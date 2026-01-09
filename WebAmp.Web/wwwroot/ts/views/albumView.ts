import type { WebAmpViewController, WebAmpViewContext } from '../router/webAmpRouter';
import { WEBAMP_ROOT } from '../router/routes';
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
        const headerTitle = document.querySelector<HTMLElement>('[data-wa-topbar-title]');
        const albumsCard = ctx.rootEl.querySelector<HTMLElement>('[data-wa-albums-card]');
        const albumsList = ctx.rootEl.querySelector<HTMLElement>('[data-wa-albums-list]');
        const albumsStatus = ctx.rootEl.querySelector<HTMLElement>('[data-wa-albums-status]');
        const detailCard = ctx.rootEl.querySelector<HTMLElement>('[data-wa-album-detail]');
        const detailImg = ctx.rootEl.querySelector<HTMLImageElement>('[data-wa-album-img]');
        const detailArt = detailImg?.parentElement as HTMLElement | null;
        const detailTitle = ctx.rootEl.querySelector<HTMLElement>('[data-wa-album-title]');
        const detailMeta = ctx.rootEl.querySelector<HTMLElement>('[data-wa-album-meta]');
        const tracksCard = ctx.rootEl.querySelector<HTMLElement>('[data-wa-album-tracks-card]');
        const tracksList = ctx.rootEl.querySelector<HTMLElement>('[data-wa-album-tracks]');
        const tracksStatus = ctx.rootEl.querySelector<HTMLElement>('[data-wa-album-tracks-status]');

        const setAlbumsStatus = (t: string) => { if (albumsStatus) albumsStatus.textContent = t; };
        const setTracksStatus = (t: string) => { if (tracksStatus) tracksStatus.textContent = t; };

        const formatAlbumDuration = (totalSec: number): string => {
            if (!Number.isFinite(totalSec) || totalSec <= 0) return '';
            const totalMinutes = Math.round(totalSec / 60);
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            if (hours <= 0) return `${minutes}m`;
            if (minutes === 0) return `${hours}h`;
            return `${hours}h ${minutes}m`;
        };

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
                    if (detailArt) detailArt.classList.add('wa-entityheader__art--loading');

                    const album = await spotifyApi.album(ctx.entityId!);

                    const images = album?.images ?? [];
                    const artUrlFull = images?.[0]?.url ?? images?.[1]?.url;
                    const artUrl = images?.[1]?.url ?? images?.[0]?.url;
                    const artUrlSmall = images?.[images.length - 1]?.url;
                    const albumName = album?.name ?? ctx.getViewLabel('album');
                    const artistName = Array.isArray(album?.artists) ? album.artists.map((a: any) => a.name).join(', ') : '';

                    const albumTypeRaw = (album?.album_type ?? album?.album_group ?? '').toLowerCase();
                    let albumTypeLabel: string;
                    switch (albumTypeRaw) {
                        case 'single':
                            albumTypeLabel = 'Single';
                            break;
                        case 'compilation':
                            albumTypeLabel = 'Compilation';
                            break;
                        default:
                            albumTypeLabel = 'Album';
                            break;
                    }
                    const totalTracksCount: number | undefined =
                        typeof album?.total_tracks === 'number' ? album.total_tracks : undefined;
                    const releaseDate: string | undefined = album?.release_date;
                    const releaseYear: string | undefined =
                        releaseDate && releaseDate.length >= 4 ? releaseDate.slice(0, 4) : undefined;

                    let totalDurationSec: number | undefined;
                    const updateDetailMeta = () => {
                        if (!detailMeta) return;
                        detailMeta.replaceChildren();

                        const artistLineEl = document.createElement('div');
                        artistLineEl.textContent = artistName;
                        detailMeta.appendChild(artistLineEl);

                        const parts: string[] = [];
                        if (albumTypeLabel) parts.push(albumTypeLabel);
                        if (releaseYear) parts.push(releaseYear);
                        if (typeof totalTracksCount === 'number' && totalTracksCount > 0) {
                            parts.push(`${totalTracksCount} track${totalTracksCount === 1 ? '' : 's'}`);
                        }

                        if (typeof totalDurationSec === 'number' && totalDurationSec > 0) {
                            const lenLabel = formatAlbumDuration(totalDurationSec);
                            if (lenLabel) {
                                const lastIndex = parts.length - 1;
                                if (lastIndex >= 0) {
                                    parts[lastIndex] = `${parts[lastIndex]}, ${lenLabel}`;
                                } else {
                                    parts.push(lenLabel);
                                }
                            }
                        }

                        if (parts.length) {
                            const metaLineEl = document.createElement('div');
                            metaLineEl.textContent = parts.join(' • ');
                            detailMeta.appendChild(metaLineEl);
                        }
                    };

                    if (detailTitle) detailTitle.textContent = albumName;
                    updateDetailMeta();
                    if (detailImg && (artUrlFull || artUrl)) {
                        detailImg.src = artUrlFull ?? artUrl;
                        if (detailArt) detailArt.classList.remove('wa-entityheader__art--loading');
                    } else if (detailArt) {
                        detailArt.classList.remove('wa-entityheader__art--loading');
                    }

                    // Update main view title to album name.
                    if (headerTitle) headerTitle.textContent = albumName;

                    // Prefer an artist-focused breadcrumb chain: Artists > ArtistName > AlbumName.
                    const primaryArtist = Array.isArray(album?.artists) && album.artists.length ? album.artists[0] : undefined;
                    const primaryArtistName: string | undefined = primaryArtist?.name;
                    const primaryArtistId: string | undefined = primaryArtist?.id;
                    const albumPath = `${WEBAMP_ROOT}/albums/${ctx.entityId}`;

                    if (primaryArtistId && primaryArtistName) {
                        const artistsRootLabel = ctx.getViewLabel('artist');
                        const artistsRootPath = `${WEBAMP_ROOT}/artists`;
                        const artistDetailPath = `${WEBAMP_ROOT}/artists/${primaryArtistId}`;
                        ctx.router.setBreadcrumbs([
                            { label: artistsRootLabel, path: artistsRootPath },
                            { label: primaryArtistName, path: artistDetailPath },
                            { label: albumName, path: albumPath }
                        ]);
                    } else {
                        // Fallback: Albums > AlbumName
                        const albumsRootLabel = ctx.getViewLabel('album');
                        const albumsRootPath = `${WEBAMP_ROOT}/albums`;
                        ctx.router.setBreadcrumbs([
                            { label: albumsRootLabel, path: albumsRootPath },
                            { label: albumName, path: albumPath }
                        ]);
                    }

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
                                    albumId: ctx.entityId!,
                                    album: albumName,
                                    primaryArtistId: Array.isArray(t?.artists) && t.artists.length ? t.artists[0]?.id : undefined,
                                    trackNumber: t?.track_number,
                                    durationSec: Math.round((t.duration_ms ?? 0) / 1000),
                                    artUrl,
                                    artUrlSmall,
                                    uri: t.uri
                                } as Track;
                            });

                            const pageDurationSec = next.reduce((sum, tr) => sum + (tr.durationSec ?? 0), 0);
                            totalDurationSec = (totalDurationSec ?? 0) + pageDurationSec;

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
                            if (!hasMore && typeof totalDurationSec === 'number') {
                                updateDetailMeta();
                            }
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
                    if (detailArt) detailArt.classList.remove('wa-entityheader__art--loading');
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
