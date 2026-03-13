import type { WebAmpViewController, WebAmpViewContext } from '../router/webAmpRouter';
import { routePath } from '../internal/paths';
import { createSoundCloudTrack, createSpotifyTrack } from '../library/trackLibrary';
import { spotifyApi } from '../sources/spotify/spotifyApi';
import { soundcloudUserApi } from '../sources/soundcloudUserApi';
import type { Track } from '../state/playerStore';
import { renderListSkeleton } from '../ui/skeleton';
import { createTrackListItem } from '../ui/trackListItem';
import { createPlaylistListItem } from '../ui/playlistListItem';
import { bindQueueActions } from '../ui/queueActions';
export const homeView: WebAmpViewController = {
    id: 'home',
    mount(ctx: WebAmpViewContext) {
        const root = ctx.rootEl;
        const playlistsEl = root.querySelector<HTMLElement>('[data-wa-playlists]');
        const playlistsStatusEl = root.querySelector<HTMLElement>('[data-wa-playlists-status]');
        const likedEl = root.querySelector<HTMLElement>('[data-wa-liked]');
        const likedStatusEl = root.querySelector<HTMLElement>('[data-wa-liked-status]');
        const recentEl = root.querySelector<HTMLElement>('[data-wa-home-recent]');
        const recentCard = root.querySelector<HTMLElement>('[data-wa-home-recent-card]');

        const setPlaylistsStatus = (t: string) => { if (playlistsStatusEl) playlistsStatusEl.textContent = t; };
        const setLikedStatus = (t: string) => { if (likedStatusEl) likedStatusEl.textContent = t; };

        // Allow empty cleanup so that Shuffle/Play buttons trigger bindQueueActions > syncVisible (to hide the actions)
        const cleanupActions = bindQueueActions({
            root,
            getTracks: () => []   // always empty > syncVisible hides the actions
        });

        (homeView as any)._cleanup = () => {
            cleanupActions();
        };

        const spotifySource = ctx.services.musicSource;
        const soundCloudSource = ctx.services.soundCloudSource;
        const isSpotifyConnected = spotifySource?.getState().isConnected ?? false;
        const isSoundCloudConnected = soundCloudSource?.getState().isConnected ?? false;

        const loadPlaylistsCard = async () => {
            if (!playlistsEl) return;

            if (!isSpotifyConnected && !isSoundCloudConnected) {
                playlistsEl.replaceChildren();
                setPlaylistsStatus('Connect to a music source to see your playlists.');
                return;
            }

            if (isSpotifyConnected) {
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
                            onClick: () => ctx.router.navigate(routePath(`playlists/${id}`))
                        }));
                    }
                    setPlaylistsStatus(items.length ? '' : 'No playlists found.');
                } catch (err: any) {
                    setPlaylistsStatus(err?.message ?? 'Failed to load playlists');
                    playlistsEl.replaceChildren();
                }
                return;
            }

            if (isSoundCloudConnected) {
                try {
                    setPlaylistsStatus('Loading…');
                    renderListSkeleton(playlistsEl, 6);
                    const data = await soundcloudUserApi.myPlaylists(20);
                    const items = (data?.collection ?? data?.items ?? []) as any[];
                    playlistsEl.replaceChildren();
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
                        playlistsEl.appendChild(createPlaylistListItem({
                            playlist: { id: String(id), title, owner, artUrlSmall },
                            onClick: () => ctx.router.navigate(routePath(`playlists/${id}`))
                        }));
                    }
                    setPlaylistsStatus(items.length ? '' : 'No playlists found.');
                } catch (err: any) {
                    setPlaylistsStatus(err?.message ?? 'Failed to load playlists');
                    playlistsEl.replaceChildren();
                }
            }
        };

        const loadLikedCard = async () => {
            if (!likedEl) return;

            if (!isSpotifyConnected && !isSoundCloudConnected) {
                likedEl.replaceChildren();
                setLikedStatus('Connect to a music source to see your liked songs.');
                return;
            }

            if (isSpotifyConnected) {
                try {
                    setLikedStatus('Loading…');
                    renderListSkeleton(likedEl, 6);
                    const data = await spotifyApi.savedTracks(20, 0);
                    const items = data?.items ?? [];
                    const tracks: Track[] = items
                        .map((it: any) => it?.track)
                        .filter(Boolean)
                        .map((t: any) => createSpotifyTrack(t, { inLibrary: true }));

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
                    likedEl.replaceChildren();
                }
                return;
            }

            if (isSoundCloudConnected) {
                try {
                    setLikedStatus(''); // skeletons only
                    renderListSkeleton(likedEl, 6);
                    const data = await soundcloudUserApi.likedTracks(20);
                    const collection = (data?.collection ?? []) as any[];
                    const tracks: Track[] = collection
                        .map((it: any) => it?.track ?? it)
                        .filter(Boolean)
                        .map((t: any) => createSoundCloudTrack(t, { inLibrary: true }))
                        .filter(Boolean) as Track[];

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
                    likedEl.replaceChildren();
                }
            }
        };

        const loadRecentCard = async () => {
            if (!recentCard || !recentEl) return;

            // Recent card:
            // - For SoundCloud: show the top ~10 activities from /me/activities/all/own.
            // - For Spotify: hide the card for now (TODO: wire recently played).
            if (isSoundCloudConnected) {
                try {
                    recentCard.style.display = '';
                    recentEl.replaceChildren();
                    renderListSkeleton(recentEl, 5);
                    const data = await soundcloudUserApi.recentActivities(10);
                    const collection = (data?.collection ?? []) as any[];
                    recentEl.replaceChildren();

                    for (const item of collection) {
                        const origin = item?.origin ?? item?.playlist ?? item?.track ?? null;
                        if (!origin) continue;
                        const kind = origin.kind as string | undefined;

                        if (kind === 'track') {
                            const id = origin.id;
                            if (!id) continue;
                            const title = typeof origin.title === 'string' ? origin.title : '(untitled)';
                            const artist =
                                typeof origin?.user?.username === 'string'
                                    ? origin.user.username
                                    : (typeof origin?.user?.name === 'string' ? origin.user.name : '');

                            const track: Track = createSoundCloudTrack(origin);

                            const row = createTrackListItem({
                                track,
                                onClick: () => {
                                    window.dispatchEvent(new CustomEvent('wa:track:select', {
                                        detail: {
                                            trackId: track.id,
                                            tracks: [track],
                                            wrap: false,
                                            from: 'home-recent'
                                        }
                                    }));
                                }
                            });

                            const pill = document.createElement('span');
                            pill.className = 'wa-listitem__pill';
                            pill.textContent = 'Track';
                            row.appendChild(pill);

                            recentEl.appendChild(row);
                        }
                    }

                    // If nothing meaningful came back, leave the card empty.
                    if (!recentEl.children.length) {
                        recentCard.style.display = 'none';
                    }
                } catch {
                    // On any error, hide the card rather than show stale demo content.
                    recentCard.style.display = 'none';
                    recentEl.replaceChildren();
                }
            } else if (isSpotifyConnected) {
                // TODO: Implement Spotify "recently played" for this card.
                recentCard.style.display = 'none';
                recentEl.replaceChildren();
            } else {
                recentCard.style.display = 'none';
                recentEl.replaceChildren();
            }
        };

        // Fire all three cards concurrently so that one slow request does not block others.
        void loadPlaylistsCard();
        void loadLikedCard();
        void loadRecentCard();
    },
    unmount() {
        (homeView as any)._cleanup?.();
        (homeView as any)._cleanup = null;
    }
};
