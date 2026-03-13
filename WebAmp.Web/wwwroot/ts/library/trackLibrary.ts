import { showAlert } from '../internal/indiumApi';
import { logEvent } from '../internal/logging';
import { soundcloudUserApi } from '../sources/soundcloudUserApi';
import { spotifyApi } from '../sources/spotify/spotifyApi';
import type { Track, TrackSource } from '../state/playerStore';
import { clearCachedJsonByPrefix } from '../storage/clientCache';
import { formatErrorMessage, showErrorDialog } from '../ui/errorDialog';
import { isSoundCloudTrackPlayable } from '../utils';

const libraryStateCache = new Map<string, boolean>();

function getTrackSource(track: Track): TrackSource {
    return (track.source ?? 'spotify') as TrackSource;
}

function getTrackLibraryKey(track: Track): string {
    return `${getTrackSource(track)}:${track.id}`;
}

function getSoundCloudTrackUrn(track: Track): string {
    return `soundcloud:tracks:${track.id}`;
}

function invalidateLibraryCaches(track: Track): void {
    switch (getTrackSource(track)) {
        case 'soundcloud':
            clearCachedJsonByPrefix('soundclouduser:/api/soundclouduser/likedtracks');
            break;
        case 'spotify':
        default:
            clearCachedJsonByPrefix('spotify:/api/spotify/savedtracks');
            break;
    }
}

export function rememberTrackLibraryState(track: Track, inLibrary: boolean): Track {
    track.inLibrary = inLibrary;
    libraryStateCache.set(getTrackLibraryKey(track), inLibrary);
    return track;
}

export function getKnownTrackLibraryState(track: Track | null | undefined): boolean | undefined {
    if (!track) return undefined;
    if (typeof track.inLibrary === 'boolean') {
        libraryStateCache.set(getTrackLibraryKey(track), track.inLibrary);
        return track.inLibrary;
    }

    return libraryStateCache.get(getTrackLibraryKey(track));
}

function applyKnownTrackLibraryState(track: Track): Track {
    const known = getKnownTrackLibraryState(track);
    if (typeof known === 'boolean') {
        track.inLibrary = known;
    }

    return track;
}

export function createSpotifyTrack(raw: any, overrides: Partial<Track> = {}): Track {
    const images = raw?.album?.images ?? [];
    const artUrlSmall = images?.[images.length - 1]?.url;
    const artUrl = images?.[1]?.url ?? images?.[0]?.url;
    const artUrlLarge = images?.[0]?.url ?? images?.[1]?.url ?? artUrl;
    const artist = Array.isArray(raw?.artists) ? raw.artists.map((a: any) => a.name).join(', ') : '';
    const album = raw?.album?.name ?? '';

    const track: Track = {
        id: raw.id,
        source: 'spotify',
        title: raw.name,
        artist,
        albumId: raw?.album?.id,
        album,
        primaryArtistId: Array.isArray(raw?.artists) && raw.artists.length ? raw.artists[0]?.id : undefined,
        durationSec: Math.round((raw?.duration_ms ?? 0) / 1000),
        artUrl,
        artUrlSmall,
        artUrlLarge,
        uri: raw?.uri,
        ...overrides
    };
    track.source = 'spotify';

    return typeof track.inLibrary === 'boolean'
        ? rememberTrackLibraryState(track, track.inLibrary)
        : applyKnownTrackLibraryState(track);
}

export function createSoundCloudTrack(raw: any, overrides: Partial<Track> = {}): Track {
    const artUrl: string | undefined =
        typeof raw?.artwork_url === 'string'
            ? raw.artwork_url
            : (typeof raw?.user?.avatar_url === 'string' ? raw.user.avatar_url : undefined);

    const baseInLibrary = typeof raw?.user_favorite === 'boolean' ? raw.user_favorite : undefined;
    const track: Track = {
        id: String(raw?.id),
        source: 'soundcloud',
        title: typeof raw?.title === 'string' ? raw.title : '(untitled)',
        artist:
            typeof raw?.user?.username === 'string'
                ? raw.user.username
                : (typeof raw?.user?.name === 'string' ? raw.user.name : ''),
        isPlayable: isSoundCloudTrackPlayable(raw),
        durationSec: Math.round((typeof raw?.duration === 'number' ? raw.duration : 0) / 1000),
        artUrl,
        artUrlSmall: artUrl,
        permalinkUrl: typeof raw?.permalink_url === 'string' ? raw.permalink_url : undefined,
        inLibrary: baseInLibrary,
        ...overrides
    };
    track.source = 'soundcloud';

    return typeof track.inLibrary === 'boolean'
        ? rememberTrackLibraryState(track, track.inLibrary)
        : applyKnownTrackLibraryState(track);
}

