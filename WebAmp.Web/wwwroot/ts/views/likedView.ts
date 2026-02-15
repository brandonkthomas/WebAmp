import type { WebAmpViewController, WebAmpViewContext } from '../router/webAmpRouter';
import { spotifyApi } from '../sources/spotify/spotifyApi';
import { soundcloudUserApi } from '../sources/soundcloudUserApi';
import type { Track } from '../state/playerStore';
import { createTrackListItem } from '../ui/trackListItem';
import { attachInfiniteScroll } from '../ui/infiniteScroll';
import { bindQueueActions } from '../ui/queueActions';
import { renderListSkeleton } from '../ui/skeleton';
import { appendFragment } from '../utils';

function mapSpotifyTrack(t: any): Track {
    const images = t?.album?.images ?? [];
    const artUrlSmall = images?.[images.length - 1]?.url;
    const artUrl = images?.[1]?.url ?? images?.[0]?.url;
    const artUrlLarge = images?.[0]?.url ?? images?.[1]?.url ?? artUrl;
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
        artUrlLarge,
        uri: t.uri
    };
}

export const likedView: WebAmpViewController = {
    id: 'liked',
    mount(ctx: WebAmpViewContext) {
        const root = ctx.rootEl;
        const likedEl = root.querySelector<HTMLElement>('[data-wa-liked]');
        const likedStatusEl = root.querySelector<HTMLElement>('[data-wa-liked-status]');
        if (!likedEl) return;

        const setStatus = (t: string) => { if (likedStatusEl) likedStatusEl.textContent = t; };

        let destroyed = false;
        let offset = 0;
        let loading = false;
        let hasMore = true;
        const allTracks: Track[] = [];
        let queueCommitted = false;
        let queueActive: Track[] = [];
        let scroller: { destroy(): void } | null = null;
        const cleanupActions = bindQueueActions({
            root,
            getTracks: () => allTracks,
            onQueueApplied: (q) => {
                queueCommitted = true;
                queueActive = q.slice();
            }
        });

        const appendTracks = (tracks: Track[]) => {
            appendFragment(likedEl, (frag) => {
                for (const t of tracks) {
                    frag.appendChild(createTrackListItem({
                        track: t,
                        onClick: () => {
                            queueCommitted = true;
                            queueActive = allTracks.slice();
                            window.dispatchEvent(new CustomEvent('wa:track:select', { detail: { trackId: t.id, tracks: queueActive, wrap: false, from: 'liked' } }));
                        }
                    }));
                }
            });
        };

        const spotifySource = ctx.services.musicSource;
        const soundCloudSource = ctx.services.soundCloudSource;
        const isSpotifyConnected = spotifySource?.getState().isConnected ?? false;
        const isSoundCloudConnected = soundCloudSource?.getState().isConnected ?? false;
        let scCursor: string | null = null;

        const loadMoreSpotify = async () => {
            if (destroyed || loading || !hasMore) return;
            loading = true;
            try {
                const data = await spotifyApi.savedTracks(50, offset);
                const items = data?.items ?? [];
                const next: Track[] = items
                    .map((it: any) => it?.track)
                    .filter(Boolean)
                    .map(mapSpotifyTrack);

                if (destroyed) return;
                if (offset === 0) {
                    likedEl.replaceChildren();
                }
                offset += items.length;
                hasMore = items.length > 0 && next.length > 0 && items.length >= 50;
                allTracks.push(...next);
                cleanupActions.refresh?.();

                if (queueCommitted) {
                    queueActive.push(...next);
                    window.dispatchEvent(new CustomEvent('wa:queue:set', { detail: { tracks: queueActive, wrap: false } }));
                }

                appendTracks(next);
                setStatus(allTracks.length ? '' : 'No liked songs found.');
            } catch (err: any) {
                setStatus(err?.message ?? 'Failed to load liked songs');
                hasMore = false;
            } finally {
                loading = false;
            }
        };

        const loadMoreSoundCloud = async () => {
            if (destroyed || loading || !hasMore) return;
            loading = true;
            try {
                const data = await soundcloudUserApi.likedTracks(50, scCursor ?? undefined);
                const collection = (data?.collection ?? []) as any[];
                const next: Track[] = collection
                    .map((it: any) => it?.track ?? it)
                    .filter(Boolean)
                    .map((t: any) => {
                        const id = t?.id;
                        if (!id) return null;
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
                        const permalinkUrl: string | undefined =
                            typeof t?.permalink_url === 'string' ? t.permalink_url : undefined;
                        return {
                            id: String(id),
                            source: 'soundcloud',
                            title,
                            artist,
                            durationSec: Math.round(durationMs / 1000),
                            artUrl,
                            artUrlSmall: artUrl,
                            permalinkUrl
                        } as Track;
                    })
                    .filter(Boolean) as Track[];

                if (destroyed) return;
                if (allTracks.length === 0) {
                    likedEl.replaceChildren();
                }

                // linked_partitioning: use next_href cursor when present
                let nextCursor: string | null = null;
                const nextHref = typeof (data as any)?.next_href === 'string' ? (data as any).next_href : null;
                if (nextHref) {
                    try {
                        const url = new URL(nextHref);
                        const c = url.searchParams.get('cursor');
                        if (c) nextCursor = c;
                    } catch {
                        // ignore parse errors; treat as single page
                    }
                }

                scCursor = nextCursor;
                hasMore = !!nextCursor && next.length > 0;

                allTracks.push(...next);
                cleanupActions.refresh?.();

                if (queueCommitted) {
                    queueActive.push(...next);
                    window.dispatchEvent(new CustomEvent('wa:queue:set', { detail: { tracks: queueActive, wrap: false } }));
                }

                appendTracks(next);
                setStatus(allTracks.length ? '' : 'No liked songs found.');
            } catch (err: any) {
                setStatus(err?.message ?? 'Failed to load liked songs');
                hasMore = false;
            } finally {
                loading = false;
            }
        };

        const init = async () => {
            const loadMore = isSpotifyConnected ? loadMoreSpotify : loadMoreSoundCloud;
            if (!isSpotifyConnected && !isSoundCloudConnected) {
                likedEl.replaceChildren();
                setStatus('Connect to a music source to see your liked songs.');
                return;
            }

            likedEl.replaceChildren();
            setStatus('');
            renderListSkeleton(likedEl, 10);
            await loadMore();

            scroller = attachInfiniteScroll({
                listEl: likedEl,
                loadMore,
                hasMore: () => hasMore,
                isLoading: () => loading
            });
        };
        void init();

        (likedView as any)._cleanup = () => {
            destroyed = true;
            scroller?.destroy();
            scroller = null;
            cleanupActions();
        };
    }
    ,
    unmount() {
        (likedView as any)._cleanup?.();
        (likedView as any)._cleanup = null;
    }
};


