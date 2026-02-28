import { logEvent } from '../internal/logging';
import { indiumSvg } from '../internal/paths';
import { shuffleCopy } from '../utils';

/**
 * Supported audio sources for tracks.
 */
export type TrackSource = 'spotify' | 'soundcloud';

/**
 * Internal track model used by WebAmp UI and transports.
 *
 * Notes:
 * - When `source` is omitted it is treated as `'spotify'` for backwards compatibility.
 * - Spotify-backed tracks typically populate `albumId`, `primaryArtistId`, and `uri`.
 * - SoundCloud-backed tracks set `source='soundcloud'` and only use the fields that
 *   make sense for that provider (no `uri` / Spotify ids).
 */
export interface Track {
    id: string;
    source?: TrackSource;
    title: string;
    artist: string;
    /**
     * Whether the provider reports this track as playable.
     * Defaults to playable when omitted.
     */
    isPlayable?: boolean;
    /**
     * External/provider URL for the track.
     * - SoundCloud: `permalink_url` (preferred for widget.load)
     * - Spotify: (unused)
     */
    permalinkUrl?: string;
    /**
     * Album id for navigation (Spotify-specific when populated)
     */
    albumId?: string;
    album?: string;
    /**
     * Primary artist id for navigation (Spotify-specific when populated)
     */
    primaryArtistId?: string;
    trackNumber?: number;
    durationSec: number;
    artUrl?: string;
    artUrlSmall?: string;
    /**
     * Optional higher-resolution artwork URL (used by mobile Now Playing)
     */
    artUrlLarge?: string;
    uri?: string;
}

/**
 * Minimal playback state used to drive UI
 */
export interface PlayerState {
    track: Track | null;
    isPlaying: boolean;
    /**
     * True while a transport is switching/loading tracks and UI should show an indeterminate
     * "loading" state for the play button.
     */
    isBusy: boolean;
    positionSec: number;
}

export type PlayerListener = (state: PlayerState) => void;

/**
 * Pluggable playback engine interface (Spotify transport implements this)
 */
export interface PlayerTransport {
    play(track: Track, positionSec?: number, opts?: { autoplay?: boolean }): Promise<void>;
    togglePlay(isPlaying: boolean): Promise<void>;
    seek(positionSec: number): Promise<void>;
}

/**
 * Clamps a number into an inclusive range
 */
function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}

/**
 * Simple player state container with queue management and optional remote transport
 */
export class PlayerStore {
    private state: PlayerState = {
        track: null,
        isPlaying: false,
        isBusy: false,
        positionSec: 0
    };

    private listeners: PlayerListener[] = [];
    private baseQueue: Track[] = [];
    private queue: Track[] = [];
    private queueWrap: boolean = false;
    private shuffleEnabled: boolean = false;
    private rafId: number | null = null;
    private lastTickMs: number | null = null;
    private lastUiEmitMs: number | null = null;
    private transport: PlayerTransport | null = null;

    private lastLoggedPlayback: { trackId: string | null; isPlaying: boolean; isBusy: boolean } | null = null;
    // When using a real transport (Spotify), we still need a local "clock" to animate progress,
    // because Web Playback SDK state updates are not emitted continuously.
    private remoteRafId: number | null = null;
    private remoteBaseMs: number | null = null;
    private remoteBasePosSec: number | null = null;
    private remoteUiEmitMs: number | null = null;

    /**
     * Tracks whether a transport (e.g. SoundCloud widget) has indicated it is
     * busy performing an async operation such as loading/switching tracks.
     * While this flag is true, remote state snapshots should not clear the
     * user's perceived "loading" spinner.
     */
    private transportBusy: boolean = false;

    constructor(seedQueue: Track[] = []) {
        this.baseQueue = seedQueue.slice();
        this.queue = seedQueue.slice();

        // Keep the global topbar "Play" button in sync with the store's
        // playing state so that clicking any track or using transport controls
        // updates its icon/label consistently.
        if (typeof window !== 'undefined') {
            window.addEventListener('wa:player:state', ((e: Event) => {
                const ev = e as CustomEvent<PlayerState>;
                const state = ev.detail;
                const actions = document.querySelector<HTMLElement>('[data-wa-queue-actions]');
                const playBtn = actions?.querySelector<HTMLButtonElement>('[data-wa-action="queue-play"]');
                const playIcon = actions?.querySelector<HTMLImageElement>('.wa-topbar__play-icon img');
                const playLabel = actions?.querySelector<HTMLElement>('.wa-topbar__play-label');

                if (!playBtn || !playIcon || !playLabel) return;

                const isPlaying = state.isPlaying && !!state.track;
                playLabel.textContent = isPlaying ? 'Pause' : 'Play';
                playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
                const src = isPlaying
                    ? indiumSvg('pause-filled.svg')
                    : indiumSvg('play-filled.svg');
                if (playIcon.getAttribute('src') !== src) {
                    playIcon.setAttribute('src', src);
                }
            }) as EventListener);
        }
    }

