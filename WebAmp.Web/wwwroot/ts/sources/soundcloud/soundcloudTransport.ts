import type { PlayerTransport, Track, TrackSource } from '../../state/playerStore';
import { showErrorDialog, formatErrorMessage } from '../../ui/errorDialog';

type PlaybackStateListener = (s: { track: Track | null; isPlaying: boolean; positionSec: number }) => void;

/**
 * Lazily loads the SoundCloud HTML5 Widget API script (SC.Widget) once.
 * This mirrors how the Spotify Web Playback SDK is loaded: only when a
 * SoundCloud-backed track is actually used for playback.
 */
let scWidgetReadyPromise: Promise<void> | null = null;

function loadSoundCloudWidgetApi(): Promise<void> {
    const w = window as any;
    if (w.SC && w.SC.Widget) {
        return Promise.resolve();
    }

    if (scWidgetReadyPromise) {
        return scWidgetReadyPromise;
    }

    scWidgetReadyPromise = new Promise<void>((resolve, reject) => {
        // If another script has already attached SC.Widget by the time we
        // run, resolve immediately.
        if (w.SC && w.SC.Widget) {
            resolve();
            return;
        }

        const existing = document.querySelector<HTMLScriptElement>('script[data-wa-sc-widget-api]');
        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error('Failed to load SoundCloud Widget API')), {
                once: true
            });
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://w.soundcloud.com/player/api.js';
        script.async = true;
        script.defer = true;
        script.setAttribute('data-wa-sc-widget-api', 'true');
        script.onload = () => {
            if (w.SC && w.SC.Widget) {
                resolve();
            } else {
                reject(new Error('SoundCloud Widget API did not initialize correctly.'));
            }
        };
        script.onerror = () => reject(new Error('Failed to load SoundCloud Widget API'));
        document.head.appendChild(script);
    });

    return scWidgetReadyPromise;
}

/**
 * PlayerTransport implementation backed by the official SoundCloud HTML5
 * widget, embedded in a hidden iframe. This avoids dealing with raw HLS
 * stream URLs and lets SoundCloud handle streaming/auth under the hood.
 *
 * Docs: https://developers.soundcloud.com/docs/api/html5-widget
 */
export class SoundCloudTransport implements PlayerTransport {
    private widget: any | null = null;
    private iframe: HTMLIFrameElement | null = null;
    private currentTrack: Track | null = null;
    private lastPositionSec: number = 0;
    private lastProgressEmitMs: number = 0;

    constructor(private readonly onRemoteState?: PlaybackStateListener) {}

    private getSource(track: Track | null): TrackSource {
        return (track?.source ?? 'spotify') as TrackSource;
    }

    private getIframe(): HTMLIFrameElement {
        if (this.iframe && document.body.contains(this.iframe)) {
            return this.iframe;
        }

        // Try to reuse an existing container if present (defensive for future markup changes).
        let container = document.querySelector<HTMLElement>('[data-wa-sc-widget-container]');
        let iframe: HTMLIFrameElement | null = null;

        if (container) {
            iframe = container.querySelector<HTMLIFrameElement>('[data-wa-sc-widget]');
        }

        // If no iframe/container are present (which is now the default), create them lazily.
        if (!iframe) {
            container = container ?? document.createElement('div');
            container.style.display = 'none';
            container.setAttribute('data-wa-sc-widget-container', 'true');

            iframe = document.createElement('iframe');
            iframe.setAttribute('data-wa-sc-widget', 'true');
            iframe.width = '100%';
            iframe.height = '166';
            iframe.scrolling = 'no';
            iframe.frameBorder = '0';
            iframe.allow = 'autoplay';
            iframe.src = 'https://w.soundcloud.com/player/?url=&auto_play=false';

            container.appendChild(iframe);
            // Attach near the end of body; location is irrelevant since the iframe is hidden.
            document.body.appendChild(container);
        }

        this.iframe = iframe;
        return iframe;
    }

