import { spotifyApi } from './spotifyApi';
import { logEvent } from '../../internal/logging';
import type { Track } from '../../state/playerStore';
import { dispatchTransportFinish } from '../transportEvents';

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

// Last emitted playback snapshot, used to infer natural end-of-track transitions
// so we can mirror SoundCloud's explicit "finished" signaling.
let lastTrackId: string | null = null;
let lastIsPlaying: boolean | null = null;
let lastPositionSec: number | null = null;

/**
 * Loads Spotify Web Playback SDK script once and waits for ready callback
 */
function loadSdk(): Promise<void> {
    return new Promise((resolve, reject) => {
        // If already loaded, resolve.
        if (window.Spotify?.Player) {
            logEvent('WebAmp', 'spotify:sdk:cached');
            resolve();
            return;
        }

        const existing = document.querySelector<HTMLScriptElement>('script[data-wa-spotify-sdk]');
        if (existing) {
            // SDK script is in-flight; chain onto any existing ready callback and
            // add a timeout so we don't hang forever if the script fails silently.
            logEvent('WebAmp', 'spotify:sdk:inflight');
            const prev = window.onSpotifyWebPlaybackSDKReady;
            const inflightTimeout = window.setTimeout(() => {
                reject(new Error('Timed out waiting for Spotify Web Playback SDK'));
            }, 15000);
            window.onSpotifyWebPlaybackSDKReady = () => {
                window.clearTimeout(inflightTimeout);
                logEvent('WebAmp', 'spotify:sdk:ready');
                if (prev) prev();
                resolve();
            };
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        script.defer = true;
        script.setAttribute('data-wa-spotify-sdk', 'true');
        script.onerror = () => {
            logEvent('WebAmp', 'spotify:sdk:error', null, 'Failed to load Spotify Web Playback SDK', 'error');
            reject(new Error('Failed to load Spotify Web Playback SDK'));
        };
        document.head.appendChild(script);
        logEvent('WebAmp', 'spotify:sdk:append', { src: script.src });

        window.onSpotifyWebPlaybackSDKReady = () => {
            logEvent('WebAmp', 'spotify:sdk:ready');
            resolve();
        };
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
        source: 'spotify',
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
    if (!state) {
        logEvent('WebAmp', 'spotify:sdk:state:null');
        return;
    }
    const payload = {
        track: mapPlayerStateToTrack(state),
        isPlaying: !state.paused,
        positionSec: Math.round((state.position ?? 0) / 1000)
    };
    logEvent('WebAmp', 'spotify:sdk:state', {
        deviceId: deviceIdRef,
        trackId: payload.track?.id ?? null,
        isPlaying: payload.isPlaying,
        positionSec: payload.positionSec,
        durationSec: payload.track?.durationSec ?? null
    });

    // If the Spotify SDK reports that playback has transitioned from playing
    // to paused at (or extremely close to) the end of the track, treat this
    // as a natural "track finished" signal. This mirrors the SoundCloud
    // transport's explicit HTMLAudioElement `ended` handler so that queue
    // auto-advance behavior is consistent across providers, including on
    // platforms where background timers are aggressively throttled.
    if (payload.track && typeof payload.positionSec === 'number') {
        const duration = payload.track.durationSec ?? 0;
        const epsilon = 2; // seconds tolerance near end-of-track
        const atEnd = duration > 0 && payload.positionSec >= duration - epsilon;
        const wasPlaying = lastIsPlaying === true;
        const sameTrack = lastTrackId !== null && lastTrackId === payload.track.id;

        if (wasPlaying && !payload.isPlaying && sameTrack && atEnd) {
            try {
                dispatchTransportFinish('spotify', payload.track.id);
            } catch {
                // ignore
            }
        }
    }

    lastTrackId = payload.track?.id ?? null;
    lastIsPlaying = payload.isPlaying;
    lastPositionSec = payload.positionSec;

    for (const l of stateListeners) l(payload);
}

/**
 * Ensures Web Playback SDK is loaded and connected, returns cached player/deviceId
 * Optionally registers a listener for `player_state_changed` snapshots
 */
export async function ensureSpotifyPlayback(onState?: PlaybackStateListener): Promise<SpotifyPlaybackReady> {
    if (onState) stateListeners.add(onState);

    if (playerRef && deviceIdRef) {
        logEvent('WebAmp', 'spotify:ensure:cached', { deviceId: deviceIdRef });
        return { deviceId: deviceIdRef, player: playerRef };
    }

    if (readyPromise) {
        logEvent('WebAmp', 'spotify:ensure:pending');
        return readyPromise;
    }

    readyPromise = (async () => {
        try {
            logEvent('WebAmp', 'spotify:ensure:start');
            await loadSdk();

            const player = new window.Spotify.Player({
                name: 'WebAmp',
                volume: 0.8,
                getOAuthToken: async (cb: (t: string) => void) => {
                    try {
                        const { accessToken } = await spotifyApi.accessToken();
                        logEvent('WebAmp', 'spotify:token:ok', { length: accessToken?.length ?? 0 });
                        cb(accessToken);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : 'Unknown error';
                        logEvent('WebAmp', 'spotify:token:error', null, message, 'error');
                        cb('');
                    }
                }
            });
            logEvent('WebAmp', 'spotify:player:created', {
                hasActivateElement: typeof player?.activateElement === 'function',
                userAgent: navigator.userAgent
            });

            const deviceIdPromise: Promise<string> = new Promise((resolve, reject) => {
                const timeout = window.setTimeout(() => reject(new Error('Spotify player did not respond.')), 15000);
                player.addListener('ready', ({ device_id }: any) => {
                    window.clearTimeout(timeout);
                    logEvent('WebAmp', 'spotify:player:ready', { deviceId: device_id });
                    resolve(device_id);
                });
                player.addListener('not_ready', ({ device_id }: any) => {
                    logEvent('WebAmp', 'spotify:player:not_ready', { deviceId: device_id }, undefined, 'warn');
                });
                player.addListener('initialization_error', ({ message }: any) => {
                    logEvent('WebAmp', 'spotify:player:init_error', null, message, 'error');
                    reject(new Error(message));
                });
                player.addListener('authentication_error', ({ message }: any) => {
                    logEvent('WebAmp', 'spotify:player:auth_error', null, message, 'error');
                    reject(new Error(message));
                });
                player.addListener('account_error', ({ message }: any) => {
                    logEvent('WebAmp', 'spotify:player:account_error', null, message, 'error');
                    reject(new Error(message));
                });
                player.addListener('playback_error', ({ message }: any) => {
                    logEvent('WebAmp', 'spotify:player:playback_error', null, message, 'error');
                });
                player.addListener('autoplay_failed', () => {
                    logEvent('WebAmp', 'spotify:player:autoplay_failed', {
                        deviceId: deviceIdRef,
                        visibility: document.visibilityState,
                        userAgent: navigator.userAgent
                    }, undefined, 'warn');
                });
            });

            player.addListener('player_state_changed', (state: any) => emitState(state));

            // IMPORTANT: connect must happen before the 'ready' event can fire.
            logEvent('WebAmp', 'spotify:player:connect:start');
            const connected = await player.connect();
            logEvent('WebAmp', 'spotify:player:connect:done', { connected });
            if (!connected) throw new Error('Spotify player failed to connect');

            const deviceId = await deviceIdPromise;

            playerRef = player;
            deviceIdRef = deviceId;
            logEvent('WebAmp', 'spotify:ensure:done', { deviceId });
            return { deviceId, player };
        } catch (e) {
            // Allow retries on next user action.
            readyPromise = null;
            const message = e instanceof Error ? e.message : 'Unknown error';
            logEvent('WebAmp', 'spotify:ensure:error', null, message, 'error');
            throw e;
        }
    })();

    return readyPromise;
}
