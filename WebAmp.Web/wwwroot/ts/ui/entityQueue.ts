import { logEvent } from '../internal/logging';
import { showAlert } from '../internal/indiumApi';
import { createSoundCloudTrack, createSpotifyTrack } from '../library/trackLibrary';
import { soundcloudUserApi } from '../sources/soundcloudUserApi';
import { spotifyApi } from '../sources/spotify/spotifyApi';
import type { Track } from '../state/playerStore';
import { formatErrorMessage, showErrorDialog } from './errorDialog';

export type QueueableEntitySource = 'spotify' | 'soundcloud';

function playableTracks(tracks: Track[]): Track[] {
    return tracks.filter((t) => t?.isPlayable !== false);
}

export function addTracksToQueue(tracks: Track[], label: string = 'Queue'): void {
    const filtered = playableTracks(tracks);
    if (!filtered.length) {
        void showAlert({
            title: label,
            message: 'No playable tracks were found.',
            variant: 'danger'
        });
        return;
    }

    window.dispatchEvent(new CustomEvent('wa:queue:add-next', {
        detail: { tracks: filtered }
    }));
}

export async function addSpotifyAlbumToQueue(albumId: string): Promise<void> {
    await addResolvedEntityToQueue('spotify-album', albumId, async () => {
        const album = await spotifyApi.album(albumId);
        const images = album?.images ?? [];
        const artUrl = images?.[1]?.url ?? images?.[0]?.url;
        const artUrlLarge = images?.[0]?.url ?? images?.[1]?.url ?? artUrl;
        const artUrlSmall = images?.[images.length - 1]?.url;
        const albumName = album?.name ?? '';

        const tracks: Track[] = [];
        let offset = 0;
        while (true) {
            const data = await spotifyApi.albumTracks(albumId, 50, offset);
            const items = data?.items ?? [];
            tracks.push(...items.map((t: any) => createSpotifyTrack(t, {
                albumId,
                album: albumName,
                trackNumber: t?.track_number,
                artUrl,
                artUrlSmall,
                artUrlLarge
            })));

            offset += items.length;
            if (items.length < 50) break;
        }

        return tracks;
    });
}

export async function addSpotifyPlaylistToQueue(playlistId: string): Promise<void> {
    await addResolvedEntityToQueue('spotify-playlist', playlistId, async () => {
        const tracks: Track[] = [];
        let offset = 0;

        while (true) {
            const data = await spotifyApi.playlistTracks(playlistId, 100, offset);
            const items = data?.items ?? [];
            tracks.push(...items
                .map((it: any) => it?.track)
                .filter(Boolean)
                .map((t: any) => createSpotifyTrack(t)));

            offset += items.length;
            if (items.length < 100) break;
        }

        return tracks;
    });
}

export async function addSoundCloudPlaylistToQueue(playlistId: string): Promise<void> {
    await addResolvedEntityToQueue('soundcloud-playlist', playlistId, async () => {
        const tracks: Track[] = [];
        let nextHref: string | null = null;

        while (true) {
            const data = await soundcloudUserApi.playlistTracks(
                playlistId,
                100,
                undefined,
                nextHref ?? undefined
            );
            const items = (data?.collection ?? []) as any[];
            tracks.push(...items
                .filter((t: any) => !!t && typeof t.id !== 'undefined')
                .map((t: any) => createSoundCloudTrack(t)));

            nextHref = typeof data?.next_href === 'string' ? data.next_href : null;
            if (!nextHref || !items.length) break;
        }

        return tracks;
    });
}

async function addResolvedEntityToQueue(
    entityType: string,
    entityId: string,
    resolveTracks: () => Promise<Track[]>
): Promise<void> {
    try {
        const tracks = await resolveTracks();
        addTracksToQueue(tracks, 'Add to Queue');
        logEvent('WebAmp', 'queue:add-entity', {
            entityType,
            entityId,
            size: playableTracks(tracks).length
        });
    } catch (error) {
        const message = formatErrorMessage(error);
        logEvent('WebAmp', 'queue:add-entity:error', {
            entityType,
            entityId
        }, message, 'error');
        await showErrorDialog(message, 'Queue Update Failed');
    }
}
