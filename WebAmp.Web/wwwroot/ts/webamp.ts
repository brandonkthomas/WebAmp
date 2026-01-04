/**
 * webamp.ts
 * Entry point for the WebAmp player UI.
 */

import { WebAmpRouter } from './router/webAmpRouter';
import type { ViewId } from './router/routes';
import { landingView } from './views/landingView';
import { homeView } from './views/homeView';
import { playlistView } from './views/playlistView';
import { albumView } from './views/albumView';
import { artistView } from './views/artistView';
import { PlayerStore } from './state/playerStore';
import { PlayerBar } from './components/playerBar/playerBar';
import { SpotifySourceStub } from './sources/spotifySourceStub';
import { SidebarController } from './components/sidebar/sidebar';

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

    const templates: Record<ViewId, HTMLTemplateElement> = {
        landing: getTemplate('wa-tpl-landing'),
        home: getTemplate('wa-tpl-home'),
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
    const musicSource = new SpotifySourceStub();

    if (playerBarRoot) {
        new PlayerBar({ root: playerBarRoot, store: playerStore });
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

    window.addEventListener('wa:track:select', (e: Event) => {
        const ev = e as CustomEvent<{ trackId?: string }>;
        const trackId = ev.detail?.trackId;
        if (!trackId) return;
        playerStore.selectTrackById(trackId, true);
    });

    const router = new WebAmpRouter({
        root: '/webamp',
        dom: { appRoot, viewHost, templates },
        views: {
            landing: landingView,
            home: homeView,
            playlist: playlistView,
            album: albumView,
            artist: artistView
        },
        services: {
            musicSource
        }
    });

    router.start();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
