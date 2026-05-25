/**
 * webamp.ts
 * Entry point for the WebAmp player UI.
 */

import { WebAmpRouter } from './router/webAmpRouter';
import type { ViewId } from './router/routes';
import { landingView } from './views/landingView';
import { homeView } from './views/homeView';
import { searchView } from './views/searchView';
import { likedView } from './views/likedView';
import { playlistView } from './views/playlistView';
import { albumView } from './views/albumView';
import { artistView } from './views/artistView';
import { PlayerStore } from './state/playerStore';
import type { Track } from './state/playerStore';
import { PlayerBar } from './components/playerBar/playerBar';
import { NowPlayingMobile } from './components/nowPlayingMobile/nowPlayingMobile';
import { SpotifySource } from './sources/spotifySource';
import { SoundCloudSource } from './sources/soundCloudSource';
import { bootIndium, createSidebarController } from './internal/indiumApi';
import { assetPath, routePath, webAmpBrandAsset } from './internal/paths';
import { HybridTransport } from './sources/hybridTransport';
import { primeTrackLibraryState } from './library/trackLibrary';
import { getDominantColor } from './ui/dominantColor';
import { clearClientCacheAndReload } from './storage/clientCache';
import { getShufflePref, isShuffleDirty, setShuffleEnabled } from './ui/queueActions';
import { logEvent } from './internal/logging';

// Injected at bundle time by esbuild (see WebAmp.Web.csproj).
declare const __WEBAMP_APP_VERSION__: string;

function getTemplate(id: string): HTMLTemplateElement {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLTemplateElement)) {
        throw new Error(`WebAmp missing template: ${id}`);
    }
    return el;
}

