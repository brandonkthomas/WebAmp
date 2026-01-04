import type { MusicSource, MusicSourceListener, MusicSourceState } from './musicSource';

/**
 * In-memory MusicSource stub for UI/dev flows without OAuth
 */
export class SpotifySourceStub implements MusicSource {
    id = 'spotify' as const;
    displayName = 'Spotify';

    private state: MusicSourceState = { isConnected: false };
    private listeners: MusicSourceListener[] = [];

    getState(): MusicSourceState {
        return { ...this.state };
    }

    onChange(listener: MusicSourceListener): () => void {
        this.listeners.push(listener);
        listener(this.getState());
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    /**
     * Simulates connect latency then flips `isConnected` true
     */
    async connect(): Promise<void> {
        // UI-only stub: real OAuth/PKCE will be implemented later.
        await new Promise((r) => setTimeout(r, 250));
        this.state = { isConnected: true };
        this.emit();
    }

    /**
     * Flips `isConnected` false and emits
     */
    async disconnect(): Promise<void> {
        this.state = { isConnected: false };
        this.emit();
    }

    private emit() {
        const snap = this.getState();
        for (const l of this.listeners) l(snap);
    }
}
