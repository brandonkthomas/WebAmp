import type { WebAmpViewController, WebAmpViewContext } from '../router/webAmpRouter';
import { spotifyApi } from '../spotify/spotifyApi';
import type { Track } from '../state/playerStore';
import { renderListSkeleton } from '../ui/skeleton';
import { createTrackListItem } from '../ui/trackListItem';
import { attachInfiniteScroll } from '../ui/infiniteScroll';
import { createAlbumListItem } from '../ui/albumListItem';
import { bindQueueActions } from '../ui/queueActions';

export const albumView: WebAmpViewController = {
    id: 'album',
    mount(ctx: WebAmpViewContext) {
        const albumsCard = ctx.rootEl.querySelector<HTMLElement>('[data-wa-albums-card]');
        const albumsList = ctx.rootEl.querySelector<HTMLElement>('[data-wa-albums-list]');
        const albumsStatus = ctx.rootEl.querySelector<HTMLElement>('[data-wa-albums-status]');
        const detailCard = ctx.rootEl.querySelector<HTMLElement>('[data-wa-album-detail]');
        const detailImg = ctx.rootEl.querySelector<HTMLImageElement>('[data-wa-album-img]');
        const detailTitle = ctx.rootEl.querySelector<HTMLElement>('[data-wa-album-title]');
        const detailMeta = ctx.rootEl.querySelector<HTMLElement>('[data-wa-album-meta]');
        const tracksCard = ctx.rootEl.querySelector<HTMLElement>('[data-wa-album-tracks-card]');
        const tracksList = ctx.rootEl.querySelector<HTMLElement>('[data-wa-album-tracks]');
        const tracksStatus = ctx.rootEl.querySelector<HTMLElement>('[data-wa-album-tracks-status]');

        const setAlbumsStatus = (t: string) => { if (albumsStatus) albumsStatus.textContent = t; };
        const setTracksStatus = (t: string) => { if (tracksStatus) tracksStatus.textContent = t; };

        let cleanup: (() => void) | null = null;
        let cleanupActions = bindQueueActions({ root: ctx.rootEl, getTracks: () => [] });

        // Saved albums list (infinite)
        (async () => {
            if (ctx.entityId) {
                if (albumsCard) albumsCard.style.display = 'none';
                return;
            }
            if (albumsCard) albumsCard.style.display = 'block';
            if (!albumsList) return;
            let destroyed = false;
            let offset = 0;
            let loading = false;
            let hasMore = true;

            setAlbumsStatus('Loading…');
            renderListSkeleton(albumsList, 8);

            const loadMoreAlbums = async () => {
                if (destroyed || loading || !hasMore) return;
                loading = true;
                try {
                    const data = await spotifyApi.savedAlbums(50, offset);
                    const items = data?.items ?? [];
                    if (offset === 0) albumsList.replaceChildren();

                    for (const it of items) {
                        const album = it?.album;
                        const id = album?.id;
                        const name = album?.name ?? '(untitled)';
                        const artist = Array.isArray(album?.artists) ? album.artists.map((a: any) => a.name).join(', ') : '';
                        const images = album?.images ?? [];
                        const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
                        if (!id) continue;
                        albumsList.appendChild(createAlbumListItem({
                            album: { id, title: name, artist, artUrlSmall },
                            onClick: () => ctx.router.navigate(`/webamp/albums/${id}`)
                        }));
                    }

                    offset += items.length;
                    hasMore = items.length >= 50;
                    setAlbumsStatus(offset ? '' : 'No saved albums found.');
                } catch (err: any) {
                    setAlbumsStatus(err?.message ?? 'Failed to load saved albums');
                    hasMore = false;
                } finally {
                    loading = false;
                }
            };

            const scroller = attachInfiniteScroll({
                listEl: albumsList,
                loadMore: loadMoreAlbums,
                hasMore: () => hasMore,
                isLoading: () => loading
            });

            cleanup = () => {
                destroyed = true;
                scroller.destroy();
            };

            await loadMoreAlbums();
        })();

        // Album tracks when viewing a specific album
        if (ctx.entityId && tracksCard && tracksList) {
            (async () => {
                try {
                    tracksCard.style.display = 'block';
                    setTracksStatus('Loading tracks…');
                    renderListSkeleton(tracksList, 10);
                    if (detailCard) detailCard.style.display = 'block';
                    if (detailTitle) detailTitle.textContent = 'Loading…';
                    if (detailMeta) detailMeta.textContent = '';
                    if (detailImg) detailImg.removeAttribute('src');

                    const album = await spotifyApi.album(ctx.entityId!);

                    const images = album?.images ?? [];
                    const artUrlFull = images?.[0]?.url ?? images?.[1]?.url;
                    const artUrl = images?.[1]?.url ?? images?.[0]?.url;
                    const artUrlSmall = images?.[images.length - 1]?.url;
                    const albumName = album?.name ?? 'Album';
                    const artistName = Array.isArray(album?.artists) ? album.artists.map((a: any) => a.name).join(', ') : '';
                    if (detailTitle) detailTitle.textContent = albumName;
                    if (detailMeta) detailMeta.textContent = artistName;
                    if (detailImg && (artUrlFull || artUrl)) detailImg.src = artUrlFull ?? artUrl;

                    let destroyed = false;
                    let offset = 0;
                    let loading = false;
                    let hasMore = true;
                    const allTracks: Track[] = [];
                    let queueCommitted = false;
                    let queueActive: Track[] = [];

                    cleanupActions();
                    cleanupActions = bindQueueActions({
                        root: ctx.rootEl,
                        getTracks: () => allTracks,
                        onQueueApplied: (q) => {
                            queueCommitted = true;
                            queueActive = q.slice();
                        }
                    });

                    const loadMoreTracks = async () => {
                        if (destroyed || loading || !hasMore) return;
                        loading = true;
                        try {
                            const data = await spotifyApi.albumTracks(ctx.entityId!, 50, offset);
                            const items = data?.items ?? [];
                            const next: Track[] = items.map((t: any) => {
                                const artist = Array.isArray(t?.artists) ? t.artists.map((a: any) => a.name).join(', ') : '';
                                return {
                                    id: t.id,
                                    title: t.name,
                                    artist,
                                    album: albumName,
                            trackNumber: t?.track_number,
                                    durationSec: Math.round((t.duration_ms ?? 0) / 1000),
                                    artUrl,
                                    artUrlSmall,
                                    uri: t.uri
                                } as Track;
                            });

                            if (offset === 0) tracksList.replaceChildren();
                            allTracks.push(...next);
                            cleanupActions.refresh?.();
                            if (queueCommitted) {
                                queueActive.push(...next);
                                window.dispatchEvent(new CustomEvent('wa:queue:set', { detail: { tracks: queueActive, wrap: false } }));
                            }

                            for (const t of next) {
                                tracksList.appendChild(createTrackListItem({
                                    track: t,
                                    leading: 'index',
                                    showMeta: false,
                                    onClick: () => {
                                        queueCommitted = true;
                                        queueActive = allTracks.slice();
                                        window.dispatchEvent(new CustomEvent('wa:track:select', { detail: { trackId: t.id, tracks: queueActive, wrap: false, from: 'album' } }));
                                    }
                                }));
                            }

                            offset += items.length;
                            hasMore = items.length >= 50;
                            setTracksStatus(allTracks.length ? '' : 'No tracks found.');
                        } catch (err: any) {
                            setTracksStatus(err?.message ?? 'Failed to load album tracks');
                            hasMore = false;
                        } finally {
                            loading = false;
                        }
                    };

                    const scroller = attachInfiniteScroll({
                        listEl: tracksList,
                        loadMore: loadMoreTracks,
                        hasMore: () => hasMore,
                        isLoading: () => loading
                    });

                    // Tear down album-tracks loader.
                    cleanup = () => {
                        destroyed = true;
                        scroller.destroy();
                        cleanupActions();
                    };

                    await loadMoreTracks();

                } catch (err: any) {
                    setTracksStatus(err?.message ?? 'Failed to load album tracks');
                    tracksList.replaceChildren();
                }
            })();
        } else {
            if (tracksCard) tracksCard.style.display = 'none';
            if (detailCard) detailCard.style.display = 'none';
        }

        (albumView as any)._cleanup = () => {
            cleanup?.();
            cleanupActions();
        };
    }
    ,
    unmount() {
        (albumView as any)._cleanup?.();
        (albumView as any)._cleanup = null;
    }
};
