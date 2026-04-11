import type {
    PlayerTransport,
    Track,
    TrackSource,
} from "../../state/playerStore";
import { showErrorDialog, formatErrorMessage } from "../../ui/errorDialog";
import { logEvent } from "../../internal/logging";
import {
    soundcloudApi,
    type SoundCloudStreamCandidate,
    type SoundCloudStreamInfo,
} from "./soundcloudApi";
import { dispatchTransportBusy } from "../transportEvents";

type PlaybackStateListener = (s: {
    track: Track | null;
    isPlaying: boolean;
    positionSec: number;
}) => void;
type QueueDirection = "next" | "prev";
type PlaybackPhase =
    | "idle"
    | "preparing"
    | "switching"
    | "playing"
    | "paused"
    | "recovering";
const STREAM_CACHE_TTL_MS = 30 * 60 * 1000;
const PREFETCH_LOOKAHEAD_LIMIT = 25;

interface ResolvedSoundCloudStream {
    info: SoundCloudStreamInfo;
    selected: SoundCloudStreamCandidate;
    candidates: SoundCloudStreamCandidate[];
    resolvedAtMs: number;
}

/**
 * SoundCloud transport backed by a hidden HTMLAudioElement and the
 * server-side /webamp/api/soundcloud/stream resolver.
 */
export class SoundCloudTransport implements PlayerTransport {
    private audio: HTMLAudioElement | null = null;
    private currentTrack: Track | null = null;
    private pendingTrack: Track | null = null;
    private desiredPlaying = false;
    private lastKnownPlaying = false;
    private lastProgressEmitMs = 0;
    private primed = false;
    private playRequestId = 0;
    private switchingTrack = false;
    private lifecycleBound = false;
    private playbackPhase: PlaybackPhase = "idle";

    private readonly streamInfoCache = new Map<
        string,
        ResolvedSoundCloudStream
    >();
    private readonly streamResolveInFlight = new Map<
        string,
        Promise<ResolvedSoundCloudStream>
    >();
    private prefetchGeneration = 0;

    //
    // track repeated errors while loading streams
    //
    private lastAudioError: {
        trackId: string;
        atMs: number;
        code: number | null;
    } | null = null;

    constructor(
        private readonly onRemoteState?: PlaybackStateListener,
        private readonly queue?: {
            getAdjacentTrack?: (
                currentTrack: Track | null,
                direction: QueueDirection,
            ) => Track | null;
            getUpcomingTracks?: (
                currentTrack: Track | null,
                limit: number,
            ) => Track[];
            fallbackQueueAdvance?: (
                direction: QueueDirection,
                autoplay: boolean,
            ) => void;
        },
    ) {}

    /**
     * Best-effort warmup for first interaction.
     */
    prime(): void {
        if (this.primed) return;
        this.primed = true;
        try {
            this.ensureAudio();
            this.bindLifecycleEvents();
            this.scheduleQueuePrefetch(this.currentTrack);
        } catch {
            // ignore
        }
    }

    private getSource(track: Track | null): TrackSource {
        return (track?.source ?? "spotify") as TrackSource;
    }

    private ensureAudio(): HTMLAudioElement {
        if (this.audio) return this.audio;

        const audio = new Audio();
        audio.preload = "metadata";
        audio.crossOrigin = "anonymous";
        audio.setAttribute("playsinline", "true");
        audio.setAttribute("webkit-playsinline", "true");

        this.audio = audio;
        this.bindAudioEvents(audio);
        this.bindLifecycleEvents();

        return audio;
    }

    private setPlaybackPhase(
        phase: PlaybackPhase,
        track: Track | null = this.currentTrack,
    ): void {
        if (this.playbackPhase === phase) return;
        this.playbackPhase = phase;
        logEvent("WebAmp", "soundcloud:phase", {
            phase,
            trackId: track?.id ?? null,
            visibility:
                typeof document !== "undefined"
                    ? document.visibilityState
                    : null,
        });
    }

