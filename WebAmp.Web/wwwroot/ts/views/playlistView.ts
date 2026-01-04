import type { WebAmpViewController, WebAmpViewContext } from '../router/webAmpRouter';
import { spotifyApi } from '../spotify/spotifyApi';
import type { Track } from '../state/playerStore';
import { renderListSkeleton } from '../ui/skeleton';
import { createTrackListItem } from '../ui/trackListItem';
import { createPlaylistListItem } from '../ui/playlistListItem';
import { attachInfiniteScroll } from '../ui/infiniteScroll';
import { bindQueueActions } from '../ui/queueActions';

export const playlistView: WebAmpViewController = {
    id: 'playlist',
    mount(ctx: WebAmpViewContext) {
        const detailCard = ctx.rootEl.querySelector<HTMLElement>('[data-wa-playlist-detail]');
        const detailImg = ctx.rootEl.querySelector<HTMLImageElement>('[data-wa-playlist-img]');
        const detailTitle = ctx.rootEl.querySelector<HTMLElement>('[data-wa-playlist-title]');
        const detailMeta = ctx.rootEl.querySelector<HTMLElement>('[data-wa-playlist-meta]');

        const playlistsCard = ctx.rootEl.querySelector<HTMLElement>('[data-wa-playlists-card]');
        const playlistsList = ctx.rootEl.querySelector<HTMLElement>('[data-wa-playlists-list]');
        const playlistsStatus = ctx.rootEl.querySelector<HTMLElement>('[data-wa-playlists-status]');
        const tracksCard = ctx.rootEl.querySelector<HTMLElement>('[data-wa-playlist-tracks-card]');
        const tracksList = ctx.rootEl.querySelector<HTMLElement>('[data-wa-playlist-tracks]');
        const tracksStatus = ctx.rootEl.querySelector<HTMLElement>('[data-wa-playlist-tracks-status]');

        const setPlaylistsStatus = (t: string) => { if (playlistsStatus) playlistsStatus.textContent = t; };
        const setTracksStatus = (t: string) => { if (tracksStatus) tracksStatus.textContent = t; };

        const appendPlaylistTracks = (tracks: Track[], allTracks: Track[], onInteract: () => void) => {
            if (!tracksList || !tracksCard) return;
            tracksCard.style.display = 'block';
            for (const t of tracks) {
                tracksList.appendChild(createTrackListItem({
                    track: t,
                    onClick: () => {
                        onInteract();
                        window.dispatchEvent(new CustomEvent('wa:track:select', { detail: { trackId: t.id, tracks: allTracks.slice(), wrap: false, from: 'playlist' } }));
                    }
                }));
            }
        };

        let cleanup: (() => void) | null = null;
        let cleanupActions = bindQueueActions({
            root: ctx.rootEl,
            getTracks: () => [], // overwritten in detail view when tracks exist
        });

        // All playlists list (only on /playlists)
        const loadAllPlaylists = async () => {
            if (!playlistsList || !playlistsCard) return;
            let destroyed = false;
            let offset = 0;
            let loading = false;
            let hasMore = true;

            playlistsCard.style.display = 'block';
            setPlaylistsStatus('Loading…');
            renderListSkeleton(playlistsList, 8);

            const loadMore = async () => {
                if (destroyed || loading || !hasMore) return;
                loading = true;
                try {
                    const data = await spotifyApi.myPlaylists(50, offset);
                    const items = data?.items ?? [];

                    if (offset === 0) playlistsList.replaceChildren();

                    for (const p of items) {
                        const id = p?.id;
                        const name = p?.name ?? '(untitled)';
                        const owner = p?.owner?.display_name ?? p?.owner?.id ?? '—';
                        const images = p?.images ?? [];
                        const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
                        if (!id) continue;
                        playlistsList.appendChild(createPlaylistListItem({
                            playlist: { id, title: name, owner, artUrlSmall },
                            onClick: () => ctx.router.navigate(`/webamp/playlists/${id}`)
                        }));
                    }

                    offset += items.length;
                    hasMore = items.length >= 50;
                    setPlaylistsStatus(offset ? '' : 'No playlists found.');
                } catch (err: any) {
                    setPlaylistsStatus(err?.message ?? 'Failed to load playlists');
                    hasMore = false;
                } finally {
                    loading = false;
                }
            };

            const scroller = attachInfiniteScroll({
                listEl: playlistsList,
                loadMore,
                hasMore: () => hasMore,
                isLoading: () => loading
            });

            cleanup = () => {
                destroyed = true;
                scroller.destroy();
            };

            await loadMore();
        };

        // If an ID is present, load tracks and make them playable.
        if (ctx.entityId && tracksList && tracksCard) {
            (async () => {
                try {
                    // Hide the "all playlists" list when viewing a specific playlist.
                    if (playlistsCard) playlistsCard.style.display = 'none';

                    if (detailCard) detailCard.style.display = 'block';
                    if (detailTitle) detailTitle.textContent = 'Loading…';
                    if (detailMeta) detailMeta.textContent = '';
                    if (detailImg) detailImg.removeAttribute('src');

                    // Playlist details (for art/title)
                    try {
                        const p = await spotifyApi.playlist(ctx.entityId!);
                        if (detailTitle) detailTitle.textContent = p?.name ?? 'Playlist';
                        const owner = p?.owner?.display_name ?? p?.owner?.id ?? '';
                        const total = p?.tracks?.total;
                        if (detailMeta) detailMeta.textContent = `${owner}${typeof total === 'number' ? ` • ${total} tracks` : ''}`;
                        const images = p?.images ?? [];
                        const artFull = images?.[0]?.url ?? images?.[1]?.url ?? images?.[images.length - 1]?.url;
                        if (detailImg && artFull) detailImg.src = artFull;
                    } catch {
                        // ignore detail errors; tracks will still show
                    }

                    tracksCard.style.display = 'block';
                    setTracksStatus('Loading tracks…');
                    renderListSkeleton(tracksList, 10);
                    let destroyed = false;
                    let offset = 0;
                    let loading = false;
                    let hasMore = true;
                    const allTracks: Track[] = [];
                    let queueCommitted = false;
                    let queueActive: Track[] = [];

                    // Rebind queue actions for this playlist detail track list.
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
                            const data = await spotifyApi.playlistTracks(ctx.entityId!, 100, offset);
                            const items = data?.items ?? [];
                            const next: Track[] = items
                                .map((it: any) => it?.track)
                                .filter(Boolean)
                                .map((t: any) => {
                                    const images = t?.album?.images ?? [];
                                    const artUrlSmall = images?.[images.length - 1]?.url;
                                    const artUrl = images?.[1]?.url ?? images?.[0]?.url;
                                    const artist = Array.isArray(t?.artists) ? t.artists.map((a: any) => a.name).join(', ') : '';
                                    const album = t?.album?.name ?? '';
                                    return {
                                        id: t.id,
                                        title: t.name,
                                        artist,
                                        album,
                                        durationSec: Math.round((t.duration_ms ?? 0) / 1000),
                                        artUrl,
                                        artUrlSmall,
                                        uri: t.uri
                                    } as Track;
                                });

                            if (offset === 0) tracksList.replaceChildren();
                            allTracks.push(...next);
                            cleanupActions.refresh?.();
                            // Only extend the global queue after explicit user interaction (play/click).
                            if (queueCommitted) {
                                queueActive.push(...next);
                                window.dispatchEvent(new CustomEvent('wa:queue:set', { detail: { tracks: queueActive, wrap: false } }));
                            }
                            appendPlaylistTracks(next, allTracks, () => {
                                queueCommitted = true;
                                queueActive = allTracks.slice();
                            });

                            offset += items.length;
                            hasMore = items.length >= 100;
                            setTracksStatus(allTracks.length ? '' : 'No tracks found.');
                        } catch (err: any) {
                            setTracksStatus(err?.message ?? 'Failed to load playlist tracks');
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

                    cleanup = () => {
                        destroyed = true;
                        scroller.destroy();
                        cleanupActions();
                    };

                    await loadMoreTracks();
                } catch (err: any) {
                    setTracksStatus(err?.message ?? 'Failed to load playlist tracks');
                    tracksList.replaceChildren();
                }
            })();
        } else {
            if (tracksCard) tracksCard.style.display = 'none';
            if (detailCard) detailCard.style.display = 'none';
            void loadAllPlaylists();
        }

        (playlistView as any)._cleanup = () => {
            cleanup?.();
            cleanupActions();
        };
    }
    ,
    unmount() {
        (playlistView as any)._cleanup?.();
        (playlistView as any)._cleanup = null;
    }
};
