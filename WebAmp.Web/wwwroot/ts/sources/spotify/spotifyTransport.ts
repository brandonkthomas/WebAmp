import type { PlayerTransport, Track } from '../../state/playerStore';
import { spotifyApi } from './spotifyApi';
import { ensureSpotifyPlayback } from './spotifyPlayback';
import { logEvent } from '../../internal/logging';
import { showErrorDialog, formatErrorMessage } from '../../ui/errorDialog';

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
            logEvent('WebAmp', 'spotify:transport:ready:start');
            try {
                const ready = await ensureSpotifyPlayback(this.onRemoteState);
                this.deviceId = ready.deviceId;
                this.player = ready.player;
                logEvent('WebAmp', 'spotify:transport:ready:done', {
                    deviceId: this.deviceId,
                    hasPlayer: !!this.player
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                logEvent('WebAmp', 'spotify:transport:ready:error', null, message, 'error');
                throw error;
            }
        })();
        return await this.ready;
    }

    private async ensureActivated(): Promise<void> {
        if (this.activated) {
            logEvent('WebAmp', 'spotify:activate:cached', { deviceId: this.deviceId });
            return;
        }
        // Web Playback SDK requires a user-gesture activation to enable audio output in some browsers.
        try {
            logEvent('WebAmp', 'spotify:activate:start', {
                deviceId: this.deviceId,
                hasActivateElement: typeof this.player?.activateElement === 'function',
                visibility: document.visibilityState,
                userAgent: navigator.userAgent,
                maxTouchPoints: navigator.maxTouchPoints ?? 0
            });
            await this.player?.activateElement?.();
            logEvent('WebAmp', 'spotify:activate:done', { deviceId: this.deviceId });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logEvent('WebAmp', 'spotify:activate:error', { deviceId: this.deviceId }, message, 'error');
        }
        this.activated = true;
    }

    /**
     * Plays a specific track URI on this device at an optional position
     */
    async play(track: Track, positionSec: number = 0, opts?: { autoplay?: boolean }): Promise<void> {
        try {
            logEvent('WebAmp', 'spotify:transport:play:start', {
                trackId: track.id,
                trackUri: track.uri ?? null,
                positionSec: Math.max(0, Math.floor(positionSec)),
                autoplay: opts?.autoplay ?? true
            });
            await this.ensureReady();
            await this.ensureActivated();
            const deviceId = this.requireDevice();
            const uri = track.uri;
            if (!uri) throw new Error('Missing Spotify track URI');
            logEvent('WebAmp', 'spotify:transport:play:request', {
                deviceId,
                trackId: track.id,
                trackUri: uri,
                positionMs: Math.max(0, Math.floor(positionSec * 1000))
            });
            await spotifyApi.playTrack(deviceId, uri, Math.max(0, Math.floor(positionSec * 1000)));
            logEvent('WebAmp', 'spotify:transport:play:done', {
                deviceId,
                trackId: track.id
            });

            // If the caller asked to "load" without playing (e.g. user was paused),
            // immediately pause after switching tracks.
            if (opts?.autoplay === false) {
                logEvent('WebAmp', 'spotify:transport:pause_after_load', {
                    deviceId,
                    trackId: track.id
                });
                await spotifyApi.pause(deviceId);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logEvent('WebAmp', 'spotify:transport:play:error', {
                trackId: track.id,
                trackUri: track.uri ?? null
            }, message, 'error');
            // For proxy errors, jsonFetch already showed a dialog; for anything else, surface a generic music error.
            if (!(error instanceof Error && error.message.includes('Spotify API proxy error'))) {
                void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            }
            throw error;
        }
    }

    /**
     * Toggles pause/resume based on current playing state
     */
    async togglePlay(isPlaying: boolean): Promise<void> {
        try {
            logEvent('WebAmp', 'spotify:transport:toggle:start', {
                previousIsPlaying: isPlaying
            });
            await this.ensureReady();
            await this.ensureActivated();
            const deviceId = this.requireDevice();
            if (isPlaying) {
                logEvent('WebAmp', 'spotify:transport:pause:request', { deviceId });
                await spotifyApi.pause(deviceId);
                logEvent('WebAmp', 'spotify:transport:pause:done', { deviceId });
            } else {
                logEvent('WebAmp', 'spotify:transport:resume:request', { deviceId });
                await spotifyApi.resume(deviceId);
                logEvent('WebAmp', 'spotify:transport:resume:done', { deviceId });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logEvent('WebAmp', 'spotify:transport:toggle:error', {
                previousIsPlaying: isPlaying,
                deviceId: this.deviceId
            }, message, 'error');
            if (!(error instanceof Error && error.message.includes('Spotify API proxy error'))) {
                void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            }
            throw error;
        }
    }

    /**
     * Seeks playback position (seconds) on this device
     */
    async seek(positionSec: number): Promise<void> {
        try {
            logEvent('WebAmp', 'spotify:transport:seek:start', {
                positionMs: Math.max(0, Math.floor(positionSec * 1000))
            });
            await this.ensureReady();
            await this.ensureActivated();
            const deviceId = this.requireDevice();
            await spotifyApi.seek(deviceId, Math.max(0, Math.floor(positionSec * 1000)));
            logEvent('WebAmp', 'spotify:transport:seek:done', {
                deviceId,
                positionMs: Math.max(0, Math.floor(positionSec * 1000))
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logEvent('WebAmp', 'spotify:transport:seek:error', {
                deviceId: this.deviceId,
                positionMs: Math.max(0, Math.floor(positionSec * 1000))
            }, message, 'error');
            if (!(error instanceof Error && error.message.includes('Spotify API proxy error'))) {
                void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            }
            throw error;
        }
    }
}