    private bindLifecycleEvents(): void {
        if (this.lifecycleBound) return;
        this.lifecycleBound = true;
        if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", () => {
                logEvent("WebAmp", "soundcloud:lifecycle:visibility", {
                    trackId: this.currentTrack?.id ?? null,
                    desiredPlaying: this.desiredPlaying,
                    visibility: document.visibilityState,
                });
                if (document.visibilityState === "visible") {
                    this.recoverDesiredPlayback("visibility");
                    this.scheduleQueuePrefetch(this.currentTrack);
                }
            });
        }
        if (typeof window !== "undefined") {
            window.addEventListener("pagehide", () => {
                logEvent("WebAmp", "soundcloud:lifecycle:pagehide", {
                    trackId: this.currentTrack?.id ?? null,
                    desiredPlaying: this.desiredPlaying,
                });
            });
            window.addEventListener("pageshow", () => {
                logEvent("WebAmp", "soundcloud:lifecycle:pageshow", {
                    trackId: this.currentTrack?.id ?? null,
                    desiredPlaying: this.desiredPlaying,
                });
                this.recoverDesiredPlayback("pageshow");
                this.scheduleQueuePrefetch(this.currentTrack);
            });
        }
    }

    private recoverDesiredPlayback(reason: string): void {
        const audio = this.audio;
        if (
            !audio ||
            !this.currentTrack ||
            !this.desiredPlaying ||
            !audio.paused
        )
            return;
        logEvent("WebAmp", "soundcloud:recover:request", {
            reason,
            trackId: this.currentTrack.id,
            positionSec:
                Math.round(Math.max(0, audio.currentTime || 0) * 100) / 100,
        });
        this.requestPlay(audio, this.playRequestId, reason);
    }

    private bindAudioEvents(audio: HTMLAudioElement): void {
        audio.addEventListener("play", () => {
            if (this.switchingTrack) return;
            if (!this.currentTrack) return;
            this.lastKnownPlaying = true;
            logEvent("WebAmp", "soundcloud:audio:play", {
                trackId: this.currentTrack.id,
                positionSec:
                    Math.round(Math.max(0, audio.currentTime || 0) * 100) / 100,
            });
        });

        audio.addEventListener("playing", () => {
            if (this.switchingTrack) return;
            if (!this.currentTrack) return;
            this.lastKnownPlaying = true;
            this.setPlaybackPhase("playing", this.currentTrack);
            logEvent("WebAmp", "soundcloud:audio:playing", {
                trackId: this.currentTrack.id,
                positionSec:
                    Math.round(Math.max(0, audio.currentTime || 0) * 100) / 100,
            });
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: true,
                positionSec: Math.max(0, audio.currentTime || 0),
            });
        });

        audio.addEventListener("pause", () => {
            if (this.switchingTrack) return;
            if (!this.currentTrack) return;
            this.lastKnownPlaying = false;
            this.setPlaybackPhase("paused", this.currentTrack);
            logEvent("WebAmp", "soundcloud:audio:pause", {
                trackId: this.currentTrack.id,
                positionSec:
                    Math.round(Math.max(0, audio.currentTime || 0) * 100) / 100,
            });
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: false,
                positionSec: Math.max(0, audio.currentTime || 0),
            });
        });

        audio.addEventListener("timeupdate", () => {
            if (this.switchingTrack) return;
            if (!this.currentTrack) return;
            const now = performance.now();
            if (now - this.lastProgressEmitMs < 300) return;
            this.lastProgressEmitMs = now;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: !audio.paused,
                positionSec: Math.max(0, audio.currentTime || 0),
            });
        });

        audio.addEventListener("loadedmetadata", () => {
            logEvent("WebAmp", "soundcloud:audio:loadedmetadata", {
                trackId: this.currentTrack?.id ?? this.pendingTrack?.id ?? null,
                durationSec:
                    Math.round(Math.max(0, audio.duration || 0) * 100) / 100,
            });
        });

        audio.addEventListener("canplay", () => {
            logEvent("WebAmp", "soundcloud:audio:canplay", {
                trackId: this.currentTrack?.id ?? this.pendingTrack?.id ?? null,
            });
        });

        audio.addEventListener("waiting", () => {
            logEvent(
                "WebAmp",
                "soundcloud:audio:waiting",
                {
                    trackId:
                        this.currentTrack?.id ?? this.pendingTrack?.id ?? null,
                    positionSec:
                        Math.round(Math.max(0, audio.currentTime || 0) * 100) /
                        100,
                },
                undefined,
                "warn",
            );
        });

        audio.addEventListener("stalled", () => {
            logEvent(
                "WebAmp",
                "soundcloud:audio:stalled",
                {
                    trackId:
                        this.currentTrack?.id ?? this.pendingTrack?.id ?? null,
                    positionSec:
                        Math.round(Math.max(0, audio.currentTime || 0) * 100) /
                        100,
                },
                undefined,
                "warn",
            );
        });

        audio.addEventListener("ended", () => {
            if (this.switchingTrack) return;
            if (!this.currentTrack) return;
            this.lastKnownPlaying = false;
            const finishedTrack = this.currentTrack;
            const duration = Number.isFinite(this.currentTrack.durationSec)
                ? this.currentTrack.durationSec
                : Math.max(0, audio.currentTime || 0);

            this.setPlaybackPhase("paused", this.currentTrack);
            logEvent("WebAmp", "soundcloud:audio:ended", {
                trackId: finishedTrack.id,
                positionSec: Math.round(duration * 100) / 100,
                desiredPlaying: this.desiredPlaying,
            });
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: false,
                positionSec: duration,
            });

            if (!this.desiredPlaying) return;

            queueMicrotask(() => {
                if (this.currentTrack?.id !== finishedTrack.id) return;
                void this.handleNaturalTrackEnd(finishedTrack);
            });
        });

        audio.addEventListener("error", () => {
            if (!this.currentTrack) return;
            const mediaError = audio.error;
            const message = mediaError
                ? `Audio error (${mediaError.code})`
                : "Audio playback error";

            // log this error
            this.lastAudioError = {
                trackId: this.currentTrack.id,
                atMs: performance.now(),
                code: mediaError?.code ?? null,
            };
            logEvent(
                "WebAmp",
                "soundcloud:audio:error",
                {
                    trackId: this.currentTrack.id,
                    errorCode: mediaError?.code ?? null,
                },
                message,
                "error",
            );
        });
    }

    private consumeRecentAudioError(
        trackId: string,
        withinMs: number = 5000,
    ): { trackId: string; atMs: number; code: number | null } | null {
        const recent = this.lastAudioError;
        if (!recent) return null;
        if (recent.trackId !== trackId) return null;
        if (performance.now() - recent.atMs > withinMs) return null;
        this.lastAudioError = null;
        return recent;
    }

    private emitRemote(s: {
        track: Track | null;
        isPlaying: boolean;
        positionSec: number;
    }) {
        if (!this.onRemoteState) return;
        this.onRemoteState({
            track: s.track,
            isPlaying: s.isPlaying,
            positionSec: s.positionSec,
        });
    }

    private setBusy(busy: boolean): void {
        dispatchTransportBusy(busy);
    }

    private async waitForLoadedMetadata(
        audio: HTMLAudioElement,
        timeoutMs: number = 3000,
    ): Promise<void> {
        if (audio.readyState >= 1) return;

        await new Promise<void>((resolve, reject) => {
            let done = false;
            const timeout = window.setTimeout(() => {
                if (done) return;
                done = true;
                cleanup();
                reject(new Error("Timed out waiting for audio metadata."));
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
                reject(new Error("Failed to load audio metadata."));
            };

            const cleanup = () => {
                window.clearTimeout(timeout);
                audio.removeEventListener("loadedmetadata", onReady);
                audio.removeEventListener("canplay", onReady);
                audio.removeEventListener("error", onError);
            };

            audio.addEventListener("loadedmetadata", onReady, { once: true });
            audio.addEventListener("canplay", onReady, { once: true });
            audio.addEventListener("error", onError, { once: true });
        });
    }

    private normalizeStreamCandidates(
        stream: SoundCloudStreamInfo,
    ): SoundCloudStreamCandidate[] {
        const rawCandidates =
            Array.isArray(stream.candidates) && stream.candidates.length
                ? stream.candidates
                : stream.url
                  ? [
                        {
                            kind: stream.kind ?? "unknown",
                            url: stream.url,
                            transport:
                                stream.transport ??
                                (this.looksLikeHlsUrl(stream.url)
                                    ? "hls"
                                    : "progressive"),
                            mimeType:
                                stream.mimeType ??
                                (this.looksLikeHlsUrl(stream.url)
                                    ? "application/vnd.apple.mpegurl"
                                    : "audio/mpeg"),
                            isPreview: !!stream.isPreview,
                        },
                    ]
                  : [];

        const deduped = new Map<string, SoundCloudStreamCandidate>();
        for (const candidate of rawCandidates) {
            const url =
                typeof candidate?.url === "string" ? candidate.url.trim() : "";
            if (!url) continue;
            if (deduped.has(url)) continue;
            deduped.set(url, {
                kind:
                    typeof candidate.kind === "string" && candidate.kind.trim()
                        ? candidate.kind
                        : "unknown",
                url,
                transport:
                    candidate.transport === "hls" ? "hls" : "progressive",
                mimeType:
                    typeof candidate.mimeType === "string" &&
                    candidate.mimeType.trim()
                        ? candidate.mimeType
                        : candidate.transport === "hls"
                          ? "application/vnd.apple.mpegurl"
                          : "audio/mpeg",
                isPreview: !!candidate.isPreview,
            });
        }

        return Array.from(deduped.values());
    }

    private looksLikeHlsUrl(url: string): boolean {
        return /\.m3u8($|\?)/i.test(url) || /\/playlist\//i.test(url);
    }

    private isIphoneSafari(): boolean {
        if (typeof navigator === "undefined") return false;
        const ua = navigator.userAgent || "";
        return (
            /iPhone/i.test(ua) &&
            /Safari/i.test(ua) &&
            !/CriOS|FxiOS|EdgiOS/i.test(ua)
        );
    }

    private canPlayNativeHls(): boolean {
        const audio = this.ensureAudio();
        try {
            return !!audio.canPlayType("application/vnd.apple.mpegurl");
        } catch {
            return false;
        }
    }

    private shouldPreferNativeHls(): boolean {
        return this.isIphoneSafari() && this.canPlayNativeHls();
    }

    private isStreamStale(stream: ResolvedSoundCloudStream): boolean {
        return performance.now() - stream.resolvedAtMs > STREAM_CACHE_TTL_MS;
    }

    private isDocumentVisible(): boolean {
        return (
            typeof document === "undefined" ||
            document.visibilityState === "visible"
        );
    }

    private maybeRefreshStaleStream(
        trackId: string,
        staleStream: ResolvedSoundCloudStream,
    ): void {
        if (!this.isDocumentVisible()) {
            logEvent("WebAmp", "soundcloud:cache:stale_hidden", {
                trackId,
                ageSec: Math.round(
                    (performance.now() - staleStream.resolvedAtMs) / 1000,
                ),
            });
            return;
        }

        if (this.streamResolveInFlight.has(trackId)) {
            return;
        }

        logEvent("WebAmp", "soundcloud:cache:refresh:start", {
            trackId,
            ageSec: Math.round(
                (performance.now() - staleStream.resolvedAtMs) / 1000,
            ),
        });

        void this.resolveStream(trackId, {
            forceRefresh: true,
            allowStale: false,
        })
            .then(() => {
                logEvent("WebAmp", "soundcloud:cache:refresh:done", {
                    trackId,
                });
            })
            .catch((error) => {
                const message =
                    error instanceof Error
                        ? error.message
                        : "Unknown cache refresh error";
                logEvent(
                    "WebAmp",
                    "soundcloud:cache:refresh:error",
                    { trackId },
                    message,
                    "warn",
                );
            });
    }

    private chooseCandidate(
        candidates: SoundCloudStreamCandidate[],
    ): SoundCloudStreamCandidate {
        const progressive = candidates.filter(
            (candidate) => candidate.transport === "progressive",
        );
        const hls = candidates.filter(
            (candidate) => candidate.transport === "hls",
        );
        if (this.shouldPreferNativeHls() && hls.length) {
            return hls[0];
        }
        return progressive[0] ?? hls[0] ?? candidates[0];
    }

    private async resolveStream(
        trackId: string,
        opts?: { forceRefresh?: boolean; allowStale?: boolean },
    ): Promise<ResolvedSoundCloudStream> {
        const allowStale = opts?.allowStale !== false;
        if (opts?.forceRefresh) {
            this.streamInfoCache.delete(trackId);
        }
        const cached = this.streamInfoCache.get(trackId);
        if (cached) {
            if (!this.isStreamStale(cached)) {
                return cached;
            }
            if (allowStale) {
                this.maybeRefreshStaleStream(trackId, cached);
                return cached;
            }
            this.streamInfoCache.delete(trackId);
        }

        const pending = this.streamResolveInFlight.get(trackId);
        if (pending) return await pending;

        const resolvePromise = (async () => {
            const info = await soundcloudApi.stream(trackId);
            const candidates = this.normalizeStreamCandidates(info);
            if (!candidates.length) {
                throw new Error("Missing SoundCloud stream URL.");
            }

            const resolved = {
                info,
                candidates,
                selected: this.chooseCandidate(candidates),
                resolvedAtMs: performance.now(),
            };
            this.streamInfoCache.set(trackId, resolved);
            return resolved;
        })();

        this.streamResolveInFlight.set(trackId, resolvePromise);
        try {
            return await resolvePromise;
        } finally {
            this.streamResolveInFlight.delete(trackId);
        }
    }

    private requestPlay(
        audio: HTMLAudioElement,
        reqId: number,
        reason: string,
        attempt: number = 1,
    ): void {
        try {
            logEvent("WebAmp", "soundcloud:play:request", {
                reason,
                attempt,
                trackId: this.currentTrack?.id ?? this.pendingTrack?.id ?? null,
                visibility:
                    typeof document !== "undefined"
                        ? document.visibilityState
                        : null,
            });
            const playResult = audio.play();
            if (!playResult || typeof playResult.then !== "function") {
                return;
            }
            void playResult
                .then(() => {
                    if (reqId !== this.playRequestId) return;
                    logEvent("WebAmp", "soundcloud:play:resolved", {
                        reason,
                        attempt,
                        trackId:
                            this.currentTrack?.id ??
                            this.pendingTrack?.id ??
                            null,
                    });
                })
                .catch((error) => {
                    if (reqId !== this.playRequestId) return;
                    const message =
                        error instanceof Error
                            ? error.message
                            : "Unknown play() error";
                    logEvent(
                        "WebAmp",
                        "soundcloud:play:rejected",
                        {
                            reason,
                            attempt,
                            trackId:
                                this.currentTrack?.id ??
                                this.pendingTrack?.id ??
                                null,
                        },
                        message,
                        "warn",
                    );
                    if (attempt >= 2 || !this.desiredPlaying) return;
                    window.setTimeout(() => {
                        if (
                            reqId !== this.playRequestId ||
                            !this.desiredPlaying
                        )
                            return;
                        this.requestPlay(
                            audio,
                            reqId,
                            `${reason}:retry`,
                            attempt + 1,
                        );
                    }, 120);
                });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Unknown play() error";
            logEvent(
                "WebAmp",
                "soundcloud:play:throw",
                {
                    reason,
                    attempt,
                    trackId:
                        this.currentTrack?.id ?? this.pendingTrack?.id ?? null,
                },
                message,
                "warn",
            );
        }
    }

    private async waitForPlaybackStart(
        audio: HTMLAudioElement,
        baselinePosSec: number,
        timeoutMs: number = 1800,
    ): Promise<boolean> {
        if (
            !audio.paused &&
            Math.max(0, audio.currentTime || 0) > baselinePosSec + 0.05
        ) {
            return true;
        }

        return await new Promise<boolean>((resolve) => {
            let done = false;
            const finish = (started: boolean) => {
                if (done) return;
                done = true;
                cleanup();
                resolve(started);
            };
            const checkProgress = () => {
                const nextPos = Math.max(0, audio.currentTime || 0);
                if (!audio.paused && nextPos > baselinePosSec + 0.05) {
                    finish(true);
                }
            };
            const timeout = window.setTimeout(() => finish(false), timeoutMs);
            const interval = window.setInterval(checkProgress, 120);
            const cleanup = () => {
                window.clearTimeout(timeout);
                window.clearInterval(interval);
                audio.removeEventListener("playing", onPlaying);
                audio.removeEventListener("timeupdate", onTimeUpdate);
                audio.removeEventListener("error", onError);
            };
            const onPlaying = () => finish(true);
            const onTimeUpdate = () => checkProgress();
            const onError = () => finish(false);

            audio.addEventListener("playing", onPlaying, { once: true });
            audio.addEventListener("timeupdate", onTimeUpdate);
            audio.addEventListener("error", onError, { once: true });
            checkProgress();
        });
    }

    /**
     * primarily used for mobile webkit sandbox bypasses
     * @param track
     * @param prepared
     * @param resumePosSec
     * @param reqId
     * @param reason
     * @returns
     */
    private async recoverStalledPlayback(
        track: Track,
        prepared: ResolvedSoundCloudStream,
        resumePosSec: number,
        reqId: number,
        reason: string,
    ): Promise<boolean> {
        if (
            typeof document !== "undefined" &&
            document.visibilityState === "hidden"
        ) {
            logEvent(
                "WebAmp",
                "soundcloud:recover:skip_hidden",
                {
                    trackId: track.id,
                    reason,
                },
                "Skipping aggressive fallback while page is hidden.",
                "warn",
            );
            return false;
        }

        const audio = this.ensureAudio();
        const alternates = prepared.candidates.filter(
            (candidate) => candidate.url !== prepared.selected.url,
        );
        for (const alternate of alternates) {
            if (reqId !== this.playRequestId) return false;
            try {
                logEvent(
                    "WebAmp",
                    "soundcloud:recover:alternate",
                    {
                        trackId: track.id,
                        kind: alternate.kind,
                        transport: alternate.transport,
                    },
                    reason,
                    "warn",
                );

                this.switchingTrack = true;
                audio.src = alternate.url;
                if (resumePosSec > 0) {
                    await this.waitForLoadedMetadata(audio, 2500);
                    if (reqId !== this.playRequestId) return false;
                    try {
                        audio.currentTime = Math.max(0, resumePosSec);
                    } catch {
                        // ignore
                    }
                }
                this.switchingTrack = false;

                const baseline = Math.max(
                    0,
                    audio.currentTime || resumePosSec || 0,
                );
                this.requestPlay(
                    audio,
                    reqId,
                    `${reason}:alternate:${alternate.kind}`,
                );
                const started = await this.waitForPlaybackStart(
                    audio,
                    baseline,
                    2200,
                );
                if (!started) {
                    continue;
                }

                const nextPrepared = {
                    ...prepared,
                    selected: alternate,
                    resolvedAtMs: performance.now(),
                };
                this.streamInfoCache.set(track.id, nextPrepared);
                return true;
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : "Unknown recovery error";
                logEvent(
                    "WebAmp",
                    "soundcloud:recover:error",
                    {
                        trackId: track.id,
                        kind: alternate.kind,
                    },
                    message,
                    "warn",
                );
            } finally {
                this.switchingTrack = false;
            }
        }

        return false;
    }

    private getAdjacentTrack(
        direction: QueueDirection,
        track: Track | null = this.currentTrack,
    ): Track | null {
        return this.queue?.getAdjacentTrack?.(track, direction) ?? null;
    }

    private getUpcomingQueueTracks(track: Track | null): Track[] {
        const tracks =
            this.queue?.getUpcomingTracks?.(track, PREFETCH_LOOKAHEAD_LIMIT) ??
            [];
        return tracks.filter(
            (candidate) => this.getSource(candidate) === "soundcloud",
        );
    }

    private async prepareTrack(track: Track): Promise<void> {
        try {
            const prepared = await this.resolveStream(track.id);
            logEvent("WebAmp", "soundcloud:prefetch:ready", {
                trackId: track.id,
                kind: prepared.selected.kind,
                transport: prepared.selected.transport,
            });
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Unknown prefetch error";
            logEvent(
                "WebAmp",
                "soundcloud:prefetch:error",
                {
                    trackId: track.id,
                },
                message,
                "warn",
            );
        }
    }

    private scheduleQueuePrefetch(track: Track | null): void {
        const tracks = this.getUpcomingQueueTracks(track);
        const generation = ++this.prefetchGeneration;

        if (!tracks.length) {
            return;
        }

        void (async () => {
            for (const candidate of tracks) {
                if (generation !== this.prefetchGeneration) return;
                try {
                    const cached = this.streamInfoCache.get(candidate.id);
                    if (cached && !this.isStreamStale(cached)) {
                        continue;
                    }
                    await this.prepareTrack(candidate);
                } catch {
                    // prepareTrack already logs failures; keep warming the remainder.
                }
            }
        })();
    }

    private async getPreparedStream(
        track: Track,
    ): Promise<ResolvedSoundCloudStream> {
        return await this.resolveStream(track.id);
    }

    private async commitTrackSource(
        track: Track,
        prepared: ResolvedSoundCloudStream,
        positionSec: number,
        autoplay: boolean,
        reqId: number,
        reason: string,
    ): Promise<boolean> {
        const audio = this.ensureAudio();
        const targetPos = Math.max(0, positionSec || 0);
        const currentSrc = audio.currentSrc || audio.src;
        const sourceChanged = currentSrc !== prepared.selected.url;

        this.setPlaybackPhase(
            this.currentTrack ? "switching" : "preparing",
            track,
        );
        this.pendingTrack = track;
        this.switchingTrack = true;

        logEvent("WebAmp", "soundcloud:switch:start", {
            trackId: track.id,
            autoplay,
            sourceChanged,
            kind: prepared.selected.kind,
            transport: prepared.selected.transport,
            targetPosSec: Math.round(targetPos * 100) / 100,
        });

        try {
            if (sourceChanged) {
                audio.src = prepared.selected.url;
            }

            if (targetPos > 0) {
                await this.waitForLoadedMetadata(audio, 2500);
                if (reqId !== this.playRequestId) return false;
                try {
                    audio.currentTime = targetPos;
                } catch {
                    // ignore
                }
            }

            this.currentTrack = track;
            this.pendingTrack = null;

            this.emitRemote({
                track: this.currentTrack,
                isPlaying: false,
                positionSec: Math.max(0, audio.currentTime || targetPos),
            });

            this.scheduleQueuePrefetch(track);
        } finally {
            this.switchingTrack = false;
        }

        if (!autoplay) {
            audio.pause();
            this.lastKnownPlaying = false;
            this.setPlaybackPhase("paused", track);
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: false,
                positionSec: Math.max(0, audio.currentTime || targetPos),
            });
            return true;
        }

        const baseline = Math.max(0, audio.currentTime || targetPos);
        this.requestPlay(audio, reqId, reason);
        const started = await this.waitForPlaybackStart(audio, baseline, 2200);
        if (reqId !== this.playRequestId) return false;
        if (started) {
            this.lastKnownPlaying = true;
            this.setPlaybackPhase("playing", track);
            return true;
        }

        this.setPlaybackPhase("recovering", track);
        return await this.recoverStalledPlayback(
            track,
            prepared,
            baseline,
            reqId,
            reason,
        );
    }

    /**
     *
     * @param track
     * @param positionSec
     * @param autoplay
     * @param reason
     * @returns
     */
    private async playSoundCloudTrack(
        track: Track,
        positionSec: number,
        autoplay: boolean,
        reason: string,
    ): Promise<void> {
        this.desiredPlaying = autoplay;
        this.lastProgressEmitMs = 0;
        const reqId = ++this.playRequestId;
        let attemptedFreshRefresh = false;

        this.setBusy(true);
        try {
            while (true) {
                // have we tried to stream this track already?
                const prepared = attemptedFreshRefresh
                    ? await this.resolveStream(track.id, {
                          forceRefresh: true,
                          allowStale: false,
                      })
                    : await this.getPreparedStream(track);
                if (reqId !== this.playRequestId) return; // sanity

                const started = await this.commitTrackSource(
                    track,
                    prepared,
                    positionSec,
                    autoplay,
                    reqId,
                    reason,
                );
                if (reqId !== this.playRequestId) return;
                if (started) {
                    return;
                }

                // have we failed to stream this recently?
                // if so, invalidate cache
                const recentAudioError = this.consumeRecentAudioError(track.id);
                if (!attemptedFreshRefresh && recentAudioError) {
                    attemptedFreshRefresh = true;
                    logEvent(
                        "WebAmp",
                        "soundcloud:stream:refresh_after_audio_error",
                        {
                            trackId: track.id,
                            errorCode: recentAudioError.code,
                        },
                        "Retrying with a fresh SoundCloud stream URL.",
                        "warn",
                    );
                    this.streamInfoCache.delete(track.id);
                    continue;
                }

                if (recentAudioError) {
                    throw new Error(
                        `Audio error (${recentAudioError.code ?? 4})`,
                    );
                }

                throw new Error("Failed to start audio playback.");
            }
        } catch (error) {
            this.lastKnownPlaying = false;
            this.pendingTrack = null;
            this.setPlaybackPhase("paused", track);
            this.emitRemote({
                track: this.currentTrack ?? track,
                isPlaying: false,
                positionSec: 0,
            });
            void showErrorDialog(
                formatErrorMessage(error),
                "Music Service Error",
            );
            throw error;
        } finally {
            if (reqId === this.playRequestId) {
                this.setBusy(false);
            }
        }
    }

    private async advanceWithinSoundCloud(
        direction: QueueDirection,
        reason: string,
    ): Promise<boolean> {
        const currentTrack = this.currentTrack;
        if (!currentTrack) return false;

        if (direction === "prev") {
            const audio = this.ensureAudio();
            if (Math.max(0, audio.currentTime || 0) > 3) {
                await this.seek(0);
                this.desiredPlaying = true;
                this.requestPlay(
                    audio,
                    ++this.playRequestId,
                    `${reason}:restart`,
                );
                return true;
            }
        }

        const adjacent = this.getAdjacentTrack(direction, currentTrack);
        if (!adjacent) {
            logEvent(
                "WebAmp",
                "soundcloud:queue:none",
                {
                    direction,
                    trackId: currentTrack.id,
                },
                reason,
                "warn",
            );
            if (direction === "next") {
                this.desiredPlaying = false;
            }
            return true;
        }

        if (adjacent.source !== "soundcloud") {
            this.queue?.fallbackQueueAdvance?.(direction, true);
            return true;
        }

        await this.playSoundCloudTrack(adjacent, 0, true, reason);
        return true;
    }

    private async handleNaturalTrackEnd(track: Track): Promise<void> {
        const nextTrack = this.getAdjacentTrack("next", track);
        if (!nextTrack) {
            this.desiredPlaying = false;
            return;
        }

        if (nextTrack.source !== "soundcloud") {
            this.queue?.fallbackQueueAdvance?.("next", true);
            return;
        }

        await this.playSoundCloudTrack(nextTrack, 0, true, "ended");
    }

    /**
     * Starts playback of a SoundCloud track using direct stream URL playback.
     */
    async play(
        track: Track,
        positionSec: number = 0,
        opts?: { autoplay?: boolean },
    ): Promise<void> {
        const source = this.getSource(track);
        if (source !== "soundcloud") return;

        const autoplay =
            typeof opts?.autoplay === "boolean"
                ? opts.autoplay
                : this.lastKnownPlaying;
        await this.playSoundCloudTrack(track, positionSec, autoplay, "play");
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
            this.setPlaybackPhase("paused", this.currentTrack);
            return;
        }

        const reqId = ++this.playRequestId;
        this.setBusy(true);
        try {
            const baseline = Math.max(0, audio.currentTime || 0);
            this.requestPlay(audio, reqId, "resume");
            const resumed = await this.waitForPlaybackStart(
                audio,
                baseline,
                2200,
            );
            if (reqId !== this.playRequestId) return;
            if (!resumed && this.currentTrack) {
                const prepared = await this.resolveStream(
                    this.currentTrack.id,
                    { forceRefresh: true },
                );
                await this.recoverStalledPlayback(
                    this.currentTrack,
                    prepared,
                    baseline,
                    reqId,
                    "resume",
                );
            }
        } catch (error) {
            this.lastKnownPlaying = false;
            this.emitRemote({
                track: this.currentTrack,
                isPlaying: false,
                positionSec: Math.max(0, audio.currentTime || 0),
            });
            void showErrorDialog(
                formatErrorMessage(error),
                "Music Service Error",
            );
            throw error;
        } finally {
            if (reqId === this.playRequestId) {
                this.setBusy(false);
            }
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
            void showErrorDialog(
                formatErrorMessage(error),
                "Music Service Error",
            );
            throw error;
        }

        this.emitRemote({
            track: this.currentTrack,
            isPlaying: !audio.paused,
            positionSec: Math.max(0, audio.currentTime || nextPos),
        });
    }

    async skipNext(): Promise<boolean> {
        return await this.advanceWithinSoundCloud("next", "mediaSessionNext");
    }

    async skipPrev(): Promise<boolean> {
        return await this.advanceWithinSoundCloud("prev", "mediaSessionPrev");
    }
}
