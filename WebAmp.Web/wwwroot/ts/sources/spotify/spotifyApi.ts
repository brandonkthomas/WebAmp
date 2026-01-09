import { showErrorDialog, formatErrorMessage } from '../../ui/errorDialog';

/**
 * Minimal auth/status info returned by the server proxy
 */
export interface SpotifyStatus {
    isAuthenticated: boolean;
    profile?: any;
}

/**
 * JSON fetch helper for same-origin WebAmp Spotify proxy endpoints
 */
async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
    try {
    const res = await fetch(url, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
        ...init
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
            const error = new Error(`Spotify API proxy error ${res.status}: ${text}`);
            // Show error dialog to user
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            throw error;
    }
    return (await res.json()) as T;
    } catch (error) {
        // If it's not already our formatted error, show a dialog
        if (!(error instanceof Error && error.message.includes('Spotify API proxy error'))) {
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
        }
        throw error;
    }
}

/**
 * Thin client for server-side Spotify proxy endpoints
 */
export const spotifyApi = {
    /** Gets auth status for current session */
    async status(): Promise<SpotifyStatus> {
        return await jsonFetch<SpotifyStatus>('/api/webamp/spotify/status');
    },

    /** Logs out current Spotify session */
    async logout(): Promise<void> {
        await jsonFetch('/api/webamp/spotify/logout', { method: 'POST', body: '{}' });
    },

    /** Gets an access token for Spotify Web Playback SDK */
    async accessToken(): Promise<{ accessToken: string }> {
        return await jsonFetch<{ accessToken: string }>('/api/webamp/spotify/accesstoken');
    },

    /** Searches Spotify content via proxy */
    async search(q: string, type: string = 'track,artist,album,playlist', limit: number = 10, offset: number = 0): Promise<any> {
        const url = `/api/webamp/spotify/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}&limit=${limit}&offset=${offset}`;
        return await jsonFetch<any>(url);
    },

    /** Lists current user playlists (paged) */
    async myPlaylists(limit: number = 20, offset: number = 0): Promise<any> {
        return await jsonFetch<any>(`/api/webamp/spotify/myplaylists?limit=${limit}&offset=${offset}`);
    },

    /** Lists current user saved tracks (paged) */
    async savedTracks(limit: number = 20, offset: number = 0): Promise<any> {
        return await jsonFetch<any>(`/api/webamp/spotify/savedtracks?limit=${limit}&offset=${offset}`);
    },

    /** Lists current user saved albums (paged) */
    async savedAlbums(limit: number = 20, offset: number = 0): Promise<any> {
        return await jsonFetch<any>(`/api/webamp/spotify/savedalbums?limit=${limit}&offset=${offset}`);
    },

    /** Lists followed artists using cursor pagination */
    async followedArtists(limit: number = 20, after?: string): Promise<any> {
        const a = after ? `&after=${encodeURIComponent(after)}` : '';
        return await jsonFetch<any>(`/api/webamp/spotify/followedartists?limit=${limit}${a}`);
    },

    /** Lists playlist tracks (paged) */
    async playlistTracks(id: string, limit: number = 100, offset: number = 0): Promise<any> {
        return await jsonFetch<any>(`/api/webamp/spotify/playlisttracks?id=${encodeURIComponent(id)}&limit=${limit}&offset=${offset}`);
    },

    /** Fetches playlist metadata */
    async playlist(id: string): Promise<any> {
        return await jsonFetch<any>(`/api/webamp/spotify/playlist?id=${encodeURIComponent(id)}`);
    },

    /** Lists album tracks (paged) */
    async albumTracks(id: string, limit: number = 50, offset: number = 0): Promise<any> {
        return await jsonFetch<any>(`/api/webamp/spotify/albumtracks?id=${encodeURIComponent(id)}&limit=${limit}&offset=${offset}`);
    },

    /** Fetches album metadata */
    async album(id: string): Promise<any> {
        return await jsonFetch<any>(`/api/webamp/spotify/album?id=${encodeURIComponent(id)}`);
    },

    /** Fetches artist top tracks for a market */
    async artistTopTracks(id: string, market: string = 'US'): Promise<any> {
        return await jsonFetch<any>(`/api/webamp/spotify/artisttoptracks?id=${encodeURIComponent(id)}&market=${encodeURIComponent(market)}`);
    },

    /** Fetches artist metadata */
    async artist(id: string): Promise<any> {
        return await jsonFetch<any>(`/api/webamp/spotify/artist?id=${encodeURIComponent(id)}`);
    },

    /** Lists artist albums (paged) */
    async artistAlbums(id: string, includeGroups: string = 'album,single', limit: number = 50, offset: number = 0): Promise<any> {
        return await jsonFetch<any>(`/api/webamp/spotify/artistalbums?id=${encodeURIComponent(id)}&includeGroups=${encodeURIComponent(includeGroups)}&limit=${limit}&offset=${offset}`);
    },

    /** Transfers playback to the Web Playback SDK device */
    async transfer(deviceId: string, play: boolean = true): Promise<void> {
        await jsonFetch('/api/webamp/spotify/transfer', {
            method: 'POST',
            body: JSON.stringify({ deviceId, play })
        });
    },

    /** Starts playback of a track URI on the given device */
    async playTrack(deviceId: string, trackUri: string, positionMs?: number): Promise<void> {
        await jsonFetch('/api/webamp/spotify/play', {
            method: 'POST',
            body: JSON.stringify({ deviceId, trackUri, positionMs })
        });
    },

    /** Pauses playback */
    async pause(deviceId: string): Promise<void> {
        await jsonFetch('/api/webamp/spotify/pause', { method: 'POST', body: JSON.stringify({ deviceId }) });
    },

    /** Resumes playback */
    async resume(deviceId: string): Promise<void> {
        await jsonFetch('/api/webamp/spotify/resume', { method: 'POST', body: JSON.stringify({ deviceId }) });
    },

    /** Skips to next track */
    async next(deviceId: string): Promise<void> {
        await jsonFetch('/api/webamp/spotify/next', { method: 'POST', body: JSON.stringify({ deviceId }) });
    },

    /** Skips to previous track */
    async previous(deviceId: string): Promise<void> {
        await jsonFetch('/api/webamp/spotify/previous', { method: 'POST', body: JSON.stringify({ deviceId }) });
    },

    /** Seeks playback position */
    async seek(deviceId: string, positionMs: number): Promise<void> {
        await jsonFetch('/api/webamp/spotify/seek', {
            method: 'POST',
            body: JSON.stringify({ deviceId, positionMs })
        });
    },

    /** Navigates to login endpoint (starts OAuth) */
    login(returnUrl?: string) {
        const ru = returnUrl ?? (window.location.pathname + window.location.search + window.location.hash);
        window.location.assign(`/webamp/spotify/login?returnUrl=${encodeURIComponent(ru)}`);
    }
};