function boot() {
    const appRoot = document.querySelector<HTMLElement>('[data-wa-app]');
    const viewHost = document.querySelector<HTMLElement>('[data-wa-view-host]');
    const playerBarRoot = document.querySelector<HTMLElement>('[data-wa-playerbar]');
    const nowPlayingRoot = document.querySelector<HTMLElement>('[data-wa-nowplaying]');
    const versionEl = document.querySelector<HTMLElement>('[data-wa-version]');

    if (!appRoot || !viewHost) return;

    const routeRoot = routePath('/');
    const indiumBoot = bootIndium({
        routeRoot: '/webamp',
        apiBasePath: '/api/webamp',
        assetBasePath: '/apps/indium',
        brandLogoSrc: webAmpBrandAsset('branding/icon-WebAmp-full256.png'),
        brandLogoAlt: 'WebAmp logo'
    });

    if (versionEl) {
        const v = (typeof __WEBAMP_APP_VERSION__ === 'string' && __WEBAMP_APP_VERSION__.trim().length)
            ? __WEBAMP_APP_VERSION__.trim()
            : 'dev';
        const m = v.match(/(\d+)\s*$/);
        const buildNum = m?.[1] ?? v;
        versionEl.textContent = `build ${buildNum}`;
    }

    // Keep the global loading overlay up until we resolve Spotify auth (prevents a "landing flash" on reload).
    let authResolved = false;
    document.body.dataset.initialState = 'loading';
    window.addEventListener('load', () => {
        // Layout.cshtml sets initialState=ready on can-pinch-to-zoom pages at window.onload; override it until auth resolves.
        queueMicrotask(() => {
            if (!authResolved) document.body.dataset.initialState = 'loading';
        });
    });

    const templates: Record<ViewId, HTMLTemplateElement> = {
        landing: getTemplate('wa-tpl-landing'),
        home: getTemplate('wa-tpl-home'),
        search: getTemplate('wa-tpl-search'),
        liked: getTemplate('wa-tpl-liked'),
        playlist: getTemplate('wa-tpl-playlist'),
        album: getTemplate('wa-tpl-album'),
        artist: getTemplate('wa-tpl-artist')
    };

    // Player scaffolding (UI-only, no audio yet)
    const seedTracks = [
        { id: '1', title: 'Track 1', artist: 'Artist', durationSec: 192 },
        { id: '2', title: 'Track 2', artist: 'Artist', durationSec: 178 },
        { id: '3', title: 'Track 3', artist: 'Artist', durationSec: 247 }
    ];
    const playerStore = new PlayerStore(seedTracks);
    const spotifySource = new SpotifySource();
    const soundCloudSource = new SoundCloudSource();
    const initialPath = window.location.pathname;

    // Apply persisted shuffle preference to the store so it affects playback order.
    playerStore.setShuffleEnabled(getShufflePref());
    window.addEventListener('wa:shuffle:set', (e: Event) => {
        const ev = e as CustomEvent<{ enabled?: boolean }>;
        playerStore.setShuffleEnabled(!!ev.detail?.enabled);
    });

    // Global disconnect handler (sidebar button) and source-aware footer chrome.
    const disconnectBtn = document.querySelector<HTMLButtonElement>('[data-wa-action="source-disconnect"]');
    const disconnectIcon = document.querySelector<HTMLImageElement>('[data-wa-disconnect-icon]');
    const disconnectLabel = document.querySelector<HTMLElement>('[data-wa-disconnect-label]');
    const DISCONNECT_ICON_WEBAMP = webAmpBrandAsset('branding/icon-WebAmp-full256.png');
    const DISCONNECT_ICON_SPOTIFY = assetPath('assets/svg/spotify.svg');
    const DISCONNECT_ICON_SOUNDCLOUD = assetPath('assets/svg/soundcloud.svg');

    const updateSourceChrome = () => {
        const spotifyConnected = spotifySource.getState().isConnected;
        const scConnected = soundCloudSource.getState().isConnected;
        if (!disconnectBtn) return;

        if (!spotifyConnected && !scConnected) {
            disconnectBtn.disabled = true;
            disconnectBtn.style.opacity = '0.6';
            if (disconnectLabel) disconnectLabel.textContent = 'Sign Out';
            if (disconnectIcon) {
                disconnectIcon.src = DISCONNECT_ICON_WEBAMP;
            }
            delete (disconnectBtn.dataset as any).waSource;
            return;
        }

        disconnectBtn.disabled = false;
        disconnectBtn.style.opacity = '';

        if (spotifyConnected) {
            if (disconnectIcon) {
                disconnectIcon.src = DISCONNECT_ICON_SPOTIFY;
            }
            if (disconnectLabel) disconnectLabel.textContent = 'Sign Out';
            disconnectBtn.dataset.waSource = 'spotify';
        } else if (scConnected) {
            if (disconnectIcon) {
                disconnectIcon.src = DISCONNECT_ICON_SOUNDCLOUD;
            }
            if (disconnectLabel) disconnectLabel.textContent = 'Sign Out';
            disconnectBtn.dataset.waSource = 'soundcloud';
        }
    };

    disconnectBtn?.addEventListener('click', () => {
        const spotifyConnected = spotifySource.getState().isConnected;
        const scConnected = soundCloudSource.getState().isConnected;
        if (spotifyConnected && (spotifySource as any).disconnect) {
            document.body.setAttribute('data-initial-state', 'loading'); // show loading overlay
            void spotifySource.disconnect();
        } else if (scConnected && (soundCloudSource as any).disconnect) {
            document.body.setAttribute('data-initial-state', 'loading'); // show loading overlay
            void soundCloudSource.disconnect();
        }
    });

    spotifySource.onChange(updateSourceChrome);
    soundCloudSource.onChange(updateSourceChrome);
    updateSourceChrome();

    // Start the router immediately (do not block on network/Spotify/SC SDK).
    const router = new WebAmpRouter({
        root: routeRoot,
        dom: { appRoot, viewHost, templates },
        views: {
            landing: landingView,
            home: homeView,
            search: searchView,
            liked: likedView,
            playlist: playlistView,
            album: albumView,
            artist: artistView
        },
        services: {
            musicSource: spotifySource,
            soundCloudSource
        }
    });

    if (playerBarRoot) {
        new PlayerBar({ root: playerBarRoot, store: playerStore });
    }
    if (nowPlayingRoot) {
        new NowPlayingMobile({ root: nowPlayingRoot, playerBarRoot, store: playerStore });
    }

    // Background color wash based on the currently playing track's album art.
    let lastArtKey: string | null = null;
    let lastLibraryTrackKey: string | null = null;
    let lastNowPlayingId: string | null = null;
    let lastMediaMetaKey: string | null = null;
    let lastMediaPosSec: number | null = null;
    const themeMedia = (typeof window !== 'undefined' && typeof window.matchMedia === 'function')
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;

    const mediaSession = (typeof navigator !== 'undefined' && 'mediaSession' in navigator)
        ? navigator.mediaSession
        : null;

    const setMediaActionHandler = (
        action: MediaSessionAction,
        handler: MediaSessionActionHandler | null
    ) => {
        if (!mediaSession) return;
        try {
            mediaSession.setActionHandler(action, handler);
        } catch {
            // Some browsers expose mediaSession but not all action handlers.
        }
    };

    /**
     * Request track skip in the transport layer
     * @param direction 
     * @returns 
     */
    const requestTransportSkip = (direction: 'next' | 'prev') => {
        const transportSkip = direction === 'next'
            ? hybridTransport?.skipNext?.()
            : hybridTransport?.skipPrev?.();

        if (!transportSkip || typeof (transportSkip as Promise<boolean>).then !== 'function') {
            if (!transportSkip) {
                if (direction === 'next') playerStore.next({ autoplay: true });
                else playerStore.prev({ autoplay: true });
            }
            return;
        }

        void (transportSkip as Promise<boolean>).then((handled) => {
            if (handled) return;
            if (direction === 'next') playerStore.next({ autoplay: true });
            else playerStore.prev({ autoplay: true });
        });
    };

    if (mediaSession) {
        setMediaActionHandler('play', () => {
            const st = playerStore.getState();
            if (!st.track) return;
            if (!st.isPlaying) playerStore.togglePlay();
        });
        setMediaActionHandler('pause', () => {
            const st = playerStore.getState();
            if (st.isPlaying) playerStore.togglePlay();
        });
        setMediaActionHandler('previoustrack', () => {
            requestTransportSkip('prev');
        });
        setMediaActionHandler('nexttrack', () => {
            requestTransportSkip('next');
        });
        setMediaActionHandler('seekto', (details) => {
            const t = typeof details?.seekTime === 'number' ? details.seekTime : null;
            if (t === null || Number.isNaN(t)) return;
            playerStore.seek(t);
        });
        // Prefer track navigation controls over podcast-style +/-10s controls in media session
        setMediaActionHandler('seekbackward', null);
        setMediaActionHandler('seekforward', null);
    }

    playerStore.subscribe((state) => {
        const libraryTrack = state.track;
        const libraryTrackSource = libraryTrack.source;
        const libraryTrackKey = libraryTrack ? `${libraryTrackSource ?? 'spotify'}:${libraryTrack.id}` : null;
        if (libraryTrackKey !== lastLibraryTrackKey) {
            lastLibraryTrackKey = libraryTrackKey;
            primeTrackLibraryState(libraryTrack);
        }

        // Now-playing indicator on track list items
        const nowId = state.track?.id ?? null;
        if (nowId !== lastNowPlayingId) {
            const prev = document.querySelectorAll<HTMLElement>('[data-wa-track][data-wa-now-playing="true"]');
            prev.forEach((el) => {
                el.removeAttribute('data-wa-now-playing');
                el.removeAttribute('data-wa-playing');
            });
            lastNowPlayingId = nowId;
        }
        if (nowId) {
            const esc = (window as any).CSS?.escape ? (window as any).CSS.escape(nowId) : nowId.replace(/"/g, '\\"');
            const els = document.querySelectorAll<HTMLElement>(`[data-wa-track="${esc}"]`);
            els.forEach((el) => {
                el.setAttribute('data-wa-now-playing', 'true');
                el.setAttribute('data-wa-playing', state.isPlaying ? 'true' : 'false');
            });
        }

        // Keep a lightweight "is playing" flag at the document level so that
        // CSS can toggle heavy visual effects (blur, noise) independently of
        // the frequently-updated player controls.
        if (typeof document !== 'undefined' && document.body) {
            document.body.dataset.waPlaying = state.isPlaying ? 'true' : 'false';
        }

        // Set Media Session metadata (album/artist/track sent to client's native OS media player)
        if (mediaSession) {
            const t = state.track;
            if (!t) {
                lastMediaMetaKey = null;
                lastMediaPosSec = null;
                try { mediaSession.metadata = null; } catch { /* ignore */ }
                try { mediaSession.playbackState = 'none'; } catch { /* ignore */ }
            } else {
                const title = t.title?.trim() || 'Unknown Title';
                const artist = t.artist?.trim() || 'Unknown Artist';
                const album = t.album?.trim() || (libraryTrackSource == 'soundcloud' ? 'SoundCloud via WebAmp' : 'Unknown Album') || 'Unknown Album';
                const artCandidates = [t.artUrlLarge, t.artUrl, t.artUrlSmall]
                    .filter((u): u is string => !!u && typeof u === 'string');
                const artwork = Array.from(new Set(artCandidates)).map((src) => ({
                    src,
                    sizes: '512x512'
                }));
                const metaKey = [title, artist, album, artwork.map((a) => a.src).join('|')].join('::');
                if (metaKey !== lastMediaMetaKey) {
                    lastMediaMetaKey = metaKey;
                    try {
                        mediaSession.metadata = new MediaMetadata({
                            title,
                            artist,
                            album,
                            artwork
                        });
                    } catch {
                        // ignore metadata update errors
                    }
                }
                try {
                    mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';
                } catch {
                    // ignore
                }

                const duration = t.durationSec ?? 0;
                const position = Math.max(0, state.positionSec ?? 0);
                // Keep lockscreen scrubber aligned, but avoid spamming updates.
                if (
                    Number.isFinite(duration)
                    && duration > 0
                    && (lastMediaPosSec === null || Math.abs(position - lastMediaPosSec) >= 0.8 || !state.isPlaying)
                ) {
                    lastMediaPosSec = position;
                    try {
                        mediaSession.setPositionState({
                            duration,
                            playbackRate: 1,
                            position: Math.min(duration, position)
                        });
                    } catch {
                        // ignore
                    }
                }
            }
        }

        const base = getIdleAccent();
        const art = state.track?.artUrlSmall ?? state.track?.artUrl ?? null;
        if (!art) {
            lastArtKey = null;
            setAccentActive(false);
            setAccent(base);
            return;
        }
        if (art === lastArtKey) return;
        lastArtKey = art;

        void (async () => {
            const rgb = await getDominantColor(art);
            if (!rgb) {
                setAccentActive(false);
                setAccent(base);
                return;
            }
            // Mix with base background so it stays subtle.
            const mixed = mixRgb(rgb, base, 0.62);
            setAccent(mixed);
            setAccentActive(true);
        })();
    });

    const syncIdleAccent = () => {
        const target = document.body ?? document.documentElement;
        if (target.dataset.waAccentActive === 'true') return;
        setAccent(getIdleAccent());
    };

    if (typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver(syncIdleAccent);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class', 'data-wa-theme', 'data-wa-theme-resolved']
        });
    }

    if (themeMedia) {
        const handleThemeChange = () => syncIdleAccent();
        if (typeof themeMedia.addEventListener === 'function') {
            themeMedia.addEventListener('change', handleThemeChange);
        } else if (typeof themeMedia.addListener === 'function') {
            themeMedia.addListener(handleThemeChange);
        }
    }

    function setAccent(rgb: { r: number; g: number; b: number }) {
        const target = document.body ?? document.documentElement;
        target.style.setProperty('--wa-accent-r', String(rgb.r));
        target.style.setProperty('--wa-accent-g', String(rgb.g));
        target.style.setProperty('--wa-accent-b', String(rgb.b));
        logEvent('WebAmp', 'setAccent', rgb);
    }

    function setAccentActive(active: boolean) {
        const target = document.body ?? document.documentElement;
        target.dataset.waAccentActive = active ? 'true' : 'false';
    }

    function getIdleAccent() {
        return isLightThemeResolved()
            ? { r: 255, g: 255, b: 255 }
            : { r: 0, g: 0, b: 0 };
    }

    function isLightThemeResolved() {
        const root = document.documentElement;
        if (
            root.classList.contains('wa-theme-light')
            || root.getAttribute('data-wa-theme') === 'light'
            || root.getAttribute('data-wa-theme-resolved') === 'light'
        ) {
            return true;
        }
        if (
            root.classList.contains('wa-theme-dark')
            || root.getAttribute('data-wa-theme') === 'dark'
            || root.getAttribute('data-wa-theme-resolved') === 'dark'
        ) {
            return false;
        }
        return !!themeMedia && !themeMedia.matches;
    }

    function mixRgb(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number) {
        const k = Math.max(0, Math.min(1, t));
        return {
            r: Math.round(a.r * k + b.r * (1 - k)),
            g: Math.round(a.g * k + b.g * (1 - k)),
            b: Math.round(a.b * k + b.b * (1 - k))
        };
    }
    createSidebarController({ appRoot: indiumBoot.appRoot || appRoot });

    // Toggle play/pause from now-playing overlay (without restarting track).
    window.addEventListener('wa:track:toggle', (e: Event) => {
        const ev = e as CustomEvent<{ trackId?: string }>;
        const trackId = ev.detail?.trackId;
        if (!trackId) return;
        const current = playerStore.getState().track?.id ?? null;
        if (current && current === trackId) {
            playerStore.togglePlay();
        } else {
            // Fallback: behave like clicking the row.
            playerStore.selectTrackById(trackId, true);
        }
    });

    // Global play/pause toggle (used by header "Play/Pause" button when the
    // current view already owns the active queue).
    window.addEventListener('wa:player:toggle', () => {
        playerStore.togglePlay();
    });

    // Provider transports can explicitly signal "track finished" when they have
    // authoritative end-of-track detection (e.g. SoundCloud HTMLAudioElement end,
    // or Spotify Web Playback SDK signaling a natural end-of-track).
    window.addEventListener('wa:transport:finish', (e: Event) => {
        const ev = e as CustomEvent<{ source?: string; trackId?: string }>;

        const finishedId = ev.detail?.trackId;
        if (!finishedId) return;

        // SoundCloud transport handles its own track finished detection
        if (ev.detail?.source === 'soundcloud') return;

        const st = playerStore.getState();
        // Only advance if the finished track is still the selected track.
        if (st.track?.id !== finishedId) return;
        // When a track finishes naturally, we want to keep continuous playback.
        playerStore.next({ autoplay: true });
    });

    // Transport busy state (e.g. SoundCloud HTMLAudioElement load/ready/seek) so UI can show
    // an indeterminate throbber for play buttons while switching tracks.
    window.addEventListener('wa:transport:busy', (e: Event) => {
        const ev = e as CustomEvent<{ busy?: boolean }>;
        playerStore.setBusy(!!ev.detail?.busy);
    });

    window.addEventListener('wa:track:select', (e: Event) => {
        const ev = e as CustomEvent<{ trackId?: string; tracks?: any[]; wrap?: boolean; from?: string }>;
        let trackId = ev.detail?.trackId;
        if (!trackId) return;

        const from = ev.detail?.from;
        const isSpecificTrackTap = from !== 'queue-play';
        if (isSpecificTrackTap && getShufflePref() && !isShuffleDirty()) {
            // If user hasn't explicitly touched shuffle yet, a direct track tap
            // should prefer deterministic playback order.
            setShuffleEnabled(false);
        }

        if (Array.isArray(ev.detail?.tracks)) {
            const queue = (ev.detail.tracks as Track[]).filter((t) => t?.isPlayable !== false);
            if (!queue.length) return;
            playerStore.setQueue(queue as any, { wrap: ev.detail?.wrap ?? false });
            if (!queue.some((t) => t.id === trackId)) {
                trackId = queue[0]?.id;
            }
        }
        playerStore.selectTrackById(trackId, true);
    });

    // Views can set the current queue by dispatching a CustomEvent('wa:queue:set', {detail:{tracks}})
    window.addEventListener('wa:queue:set', (e: Event) => {
        const ev = e as CustomEvent<{ tracks?: any[]; wrap?: boolean }>;
        const tracks = ev.detail?.tracks;
        if (!Array.isArray(tracks)) return;
        const queue = (tracks as Track[]).filter((t) => t?.isPlayable !== false);
        playerStore.setQueue(queue as any, { wrap: ev.detail?.wrap ?? false });
    });

    // Explicit user queue additions should play before the remaining implicit queue.
    window.addEventListener('wa:queue:add-next', (e: Event) => {
        const ev = e as CustomEvent<{ tracks?: any[] }>;
        const tracks = ev.detail?.tracks;
        if (!Array.isArray(tracks)) return;
        playerStore.addNext(tracks as Track[]);
    });

    // Lazy-loaded pages can extend the indirect queue without disturbing explicit additions.
    window.addEventListener('wa:queue:append-implicit', (e: Event) => {
        const ev = e as CustomEvent<{ tracks?: any[] }>;
        const tracks = ev.detail?.tracks;
        if (!Array.isArray(tracks)) return;
        playerStore.appendImplicit(tracks as Track[]);
    });

    // Deep-link helpers from the global player bar
    window.addEventListener('wa:navigate:album', (e: Event) => {
        const ev = e as CustomEvent<{ albumId?: string }>;
        const albumId = ev.detail?.albumId;
        if (!albumId) return;
        router.navigate(routePath(`albums/${albumId}`));
    });

    window.addEventListener('wa:navigate:artist', (e: Event) => {
        const ev = e as CustomEvent<{ artistId?: string }>;
        const artistId = ev.detail?.artistId;
        if (!artistId) return;
        router.navigate(routePath(`artists/${artistId}`));
    });

    router.start();

    (window as any).waClearCacheAndReload = clearClientCacheAndReload;

    // Background: check auth status and always install a hybrid transport.
    // The transport will route playback to Spotify or SoundCloud based on track.source,
    // and will surface a friendly error if a Spotify track is played without being connected.
    let transportInstalled = false;
    let hybridTransport: HybridTransport | null = null;
    
    const ensureHybridTransport = () => {
        if (transportInstalled) return;
        transportInstalled = true;
        const transport = new HybridTransport({
            spotifySource,
            onRemoteState: (s) => {
                playerStore.syncFromRemote({
                    track: s.track,
                    isPlaying: s.isPlaying,
                    positionSec: s.positionSec
                });
            },
            getAdjacentTrack: (currentTrack, direction) => playerStore.getAdjacentTrack(direction, currentTrack?.id ?? null),
            getUpcomingTracks: (currentTrack, limit) => playerStore.getUpcomingTracks(currentTrack?.id ?? null, limit),
            fallbackQueueAdvance: (direction, autoplay) => {
                if (direction === 'next') {
                    playerStore.next({ autoplay });
                } else {
                    playerStore.prev({ autoplay });
                }
            }
        });
        hybridTransport = transport;
        playerStore.setTransport(transport);

        // Prewarm SoundCloud transport (audio element + stream resolver cache path)
        // so first play does less work on the interaction-critical path.
        try {
            transport.primeSoundCloud();
        } catch {
            // ignore
        }

        try {
            transport.primeSpotify();
        } catch {
            // ignore
        }

        // Prime again on earliest user interaction to maximize first-play reliability.
        const primeOnce = () => {
            try {
                transport.primeSoundCloud();
            } catch {
                // ignore
            }
            try {
                transport.primeSpotify();
            } catch {
                // ignore
            }
            try {
                transport.primeSpotifyActivation();
            } catch {
                // ignore
            }
            window.removeEventListener('pointerdown', primeOnce, true);
            window.removeEventListener('touchstart', primeOnce, true);
            window.removeEventListener('mousedown', primeOnce, true);
        };
        window.addEventListener('pointerdown', primeOnce, true);
        window.addEventListener('touchstart', primeOnce, true);
        window.addEventListener('mousedown', primeOnce, true);

        // If UI already shows a selected/playing track, attempt to start real playback once transport becomes ready.
        const st = playerStore.getState();
        if (st.track && st.isPlaying) {
            void transport.play(st.track, st.positionSec, { autoplay: true });
        }
    };

    // Install the transport immediately so first-tap play is routed through the real
    // engine in the same user gesture (important for autoplay policies), rather than
    // waiting for async auth probes to finish.
    ensureHybridTransport();

    void Promise.all([spotifySource.init(), soundCloudSource.init()]).then(() => {
        const spotifyConnected = spotifySource.getState().isConnected;
        const scConnected = soundCloudSource.getState().isConnected;
        const authed = spotifyConnected || scConnected;
        const currentView = appRoot.dataset.waView;

        // Always have a transport so that SoundCloud-only mode works without Spotify.
        ensureHybridTransport();

        if (spotifyConnected) {
            try {
                hybridTransport?.primeSpotify();
            } catch {
                // ignore
            }
        }

        // If any music source is connected and we are still on the landing page,
        // jump to the desired route.
        if (authed && currentView === 'landing') {
            const desired =
                initialPath && initialPath.startsWith(`${routeRoot}/`)
                    ? initialPath
                    : routePath('home');
            router.navigate(desired);
        }

        authResolved = true;
        document.body.dataset.initialState = 'ready';
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
