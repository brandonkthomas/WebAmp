import type { MusicSource, MusicSourceListener, MusicSourceState } from './musicSource';
import { soundcloudUserApi } from './soundcloudUserApi';
import { logEvent } from '../../../../../Portfolio/wwwroot/ts/common';

/**
 * MusicSource implementation backed by SoundCloud user authentication
 * (Authorization Code + PKCE).
 */
export class SoundCloudSource implements MusicSource {
    id = 'soundcloud' as const;
    displayName = 'SoundCloud';

    private state: MusicSourceState = { isConnected: false };
    private listeners: MusicSourceListener[] = [];
    private lastLoggedConnected: boolean | null = null;

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
     * Probes auth state via `/soundclouduser/status`.
     */
    async init(): Promise<void> {
        try {
            const s = await soundcloudUserApi.status();
            this.state = { isConnected: !!s?.isAuthenticated };
        } catch {
            this.state = { isConnected: false };
        }
        this.emit();
    }

    /**
     * Starts OAuth flow by navigating to the SoundCloud login endpoint.
     */
    async connect(): Promise<void> {
        const ru = window.location.pathname + window.location.search + window.location.hash;
        window.location.assign(`/webamp/soundcloud/login?returnUrl=${encodeURIComponent(ru)}`);
        await new Promise(() => {});
    }

    /**
     * Logs out of SoundCloud user session.
     */
    async disconnect(): Promise<void> {
        await soundcloudUserApi.logout();
        this.state = { isConnected: false };
        this.emit();
        // After logout, take the user back to landing so that views, routing,
        // and playback state are reset consistently (mirrors SpotifySource).
        window.location.assign('/webamp');
    }

    private emit() {
        const snap = this.getState();
        if (this.lastLoggedConnected !== snap.isConnected) {
            logEvent('WebAmp', 'source:state', { source: this.id, connected: snap.isConnected });
            this.lastLoggedConnected = snap.isConnected;
        }
        for (const l of this.listeners) l(snap);
    }
}

