import { spotifyApi } from './spotifyApi';
import type { Track } from '../state/playerStore';

declare global {
    /**
     * Spotify Web Playback SDK attaches itself on `window.Spotify`
     */
    interface Window {
        onSpotifyWebPlaybackSDKReady?: () => void;
        Spotify?: any;
    }
}

/**
 * Result of initializing the Spotify Web Playback SDK
 */
export interface SpotifyPlaybackReady {
    deviceId: string;
    player: any;
}

type PlaybackStateListener = (s: { track: Track | null; isPlaying: boolean; positionSec: number }) => void;

let readyPromise: Promise<SpotifyPlaybackReady> | null = null;
let playerRef: any | null = null;
let deviceIdRef: string | null = null;
const stateListeners = new Set<PlaybackStateListener>();

/**
 * Loads Spotify Web Playback SDK script once and waits for ready callback
 */
function loadSdk(): Promise<void> {
    return new Promise((resolve, reject) => {
        // If already loaded, resolve.
        if (window.Spotify?.Player) {
            resolve();
            return;
        }

        const existing = document.querySelector<HTMLScriptElement>('script[data-wa-spotify-sdk]');
        if (existing) {
            // SDK script is in-flight; wait for ready callback.
        } else {
            const script = document.createElement('script');
            script.src = 'https://sdk.scdn.co/spotify-player.js';
            script.async = true;
            script.defer = true;
            script.setAttribute('data-wa-spotify-sdk', 'true');
            script.onerror = () => reject(new Error('Failed to load Spotify Web Playback SDK'));
            document.head.appendChild(script);
        }

        window.onSpotifyWebPlaybackSDKReady = () => resolve();
    });
}

/**
 * Maps Spotify SDK `player_state_changed` payload into internal `Track`
 */
function mapPlayerStateToTrack(state: any): Track | null {
    const t = state?.track_window?.current_track;
    if (!t) return null;
    const art = t.album?.images?.[0]?.url;
    const artist = Array.isArray(t.artists)
        ? t.artists.map((a: any) => a.name).join(', ')
        : (t.artists?.[0]?.name ?? '');
    const primaryArtistId: string | undefined =
        Array.isArray(t.artists) && t.artists.length
            ? t.artists[0]?.id
            : (t.artists?.[0]?.id ?? undefined);
    return {
        id: t.id,
        title: t.name,
        artist,
        albumId: t.album?.id,
        album: t.album?.name,
        primaryArtistId,
        durationSec: Math.round((t.duration_ms ?? 0) / 1000),
        artUrl: art,
        uri: t.uri
    };
}

/**
 * Broadcasts a normalized playback snapshot to all listeners
 */
function emitState(state: any) {
    if (!state) return;
    const payload = {
        track: mapPlayerStateToTrack(state),
        isPlaying: !state.paused,
        positionSec: Math.round((state.position ?? 0) / 1000)
    };
    for (const l of stateListeners) l(payload);
}

/**
 * Ensures Web Playback SDK is loaded and connected, returns cached player/deviceId
 * Optionally registers a listener for `player_state_changed` snapshots
 */
export async function ensureSpotifyPlayback(onState?: PlaybackStateListener): Promise<SpotifyPlaybackReady> {
    if (onState) stateListeners.add(onState);

    if (playerRef && deviceIdRef) {
        return { deviceId: deviceIdRef, player: playerRef };
    }

    if (readyPromise) return readyPromise;

    readyPromise = (async () => {
        try {
            await loadSdk();

            const player = new window.Spotify.Player({
                name: 'WebAmp',
                volume: 0.8,
                getOAuthToken: async (cb: (t: string) => void) => {
                    try {
                        const { accessToken } = await spotifyApi.accessToken();
                        cb(accessToken);
                    } catch {
                        cb('');
                    }
                }
            });

            const deviceIdPromise: Promise<string> = new Promise((resolve, reject) => {
                const timeout = window.setTimeout(() => reject(new Error('Spotify player did not become ready in time')), 15000);
                player.addListener('ready', ({ device_id }: any) => {
                    window.clearTimeout(timeout);
                    resolve(device_id);
                });
                player.addListener('not_ready', () => {
                    // ignore
                });
                player.addListener('initialization_error', ({ message }: any) => reject(new Error(message)));
                player.addListener('authentication_error', ({ message }: any) => reject(new Error(message)));
                player.addListener('account_error', ({ message }: any) => reject(new Error(message)));
            });

            player.addListener('player_state_changed', (state: any) => emitState(state));

            // IMPORTANT: connect must happen before the 'ready' event can fire.
            const connected = await player.connect();
            if (!connected) throw new Error('Spotify player failed to connect');

            const deviceId = await deviceIdPromise;

            // Make this browser player the active device.
            await spotifyApi.transfer(deviceId, true);

            playerRef = player;
            deviceIdRef = deviceId;
            return { deviceId, player };
        } catch (e) {
            // Allow retries on next user action.
            readyPromise = null;
            throw e;
        }
    })();

    return readyPromise;
}
