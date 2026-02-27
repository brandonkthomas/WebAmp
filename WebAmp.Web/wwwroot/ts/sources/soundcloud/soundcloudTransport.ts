import type { PlayerTransport, Track, TrackSource } from '../../state/playerStore';
import { showErrorDialog, formatErrorMessage } from '../../ui/errorDialog';

type PlaybackStateListener = (s: { track: Track | null; isPlaying: boolean; positionSec: number }) => void;

/**
 * Lazily loads the SoundCloud HTML5 Widget API script (SC.Widget) once.
 */
let scWidgetReadyPromise: Promise<void> | null = null;

function loadSoundCloudWidgetApi(): Promise<void> {
    const w = window as any;
    if (w.SC?.Widget) {
        return Promise.resolve();
    }

    if (scWidgetReadyPromise) {
        return scWidgetReadyPromise;
    }

    scWidgetReadyPromise = new Promise<void>((resolve, reject) => {
        if (w.SC?.Widget) {
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
            if (w.SC?.Widget) resolve();
            else reject(new Error('SoundCloud Widget API did not initialize correctly.'));
        };
        script.onerror = () => reject(new Error('Failed to load SoundCloud Widget API'));
        document.head.appendChild(script);
    });

    return scWidgetReadyPromise;
}

function buildSoundCloudWidgetEmbedSrc(permalinkUrl: string): string {
    const url = encodeURIComponent(permalinkUrl);
    return `https://w.soundcloud.com/player/?url=${url}&auto_play=false&show_artwork=false&single_active=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=false`;
}

/**
 * Baseline SoundCloud transport using the official HTML5 widget API.
 * Docs: https://developers.soundcloud.com/docs/api/html5-widget
 */
export class SoundCloudTransport implements PlayerTransport {
    private widget: any | null = null;
    private iframe: HTMLIFrameElement | null = null;
    private widgetEventsBound = false;

    private currentTrack: Track | null = null;
    private lastPositionSec = 0;
    private lastProgressEmitMs = 0;
    private lastKnownPlaying = false;
    private desiredPlaying = false;
    private primed = false;

    constructor(private readonly onRemoteState?: PlaybackStateListener) {}

    /**
     * Best-effort preload of widget API.
     */
    prime(): void {
        if (this.primed) return;
        this.primed = true;
        try {
            void loadSoundCloudWidgetApi();
        } catch {
            // ignore
        }
    }

    private getSource(track: Track | null): TrackSource {
        return (track?.source ?? 'spotify') as TrackSource;
    }

    private getIframe(): HTMLIFrameElement {
        if (this.iframe && document.body.contains(this.iframe)) {
            return this.iframe;
        }

        let container = document.querySelector<HTMLElement>('[data-wa-sc-widget-container]');
        let iframe = container?.querySelector<HTMLIFrameElement>('[data-wa-sc-widget]') ?? null;

        if (!iframe) {
            container = container ?? document.createElement('div');
            container.style.position = 'fixed';
            container.style.left = '-9999px';
            container.style.top = '0';
            container.style.width = '1px';
            container.style.height = '1px';
            container.style.opacity = '0.001';
            container.style.pointerEvents = 'none';
            container.setAttribute('data-wa-sc-widget-container', 'true');

            iframe = document.createElement('iframe');
            iframe.setAttribute('data-wa-sc-widget', 'true');
            iframe.width = '100%';
            iframe.height = '166';
            iframe.scrolling = 'no';
            iframe.frameBorder = '0';
            iframe.allow = 'autoplay';
            iframe.src = buildSoundCloudWidgetEmbedSrc('https://soundcloud.com/forss/flickermood');

            container.appendChild(iframe);
            document.body.appendChild(container);
        }

        this.iframe = iframe;
        return iframe;
    }

    private createWidgetFromExistingIframe(): any {
        if (this.widget) return this.widget;
        const w = window as any;
        if (!w.SC?.Widget) {
            throw new Error('SoundCloud widget API is not available.');
        }

        this.widget = w.SC.Widget(this.getIframe());
        this.bindWidgetEvents();
        return this.widget;
    }

