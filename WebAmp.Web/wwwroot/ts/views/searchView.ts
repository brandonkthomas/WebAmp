import type { WebAmpViewController, WebAmpViewContext } from '../router/webAmpRouter';
import { spotifyApi } from '../spotify/spotifyApi';
import type { Track } from '../state/playerStore';
import { renderListSkeleton } from '../ui/skeleton';
import { createTrackListItem } from '../ui/trackListItem';
import { createAlbumListItem } from '../ui/albumListItem';
import { createArtistListItem } from '../ui/artistListItem';
import { createPlaylistListItem } from '../ui/playlistListItem';
import { bindQueueActions } from '../ui/queueActions';

function mapSpotifyTrack(it: any): Track {
    const images = it?.album?.images ?? [];
    const artUrlSmall = images?.[images.length - 1]?.url;
    const artUrl = images?.[1]?.url ?? images?.[0]?.url;
    const artist = Array.isArray(it?.artists) ? it.artists.map((a: any) => a.name).join(', ') : '';
    const album = it?.album?.name ?? '';
    return {
        id: it.id,
        title: it.name,
        artist,
        album,
        durationSec: Math.round((it.duration_ms ?? 0) / 1000),
        artUrl,
        artUrlSmall,
        uri: it.uri
    };
}

export const searchView: WebAmpViewController = {
    id: 'search',
    mount(ctx: WebAmpViewContext) {
        const root = ctx.rootEl;
        const form = root.querySelector<HTMLFormElement>('[data-wa-search-form]');
        const input = root.querySelector<HTMLInputElement>('[data-wa-search-input]');
        const statusEl = root.querySelector<HTMLElement>('[data-wa-search-status]');
        const resultsEl = root.querySelector<HTMLElement>('[data-wa-search-results]');
        const resultsCard = root.querySelector<HTMLElement>('[data-wa-search-results-card]');
        if (!form || !input || !resultsEl) return;

        const setStatus = (t: string) => { if (statusEl) statusEl.textContent = t; };

        let destroyed = false;
        let currentQuery = '';
        const baseTracks: Track[] = [];
        let queueActive: Track[] = baseTracks;
        const cleanupActions = bindQueueActions({
            root,
            getTracks: () => baseTracks,
            onQueueApplied: (q) => { queueActive = q.slice(); }
        });

        const reset = () => {
            baseTracks.splice(0, baseTracks.length);
            queueActive = baseTracks;
            resultsEl.replaceChildren();
        };

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const q = input.value.trim();
            if (!q) return;

            currentQuery = q;
            reset();
            if (resultsCard) resultsCard.style.display = 'block';
            setStatus('Searching…');
            renderListSkeleton(resultsEl, 8);

            try {
                const data = await spotifyApi.search(currentQuery, 'track,album,artist,playlist', 5, 0);
                if (destroyed) return;

                const trackItems = data?.tracks?.items ?? [];
                const albumItems = data?.albums?.items ?? [];
                const artistItems = data?.artists?.items ?? [];
                const playlistItems = data?.playlists?.items ?? [];

                const tracks: Track[] = trackItems.map(mapSpotifyTrack);
                baseTracks.push(...tracks);
                queueActive = baseTracks;
                cleanupActions.refresh?.();

                resultsEl.replaceChildren();

                const makeSection = (title: string) => {
                    const wrap = document.createElement('div');
                    const h = document.createElement('h2');
                    h.className = 'wa-h2';
                    h.textContent = title;
                    const list = document.createElement('div');
                    list.className = 'wa-list';
                    wrap.appendChild(h);
                    wrap.appendChild(list);
                    return { wrap, list };
                };

                const tracksSec = makeSection('Tracks');
                const albumsSec = makeSection('Albums');
                const artistsSec = makeSection('Artists');
                const playlistsSec = makeSection('Playlists');

                for (let i = 0; i < tracks.length; i++) {
                    const t = tracks[i];
                    tracksSec.list.appendChild(createTrackListItem({
                        track: t,
                        onClick: () => window.dispatchEvent(new CustomEvent('wa:track:select', { detail: { trackId: t.id, tracks: baseTracks.slice(), wrap: false, from: 'search' } }))
                    }));
                }

                for (const a of albumItems) {
                    const id = a?.id;
                    if (!id) continue;
                    const title = a?.name ?? '(untitled)';
                    const artist = Array.isArray(a?.artists) ? a.artists.map((x: any) => x.name).join(', ') : '';
                    const images = a?.images ?? [];
                    const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
                    albumsSec.list.appendChild(createAlbumListItem({
                        album: { id, title, artist, artUrlSmall },
                        onClick: () => ctx.router.navigate(`/webamp/albums/${id}`)
                    }));
                }

                for (const a of artistItems) {
                    const id = a?.id;
                    if (!id) continue;
                    const name = a?.name ?? '(untitled)';
                    const images = a?.images ?? [];
                    const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
                    artistsSec.list.appendChild(createArtistListItem({
                        artist: { id, name, artUrlSmall },
                        onClick: () => ctx.router.navigate(`/webamp/artists/${id}`)
                    }));
                }

                for (const p of playlistItems) {
                    const id = p?.id;
                    if (!id) continue;
                    const title = p?.name ?? '(untitled)';
                    const owner = p?.owner?.display_name ?? p?.owner?.id ?? '—';
                    const images = p?.images ?? [];
                    const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
                    playlistsSec.list.appendChild(createPlaylistListItem({
                        playlist: { id, title, owner, artUrlSmall },
                        onClick: () => ctx.router.navigate(`/webamp/playlists/${id}`)
                    }));
                }

                // Only show non-empty sections (keep UI tight)
                const any =
                    (tracksSec.list.childElementCount || albumItems.length || artistItems.length || playlistItems.length);

                if (!any) {
                    setStatus('No results found.');
                    return;
                }

                if (tracksSec.list.childElementCount) resultsEl.appendChild(tracksSec.wrap);
                if (albumsSec.list.childElementCount) resultsEl.appendChild(albumsSec.wrap);
                if (artistsSec.list.childElementCount) resultsEl.appendChild(artistsSec.wrap);
                if (playlistsSec.list.childElementCount) resultsEl.appendChild(playlistsSec.wrap);

                setStatus('');
            } catch (err: any) {
                setStatus(err?.message ?? 'Search failed');
                resultsEl.replaceChildren();
            }
        });

        (searchView as any)._cleanup = () => {
            destroyed = true;
            cleanupActions();
        };
    }
    ,
    unmount() {
        (searchView as any)._cleanup?.();
        (searchView as any)._cleanup = null;
    }
};
