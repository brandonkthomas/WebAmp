import type { MusicSource, MusicSourceListener, MusicSourceState } from './musicSource';
import { spotifyApi } from '../spotify/spotifyApi';

/**
 * Real Spotify-backed MusicSource using server-side auth endpoints
 */
export class SpotifySource implements MusicSource {
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
     * Probes auth state via `spotifyApi.status` and emits an initial snapshot
     */
    async init(): Promise<void> {
        try {
            const s = await spotifyApi.status();
            this.state = { isConnected: !!s?.isAuthenticated };
        } catch {
            this.state = { isConnected: false };
        }
        this.emit();
    }

    /**
     * Starts OAuth flow via navigation, promise intentionally never resolves
     */
    async connect(): Promise<void> {
        spotifyApi.login();
        // Navigation will occur; keep promise alive for callers that await.
        await new Promise(() => {});
    }

    /**
     * Logs out via proxy endpoint, emits state, then navigates back to `/webamp`
     */
    async disconnect(): Promise<void> {
        await spotifyApi.logout();
        this.state = { isConnected: false };
        this.emit();
        // After logout, take the user back to landing.
        window.location.assign('/webamp');
    }

    private emit() {
        const snap = this.getState();
        for (const l of this.listeners) l(snap);
    }
}
