export interface Track {
    id: string;
    title: string;
    artist: string;
    durationSec: number;
    artUrl?: string;
}

export interface PlayerState {
    track: Track | null;
    isPlaying: boolean;
    positionSec: number;
}

export type PlayerListener = (state: PlayerState) => void;

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}

export class PlayerStore {
    private state: PlayerState = {
        track: null,
        isPlaying: false,
        positionSec: 0
    };

    private listeners: PlayerListener[] = [];
    private queue: Track[] = [];
    private rafId: number | null = null;
    private lastTickMs: number | null = null;

    constructor(seedQueue: Track[] = []) {
        this.queue = seedQueue.slice();
    }

    subscribe(listener: PlayerListener): () => void {
        this.listeners.push(listener);
        listener(this.getState());
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    getState(): PlayerState {
        return { ...this.state };
    }

    setQueue(queue: Track[]) {
        this.queue = queue.slice();
    }

    selectTrackById(trackId: string, autoplay: boolean = true) {
        const track = this.queue.find((t) => t.id === trackId) ?? null;
        if (!track) return;

        this.state = {
            track,
            isPlaying: autoplay ? true : this.state.isPlaying,
            positionSec: 0
        };

        this.emit();
        if (this.state.isPlaying) this.ensureTicker();
    }

    togglePlay() {
        // If nothing is selected, choose the first track.
        if (!this.state.track && this.queue.length) {
            this.selectTrackById(this.queue[0].id, true);
            return;
        }

        this.state = { ...this.state, isPlaying: !this.state.isPlaying };
        this.emit();
        this.ensureTicker();
    }

    next() {
        if (!this.queue.length) return;

        const currentId = this.state.track?.id;
        const idx = currentId ? this.queue.findIndex((t) => t.id === currentId) : -1;
        const nextIdx = idx >= 0 ? (idx + 1) % this.queue.length : 0;
        this.selectTrackById(this.queue[nextIdx].id, true);
    }

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

    seek(positionSec: number) {
        const duration = this.state.track?.durationSec ?? 0;
        const clamped = duration ? clamp(positionSec, 0, duration) : 0;
        this.state = { ...this.state, positionSec: clamped };
        this.emit();
    }

    seekByRatio(ratio: number) {
        const duration = this.state.track?.durationSec ?? 0;
        if (!duration) return;
        this.seek(duration * clamp(ratio, 0, 1));
    }

    private emit() {
        const snapshot = this.getState();
        for (const l of this.listeners) l(snapshot);
    }

    private ensureTicker() {
        if (!this.state.isPlaying) {
            if (this.rafId !== null) cancelAnimationFrame(this.rafId);
            this.rafId = null;
            this.lastTickMs = null;
            return;
        }

        if (this.rafId !== null) return;

        const tick = (nowMs: number) => {
            if (!this.state.isPlaying) {
                this.rafId = null;
                this.lastTickMs = null;
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
                    this.emit();
                }
            }

            this.rafId = requestAnimationFrame(tick);
        };

        this.rafId = requestAnimationFrame(tick);
    }
}
