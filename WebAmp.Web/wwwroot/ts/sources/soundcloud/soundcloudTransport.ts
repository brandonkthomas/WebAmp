import type { PlayerTransport, Track, TrackSource } from '../../state/playerStore';
import { showErrorDialog, formatErrorMessage } from '../../ui/errorDialog';
import { soundcloudApi } from './soundcloudApi';

type PlaybackStateListener = (s: { track: Track | null; isPlaying: boolean; positionSec: number }) => void;

/**
 * SoundCloud transport backed by a hidden HTMLAudioElement and the
 * server-side /webamp/api/soundcloud/stream resolver.
 */
export class SoundCloudTransport implements PlayerTransport {
    private audio: HTMLAudioElement | null = null;
    private currentTrack: Track | null = null;
    private desiredPlaying = false;
    private lastKnownPlaying = false;
    private lastProgressEmitMs = 0;
    private primed = false;
    private playRequestId = 0;
    private switchingTrack = false;

    private readonly streamUrlCache = new Map<string, string>();

    constructor(
        private readonly onRemoteState?: PlaybackStateListener
    ) {}

    /**
     * Best-effort warmup for first interaction.
     */
    prime(): void {
        if (this.primed) return;
        this.primed = true;
        try {
            this.ensureAudio();
        } catch {
            // ignore
        }
    }

    private getSource(track: Track | null): TrackSource {
        return (track?.source ?? 'spotify') as TrackSource;
    }

    private ensureAudio(): HTMLAudioElement {
        if (this.audio) return this.audio;

        const audio = new Audio();
        audio.preload = 'none';
        audio.crossOrigin = 'anonymous';
        audio.setAttribute('playsinline', 'true');
        audio.setAttribute('webkit-playsinline', 'true');

        this.audio = audio;
        this.bindAudioEvents(audio);

        return audio;
    }

