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
    private sessionId: number = 0;
    private sessionStarted: boolean = false;
    private awaitingReadySessionId: number | null = null;
    private awaitingReadyResolve: (() => void) | null = null;
    private lastKnownPlaying: boolean = false;

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

        const widgetErrorToError = (e: any): Error => {
            try {
                if (e && typeof e === 'object') {
                    const msg = (e.message ?? e.error ?? e.title ?? e.status) as any;
                    if (typeof msg === 'string' && msg.trim().length) return new Error(msg);
                }
                if (typeof e === 'string' && e.trim().length) return new Error(e);
            } catch {
                // ignore
            }
            return new Error('SoundCloud widget error');
        };

        widget.bind(Events.ERROR, (e: any) => {
            const err = widgetErrorToError(e);
            void showErrorDialog(formatErrorMessage(err), 'Music Service Error');
        });

        widget.bind(Events.READY, () => {
            const expected = this.awaitingReadySessionId;
            if (expected === null) return;
            // Resolve the pending "ready after load" promise for the active session.
            if (expected === this.sessionId && this.awaitingReadyResolve) {
                const resolve = this.awaitingReadyResolve;
                this.awaitingReadyResolve = null;
                this.awaitingReadySessionId = null;
                resolve();
            }
        });

        widget.bind(Events.LOAD_PROGRESS, (_e: any) => {
            // We don't currently surface load progress, but binding it helps document
            // supported widget events and makes future buffering UI straightforward.
        });

        widget.bind(Events.PLAY_PROGRESS, (e: any) => {
            const posMs = typeof e?.currentPosition === 'number' ? e.currentPosition : 0;
            this.lastPositionSec = Math.max(0, posMs / 1000);

            // Keep PlayerStore's remote clock aligned to real playback so queue auto-advance
            // happens near the actual end-of-track (and doesn't drift if the tab stalls).
            if (this.currentTrack && this.sessionStarted) {
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
            this.sessionStarted = true;
            this.lastKnownPlaying = true;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: true,
                positionSec: this.lastPositionSec
            });
        });

        widget.bind(Events.PAUSE, () => {
            if (!this.currentTrack) return;
            this.lastKnownPlaying = false;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: false,
                positionSec: this.lastPositionSec
            });
        });

        widget.bind(Events.SEEK, (e: any) => {
            const posMs = typeof e?.currentPosition === 'number' ? e.currentPosition : 0;
            this.lastPositionSec = Math.max(0, posMs / 1000);
        });

        widget.bind(Events.FINISH, () => {
            if (!this.currentTrack) return;
            this.lastKnownPlaying = false;
            const finishedId = this.currentTrack.id;
            const duration =
                (typeof this.currentTrack.durationSec === 'number' && Number.isFinite(this.currentTrack.durationSec))
                    ? this.currentTrack.durationSec
                    : this.lastPositionSec;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: false,
                positionSec: duration
            });

            // Explicitly notify the app layer to advance the queue.
            // We guard by track id so a late FINISH event can't advance a newer track.
            try {
                queueMicrotask(() => {
                    if (this.currentTrack?.id !== finishedId) return;
                    window.dispatchEvent(new CustomEvent('wa:transport:finish', { detail: { source: 'soundcloud', trackId: finishedId } }));
                });
            } catch {
                // ignore
            }
        });

        return widget;
    }

    private async callWidgetGetter<T>(
        invoke: (cb: (value: T) => void) => void,
        timeoutMs: number,
        fallback?: T
    ): Promise<T> {
        return await new Promise<T>((resolve, reject) => {
            let done = false;
            const t = window.setTimeout(() => {
                if (done) return;
                done = true;
                if (arguments.length >= 3) resolve(fallback as T);
                else reject(new Error('SoundCloud widget did not respond'));
            }, timeoutMs);

            try {
                invoke((value: T) => {
                    if (done) return;
                    done = true;
                    window.clearTimeout(t);
                    resolve(value);
                });
            } catch (err) {
                if (done) return;
                done = true;
                window.clearTimeout(t);
                reject(err);
            }
        });
    }

    private async getPositionMs(widget: any, timeoutMs: number = 800): Promise<number> {
        const ms = await this.callWidgetGetter<number>((cb) => widget.getPosition(cb), timeoutMs, 0);
        return (typeof ms === 'number' && Number.isFinite(ms)) ? ms : 0;
    }

    private async getDurationMs(widget: any, timeoutMs: number = 800): Promise<number> {
        const ms = await this.callWidgetGetter<number>((cb) => widget.getDuration(cb), timeoutMs, 0);
        return (typeof ms === 'number' && Number.isFinite(ms)) ? ms : 0;
    }

    private async getCurrentSound(widget: any, timeoutMs: number = 800): Promise<any | null> {
        return await this.callWidgetGetter<any>((cb) => widget.getCurrentSound(cb), timeoutMs, null);
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
        // If the widget can't report pause state or is unresponsive, assume paused to avoid lying to UI.
        return await this.callWidgetGetter<boolean>((cb) => widget.isPaused(cb), 800, true);
    }

    private async emitActualPlaybackState(widget: any): Promise<void> {
        if (!this.currentTrack) return;
        // Validate position via widget getters whenever possible (helps avoid scrubbing jumps).
        try {
            const posMs = await this.getPositionMs(widget, 500);
            const posSec = Math.max(0, posMs / 1000);
            // Only accept sane values.
            if (Number.isFinite(posSec)) this.lastPositionSec = posSec;
        } catch {
            // ignore
        }
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
    async play(track: Track, positionSec: number = 0, opts?: { autoplay?: boolean }): Promise<void> {
        const source = this.getSource(track);
        if (source !== 'soundcloud') {
            // This transport is only responsible for SoundCloud tracks.
            return;
        }

        const autoplay = (typeof opts?.autoplay === 'boolean')
            ? opts.autoplay
            : this.lastKnownPlaying;

        // New playback session: reset progress tracking so we don't leak previous track position.
        this.sessionId++;
        this.sessionStarted = false;
        this.lastProgressEmitMs = 0;
        this.currentTrack = track;
        this.lastPositionSec = Math.max(0, positionSec || 0);

        try {
            const widget = await this.ensureWidget();
            const sessionAtStart = this.sessionId;

            const trackUrl = `https://api.soundcloud.com/tracks/${encodeURIComponent(track.id)}`;

            // Wait for widget READY after we call load(). On iOS/Safari, calling play/seek
            // too early is a common cause of "it just pauses".
            const readyAfterLoad = new Promise<void>((resolve) => {
                this.awaitingReadySessionId = sessionAtStart;
                this.awaitingReadyResolve = resolve;
            });

            await new Promise<void>((resolve, reject) => {
                try {
                    // Use the documented widget.load(url, options) API.
                    // Per docs, existing event listeners remain active across loads.
                    // Docs: https://developers.soundcloud.com/docs/api/html5-widget#playground
                    widget.load(trackUrl, {
                        // We explicitly play() only if we were previously playing.
                        auto_play: false,
                        hide_related: true,
                        show_comments: false,
                        show_user: true,
                        show_reposts: false,
                        visual: false,
                        callback: () => {
                            // Callback indicates the widget is ready to accept external calls,
                            // but we also await the READY event (more reliable on iOS/Safari).
                            this.emitRemote({ track, isPlaying: false, positionSec: this.lastPositionSec });
                            resolve();
                        }
                    });
                } catch (err) {
                    reject(err);
                }
            });

            // If another track started while we were loading, abort.
            if (this.sessionId !== sessionAtStart) return;

            // Wait for READY after load (with a timeout so we don't hang forever).
            const readyWon = await Promise.race([
                readyAfterLoad.then(() => true),
                new Promise<boolean>((r) => setTimeout(() => r(false), 1500))
            ]);
            if (this.sessionId !== sessionAtStart) return;

            if (!readyWon) {
                // Don't fail immediately: probe the widget API to see if it's alive.
                // If getters respond, proceed cautiously; otherwise treat as failed.
                const alive = await (async () => {
                    try {
                        await this.getCurrentSound(widget, 650);
                        return true;
                    } catch {
                        // try a cheaper probe
                        try {
                            await this.getIsPaused(widget);
                            return true;
                        } catch {
                            return false;
                        }
                    }
                })();
                if (!alive) {
                    throw new Error('SoundCloud did not respond.');
                }
            }

            // Now safe to seek. Always seek (even to 0) to prevent "carry over" positions.
            try {
                widget.seekTo(this.lastPositionSec * 1000);
            } catch {
                // ignore
            }

            // Only attempt to play if caller says we should be playing (e.g., we were previously playing).
            if (autoplay) {
                try {
                    widget.play();
                } catch {
                    // ignore
                }
            }

            // Validate duration/position after load for sanity (best-effort).
            try {
                const [_posMs, _durMs] = await Promise.all([
                    this.getPositionMs(widget, 650),
                    this.getDurationMs(widget, 650)
                ]);
                // lastPositionSec is already tracked; we just force a sane range check.
                if (this.currentTrack?.durationSec && _durMs > 0) {
                    // no-op; future: we could reconcile durationSec if API is more accurate.
                }
            } catch {
                // ignore
            }

            await new Promise<void>((r) => setTimeout(r, 250));
            if (this.sessionId !== sessionAtStart) return;
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
            // Explicit play/pause is more deterministic than widget.toggle().
            if (previouslyPlaying) widget.pause();
            else widget.play();
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

