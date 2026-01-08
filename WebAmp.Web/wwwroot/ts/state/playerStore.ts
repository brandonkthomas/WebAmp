/**
 * Internal track model used by WebAmp UI and transports
 */
export interface Track {
    id: string;
    title: string;
    artist: string;
    /**
     * Spotify album id for navigation (if known)
     */
    albumId?: string;
    album?: string;
    /**
     * Primary Spotify artist id for navigation (if known)
     */
    primaryArtistId?: string;
    trackNumber?: number;
    durationSec: number;
    artUrl?: string;
    artUrlSmall?: string;
    uri?: string;
}

/**
 * Minimal playback state used to drive UI
 */
export interface PlayerState {
    track: Track | null;
    isPlaying: boolean;
    positionSec: number;
}

export type PlayerListener = (state: PlayerState) => void;

/**
 * Pluggable playback engine interface (Spotify transport implements this)
 */
export interface PlayerTransport {
    play(track: Track, positionSec?: number): Promise<void>;
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
        positionSec: 0
    };

    private listeners: PlayerListener[] = [];
    private queue: Track[] = [];
    private queueWrap: boolean = false;
    private rafId: number | null = null;
    private lastTickMs: number | null = null;
    private lastUiEmitMs: number | null = null;
    private transport: PlayerTransport | null = null;

    // When using a real transport (Spotify), we still need a local "clock" to animate progress,
    // because Web Playback SDK state updates are not emitted continuously.
    private remoteRafId: number | null = null;
    private remoteBaseMs: number | null = null;
    private remoteBasePosSec: number | null = null;
    private remoteUiEmitMs: number | null = null;

    constructor(seedQueue: Track[] = []) {
        this.queue = seedQueue.slice();
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

    /**
     * Replaces the current queue
     */
    setQueue(queue: Track[], opts?: { wrap?: boolean }) {
        this.queue = queue.slice();
        this.queueWrap = opts?.wrap ?? false;
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

        this.state = {
            track,
            isPlaying: autoplay ? true : this.state.isPlaying,
            positionSec: 0
        };

        this.emit();
        if (this.transport && autoplay) {
            // Start local progress immediately; remote state updates may arrive later.
            this.remoteBaseMs = performance.now();
            this.remoteBasePosSec = 0;
            this.startRemoteTicker();
            void this.transport.play(track, 0);
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
            this.state = { ...this.state, isPlaying: next };
            this.emit();
            void this.transport.togglePlay(!next /* previous */);
            if (next) this.startRemoteTicker();
            else this.stopRemoteTicker();
            return;
        }

        this.state = { ...this.state, isPlaying: !this.state.isPlaying };
        this.emit();
        this.ensureTicker();
    }

    /**
     * Advances to next track, stops at end unless queue wrap is enabled
     */
    next() {
        if (!this.queue.length) return;

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
        this.selectTrackById(this.queue[nextIdx].id, true);
    }

    /**
     * Goes to previous track, restarts track if current position > 3s
     */
    prev() {
        if (!this.queue.length) return;

        // If we're more than 3 seconds in, treat prev as restart.
        if (this.state.track && this.state.positionSec > 3) {
            this.seek(0);
            return;
        }

        const currentId = this.state.track?.id;
        const idx = currentId ? this.queue.findIndex((t) => t.id === currentId) : -1;
        const prevIdx = idx >= 0 ? (idx - 1 + this.queue.length) % this.queue.length : 0;
        this.selectTrackById(this.queue[prevIdx].id, true);
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
        this.state = next;

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
        for (const l of this.listeners) l(snapshot);
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
                this.next();
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
