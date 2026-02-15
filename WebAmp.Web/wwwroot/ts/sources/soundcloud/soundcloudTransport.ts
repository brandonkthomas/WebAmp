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

function buildSoundCloudWidgetEmbedSrc(permalinkUrl: string): string {
    const url = encodeURIComponent(permalinkUrl);
    // Use the same query params we pass to widget.load() so the initial iframe render
    // does not crash the widget (empty `url=` now 404s and throws inside widget JS).
    return `https://w.soundcloud.com/player/?url=${url}&auto_play=false&show_artwork=false&single_active=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=false`;
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
    /**
     * Starting position (in seconds) for the current playback session.
     * For WebAmp's SoundCloud provider this is always 0 when switching tracks,
     * but we track it explicitly so we can detect and ignore stale progress
     * events from the previous track.
     */
    private sessionStartPositionSec: number = 0;
    private lastProgressEmitMs: number = 0;
    private sessionId: number = 0;
    private sessionStarted: boolean = false;
    /**
     * True between `play()` starting a new track and the first sane PLAY_PROGRESS
     * reading for that track. While this is true, we ignore large jumps away from
     * `sessionStartPositionSec` so that late PLAY_PROGRESS events for the previous
     * track can't poison the new track's starting position.
     */
    private awaitingInitialProgress: boolean = false;
    private awaitingReadySessionId: number | null = null;
    private awaitingReadyResolve: (() => void) | null = null;
    private lastKnownPlaying: boolean = false;
    private desiredPlaying: boolean = false;
    private primed: boolean = false;

    constructor(private readonly onRemoteState?: PlaybackStateListener) {}

    /**
     * Best-effort "warm up" to avoid Safari losing user activation on first play:
     * - create hidden iframe
     * - start loading SC.Widget api.js
     * - create widget instance + bind events
     *
     * Safe to call multiple times.
     */
    prime(): void {
        if (this.primed) return;
        this.primed = true;
        try {
            // Only preload the widget API script. Do NOT create the iframe/widget yet:
            // creating an iframe with an empty `url=` embed crashes the widget in Safari,
            // and we don't need the iframe until we have a real track URL.
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

        // Try to reuse an existing container if present (defensive for future markup changes).
        let container = document.querySelector<HTMLElement>('[data-wa-sc-widget-container]');
        let iframe: HTMLIFrameElement | null = null;

        if (container) {
            iframe = container.querySelector<HTMLIFrameElement>('[data-wa-sc-widget]');
        }

        // If no iframe/container are present (which is now the default), create them lazily.
        if (!iframe) {
            container = container ?? document.createElement('div');
            // IMPORTANT (iOS Safari): Avoid display:none for media iframes.
            // Keeping it offscreen is more reliable than fully non-rendered.
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
            // Allow autoplay so the widget can advance within the same media element
            // when the user has already interacted with the page (important on iOS/Safari).
            iframe.allow = 'autoplay';
            // Initial src must be a valid embed; empty `url=` now 404s and can crash the widget JS.
            // This is just a placeholder; real configuration is provided via widget.load().
            iframe.src = buildSoundCloudWidgetEmbedSrc('https://soundcloud.com/forss/flickermood');

            container.appendChild(iframe);
            // Attach near the end of body; location is irrelevant since the iframe is hidden.
            document.body.appendChild(container);
        }

        this.iframe = iframe;
        return iframe;
    }

    private createWidgetFromExistingIframe(): any {
        if (this.widget) return this.widget;
        const w = window as any;
        if (!w.SC || !w.SC.Widget) {
            throw new Error('SoundCloud widget API is not available.');
        }
        const iframe = this.getIframe();
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
            // Some Safari/iOS runs emit a null-ish ERROR early (e.g. placeholder embed).
            // Don't surface that as a user-visible dialog.
            if (!this.currentTrack) return;
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
            // noop
        });

        widget.bind(Events.PLAY_PROGRESS, (e: any) => {
            if (!this.sessionStarted) return;
            const posMs = typeof e?.currentPosition === 'number' ? e.currentPosition : 0;
            const nextPosSec = Math.max(0, posMs / 1000);

            if (this.awaitingInitialProgress) {
                const deltaFromStart = Math.abs(nextPosSec - this.sessionStartPositionSec);
                if (deltaFromStart > 2) return;
                this.awaitingInitialProgress = false;
            }

            this.lastPositionSec = nextPosSec;

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
            if (!this.sessionStarted) return;
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

    private async ensureWidget(): Promise<any> {
        if (this.widget) return this.widget;

        const w = window as any;
        if (w.SC && w.SC.Widget) {
            // Script already present: create/bind synchronously (avoids user-activation loss).
            return this.createWidgetFromExistingIframe();
        }

        await loadSoundCloudWidgetApi();
        return this.createWidgetFromExistingIframe();
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

    private async waitForCurrentSoundId(widget: any, expectedTrackId: string, timeoutMs: number = 1600): Promise<boolean> {
        const expected = String(expectedTrackId);
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            try {
                const s = await this.getCurrentSound(widget, 650);
                const id = (s && (s.id ?? s.soundId ?? s.sound_id)) as any;
                if (id != null && String(id) === expected) return true;
            } catch {
                // ignore and retry
            }
            await new Promise<void>((r) => setTimeout(r, 90));
        }
        return false;
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
            // Avoid reading a stale position during a track transition by verifying the current sound id.
            const ok = await this.waitForCurrentSoundId(widget, this.currentTrack.id, 650);
            if (ok) {
                const posMs = await this.getPositionMs(widget, 500);
                const posSec = Math.max(0, posMs / 1000);
                // Only accept sane values.
                if (Number.isFinite(posSec)) this.lastPositionSec = posSec;
            }
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
        this.desiredPlaying = autoplay;
        const userGestureActive = (() => {
            try {
                return !!(navigator as any)?.userActivation?.isActive;
            } catch {
                return false;
            }
        })();

        // New playback session: reset progress tracking so we don't leak previous track position.
        this.sessionId++;
        this.sessionStarted = false;
        this.lastProgressEmitMs = 0;
        this.currentTrack = track;
        this.lastPositionSec = Math.max(0, positionSec || 0);
        this.sessionStartPositionSec = this.lastPositionSec;
        // Until we see a sane first PLAY_PROGRESS tick for this session, ignore
        // any large jumps coming from the widget (they are typically late events
        // from the previous track).
        this.awaitingInitialProgress = true;

        try {
            // iOS Safari is extremely sensitive to user-gesture boundaries for cross-origin media.
            // If the widget already exists, DO NOT `await` before calling widget.load(), otherwise
            // we may lose the activation and Safari will "load then pause".
            let widget = this.widget;
            if (!widget) {
                widget = await this.ensureWidget();
            }
            const sessionAtStart = this.sessionId;

            // Prefer SoundCloud permalinks when available; the widget is most reliable with them.
            // Fallback to API track URL (some tracks may require a client_id when using API urls).
            const trackUrl =
                (typeof (track as any)?.permalinkUrl === 'string' && (track as any).permalinkUrl.trim().length)
                    ? (track as any).permalinkUrl.trim()
                    : `https://api.soundcloud.com/tracks/${encodeURIComponent(track.id)}`;

            if (autoplay) {
                try {
                    window.dispatchEvent(new CustomEvent('wa:transport:busy', { detail: { busy: true } }));
                } catch {
                    // ignore
                }
            }

            // Wait for widget READY after we call load(). On iOS/Safari, calling play/seek
            // too early is a common cause of "it just pauses".
            const readyAfterLoad = new Promise<void>((resolve) => {
                this.awaitingReadySessionId = sessionAtStart;
                this.awaitingReadyResolve = resolve;
            });

            const loadCallback = new Promise<void>((resolve, reject) => {
                try {
                    // Use the documented widget.load(url, options) API.
                    // Per docs, existing event listeners remain active across loads.
                    // Docs: https://developers.soundcloud.com/docs/api/html5-widget#methods
                    widget.load(trackUrl, {
                        // Let the widget handle in-iframe autoplay when appropriate.
                        // This is often treated more leniently by mobile Safari than a
                        // cross-frame widget.play() call, as long as the user has
                        // previously interacted with the page.
                        auto_play: autoplay,
                        // The iframe is hidden, so artwork and most UI chrome are wasted.
                        show_artwork: false,
                        hide_related: true,
                        show_comments: false,
                        show_user: false,
                        show_reposts: false,
                        // We only ever keep a single hidden widget iframe around, but
                        // be explicit so other embeds on the page don't toggle it off.
                        single_active: false,
                        visual: false,
                        callback: () => {
                            // Callback indicates the widget is ready to accept external calls,
                            // but we also await the READY event (more reliable on iOS/Safari).
                            this.emitRemote({ track, isPlaying: false, positionSec: this.lastPositionSec });
                            resolve();
                        }
                    });

                    // Safari/iOS: if this play() call was triggered by a real user gesture
                    // (tap/click), issue a best-effort play() immediately in the same task.
                    // This keeps us within the activation window without waiting for READY.
                    if (autoplay && this.desiredPlaying && userGestureActive) {
                        try {
                            widget.play();
                        } catch {
                            // ignore
                        }
                    }
                } catch (err) {
                    reject(err);
                }
            });

            await loadCallback;

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

            // Ensure the widget has actually switched to the new sound before we seek.
            // Otherwise seekTo() can apply to the previous track and the new track will start
            // at the old timestamp (and only reset to 0 if the new track is shorter).
            await this.waitForCurrentSoundId(widget, track.id, 1800);
            if (this.sessionId !== sessionAtStart) return;

            // Now safe to seek.
            try {
                const desiredPosSec = Math.max(0, this.lastPositionSec || 0);
                if (desiredPosSec > 0.01) {
                    // Resume playback at the requested timestamp.
                    widget.seekTo(desiredPosSec * 1000);
                } else {
                    // Track changes sometimes "carry over" the previous track's timestamp inside the widget.
                    // Don't blindly call seekTo(0) (Safari can be finicky); instead, only reset if we
                    // detect the widget actually started at a non-zero position.
                    try {
                        const currentPosMs = await this.getPositionMs(widget, 450);
                        if (currentPosMs > 1200) {
                            widget.seekTo(0);
                        }
                    } catch {
                        // If we can't read position, do not force seekTo(0).
                    }
                }
            } catch {
                // ignore
            }

            // If autoplay was requested but Safari leaves us paused, try a single "kick" play()
            // after READY. This is important for:
            // - next/prev taps when state drifted to paused
            // - auto-advance between tracks (no direct user gesture at that moment)
            if (autoplay && this.desiredPlaying) {
                try {
                    const paused = await this.getIsPaused(widget);
                    if (paused) {
                        try { widget.play(); } catch { /* ignore */ }
                    }
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

    /**
     * Toggles pause/resume based on previous playing state.
     */
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
            // Same iOS/Safari user-gesture rule: if the widget already exists, do not `await`
            // before issuing play/pause.
            const widget = this.widget ?? (await this.ensureWidget());
            // Explicit play/pause is more deterministic than widget.toggle().
            this.desiredPlaying = !previouslyPlaying;
            if (previouslyPlaying) widget.pause();
            else widget.play();
            // Best-effort: sync state after toggle in case the widget doesn't emit promptly.
            setTimeout(() => {
                void this.emitActualPlaybackState(widget);
            }, 100);
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

    /**
     * Seeks within the current SoundCloud track.
     */
    async seek(positionSec: number): Promise<void> {
        if (!this.currentTrack) return;

        try {
            // If we already have the widget, avoid an async boundary before seek.
            const widget = this.widget ?? (await this.ensureWidget());
            const nextPos = Math.max(0, positionSec || 0);
            const ms = nextPos * 1000;

            widget.seekTo(ms);
            this.lastPositionSec = nextPos;
            // An explicit seek defines a new "expected" position; do not apply the
            // initial-progress guard for this session any more.
            this.sessionStartPositionSec = nextPos;
            this.awaitingInitialProgress = false;
            // Don't assume seeking implies playback.
            await this.emitActualPlaybackState(widget);
        } catch (error) {
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            throw error;
        }
    }
}
