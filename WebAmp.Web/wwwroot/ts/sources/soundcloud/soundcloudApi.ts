import { cachedJsonFetch } from '../../storage/clientCache';
import { showErrorDialog, formatErrorMessage } from '../../ui/errorDialog';

export interface SoundCloudStatus {
    isConfigured: boolean;
    isAuthenticated: boolean;
}

export interface SoundCloudStreamInfo {
    url: string;
    protocol?: string | null;
    preset?: string | null;
    permalinkUrl?: string | null;
    kind?: string | null;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
    try {
        const res = await fetch(url, {
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                ...(init?.headers ?? {})
            },
            ...init
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            const error = new Error(`SoundCloud API proxy error ${res.status}: ${text}`);
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            throw error;
        }
        // Some endpoints may legitimately return empty bodies (204); guard for that.
        const text = await res.text();
        return (text ? (JSON.parse(text) as T) : ({} as T));
    } catch (error) {
        if (!(error instanceof Error && error.message.includes('SoundCloud API proxy error'))) {
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
        }
        throw error;
    }
}

async function cachedGet<T>(key: string, url: string): Promise<T> {
    return await cachedJsonFetch<T>(key, () => jsonFetch<T>(url));
}

/**
 * Thin client for server-side SoundCloud proxy endpoints.
 */
export const soundcloudApi = {
    /** Checks if SoundCloud is configured and the server can obtain a token. */
    async status(): Promise<SoundCloudStatus> {
        return await jsonFetch<SoundCloudStatus>('/api/webamp/soundcloud/status');
    },

    /** Searches public, playable SoundCloud tracks via server proxy. */
    async searchTracks(q: string, limit: number = 20, cursor?: string): Promise<any> {
        const params = new URLSearchParams();
        params.set('q', q);
        params.set('limit', String(limit));
        if (cursor) params.set('cursor', cursor);
        const url = `/api/webamp/soundcloud/searchtracks?${params.toString()}`;
        return await cachedGet<any>(`soundcloud:${url}`, url);
    },

    /** Searches public SoundCloud playlists via server proxy. */
    async searchPlaylists(q: string, limit: number = 20, cursor?: string): Promise<any> {
        const params = new URLSearchParams();
        params.set('q', q);
        params.set('limit', String(limit));
        if (cursor) params.set('cursor', cursor);
        const url = `/api/webamp/soundcloud/searchplaylists?${params.toString()}`;
        return await cachedGet<any>(`soundcloud:${url}`, url);
    },

    /** Searches public SoundCloud users via server proxy. */
    async searchUsers(q: string, limit: number = 20, cursor?: string): Promise<any> {
        const params = new URLSearchParams();
        params.set('q', q);
        params.set('limit', String(limit));
        if (cursor) params.set('cursor', cursor);
        const url = `/api/webamp/soundcloud/searchusers?${params.toString()}`;
        return await cachedGet<any>(`soundcloud:${url}`, url);
    },

    /** Fetches raw SoundCloud track metadata for a given id. */
    async track(id: string): Promise<any> {
        const url = `/api/webamp/soundcloud/track?id=${encodeURIComponent(id)}`;
        return await cachedGet<any>(`soundcloud:${url}`, url);
    },

    /**
     * Resolves a direct stream URL (or descriptor) for a SoundCloud track id.
     * Frontend should feed the returned `url` into an &lt;audio&gt; element.
     */
    async stream(id: string): Promise<SoundCloudStreamInfo> {
        const url = `/api/webamp/soundcloud/stream?id=${encodeURIComponent(id)}`;
        return await jsonFetch<SoundCloudStreamInfo>(url);
    }
};

