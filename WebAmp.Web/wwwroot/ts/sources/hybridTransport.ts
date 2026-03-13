import type { PlayerTransport, Track, TrackSource } from '../state/playerStore';
import type { MusicSource } from './musicSource';
import { SpotifyTransport } from './spotify/spotifyTransport';
import { SoundCloudTransport } from './soundcloud/soundcloudTransport';

type RemoteStateListener = (s: { track: Track | null; isPlaying: boolean; positionSec: number }) => void;

/**
 * PlayerTransport that delegates to Spotify or SoundCloud transports based on
 * the `Track.source` field. When `source` is omitted, it is treated as
 * `'spotify'` for backwards compatibility.
 */
export class HybridTransport implements PlayerTransport {
    private spotify: SpotifyTransport | null = null;
    private soundcloud: SoundCloudTransport;
    private lastSource: TrackSource | null = null;

    constructor(
        private readonly opts: {
            spotifySource: MusicSource;
            onRemoteState: RemoteStateListener;
            getAdjacentTrack?: (currentTrack: Track | null, direction: 'next' | 'prev') => Track | null;
            fallbackQueueAdvance?: (direction: 'next' | 'prev', autoplay: boolean) => void;
        }
    ) {
        this.soundcloud = new SoundCloudTransport(
            (s) => this.opts.onRemoteState(s),
            {
                getAdjacentTrack: this.opts.getAdjacentTrack,
                fallbackQueueAdvance: this.opts.fallbackQueueAdvance
            }
        );
    }

    /**
     * Best-effort warm up for Safari autoplay policies.
     * Safe to call even if SoundCloud is never used.
     */
    primeSoundCloud(): void {
        this.soundcloud.prime();
    }

    primeSpotify(): void {
        if (!this.opts.spotifySource.getState().isConnected) return;
        this.ensureSpotify().prime();
    }

    primeSpotifyActivation(): void {
        if (!this.opts.spotifySource.getState().isConnected) return;
        this.ensureSpotify().primeActivation();
    }

    private getSource(track: Track | null): TrackSource | null {
        if (!track) return null;
        return (track.source ?? 'spotify') as TrackSource;
    }

    private ensureSpotify(): SpotifyTransport {
        if (!this.spotify) {
            this.spotify = new SpotifyTransport((s) => {
                this.opts.onRemoteState(s);
            });
        }
        return this.spotify;
    }

    async play(track: Track, positionSec: number = 0, opts?: { autoplay?: boolean }): Promise<void> {
        const source = this.getSource(track);
        if (!source) return;
        this.lastSource = source;

        if (source === 'spotify') {
            // Respect Spotify connection state; if not connected, surface a friendly error.
            if (!this.opts.spotifySource.getState().isConnected) {
                throw new Error('Spotify is not connected.');
            }
            const spotify = this.ensureSpotify();
            await spotify.play(track, positionSec, opts);
            return;
        }

        // SoundCloud: no user auth required (app-level token only).
        await this.soundcloud.play(track, positionSec, opts);
    }

    async togglePlay(previouslyPlaying: boolean): Promise<void> {
        const source = this.lastSource;
        if (!source) return;

        if (source === 'spotify') {
            if (!this.spotify) return;
            await this.spotify.togglePlay(previouslyPlaying);
            return;
        }

        await this.soundcloud.togglePlay(previouslyPlaying);
    }

    async seek(positionSec: number): Promise<void> {
        const source = this.lastSource;
        if (!source) return;

        if (source === 'spotify') {
            if (!this.spotify) return;
            await this.spotify.seek(positionSec);
            return;
        }

        await this.soundcloud.seek(positionSec);
    }

    async skipNext(): Promise<boolean> {
        if (this.lastSource !== 'soundcloud') return false;
        return await this.soundcloud.skipNext();
    }

    async skipPrev(): Promise<boolean> {
        if (this.lastSource !== 'soundcloud') return false;
        return await this.soundcloud.skipPrev();
    }
}