    private bindAudioEvents(audio: HTMLAudioElement): void {
        audio.addEventListener('play', () => {
            if (this.switchingTrack) return;
            if (!this.currentTrack) return;
            this.lastKnownPlaying = true;
        });

        audio.addEventListener('playing', () => {
            if (this.switchingTrack) return;
            if (!this.currentTrack) return;
            this.lastKnownPlaying = true;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: true,
                positionSec: Math.max(0, audio.currentTime || 0)
            });
        });

        audio.addEventListener('pause', () => {
            if (this.switchingTrack) return;
            if (!this.currentTrack) return;
            this.lastKnownPlaying = false;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: false,
                positionSec: Math.max(0, audio.currentTime || 0)
            });
        });

        audio.addEventListener('timeupdate', () => {
            if (this.switchingTrack) return;
            if (!this.currentTrack) return;
            const now = performance.now();
            if (now - this.lastProgressEmitMs < 300) return;
            this.lastProgressEmitMs = now;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: !audio.paused,
                positionSec: Math.max(0, audio.currentTime || 0)
            });
        });

        audio.addEventListener('ended', () => {
            if (this.switchingTrack) return;
            if (!this.currentTrack) return;
            this.lastKnownPlaying = false;
            const finishedId = this.currentTrack.id;
            const duration = Number.isFinite(this.currentTrack.durationSec)
                ? this.currentTrack.durationSec
                : Math.max(0, audio.currentTime || 0);

            this.emitRemote({
                track: this.currentTrack,
                isPlaying: false,
                positionSec: duration
            });

            try {
                queueMicrotask(() => {
                    if (this.currentTrack?.id !== finishedId) return;
                    window.dispatchEvent(new CustomEvent('wa:transport:finish', {
                        detail: { source: 'soundcloud', trackId: finishedId }
                    }));
                });
            } catch {
                // ignore
            }
        });

        audio.addEventListener('error', () => {
            if (!this.currentTrack) return;
            const mediaError = audio.error;
            const message = mediaError
                ? `Audio error (${mediaError.code})`
                : 'Audio playback error';
            void showErrorDialog(formatErrorMessage(new Error(message)), 'Music Service Error');
        });
    }

    private emitRemote(s: { track: Track | null; isPlaying: boolean; positionSec: number }) {
        if (!this.onRemoteState) return;
        this.onRemoteState({
            track: s.track,
            isPlaying: s.isPlaying,
            positionSec: s.positionSec
        });
    }

    private setBusy(busy: boolean): void {
        try {
            window.dispatchEvent(new CustomEvent('wa:transport:busy', { detail: { busy } }));
        } catch {
            // ignore
        }
    }

    private async waitForLoadedMetadata(audio: HTMLAudioElement, timeoutMs: number = 3000): Promise<void> {
        if (audio.readyState >= 1) return;

        await new Promise<void>((resolve, reject) => {
            let done = false;
            const timeout = window.setTimeout(() => {
                if (done) return;
                done = true;
                cleanup();
                reject(new Error('Timed out waiting for audio metadata.'));
            }, timeoutMs);

            const onReady = () => {
                if (done) return;
                done = true;
                cleanup();
                resolve();
            };

            const onError = () => {
                if (done) return;
                done = true;
                cleanup();
                reject(new Error('Failed to load audio metadata.'));
            };

            const cleanup = () => {
                window.clearTimeout(timeout);
                audio.removeEventListener('loadedmetadata', onReady);
                audio.removeEventListener('canplay', onReady);
                audio.removeEventListener('error', onError);
            };

            audio.addEventListener('loadedmetadata', onReady, { once: true });
            audio.addEventListener('canplay', onReady, { once: true });
            audio.addEventListener('error', onError, { once: true });
        });
    }

    private async resolveStreamUrl(trackId: string, opts?: { forceRefresh?: boolean }): Promise<string> {
        if (opts?.forceRefresh) {
            this.streamUrlCache.delete(trackId);
        }
        const cached = this.streamUrlCache.get(trackId);
        if (cached) return cached;

        const stream = await soundcloudApi.stream(trackId);
        const url = typeof stream?.url === 'string' ? stream.url.trim() : '';
        if (!url) {
            throw new Error('Missing SoundCloud stream URL.');
        }

        this.streamUrlCache.set(trackId, url);
        return url;
    }

    private async safePlay(audio: HTMLAudioElement): Promise<void> {
        try {
            await audio.play();
        } catch {
            // One short retry handles transient iOS stalls after src swaps.
            await new Promise<void>((r) => setTimeout(r, 120));
            await audio.play();
        }
    }

    private async waitForPlaybackProgress(
        audio: HTMLAudioElement,
        baselinePosSec: number,
        timeoutMs: number = 1400
    ): Promise<boolean> {
        const start = performance.now();
        while (performance.now() - start < timeoutMs) {
            if (audio.paused) return false;
            const nextPos = Math.max(0, audio.currentTime || 0);
            if (nextPos > baselinePosSec + 0.12) return true;
            await new Promise<void>((resolve) => setTimeout(resolve, 120));
        }
        return false;
    }

    private async recoverStalledPlayback(track: Track, resumePosSec: number): Promise<boolean> {
        const audio = this.ensureAudio();
        try {
            const streamUrl = await this.resolveStreamUrl(track.id, { forceRefresh: true });
            audio.src = streamUrl;
            audio.load();
            await this.waitForLoadedMetadata(audio, 3500);

            const resumeAt = Math.max(0, resumePosSec || 0);
            if (resumeAt > 0) {
                try {
                    audio.currentTime = resumeAt;
                } catch {
                    // ignore
                }
            }

            const baseline = Math.max(0, audio.currentTime || resumeAt);
            await this.safePlay(audio);
            return await this.waitForPlaybackProgress(audio, baseline, 1800);
        } catch {
            return false;
        }
    }

    /**
     * Starts playback of a SoundCloud track using direct stream URL playback.
     */
    async play(track: Track, positionSec: number = 0, opts?: { autoplay?: boolean }): Promise<void> {
        const source = this.getSource(track);
        if (source !== 'soundcloud') return;

        const autoplay = (typeof opts?.autoplay === 'boolean')
            ? opts.autoplay
            : this.lastKnownPlaying;

        this.currentTrack = null;
        this.switchingTrack = true;
        this.desiredPlaying = autoplay;
        this.lastProgressEmitMs = 0;

        const reqId = ++this.playRequestId;
        const targetPos = Math.max(0, positionSec || 0);

        this.setBusy(true);
        try {
            const audio = this.ensureAudio();

            if (!audio.paused) {
                audio.pause();
            }
            try {
                audio.currentTime = 0;
            } catch {
                // ignore
            }

            const streamUrl = await this.resolveStreamUrl(track.id);
            if (reqId !== this.playRequestId) return;

            const currentSrc = audio.currentSrc || audio.src;
            const sourceChanged = currentSrc !== streamUrl;

            if (sourceChanged) {
                audio.src = streamUrl;
                audio.load();
                await this.waitForLoadedMetadata(audio, 3500);
                if (reqId !== this.playRequestId) return;
            }

            if (targetPos > 0) {
                try {
                    audio.currentTime = targetPos;
                } catch {
                    // ignore
                }
            }

            this.currentTrack = track;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: false,
                positionSec: Math.max(0, audio.currentTime || 0)
            });

            if (!autoplay) {
                audio.pause();
                this.emitRemote({
                    track: this.currentTrack,
                    isPlaying: false,
                    positionSec: Math.max(0, audio.currentTime || 0)
                });
                return;
            }

            const baseline = Math.max(0, audio.currentTime || targetPos);
            await this.safePlay(audio);
            const started = await this.waitForPlaybackProgress(audio, baseline);
            if (!started) {
                await this.recoverStalledPlayback(track, baseline);
            }
        } catch (error) {
            this.lastKnownPlaying = false;
            this.currentTrack = track;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: false,
                positionSec: 0
            });
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            throw error;
        } finally {
            if (reqId === this.playRequestId) {
                this.switchingTrack = false;
                this.setBusy(false);
            }
        }
    }

    /**
     * Toggle play/pause on the active audio element.
     */
    async togglePlay(previouslyPlaying: boolean): Promise<void> {
        if (!this.currentTrack) return;

        const audio = this.ensureAudio();
        this.desiredPlaying = !previouslyPlaying;

        if (previouslyPlaying) {
            audio.pause();
            return;
        }

        this.setBusy(true);
        try {
            const baseline = Math.max(0, audio.currentTime || 0);
            await this.safePlay(audio);
            const resumed = await this.waitForPlaybackProgress(audio, baseline);
            if (!resumed && this.currentTrack) {
                await this.recoverStalledPlayback(this.currentTrack, baseline);
            }
        } catch (error) {
            this.lastKnownPlaying = false;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: false,
                positionSec: Math.max(0, audio.currentTime || 0)
            });
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            throw error;
        } finally {
            this.setBusy(false);
        }
    }

    /**
     * Seek on the active audio element.
     */
    async seek(positionSec: number): Promise<void> {
        if (!this.currentTrack) return;
        const audio = this.ensureAudio();
        const nextPos = Math.max(0, positionSec || 0);

        try {
            audio.currentTime = nextPos;
        } catch (error) {
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            throw error;
        }

        this.emitRemote({
            track: this.currentTrack,
            isPlaying: !audio.paused,
            positionSec: Math.max(0, audio.currentTime || nextPos)
        });
    }
}