    private bindWidgetEvents(): void {
        if (!this.widget || this.widgetEventsBound) return;
        this.widgetEventsBound = true;

        const w = window as any;
        const Events = w.SC.Widget.Events;

        this.widget.bind(Events.ERROR, (e: any) => {
            if (!this.currentTrack) return;
            const message = typeof e === 'string'
                ? e
                : (e?.message ?? e?.error ?? e?.title ?? e?.status ?? 'SoundCloud widget error');
            void showErrorDialog(formatErrorMessage(new Error(String(message))), 'Music Service Error');
        });

        this.widget.bind(Events.PLAY_PROGRESS, (e: any) => {
            if (!this.currentTrack) return;
            const posMs = typeof e?.currentPosition === 'number' ? e.currentPosition : 0;
            this.lastPositionSec = Math.max(0, posMs / 1000);

            const now = performance.now();
            if (now - this.lastProgressEmitMs < 350) return;
            this.lastProgressEmitMs = now;

            this.emitRemote({
                track: this.currentTrack,
                isPlaying: true,
                positionSec: this.lastPositionSec
            });
        });

        this.widget.bind(Events.PLAY, () => {
            if (!this.currentTrack) return;
            this.lastKnownPlaying = true;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: true,
                positionSec: this.lastPositionSec
            });
        });

        this.widget.bind(Events.PAUSE, () => {
            if (!this.currentTrack) return;
            this.lastKnownPlaying = false;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: false,
                positionSec: this.lastPositionSec
            });
        });

        this.widget.bind(Events.SEEK, (e: any) => {
            const posMs = typeof e?.currentPosition === 'number' ? e.currentPosition : 0;
            this.lastPositionSec = Math.max(0, posMs / 1000);
        });

        this.widget.bind(Events.FINISH, () => {
            if (!this.currentTrack) return;
            this.lastKnownPlaying = false;
            const finishedId = this.currentTrack.id;
            const duration = Number.isFinite(this.currentTrack.durationSec)
                ? this.currentTrack.durationSec
                : this.lastPositionSec;

            this.emitRemote({
                track: this.currentTrack,
                isPlaying: false,
                positionSec: duration
            });

            queueMicrotask(() => {
                if (this.currentTrack?.id !== finishedId) return;
                window.dispatchEvent(new CustomEvent('wa:transport:finish', {
                    detail: { source: 'soundcloud', trackId: finishedId }
                }));
            });
        });
    }

    private async ensureWidget(): Promise<any> {
        if (this.widget) return this.widget;
        await loadSoundCloudWidgetApi();
        return this.createWidgetFromExistingIframe();
    }

    private async callWidgetGetter<T>(
        widget: any,
        invoke: (cb: (value: T) => void) => void,
        timeoutMs: number,
        fallback: T
    ): Promise<T> {
        return await new Promise<T>((resolve) => {
            let settled = false;
            const timeout = window.setTimeout(() => {
                if (settled) return;
                settled = true;
                resolve(fallback);
            }, timeoutMs);

            try {
                invoke((value: T) => {
                    if (settled) return;
                    settled = true;
                    window.clearTimeout(timeout);
                    resolve(value);
                });
            } catch {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                resolve(fallback);
            }
        });
    }

    private async getIsPaused(widget: any, timeoutMs: number = 700): Promise<boolean> {
        return await this.callWidgetGetter<boolean>(widget, (cb) => widget.isPaused(cb), timeoutMs, true);
    }

    private async getPositionMs(widget: any, timeoutMs: number = 700): Promise<number> {
        const value = await this.callWidgetGetter<number>(widget, (cb) => widget.getPosition(cb), timeoutMs, 0);
        return Number.isFinite(value) ? value : 0;
    }

    private emitRemote(s: { track: Track | null; isPlaying: boolean; positionSec: number }) {
        if (!this.onRemoteState) return;
        this.onRemoteState({
            track: s.track,
            isPlaying: s.isPlaying,
            positionSec: s.positionSec
        });
    }

    private async emitActualPlaybackState(widget: any): Promise<void> {
        if (!this.currentTrack) return;
        const posMs = await this.getPositionMs(widget, 700);
        this.lastPositionSec = Math.max(0, posMs / 1000);
        const paused = await this.getIsPaused(widget, 700);
        this.emitRemote({
            track: this.currentTrack,
            isPlaying: !paused,
            positionSec: this.lastPositionSec
        });
    }

    async play(track: Track, positionSec: number = 0, opts?: { autoplay?: boolean }): Promise<void> {
        const source = this.getSource(track);
        if (source !== 'soundcloud') return;

        const autoplay = (typeof opts?.autoplay === 'boolean')
            ? opts.autoplay
            : this.lastKnownPlaying;

        this.desiredPlaying = autoplay;
        this.currentTrack = track;
        this.lastPositionSec = Math.max(0, positionSec || 0);
        this.lastProgressEmitMs = 0;

        try {
            if (autoplay) {
                try {
                    window.dispatchEvent(new CustomEvent('wa:transport:busy', { detail: { busy: true } }));
                } catch {
                    // ignore
                }
            }

            const widget = await this.ensureWidget();
            const trackUrl =
                (typeof (track as any)?.permalinkUrl === 'string' && (track as any).permalinkUrl.trim().length)
                    ? (track as any).permalinkUrl.trim()
                    : `https://api.soundcloud.com/tracks/${encodeURIComponent(track.id)}`;

            const desiredPosMs = Math.max(0, this.lastPositionSec * 1000);

            await new Promise<void>((resolve, reject) => {
                try {
                    widget.load(trackUrl, {
                        auto_play: autoplay,
                        show_artwork: false,
                        hide_related: true,
                        show_comments: false,
                        show_user: false,
                        show_reposts: false,
                        single_active: false,
                        visual: false,
                        callback: () => {
                            // Keep starting position deterministic on each track load.
                            try { widget.seekTo(desiredPosMs); } catch { /* ignore */ }
                            resolve();
                        }
                    });
                } catch (err) {
                    reject(err);
                }
            });

            if (autoplay && this.desiredPlaying) {
                try { widget.play(); } catch { /* ignore */ }

                // Single soft retry if widget reports paused right after load.
                const paused = await this.getIsPaused(widget, 700);
                if (paused && this.desiredPlaying) {
                    await new Promise<void>((r) => setTimeout(r, 120));
                    try { widget.play(); } catch { /* ignore */ }
                }
            }

            await this.emitActualPlaybackState(widget);
        } catch (error) {
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            throw error;
        } finally {
            if (autoplay) {
                try {
                    window.dispatchEvent(new CustomEvent('wa:transport:busy', { detail: { busy: false } }));
                } catch {
                    // ignore
                }
            }
        }
    }

    async togglePlay(previouslyPlaying: boolean): Promise<void> {
        if (!this.currentTrack) return;
        const startingPlayback = !previouslyPlaying;

        if (startingPlayback) {
            try {
                window.dispatchEvent(new CustomEvent('wa:transport:busy', { detail: { busy: true } }));
            } catch {
                // ignore
            }
        }

        try {
            const widget = await this.ensureWidget();
            this.desiredPlaying = !previouslyPlaying;

            if (previouslyPlaying) {
                widget.pause();
            } else {
                widget.play();
                const paused = await this.getIsPaused(widget, 700);
                if (paused && this.desiredPlaying) {
                    await new Promise<void>((r) => setTimeout(r, 100));
                    try { widget.play(); } catch { /* ignore */ }
                }
            }

            await this.emitActualPlaybackState(widget);
        } catch (error) {
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            throw error;
        } finally {
            if (startingPlayback) {
                try {
                    window.dispatchEvent(new CustomEvent('wa:transport:busy', { detail: { busy: false } }));
                } catch {
                    // ignore
                }
            }
        }
    }

    async seek(positionSec: number): Promise<void> {
        if (!this.currentTrack) return;

        try {
            const widget = await this.ensureWidget();
            const nextPos = Math.max(0, positionSec || 0);
            widget.seekTo(nextPos * 1000);
            this.lastPositionSec = nextPos;
            await this.emitActualPlaybackState(widget);
        } catch (error) {
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            throw error;
        }
    }
}
