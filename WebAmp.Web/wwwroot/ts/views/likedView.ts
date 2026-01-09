import type { WebAmpViewController, WebAmpViewContext } from '../router/webAmpRouter';
import { spotifyApi } from '../sources/spotify/spotifyApi';
import type { Track } from '../state/playerStore';
import { createTrackListItem } from '../ui/trackListItem';
import { attachInfiniteScroll } from '../ui/infiniteScroll';
import { bindQueueActions } from '../ui/queueActions';

function mapSpotifyTrack(t: any): Track {
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
        primaryArtistId: Array.isArray(t?.artists) && t.artists.length ? t.artists[0]?.id : undefined,
        durationSec: Math.round((t.duration_ms ?? 0) / 1000),
        artUrl,
        artUrlSmall,
        uri: t.uri
    };
}

export const likedView: WebAmpViewController = {
    id: 'liked',
    mount(_ctx: WebAmpViewContext) {
        const root = _ctx.rootEl;
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
            for (const t of tracks) {
                likedEl.appendChild(createTrackListItem({
                    track: t,
                    onClick: () => {
                        queueCommitted = true;
                        queueActive = allTracks.slice();
                        window.dispatchEvent(new CustomEvent('wa:track:select', { detail: { trackId: t.id, tracks: queueActive, wrap: false, from: 'liked' } }));
                    }
                }));
            }
        };

        const loadMore = async () => {
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
                offset += items.length;
                hasMore = items.length > 0 && next.length > 0 && items.length >= 50;
                allTracks.push(...next);
                cleanupActions.refresh?.();

                // Only extend the global queue after explicit user interaction (play/click).
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
            setStatus('Loading…');
            likedEl.replaceChildren();
            await loadMore();
            // Attach infinite loader after first page renders, so we don't fight with skeleton clearing.
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