async function resolveSpotifyTrackLibraryState(track: Track): Promise<boolean> {
    return await spotifyApi.savedTracksContains(track.id);
}

async function resolveSoundCloudTrackLibraryState(track: Track): Promise<boolean> {
    const data = await soundcloudUserApi.track(track.id);
    return !!data?.user_favorite;
}

export async function ensureTrackLibraryState(track: Track | null): Promise<boolean> {
    if (!track) return false;

    const known = getKnownTrackLibraryState(track);
    if (typeof known === 'boolean') return known;

    const resolved = getTrackSource(track) === 'soundcloud'
        ? await resolveSoundCloudTrackLibraryState(track)
        : await resolveSpotifyTrackLibraryState(track);

    rememberTrackLibraryState(track, resolved);
    return resolved;
}

export function primeTrackLibraryState(track: Track | null): void {
    if (!track || typeof getKnownTrackLibraryState(track) === 'boolean') return;

    void ensureTrackLibraryState(track).catch(() => {
        // Best-effort prefetch only.
    });
}

async function addTrackToLibrary(track: Track): Promise<void> {
    switch (getTrackSource(track)) {
        case 'soundcloud':
            await soundcloudUserApi.likeTrack(getSoundCloudTrackUrn(track));
            break;
        case 'spotify':
        default:
            await spotifyApi.saveTrack(track.id);
            break;
    }
}

async function removeTrackFromLibrary(track: Track): Promise<void> {
    switch (getTrackSource(track)) {
        case 'soundcloud':
            await soundcloudUserApi.unlikeTrack(getSoundCloudTrackUrn(track));
            break;
        case 'spotify':
        default:
            await spotifyApi.removeTrack(track.id);
            break;
    }
}

function getTrackLibrarySuccessMessage(track: Track, nextInLibrary: boolean): string {
    switch (getTrackSource(track)) {
        case 'soundcloud':
            return nextInLibrary
                ? 'Added to your SoundCloud likes.'
                : 'Removed from your SoundCloud likes.';
        case 'spotify':
        default:
            return nextInLibrary
                ? 'Added to your Liked Songs.'
                : 'Removed from your Liked Songs.';
    }
}

export function getTrackLibraryActionTitle(track: Track | null): string {
    return getKnownTrackLibraryState(track) ? 'Remove From Library' : 'Add To Library';
}

export async function toggleTrackLibrary(track: Track | null): Promise<boolean | null> {
    if (!track) return null;

    try {
        const inLibrary = await ensureTrackLibraryState(track);
        const nextInLibrary = !inLibrary;

        if (nextInLibrary) {
            await addTrackToLibrary(track);
        } else {
            await removeTrackFromLibrary(track);
        }

        rememberTrackLibraryState(track, nextInLibrary);
        invalidateLibraryCaches(track);

        await showAlert({
            title: nextInLibrary ? 'Add To Library' : 'Remove From Library',
            message: getTrackLibrarySuccessMessage(track, nextInLibrary)
        });

        logEvent('WebAmp', nextInLibrary ? 'track:add-to-library' : 'track:remove-from-library', {
            source: getTrackSource(track),
            trackId: track.id
        });

        return nextInLibrary;
    } catch (error) {
        const message = formatErrorMessage(error);
        logEvent('WebAmp', 'track:toggle-library:error', {
            source: getTrackSource(track),
            trackId: track.id
        }, message, 'error');
        await showErrorDialog(message, 'Library Update Failed');
        return null;
    }
}
