import type { MusicSource, MusicSourceListener, MusicSourceState } from './musicSource';

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

    async connect(): Promise<void> {
        // UI-only stub: real OAuth/PKCE will be implemented later.
        await new Promise((r) => setTimeout(r, 250));
        this.state = { isConnected: true };
        this.emit();
    }

    async disconnect(): Promise<void> {
        this.state = { isConnected: false };
        this.emit();
    }

    private emit() {
        const snap = this.getState();
        for (const l of this.listeners) l(snap);
    }
}