    /**
     * Enables/disables shuffle for the active queue.
     * This affects playback order for next/prev/auto-advance (not just "shuffle play").
     */
    setShuffleEnabled(enabled: boolean) {
        const next = !!enabled;
        if (this.shuffleEnabled === next) return;
        this.shuffleEnabled = next;
        this.applyQueueTransform();
        logEvent('WebAmp', 'queue:shuffle', { enabled: this.shuffleEnabled, size: this.queue.length });
    }

    private applyQueueTransform() {
        const currentId = this.state.track?.id ?? null;
        const base = this.baseQueue.slice();

        if (!this.shuffleEnabled) {
            this.queue = base;
        } else if (currentId) {
            const current = base.find((t) => t.id === currentId) ?? null;
            const rest = base.filter((t) => t.id !== currentId);
            this.queue = current ? [current, ...shuffleCopy(rest)] : shuffleCopy(base);
        } else {
            this.queue = shuffleCopy(base);
        }

        // Keep the selected track object aligned to the transformed queue.
        if (currentId) {
            const nextTrack = this.queue.find((t) => t.id === currentId) ?? this.state.track;
            this.state = { ...this.state, track: nextTrack ?? null };
            this.emit();
        }
    }

    /**
     * Subscribes to state changes, returns an unsubscribe function
     */
    subscribe(listener: PlayerListener): () => void {
        this.listeners.push(listener);
        listener(this.getState());
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    /**
     * Returns a shallow snapshot of current state
     */
    getState(): PlayerState {
        return { ...this.state };
    }

    setBusy(isBusy: boolean) {
        // Remember whether the underlying transport reports itself as busy.
        this.transportBusy = isBusy;
        if (this.state.isBusy === isBusy) return;
        this.state = { ...this.state, isBusy };
        this.emit();
    }

    /**
     * Replaces the current queue
     */
    setQueue(queue: Track[], opts?: { wrap?: boolean }) {
        const filtered = queue.filter((t) => t?.isPlayable !== false);
        this.baseQueue = filtered.slice();
        this.queue = filtered.slice();
        this.queueWrap = opts?.wrap ?? false;
        if (this.shuffleEnabled) {
            this.applyQueueTransform();
        }
        const size = this.queue.length;
        logEvent('WebAmp', 'queue:set', {
            size,
            filteredOut: Math.max(0, queue.length - size),
            wrap: this.queueWrap,
            firstId: this.queue[0]?.id ?? null,
            source: this.queue[0]?.source ?? null
        });
    }

    /**
     * Installs or removes a real playback transport
     */
    setTransport(transport: PlayerTransport | null) {
        this.transport = transport;
        // When a real transport is present, disable the synthetic ticker.
        if (transport) {
            if (this.rafId !== null) cancelAnimationFrame(this.rafId);
            this.rafId = null;
            this.lastTickMs = null;
            this.lastUiEmitMs = null;
            this.stopRemoteTicker();
        }
    }

    /**
     * Selects a track from the queue by id and optionally starts playback
     */
    selectTrackById(trackId: string, autoplay: boolean = true) {
        const track = this.queue.find((t) => t.id === trackId) ?? null;
        if (!track) return;
        const optimisticPlaying = this.transport ? false : !!autoplay;

        this.state = {
            track,
            isPlaying: optimisticPlaying,
            isBusy: this.transport ? !!autoplay : false,
            positionSec: 0
        };

        this.emit();
        if (this.transport) {
            // Baseline behavior: do not synthesize remote progress before the
            // transport confirms playback state.
            this.stopRemoteTicker();
            void this.transport.play(track, 0, { autoplay });
            return;
        }
        if (this.state.isPlaying) this.ensureTicker();
    }

    /**
     * Toggles play/pause, auto-selects first track if none is selected
     */
    togglePlay() {
        // If nothing is selected, choose the first track.
        if (!this.state.track && this.queue.length) {
            this.selectTrackById(this.queue[0].id, true);
            return;
        }

        if (this.transport) {
            const next = !this.state.isPlaying;
            // Any user toggle should cancel "busy" UI immediately.
            this.state = next
                ? { ...this.state, isPlaying: false, isBusy: true }
                : { ...this.state, isPlaying: false, isBusy: false };
            this.emit();
            void this.transport.togglePlay(!next /* previous */);
            // Let transport remote updates control ticker start/stop.
            this.stopRemoteTicker();
            return;
        }

        this.state = { ...this.state, isPlaying: !this.state.isPlaying };
        this.emit();
        this.ensureTicker();
    }

    /**
     * Advances to next track, stops at end unless queue wrap is enabled
     */
    next(opts?: { autoplay?: boolean }) {
        if (!this.queue.length) return;

        const shouldAutoplay = typeof opts?.autoplay === 'boolean' ? opts.autoplay : this.state.isPlaying;
        const currentId = this.state.track?.id;
        const idx = currentId ? this.queue.findIndex((t) => t.id === currentId) : -1;
        const atEnd = idx >= 0 && idx === this.queue.length - 1;
        if (atEnd && !this.queueWrap) {
            // End of list: stop playback.
            this.state = { ...this.state, isPlaying: false, positionSec: this.state.track?.durationSec ?? this.state.positionSec };
            this.emit();
            this.stopRemoteTicker();
            // If a real transport exists, also pause remote playback.
            if (this.transport) void this.transport.togglePlay(true);
            return;
        }
        const nextIdx = idx >= 0 ? (idx + 1) % this.queue.length : 0;
        this.selectTrackById(this.queue[nextIdx].id, shouldAutoplay);
    }

    /**
     * Goes to previous track, restarts track if current position > 3s
     */
    prev(opts?: { autoplay?: boolean }) {
        if (!this.queue.length) return;

        const shouldAutoplay = typeof opts?.autoplay === 'boolean' ? opts.autoplay : this.state.isPlaying;
        // If we're more than 3 seconds in, treat prev as restart.
        if (this.state.track && this.state.positionSec > 3) {
            this.seek(0);
            return;
        }

        const currentId = this.state.track?.id;
        const idx = currentId ? this.queue.findIndex((t) => t.id === currentId) : -1;
        const prevIdx = idx >= 0 ? (idx - 1 + this.queue.length) % this.queue.length : 0;
        this.selectTrackById(this.queue[prevIdx].id, shouldAutoplay);
    }

    /**
     * Seeks to an absolute position (seconds), clamps to track duration
     */
    seek(positionSec: number) {
        const duration = this.state.track?.durationSec ?? 0;
        const clamped = duration ? clamp(positionSec, 0, duration) : 0;
        this.state = { ...this.state, positionSec: clamped };
        this.emit();
        if (this.transport) {
            // Keep local "remote clock" aligned with user-driven seeks.
            this.remoteBaseMs = performance.now();
            this.remoteBasePosSec = clamped;
            if (this.state.isPlaying) this.startRemoteTicker();
            void this.transport.seek(clamped);
        }
    }

    /**
     * Seeks to a position based on a 0..1 ratio of track duration
     */
    seekByRatio(ratio: number) {
        const duration = this.state.track?.durationSec ?? 0;
        if (!duration) return;
        this.seek(duration * clamp(ratio, 0, 1));
    }

    /**
     * Update UI state from a real playback engine (e.g. Spotify Web Playback SDK)
     * without triggering local transport commands.
     */
    syncFromRemote(update: Partial<PlayerState>) {
        // Some transports temporarily emit a null track during transitions.
        // Treat that as "track unknown" (do not clear the current selection), while still applying
        // play/pause + position updates.
        const hasTrackProp = Object.prototype.hasOwnProperty.call(update, 'track');
        const incomingTrack = hasTrackProp ? (update as any).track as Track | null | undefined : undefined;

        const safeUpdate: Partial<PlayerState> =
            hasTrackProp && incomingTrack === null
                ? (({ track: _t, ...rest }) => rest)(update as any)
                : update;

        // If a non-null track is present, merge it into the existing track so that
        // navigation metadata (albumId / primaryArtistId) established by the UI
        // remains available even if the transport omits or clears those fields
        let mergedTrack: Track | null = this.state.track;
        if (hasTrackProp && incomingTrack && this.state.track) {
            const prev = this.state.track;
            const next = incomingTrack;
            mergedTrack = {
                ...prev,
                ...next,
                // Keep sticky navigation metadata when the remote snapshot does not provide it
                albumId: next.albumId ?? prev.albumId,
                primaryArtistId: next.primaryArtistId ?? prev.primaryArtistId
            };
        } else if (hasTrackProp && incomingTrack) {
            mergedTrack = incomingTrack;
        }

        const next: PlayerState = {
            ...this.state,
            ...safeUpdate,
            track: mergedTrack
        };
        // When we receive an authoritative remote update for the currently selected track,
        // clear any "busy" loading state, unless the transport has explicitly
        // reported that it is still busy (e.g. SoundCloud widget mid-load).
        const incomingId = (hasTrackProp && incomingTrack) ? incomingTrack.id : mergedTrack?.id;
        const shouldClearBusy =
            !!this.state.isBusy
            && !this.transportBusy
            && !!mergedTrack
            && typeof incomingId === 'string'
            && mergedTrack.id === incomingId
            && (typeof safeUpdate.isPlaying === 'boolean' || typeof safeUpdate.positionSec === 'number');

        this.state = shouldClearBusy ? { ...next, isBusy: false } : next;

        // Update the remote clock base whenever we get a position update.
        if (typeof safeUpdate.positionSec === 'number') {
            this.remoteBaseMs = performance.now();
            this.remoteBasePosSec = safeUpdate.positionSec;
        }

        if (typeof safeUpdate.isPlaying === 'boolean') {
            if (safeUpdate.isPlaying) this.startRemoteTicker();
            else this.stopRemoteTicker();
        }
        this.emit();
    }

    private emit() {
        const snapshot = this.getState();
        const trackId = snapshot.track?.id ?? null;
        const last = this.lastLoggedPlayback;
        if (!last || last.trackId != trackId || last.isPlaying !== snapshot.isPlaying || last.isBusy !== snapshot.isBusy) {
            logEvent('WebAmp', 'playback:state', {
                trackId,
                source: snapshot.track?.source ?? null,
                isPlaying: snapshot.isPlaying,
                isBusy: snapshot.isBusy
            });
            this.lastLoggedPlayback = { trackId, isPlaying: snapshot.isPlaying, isBusy: snapshot.isBusy };
        }
        for (const l of this.listeners) l(snapshot);
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent<PlayerState>('wa:player:state', { detail: snapshot }));
        }
    }

    private startRemoteTicker() {
        // Only used when transport exists.
        if (!this.transport) return;
        if (!this.state.isPlaying) return;
        if (this.remoteRafId !== null) return;

        const tick = (nowMs: number) => {
            if (!this.transport || !this.state.isPlaying || !this.state.track) {
                this.remoteRafId = null;
                this.remoteUiEmitMs = null;
                return;
            }

            const baseMs = this.remoteBaseMs ?? nowMs;
            const basePos = this.remoteBasePosSec ?? (this.state.positionSec ?? 0);
            const deltaSec = (nowMs - baseMs) / 1000;
            const duration = this.state.track.durationSec ?? 0;
            const nextPos = duration ? clamp(basePos + deltaSec, 0, duration) : Math.max(0, basePos + deltaSec);

            // Auto-advance at end-of-track when we own the queue.
            if (duration > 0 && nextPos >= duration - 0.35) {
                this.remoteRafId = null;
                this.remoteUiEmitMs = null;
                this.next({ autoplay: true });
                return;
            }

            // Throttle UI emissions to avoid hammering render.
            const lastEmit = this.remoteUiEmitMs ?? 0;
            if (nowMs - lastEmit >= 250) {
                this.remoteUiEmitMs = nowMs;
                this.state = { ...this.state, positionSec: nextPos };
                this.emit();
            }

            this.remoteRafId = requestAnimationFrame(tick);
        };

        this.remoteRafId = requestAnimationFrame(tick);
    }

    private stopRemoteTicker() {
        if (this.remoteRafId !== null) cancelAnimationFrame(this.remoteRafId);
        this.remoteRafId = null;
        this.remoteUiEmitMs = null;
        this.remoteBaseMs = null;
        this.remoteBasePosSec = null;
    }

    private ensureTicker() {
        if (!this.state.isPlaying) {
            if (this.rafId !== null) cancelAnimationFrame(this.rafId);
            this.rafId = null;
            this.lastTickMs = null;
            this.lastUiEmitMs = null;
            return;
        }

        // Real transport present: do not run synthetic ticker.
        if (this.transport) return;

        if (this.rafId !== null) return;

        const tick = (nowMs: number) => {
            if (!this.state.isPlaying) {
                this.rafId = null;
                this.lastTickMs = null;
                this.lastUiEmitMs = null;
                return;
            }

            const last = this.lastTickMs ?? nowMs;
            const deltaSec = (nowMs - last) / 1000;
            this.lastTickMs = nowMs;

            const duration = this.state.track?.durationSec ?? 0;
            if (duration > 0) {
                const nextPos = this.state.positionSec + deltaSec;
                if (nextPos >= duration) {
                    this.next();
                } else {
                    this.state = { ...this.state, positionSec: nextPos };
                    // Throttle UI emissions (prevents 60fps re-render + repeated image src assignment).
                    const lastEmit = this.lastUiEmitMs ?? 0;
                    if (nowMs - lastEmit >= 250) {
                        this.lastUiEmitMs = nowMs;
                    this.emit();
                    }
                }
            }

            this.rafId = requestAnimationFrame(tick);
        };

        this.rafId = requestAnimationFrame(tick);
    }
}
