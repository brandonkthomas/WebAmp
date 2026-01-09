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
import { PlayerBar } from './components/playerBar/playerBar';
import { SpotifySource } from './sources/spotifySource';
import { SidebarController } from './components/sidebar/sidebar';
import { SpotifyTransport } from './sources/spotify/spotifyTransport';
import { getDominantColor } from './ui/dominantColor';

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
    const sidebar = document.querySelector<HTMLElement>('[data-wa-sidebar]');
    const sidebarOverlay = document.querySelector<HTMLElement>('[data-wa-sidebar-overlay]');
    const sidebarOpenBtn = document.querySelector<HTMLElement>('[data-wa-sidebar-toggle]');
    const sidebarCloseBtn = document.querySelector<HTMLElement>('[data-wa-sidebar-close]');

    if (!appRoot || !viewHost) return;

    // Keep the global loading overlay up until we resolve Spotify auth (prevents a "landing flash" on reload).
    let authResolved = false;
    document.body.dataset.initialState = 'loading';
    window.addEventListener('load', () => {
        // Layout.cshtml sets initialState=ready on app pages at window.onload; override it until auth resolves.
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
    const musicSource = new SpotifySource();
    const initialPath = window.location.pathname;

    // Start the router immediately (do not block on network/Spotify SDK).
    const router = new WebAmpRouter({
        root: '/webamp',
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
            musicSource
        }
    });

    // Global disconnect handler (sidebar button)
    const disconnectBtn = document.querySelector<HTMLButtonElement>('[data-wa-action="spotify-disconnect"]');
    disconnectBtn?.addEventListener('click', () => {
        if (musicSource.disconnect) void musicSource.disconnect();
    });

    if (playerBarRoot) {
        new PlayerBar({ root: playerBarRoot, store: playerStore });
    }

    // Background color wash based on the currently playing track's album art.
    const base = { r: 14, g: 14, b: 18 };
    let lastArtKey: string | null = null;
    let lastNowPlayingId: string | null = null;
    playerStore.subscribe((state) => {
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

        const art = state.track?.artUrlSmall ?? state.track?.artUrl ?? null;
        if (!art) {
            lastArtKey = null;
            setAccent(base);
            return;
        }
        if (art === lastArtKey) return;
        lastArtKey = art;

        void (async () => {
            const rgb = await getDominantColor(art);
            if (!rgb) return;
            // Mix with base background so it stays subtle.
            const mixed = mixRgb(rgb, base, 0.62);
            setAccent(mixed);
        })();
    });

    function setAccent(rgb: { r: number; g: number; b: number }) {
        const target = document.body ?? document.documentElement;
        target.style.setProperty('--wa-accent-r', String(rgb.r));
        target.style.setProperty('--wa-accent-g', String(rgb.g));
        target.style.setProperty('--wa-accent-b', String(rgb.b));
    }

    function mixRgb(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number) {
        const k = Math.max(0, Math.min(1, t));
        return {
            r: Math.round(a.r * k + b.r * (1 - k)),
            g: Math.round(a.g * k + b.g * (1 - k)),
            b: Math.round(a.b * k + b.b * (1 - k))
        };
    }

    if (sidebar && sidebarOverlay) {
        new SidebarController({
            appRoot,
            sidebar,
            overlay: sidebarOverlay,
            openBtn: sidebarOpenBtn,
            closeBtn: sidebarCloseBtn
        });
    }

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

    window.addEventListener('wa:track:select', (e: Event) => {
        const ev = e as CustomEvent<{ trackId?: string; tracks?: any[]; wrap?: boolean }>;
        const trackId = ev.detail?.trackId;
        if (!trackId) return;
        if (Array.isArray(ev.detail?.tracks)) {
            playerStore.setQueue(ev.detail.tracks as any, { wrap: ev.detail?.wrap ?? false });
        }
        playerStore.selectTrackById(trackId, true);
    });

    // Views can set the current queue by dispatching a CustomEvent('wa:queue:set', {detail:{tracks}})
    window.addEventListener('wa:queue:set', (e: Event) => {
        const ev = e as CustomEvent<{ tracks?: any[]; wrap?: boolean }>;
        const tracks = ev.detail?.tracks;
        if (!Array.isArray(tracks)) return;
        playerStore.setQueue(tracks as any, { wrap: ev.detail?.wrap ?? false });
    });

    // Deep-link helpers from the global player bar
    window.addEventListener('wa:navigate:album', (e: Event) => {
        const ev = e as CustomEvent<{ albumId?: string }>;
        const albumId = ev.detail?.albumId;
        if (!albumId) return;
        router.navigate(`/webamp/albums/${albumId}`);
    });

    window.addEventListener('wa:navigate:artist', (e: Event) => {
        const ev = e as CustomEvent<{ artistId?: string }>;
        const artistId = ev.detail?.artistId;
        if (!artistId) return;
        router.navigate(`/webamp/artists/${artistId}`);
    });

    router.start();

    // Background: check auth status quickly and then (if authed) install Spotify transport lazily.
    let transportInstalled = false;
    const ensureSpotifyTransport = () => {
        if (transportInstalled) return;
        transportInstalled = true;
        const transport = new SpotifyTransport((s) => {
            playerStore.syncFromRemote({
                track: s.track,
                isPlaying: s.isPlaying,
                positionSec: s.positionSec
            });
        });
        playerStore.setTransport(transport);

        // If UI already shows a selected/playing track, attempt to start real playback once transport becomes ready.
        const st = playerStore.getState();
        if (st.track && st.isPlaying) {
            void transport.play(st.track, st.positionSec);
        }
    };

    void musicSource.init().then(() => {
        // After we know auth state, ensure the router is on the right screen.
        const connected = musicSource.getState().isConnected;
        const currentView = appRoot.dataset.waView;

        if (connected) {
            ensureSpotifyTransport();

            // If we started on landing because auth was unknown, jump to desired route.
            if (currentView === 'landing') {
                const desired = initialPath && initialPath.startsWith('/webamp/') ? initialPath : '/webamp/home';
                router.navigate(desired);
            }
        } else {
            // Not connected: if user somehow landed elsewhere, bounce to landing.
            if (currentView && currentView !== 'landing') {
                router.navigate('/webamp');
            }
            playerStore.setTransport(null);
            transportInstalled = false;
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
