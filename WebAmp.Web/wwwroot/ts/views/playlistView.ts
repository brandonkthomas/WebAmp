import type { WebAmpViewController, WebAmpViewContext } from '../router/webAmpRouter';
import { WEBAMP_ROOT } from '../router/routes';
import { spotifyApi } from '../sources/spotify/spotifyApi';
import { soundcloudUserApi } from '../sources/soundcloudUserApi';
import type { Track } from '../state/playerStore';
import { renderListSkeleton } from '../ui/skeleton';
import { createTrackListItem } from '../ui/trackListItem';
import { createPlaylistListItem } from '../ui/playlistListItem';
import { attachInfiniteScroll } from '../ui/infiniteScroll';
import { bindQueueActions } from '../ui/queueActions';

export const playlistView: WebAmpViewController = {
    id: 'playlist',
    mount(ctx: WebAmpViewContext) {
        const headerTitle = document.querySelector<HTMLElement>('[data-wa-topbar-title]');
        const detailCard = ctx.rootEl.querySelector<HTMLElement>('[data-wa-playlist-detail]');
        const detailImg = ctx.rootEl.querySelector<HTMLImageElement>('[data-wa-playlist-img]');
        const detailTitle = ctx.rootEl.querySelector<HTMLElement>('[data-wa-playlist-title]');
        const detailMeta = ctx.rootEl.querySelector<HTMLElement>('[data-wa-playlist-meta]');
        const detailArt = detailImg?.parentElement as HTMLElement | null;

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

        const spotifySource = ctx.services.musicSource;
        const soundCloudSource = ctx.services.soundCloudSource;
        const isSpotifyConnected = spotifySource?.getState().isConnected ?? false;
        const isSoundCloudConnected = soundCloudSource?.getState().isConnected ?? false;

        // All playlists list (only on /playlists)
        const loadAllPlaylists = async () => {
            if (!playlistsList || !playlistsCard) return;
            let destroyed = false;
            let offset = 0;
            let loading = false;
            let hasMore = true;

            playlistsCard.style.display = 'block';

            if (!isSpotifyConnected && !isSoundCloudConnected) {
                playlistsList.replaceChildren();
                setPlaylistsStatus('Connect to a music source to see your playlists.');
                return;
            }

            // Use skeletons instead of visible "Loading…" text.
            setPlaylistsStatus('');
            renderListSkeleton(playlistsList, 8);

            const loadMoreSpotify = async () => {
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

            const loadMoreSoundCloud = async () => {
                if (destroyed || loading || !hasMore) return;
                loading = true;
                try {
                    const data = await soundcloudUserApi.myPlaylists(50);
                    const items = (data?.collection ?? data?.items ?? []) as any[];

                    if (offset === 0) playlistsList.replaceChildren();

                    for (const p of items) {
                        const id = p?.id;
                        if (!id) continue;
                        const title = p?.title ?? '(untitled)';
                        const owner =
                            (typeof p?.user?.username === 'string' && p.user.username) ||
                            (typeof p?.user?.name === 'string' && p.user.name) ||
                            '—';
                        const artUrlSmall: string | undefined =
                            typeof p?.artwork_url === 'string'
                                ? p.artwork_url
                                : (Array.isArray(p?.tracks) && p.tracks.length && typeof p.tracks[0]?.artwork_url === 'string'
                                    ? p.tracks[0].artwork_url
                                    : undefined);
                        playlistsList.appendChild(createPlaylistListItem({
                            playlist: { id: String(id), title, owner, artUrlSmall },
                            onClick: () => ctx.router.navigate(`/webamp/playlists/${id}`)
                        }));
                    }

                    hasMore = false;
                    setPlaylistsStatus(items.length ? '' : 'No playlists found.');
                } catch (err: any) {
                    setPlaylistsStatus(err?.message ?? 'Failed to load playlists');
                    hasMore = false;
                } finally {
                    loading = false;
                }
            };

            const loadMore = isSpotifyConnected ? loadMoreSpotify : loadMoreSoundCloud;

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
                    if (detailArt) detailArt.classList.add('wa-entityheader__art--loading');

                    tracksCard.style.display = 'block';
                    // Skeletons only; no visible "Loading…" text.
                    setTracksStatus('');
                    renderListSkeleton(tracksList, 10);

                    // Playlist details (for art/title + header + breadcrumbs)
                    let playlistName = ctx.getViewLabel('playlist');
                    if (isSpotifyConnected) {
                        try {
                            const p = await spotifyApi.playlist(ctx.entityId!);
                            playlistName = p?.name ?? playlistName;
                            if (detailTitle) detailTitle.textContent = playlistName;
                            const owner = p?.owner?.display_name ?? p?.owner?.id ?? '';
                            const total = p?.tracks?.total;
                            if (detailMeta) detailMeta.textContent = `${owner}${typeof total === 'number' ? ` • ${total} tracks` : ''}`;
                            const images = p?.images ?? [];
                            const artFull = images?.[0]?.url ?? images?.[1]?.url ?? images?.[images.length - 1]?.url;
                            if (detailImg && artFull) {
                                detailImg.src = artFull;
                                if (detailArt) detailArt.classList.remove('wa-entityheader__art--loading');
                            } else if (detailArt) {
                                detailArt.classList.remove('wa-entityheader__art--loading');
                            }

                            // Update main view title + breadcrumbs now that we know the playlist name.
                            if (headerTitle) headerTitle.textContent = playlistName;
                            const rootLabel = ctx.getViewLabel('playlist');
                            const rootPath = `${WEBAMP_ROOT}/playlists`;
                            const detailPath = `${WEBAMP_ROOT}/playlists/${ctx.entityId}`;
                            ctx.router.setBreadcrumbs([
                                { label: rootLabel, path: rootPath },
                                { label: playlistName, path: detailPath }
                            ]);
                        } catch {
                            if (detailArt) detailArt.classList.remove('wa-entityheader__art--loading');
                        }
                    } else if (isSoundCloudConnected) {
                        try {
                            const p = await soundcloudUserApi.playlist(ctx.entityId!);
                            playlistName = p?.title ?? playlistName;
                            if (detailTitle) detailTitle.textContent = playlistName;
                            const owner =
                                (typeof p?.user?.username === 'string' && p.user.username) ||
                                (typeof p?.user?.name === 'string' && p.user.name) ||
                                '';
                            const trackCount: number | undefined =
                                typeof p?.track_count === 'number' ? p.track_count : undefined;
                            if (detailMeta) {
                                detailMeta.textContent = `${owner}${typeof trackCount === 'number' ? ` • ${trackCount} tracks` : ''}`;
                            }
                            const artFull: string | undefined =
                                typeof p?.artwork_url === 'string'
                                    ? p.artwork_url
                                    : (Array.isArray(p?.tracks) && p.tracks.length && typeof p.tracks[0]?.artwork_url === 'string'
                                        ? p.tracks[0].artwork_url
                                        : undefined);
                            if (detailImg && artFull) {
                                detailImg.src = artFull;
                                if (detailArt) detailArt.classList.remove('wa-entityheader__art--loading');
                            } else if (detailArt) {
                                detailArt.classList.remove('wa-entityheader__art--loading');
                            }

                            if (headerTitle) headerTitle.textContent = playlistName;
                            const rootLabel = ctx.getViewLabel('playlist');
                            const rootPath = `${WEBAMP_ROOT}/playlists`;
                            const detailPath = `${WEBAMP_ROOT}/playlists/${ctx.entityId}`;
                            ctx.router.setBreadcrumbs([
                                { label: rootLabel, path: rootPath },
                                { label: playlistName, path: detailPath }
                            ]);
                        } catch {
                            if (detailArt) detailArt.classList.remove('wa-entityheader__art--loading');
                        }
                    }
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

                    const loadMoreSpotifyTracks = async () => {
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
                                        source: 'spotify',
                                        title: t.name,
                                        artist,
                                        albumId: t?.album?.id,
                                        album,
                                        primaryArtistId: Array.isArray(t?.artists) && t.artists.length ? t.artists[0]?.id : undefined,
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

                    const loadMoreSoundCloudTracks = async () => {
                        if (destroyed || loading || !hasMore) return;
                        loading = true;
                        try {
                            const data = await soundcloudUserApi.playlistTracks(ctx.entityId!, 100);
                            const items = (data?.collection ?? []) as any[];
                            const next: Track[] = items
                                .filter((t: any) => !!t && typeof t.id !== 'undefined')
                                .map((t: any) => {
                                    const id = t?.id;
                                    const title = typeof t?.title === 'string' ? t.title : '(untitled)';
                                    const artist =
                                        typeof t?.user?.username === 'string'
                                            ? t.user.username
                                            : (typeof t?.user?.name === 'string' ? t.user.name : '');
                                    const durationMs: number = typeof t?.duration === 'number' ? t.duration : 0;
                                    const artUrl: string | undefined =
                                        typeof t?.artwork_url === 'string'
                                            ? t.artwork_url
                                            : (typeof t?.user?.avatar_url === 'string' ? t.user.avatar_url : undefined);
                                    return {
                                        id: String(id),
                                        source: 'soundcloud',
                                        title,
                                        artist,
                                        durationSec: Math.round(durationMs / 1000),
                                        artUrl,
                                        artUrlSmall: artUrl
                                    } as Track;
                                });

                            if (offset === 0) tracksList.replaceChildren();
                            allTracks.push(...next);
                            cleanupActions.refresh?.();
                            if (queueCommitted) {
                                queueActive.push(...next);
                                window.dispatchEvent(new CustomEvent('wa:queue:set', { detail: { tracks: queueActive, wrap: false } }));
                            }
                            appendPlaylistTracks(next, allTracks, () => {
                                queueCommitted = true;
                                queueActive = allTracks.slice();
                            });

                            hasMore = false;
                            setTracksStatus(allTracks.length ? '' : 'No tracks found.');
                        } catch (err: any) {
                            setTracksStatus(err?.message ?? 'Failed to load playlist tracks');
                            hasMore = false;
                        } finally {
                            loading = false;
                        }
                    };

                    const loadMoreTracks = isSpotifyConnected ? loadMoreSpotifyTracks : loadMoreSoundCloudTracks;

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