    private async ensureWidget(): Promise<any> {
        if (this.widget) return this.widget;

        const iframe = this.getIframe();
        if (!iframe) {
            throw new Error('SoundCloud widget iframe not found.');
        }

        await loadSoundCloudWidgetApi();

        const w = window as any;
        if (!w.SC || !w.SC.Widget) {
            throw new Error('SoundCloud widget API is not available.');
        }

        const widget = w.SC.Widget(iframe);
        this.widget = widget;

        // Wire up basic event forwarding so PlayerStore can keep its remote
        // ticker in sync with the widget.
        const Events = w.SC.Widget.Events;

        widget.bind(Events.PLAY_PROGRESS, (e: any) => {
            const posMs = typeof e?.currentPosition === 'number' ? e.currentPosition : 0;
            this.lastPositionSec = Math.max(0, posMs / 1000);

            // Keep PlayerStore's remote clock aligned to real playback so queue auto-advance
            // happens near the actual end-of-track (and doesn't drift if the tab stalls).
            if (this.currentTrack) {
                const now = performance.now();
                if (now - this.lastProgressEmitMs >= 500) {
                    this.lastProgressEmitMs = now;
                    this.emitRemote({
                        track: this.currentTrack,
                        isPlaying: true,
                        positionSec: this.lastPositionSec
                    });
                }
            }
        });

        widget.bind(Events.PLAY, () => {
            if (!this.currentTrack) return;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: true,
                positionSec: this.lastPositionSec
            });
        });

        widget.bind(Events.PAUSE, () => {
            if (!this.currentTrack) return;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: false,
                positionSec: this.lastPositionSec
            });
        });

        widget.bind(Events.FINISH, () => {
            if (!this.currentTrack) return;
            const duration =
                (typeof this.currentTrack.durationSec === 'number' && Number.isFinite(this.currentTrack.durationSec))
                    ? this.currentTrack.durationSec
                    : this.lastPositionSec;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: false,
                positionSec: duration
            });
        });

        return widget;
    }

    private emitRemote(s: { track: Track | null; isPlaying: boolean; positionSec: number }) {
        if (!this.onRemoteState) return;
        this.onRemoteState({
            track: s.track,
            isPlaying: s.isPlaying,
            positionSec: s.positionSec
        });
    }

    private async getIsPaused(widget: any): Promise<boolean> {
        return await new Promise<boolean>((resolve) => {
            try {
                widget.isPaused((paused: any) => resolve(!!paused));
            } catch {
                // If the widget can't report pause state, assume it's paused to avoid lying to UI.
                resolve(true);
            }
        });
    }

    private async emitActualPlaybackState(widget: any): Promise<void> {
        if (!this.currentTrack) return;
        const paused = await this.getIsPaused(widget);
        this.emitRemote({
            track: this.currentTrack,
            isPlaying: !paused,
            positionSec: this.lastPositionSec
        });
    }

    /**
     * Starts playback of a SoundCloud-backed track using the widget.
     */
    async play(track: Track, positionSec: number = 0): Promise<void> {
        const source = this.getSource(track);
        if (source !== 'soundcloud') {
            // This transport is only responsible for SoundCloud tracks.
            return;
        }

        this.currentTrack = track;
        this.lastPositionSec = Math.max(0, positionSec || 0);

        try {
            const widget = await this.ensureWidget();

            const trackUrl = `https://api.soundcloud.com/tracks/${encodeURIComponent(track.id)}`;

            await new Promise<void>((resolve, reject) => {
                try {
                    // Use the documented widget.load API with auto_play. This
                    // behaves reliably after a user gesture (clicking a track
                    // in WebAmp), and matches the behavior that worked in your
                    // CodePen experiment.
                    widget.load(trackUrl, {
                        auto_play: true,
                        hide_related: true,
                        show_comments: false,
                        show_user: true,
                        show_reposts: false,
                        visual: false,
                        callback: () => {
                            // "load" callback does NOT guarantee audio actually started.
                            // Emit a conservative state (paused) and let PLAY/PAUSE events
                            // (and the isPaused probe below) reflect reality.
                            this.emitRemote({ track, isPlaying: false, positionSec: this.lastPositionSec });
                            resolve();
                        }
                    });
                } catch (err) {
                    reject(err);
                }
            });

            // Seek (best-effort) then force a play attempt. This improves:
            // - Initial autoplay reliability
            // - Auto-advance to next queue item
            if (this.lastPositionSec > 0) {
                try {
                    widget.seekTo(this.lastPositionSec * 1000);
                } catch {
                    // ignore
                }
            }
            try {
                widget.play();
            } catch {
                // ignore
            }

            // After a short delay, sync state to what the widget is actually doing.
            // (PLAY event will also fire when it really starts.)
            await new Promise<void>((r) => setTimeout(r, 300));
            await this.emitActualPlaybackState(widget);
        } catch (error) {
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            throw error;
        }
    }

    /**
     * Toggles pause/resume based on previous playing state.
     */
    async togglePlay(previouslyPlaying: boolean): Promise<void> {
        if (!this.currentTrack) return;

        try {
            const widget = await this.ensureWidget();
            // The widget keeps its own play/pause state; toggle() is simpler
            // than trying to mirror the boolean.
            widget.toggle();
            // Best-effort: sync state after toggle in case the widget doesn't emit promptly.
            setTimeout(() => {
                void this.emitActualPlaybackState(widget);
            }, 100);
        } catch (error) {
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            throw error;
        }
    }

    /**
     * Seeks within the current SoundCloud track.
     */
    async seek(positionSec: number): Promise<void> {
        if (!this.currentTrack) return;

        try {
            const widget = await this.ensureWidget();
            const nextPos = Math.max(0, positionSec || 0);
            const ms = nextPos * 1000;

            widget.seekTo(ms);
            this.lastPositionSec = nextPos;
            // Don't assume seeking implies playback.
            await this.emitActualPlaybackState(widget);
        } catch (error) {
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            throw error;
        }
    }
}

