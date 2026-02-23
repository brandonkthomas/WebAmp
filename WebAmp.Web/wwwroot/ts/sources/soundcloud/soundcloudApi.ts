import { cachedJsonFetch } from '../../storage/clientCache';
import { showErrorDialog, formatErrorMessage } from '../../ui/errorDialog';
import { logEvent } from '../../internal/logging';
import { apiPath } from '../../internal/paths';

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

function soundCloudApiPath(path: string): string {
    return apiPath(`soundcloud/${path.replace(/^\/+/, '')}`);
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
    const startedAt = performance.now();
    const method = init?.method ?? 'GET';
    let status: number | null = null;
    let errorLogged = false;
    try {
        const res = await fetch(url, {
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                ...(init?.headers ?? {})
            },
            ...init
        });
        status = res.status;
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            const error = new Error(`SoundCloud API proxy error ${res.status}: ${text}`);
            logEvent('WebAmp', 'api:error', { source: 'soundcloud', method, status, ms: Math.round(performance.now() - startedAt), url }, error.message, 'error');
            errorLogged = true;
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            throw error;
        }
        logEvent('WebAmp', 'api:ok', { source: 'soundcloud', method, status, ms: Math.round(performance.now() - startedAt), url });
        // Some endpoints may legitimately return empty bodies (204); guard for that.
        const text = await res.text();
        return (text ? (JSON.parse(text) as T) : ({} as T));
    } catch (error) {
        if (!errorLogged) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logEvent('WebAmp', 'api:error', { source: 'soundcloud', method, status, ms: Math.round(performance.now() - startedAt), url }, message, 'error');
        }
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
        return await jsonFetch<SoundCloudStatus>(soundCloudApiPath('status'));
    },

    /** Searches public, playable SoundCloud tracks via server proxy. */
    async searchTracks(q: string, limit: number = 20, cursor?: string): Promise<any> {
        const params = new URLSearchParams();
        params.set('q', q);
        params.set('limit', String(limit));
        if (cursor) params.set('cursor', cursor);
        const url = `${soundCloudApiPath('searchtracks')}?${params.toString()}`;
        return await cachedGet<any>(`soundcloud:${url}`, url);
    },

    /** Searches public SoundCloud playlists via server proxy. */
    async searchPlaylists(q: string, limit: number = 20, cursor?: string): Promise<any> {
        const params = new URLSearchParams();
        params.set('q', q);
        params.set('limit', String(limit));
        if (cursor) params.set('cursor', cursor);
        const url = `${soundCloudApiPath('searchplaylists')}?${params.toString()}`;
        return await cachedGet<any>(`soundcloud:${url}`, url);
    },

    /** Searches public SoundCloud users via server proxy. */
    async searchUsers(q: string, limit: number = 20, cursor?: string): Promise<any> {
        const params = new URLSearchParams();
        params.set('q', q);
        params.set('limit', String(limit));
        if (cursor) params.set('cursor', cursor);
        const url = `${soundCloudApiPath('searchusers')}?${params.toString()}`;
        return await cachedGet<any>(`soundcloud:${url}`, url);
    },

    /** Fetches raw SoundCloud track metadata for a given id. */
    async track(id: string): Promise<any> {
        const url = `${soundCloudApiPath('track')}?id=${encodeURIComponent(id)}`;
        return await cachedGet<any>(`soundcloud:${url}`, url);
    },

    /**
     * Resolves a direct stream URL (or descriptor) for a SoundCloud track id.
     * Frontend should feed the returned `url` into an <audio> element.
     */
    async stream(id: string): Promise<SoundCloudStreamInfo> {
        const url = `${soundCloudApiPath('stream')}?id=${encodeURIComponent(id)}`;
        return await jsonFetch<SoundCloudStreamInfo>(url);
    }
};
