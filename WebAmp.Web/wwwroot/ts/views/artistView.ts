import type { WebAmpViewController, WebAmpViewContext } from '../router/webAmpRouter';
import { spotifyApi } from '../spotify/spotifyApi';
import type { Track } from '../state/playerStore';
import { renderListSkeleton } from '../ui/skeleton';
import { createTrackListItem } from '../ui/trackListItem';
import { attachInfiniteScroll } from '../ui/infiniteScroll';
import { createArtistListItem } from '../ui/artistListItem';
import { createAlbumListItem } from '../ui/albumListItem';
import { bindQueueActions } from '../ui/queueActions';

export const artistView: WebAmpViewController = {
    id: 'artist',
    mount(ctx: WebAmpViewContext) {
        const artistsCard = ctx.rootEl.querySelector<HTMLElement>('[data-wa-artists-card]');
        const artistsList = ctx.rootEl.querySelector<HTMLElement>('[data-wa-artists-list]');
        const artistsStatus = ctx.rootEl.querySelector<HTMLElement>('[data-wa-artists-status]');
        const detailCard = ctx.rootEl.querySelector<HTMLElement>('[data-wa-artist-detail]');
        const detailImg = ctx.rootEl.querySelector<HTMLImageElement>('[data-wa-artist-img]');
        const detailName = ctx.rootEl.querySelector<HTMLElement>('[data-wa-artist-name]');
        const detailMeta = ctx.rootEl.querySelector<HTMLElement>('[data-wa-artist-meta]');
        const topCard = ctx.rootEl.querySelector<HTMLElement>('[data-wa-artist-toptracks-card]');
        const topList = ctx.rootEl.querySelector<HTMLElement>('[data-wa-artist-toptracks]');
        const topStatus = ctx.rootEl.querySelector<HTMLElement>('[data-wa-artist-toptracks-status]');
        const albumsCard = ctx.rootEl.querySelector<HTMLElement>('[data-wa-artist-albums-card]');
        const albumsList = ctx.rootEl.querySelector<HTMLElement>('[data-wa-artist-albums]');
        const albumsStatus = ctx.rootEl.querySelector<HTMLElement>('[data-wa-artist-albums-status]');
        const singlesCard = ctx.rootEl.querySelector<HTMLElement>('[data-wa-artist-singles-card]');
        const singlesList = ctx.rootEl.querySelector<HTMLElement>('[data-wa-artist-singles]');
        const singlesStatus = ctx.rootEl.querySelector<HTMLElement>('[data-wa-artist-singles-status]');

        const setArtistsStatus = (t: string) => { if (artistsStatus) artistsStatus.textContent = t; };
        const setTopStatus = (t: string) => { if (topStatus) topStatus.textContent = t; };
        const setAlbumsStatus = (t: string) => { if (albumsStatus) albumsStatus.textContent = t; };
        const setSinglesStatus = (t: string) => { if (singlesStatus) singlesStatus.textContent = t; };

        let cleanup: (() => void) | null = null;
        let cleanupActions = bindQueueActions({ root: ctx.rootEl, getTracks: () => [] });

        // Followed artists list (cursor-based infinite)
        (async () => {
            if (ctx.entityId) {
                if (artistsCard) artistsCard.style.display = 'none';
                return;
            }
            if (artistsCard) artistsCard.style.display = 'block';
            if (!artistsList) return;
            let destroyed = false;
            let after: string | undefined = undefined;
            let loading = false;
            let hasMore = true;

            setArtistsStatus('Loading…');
            renderListSkeleton(artistsList, 8);

            const loadMoreArtists = async () => {
                if (destroyed || loading || !hasMore) return;
                loading = true;
                try {
                    const data = await spotifyApi.followedArtists(50, after);
                    const artists = data?.artists;
                    const items = artists?.items ?? [];
                    const nextAfter = artists?.cursors?.after;

                    if (!after) artistsList.replaceChildren();

                    for (const a of items) {
                        const id = a?.id;
                        const name = a?.name ?? '(untitled)';
                        const images = a?.images ?? [];
                        const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
                        if (!id) continue;
                        artistsList.appendChild(createArtistListItem({
                            artist: { id, name, artUrlSmall },
                            onClick: () => ctx.router.navigate(`/webamp/artists/${id}`)
                        }));
                    }

                    after = nextAfter;
                    hasMore = Boolean(nextAfter) && items.length > 0;
                    setArtistsStatus(items.length ? '' : 'No followed artists found.');
                } catch (err: any) {
                    setArtistsStatus(err?.message ?? 'Failed to load followed artists');
                    hasMore = false;
                } finally {
                    loading = false;
                }
            };

            const scroller = attachInfiniteScroll({
                listEl: artistsList,
                loadMore: loadMoreArtists,
                hasMore: () => hasMore,
                isLoading: () => loading
            });

            cleanup = () => {
                destroyed = true;
                scroller.destroy();
            };

            await loadMoreArtists();
        })();

        // Top tracks when viewing a specific artist
        if (ctx.entityId && topCard && topList) {
            (async () => {
                try {
                    if (detailCard) detailCard.style.display = 'block';
                    if (detailName) detailName.textContent = 'Loading…';
                    if (detailMeta) detailMeta.textContent = '';
                    if (detailImg) detailImg.removeAttribute('src');
                    try {
                        const a = await spotifyApi.artist(ctx.entityId!);
                        if (detailName) detailName.textContent = a?.name ?? 'Artist';
                        const followers = a?.followers?.total;
                        const genres = Array.isArray(a?.genres) ? a.genres.slice(0, 3).join(' • ') : '';
                        const followersText = typeof followers === 'number' ? `${followers.toLocaleString()} followers` : '';
                        const meta = [followersText, genres].filter(Boolean).join(' • ');
                        if (detailMeta) detailMeta.textContent = meta;
                        const images = a?.images ?? [];
                        const artUrl = images?.[0]?.url ?? images?.[1]?.url ?? images?.[images.length - 1]?.url;
                        if (detailImg && artUrl) detailImg.src = artUrl;
                    } catch {
                        // ignore artist detail errors; lists can still load
                    }

                    topCard.style.display = 'block';
                    setTopStatus('Loading top tracks…');
                    renderListSkeleton(topList, 10);
                    const data = await spotifyApi.artistTopTracks(ctx.entityId!, 'US');
                    const items = data?.tracks ?? [];
                    const tracks: Track[] = items.map((t: any) => {
                        const images = t?.album?.images ?? [];
                        const artUrlSmall = images?.[images.length - 1]?.url;
                        const artUrl = images?.[1]?.url ?? images?.[0]?.url;
                        const artist = Array.isArray(t?.artists) ? t.artists.map((a: any) => a.name).join(', ') : '';
                        const album = t?.album?.name ?? '';
                        return {
                            id: t.id,
                            title: t.name,
                            artist,
                            albumId: t?.album?.id,
                            album,
                            primaryArtistId: ctx.entityId!,
                            durationSec: Math.round((t.duration_ms ?? 0) / 1000),
                            artUrl,
                            artUrlSmall,
                            uri: t.uri
                        } as Track;
                    });

                    topList.replaceChildren();
                    cleanupActions();
                    cleanupActions = bindQueueActions({
                        root: ctx.rootEl,
                        getTracks: () => tracks
                    });
                    cleanupActions.refresh?.();
                    for (let i = 0; i < tracks.length; i++) {
                        const t = tracks[i];
                        topList.appendChild(createTrackListItem({
                            track: t,
                            leading: 'index',
                            index: i + 1,
                            showMeta: false,
                            onClick: () => window.dispatchEvent(new CustomEvent('wa:track:select', { detail: { trackId: t.id, tracks: tracks.slice(), wrap: false, from: 'artist' } }))
                        }));
                    }
                    setTopStatus(tracks.length ? '' : 'No top tracks found.');
                } catch (err: any) {
                    setTopStatus(err?.message ?? 'Failed to load top tracks');
                    topList.replaceChildren();
                }
            })();
        } else {
            if (topCard) topCard.style.display = 'none';
            if (detailCard) detailCard.style.display = 'none';
        }

        // Albums + singles when viewing a specific artist
        if (ctx.entityId && (albumsCard || singlesCard) && albumsList && singlesList) {
            (async () => {
                try {
                    if (albumsCard) albumsCard.style.display = 'block';
                    if (singlesCard) singlesCard.style.display = 'block';
                    setAlbumsStatus('Loading…');
                    setSinglesStatus('Loading…');
                    renderListSkeleton(albumsList, 6);
                    renderListSkeleton(singlesList, 6);

                    const data = await spotifyApi.artistAlbums(ctx.entityId!, 'album,single', 50, 0);
                    const items = data?.items ?? [];

                    // De-dupe (Spotify can return duplicates across markets)
                    const seen = new Set<string>();
                    const deduped = items.filter((it: any) => {
                        const id = it?.id;
                        if (!id || seen.has(id)) return false;
                        seen.add(id);
                        return true;
                    });

                    const albums = deduped.filter((it: any) => (it?.album_group ?? it?.album_type) === 'album');
                    const singles = deduped.filter((it: any) => (it?.album_group ?? it?.album_type) === 'single');

                    albumsList.replaceChildren();
                    singlesList.replaceChildren();

                    for (const a of albums) {
                        const id = a?.id;
                        if (!id) continue;
                        const title = a?.name ?? '(untitled)';
                        const artist = Array.isArray(a?.artists) ? a.artists.map((x: any) => x.name).join(', ') : '';
                        const images = a?.images ?? [];
                        const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
                        albumsList.appendChild(createAlbumListItem({
                            album: { id, title, artist, artUrlSmall },
                            onClick: () => ctx.router.navigate(`/webamp/albums/${id}`)
                        }));
                    }

                    for (const s of singles) {
                        const id = s?.id;
                        if (!id) continue;
                        const title = s?.name ?? '(untitled)';
                        const artist = Array.isArray(s?.artists) ? s.artists.map((x: any) => x.name).join(', ') : '';
                        const images = s?.images ?? [];
                        const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
                        singlesList.appendChild(createAlbumListItem({
                            album: { id, title, artist, artUrlSmall },
                            onClick: () => ctx.router.navigate(`/webamp/albums/${id}`)
                        }));
                    }

                    setAlbumsStatus(albums.length ? '' : 'No albums found.');
                    setSinglesStatus(singles.length ? '' : 'No singles found.');
                } catch (err: any) {
                    setAlbumsStatus(err?.message ?? 'Failed to load albums');
                    setSinglesStatus(err?.message ?? 'Failed to load singles');
                    albumsList.replaceChildren();
                    singlesList.replaceChildren();
                }
            })();
        } else {
            if (albumsCard) albumsCard.style.display = 'none';
            if (singlesCard) singlesCard.style.display = 'none';
        }

        (artistView as any)._cleanup = () => {
            cleanup?.();
            cleanupActions();
        };
    }
    ,
    unmount() {
        (artistView as any)._cleanup?.();
        (artistView as any)._cleanup = null;
    }
};
