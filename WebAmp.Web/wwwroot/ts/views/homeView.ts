import type { WebAmpViewController, WebAmpViewContext } from '../router/webAmpRouter';
import { spotifyApi } from '../spotify/spotifyApi';
import type { Track } from '../state/playerStore';
import { renderListSkeleton } from '../ui/skeleton';
import { createTrackListItem } from '../ui/trackListItem';
import { createPlaylistListItem } from '../ui/playlistListItem';

export const homeView: WebAmpViewController = {
    id: 'home',
    mount(ctx: WebAmpViewContext) {
        const root = ctx.rootEl;
        const playlistsEl = root.querySelector<HTMLElement>('[data-wa-playlists]');
        const playlistsStatusEl = root.querySelector<HTMLElement>('[data-wa-playlists-status]');
        const likedEl = root.querySelector<HTMLElement>('[data-wa-liked]');
        const likedStatusEl = root.querySelector<HTMLElement>('[data-wa-liked-status]');

        const setPlaylistsStatus = (t: string) => { if (playlistsStatusEl) playlistsStatusEl.textContent = t; };
        const setLikedStatus = (t: string) => { if (likedStatusEl) likedStatusEl.textContent = t; };

        // Load a little library UI (saved playlists + liked songs)
        (async () => {
            if (playlistsEl) {
                try {
                    setPlaylistsStatus('Loading…');
                    renderListSkeleton(playlistsEl, 6);
                    const data = await spotifyApi.myPlaylists(20, 0);
                    const items = data?.items ?? [];
                    playlistsEl.replaceChildren();
                    for (const p of items) {
                        const id = p?.id;
                        const name = p?.name ?? '(untitled)';
                        const owner = p?.owner?.display_name ?? p?.owner?.id ?? '—';
                        const images = p?.images ?? [];
                        const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
                        if (!id) continue;
                        playlistsEl.appendChild(createPlaylistListItem({
                            playlist: { id, title: name, owner, artUrlSmall },
                            onClick: () => ctx.router.navigate(`/webamp/playlists/${id}`)
                        }));
                    }
                    setPlaylistsStatus(items.length ? '' : 'No playlists found.');
                } catch (err: any) {
                    setPlaylistsStatus(err?.message ?? 'Failed to load playlists');
                    playlistsEl?.replaceChildren();
                }
            }

            if (likedEl) {
                try {
                    setLikedStatus('Loading…');
                    renderListSkeleton(likedEl, 6);
                    const data = await spotifyApi.savedTracks(20, 0);
                    const items = data?.items ?? [];
                    const tracks: Track[] = items
                        .map((it: any) => it?.track)
                        .filter(Boolean)
                        .map((t: any) => {
                            const images = t?.album?.images ?? [];
                            const artUrlSmall = images?.[images.length - 1]?.url;
                            const artUrl = images?.[1]?.url ?? images?.[0]?.url;
                            const artist = Array.isArray(t?.artists) ? t.artists.map((a: any) => a.name).join(', ') : '';
                            const album = t?.album?.name ?? '';
                            const albumId = t?.album?.id;
                            const primaryArtistId: string | undefined =
                                Array.isArray(t?.artists) && t.artists.length
                                    ? t.artists[0]?.id
                                    : undefined;
                            return {
                                id: t.id,
                                title: t.name,
                                artist,
                                albumId,
                                album,
                                primaryArtistId,
                                durationSec: Math.round((t.duration_ms ?? 0) / 1000),
                                artUrl,
                                artUrlSmall,
                                uri: t.uri
                            } as Track;
                        });

                    likedEl.replaceChildren();
                    for (const t of tracks) {
                        likedEl.appendChild(createTrackListItem({
                            track: t,
                            onClick: () => {
                                window.dispatchEvent(new CustomEvent('wa:track:select', { detail: { trackId: t.id, tracks: tracks.slice(), wrap: false, from: 'liked' } }));
                            }
                        }));
                    }

                    setLikedStatus(tracks.length ? '' : 'No liked songs found.');
                } catch (err: any) {
                    setLikedStatus(err?.message ?? 'Failed to load liked songs');
                    likedEl?.replaceChildren();
    }
            }
        })();
    }
};
