import type { PlayerTransport, Track } from '../state/playerStore';
import { spotifyApi } from './spotifyApi';
import { ensureSpotifyPlayback } from './spotifyPlayback';

/**
 * PlayerTransport backed by Spotify Web Playback SDK + server proxy endpoints
 */
export class SpotifyTransport implements PlayerTransport {
    private deviceId: string | null = null;
    private player: any | null = null;
    private ready: Promise<void> | null = null;
    private activated = false;

    constructor(private readonly onRemoteState?: (s: { track: Track | null; isPlaying: boolean; positionSec: number }) => void) {}

    /**
     * Pre-warms SDK and device id
     */
    async init(): Promise<void> {
        await this.ensureReady();
    }

    private requireDevice(): string {
        if (!this.deviceId) throw new Error('Spotify device not ready');
        return this.deviceId;
    }

    private async ensureReady(): Promise<void> {
        if (this.ready) return await this.ready;
        this.ready = (async () => {
            const ready = await ensureSpotifyPlayback(this.onRemoteState);
            this.deviceId = ready.deviceId;
            this.player = ready.player;
        })();
        return await this.ready;
    }

    private async ensureActivated(): Promise<void> {
        if (this.activated) return;
        // Web Playback SDK requires a user-gesture activation to enable audio output in some browsers.
        try {
            await this.player?.activateElement?.();
        } catch {
            // ignore
        }
        this.activated = true;
    }

    /**
     * Plays a specific track URI on this device at an optional position
     */
    async play(track: Track, positionSec: number = 0): Promise<void> {
        try {
            await this.ensureReady();
            await this.ensureActivated();
            const deviceId = this.requireDevice();
            const uri = track.uri;
            if (!uri) throw new Error('Missing Spotify track URI');
            await spotifyApi.playTrack(deviceId, uri, Math.max(0, Math.floor(positionSec * 1000)));
        } catch (error) {
            // Error dialog is already shown by jsonFetch, just rethrow
            throw error;
        }
    }

    /**
     * Toggles pause/resume based on current playing state
     */
    async togglePlay(isPlaying: boolean): Promise<void> {
        try {
            await this.ensureReady();
            await this.ensureActivated();
            const deviceId = this.requireDevice();
            if (isPlaying) {
                await spotifyApi.pause(deviceId);
            } else {
                await spotifyApi.resume(deviceId);
            }
        } catch (error) {
            // Error dialog is already shown by jsonFetch, just rethrow
            throw error;
        }
    }

    /**
     * Seeks playback position (seconds) on this device
     */
    async seek(positionSec: number): Promise<void> {
        try {
            await this.ensureReady();
            await this.ensureActivated();
            const deviceId = this.requireDevice();
            await spotifyApi.seek(deviceId, Math.max(0, Math.floor(positionSec * 1000)));
        } catch (error) {
            // Error dialog is already shown by jsonFetch, just rethrow
            throw error;
        }
    }
}
