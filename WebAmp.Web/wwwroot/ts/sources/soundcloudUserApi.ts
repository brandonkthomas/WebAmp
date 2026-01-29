import { cachedJsonFetch } from '../storage/clientCache';
import { showErrorDialog, formatErrorMessage } from '../ui/errorDialog';
import { logEvent } from '../../../../../Portfolio/wwwroot/ts/common';

export interface SoundCloudUserStatus {
    isAuthenticated: boolean;
    profile?: any;
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
            const error = new Error(`SoundCloud user API proxy error ${res.status}: ${text}`);
            logEvent('WebAmp', 'api:error', { source: 'soundcloud-user', method, status, ms: Math.round(performance.now() - startedAt), url }, error.message, 'error');
            errorLogged = true;
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            throw error;
        }
        logEvent('WebAmp', 'api:ok', { source: 'soundcloud-user', method, status, ms: Math.round(performance.now() - startedAt), url });
        const text = await res.text();
        return (text ? (JSON.parse(text) as T) : ({} as T));
    } catch (error) {
        if (!errorLogged) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            logEvent('WebAmp', 'api:error', { source: 'soundcloud-user', method, status, ms: Math.round(performance.now() - startedAt), url }, message, 'error');
        }
        if (!(error instanceof Error && error.message.includes('SoundCloud user API proxy error'))) {
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
        }
        throw error;
    }
}

async function cachedGet<T>(key: string, url: string): Promise<T> {
    return await cachedJsonFetch<T>(key, () => jsonFetch<T>(url));
}

/**
 * Client for user-scoped SoundCloud proxy endpoints (Authorization Code flow).
 */
export const soundcloudUserApi = {
    async status(): Promise<SoundCloudUserStatus> {
        return await jsonFetch<SoundCloudUserStatus>('/api/webamp/soundclouduser/status');
    },

    async logout(): Promise<void> {
        await jsonFetch('/api/webamp/soundclouduser/logout', { method: 'POST', body: '{}' });
    },

    async myPlaylists(limit: number = 20, cursor?: string): Promise<any> {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        if (cursor) params.set('cursor', cursor);
        return await cachedGet<any>(`soundclouduser:/api/webamp/soundclouduser/myplaylists?${params.toString()}`, `/api/webamp/soundclouduser/myplaylists?${params.toString()}`);
    },

    async likedTracks(limit: number = 20, cursor?: string): Promise<any> {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        if (cursor) params.set('cursor', cursor);
        return await cachedGet<any>(`soundclouduser:/api/webamp/soundclouduser/likedtracks?${params.toString()}`, `/api/webamp/soundclouduser/likedtracks?${params.toString()}`);
    },

    async recentActivities(limit: number = 10, cursor?: string): Promise<any> {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        if (cursor) params.set('cursor', cursor);
        return await cachedGet<any>(`soundclouduser:/api/webamp/soundclouduser/recentactivities?${params.toString()}`, `/api/webamp/soundclouduser/recentactivities?${params.toString()}`);
    },

    async playlist(id: string): Promise<any> {
        return await cachedGet<any>(`soundclouduser:/api/webamp/soundclouduser/playlist?id=${encodeURIComponent(id)}`, `/api/webamp/soundclouduser/playlist?id=${encodeURIComponent(id)}`);
    },

    async playlistTracks(id: string, limit: number = 100, cursor?: string): Promise<any> {
        const params = new URLSearchParams();
        params.set('id', id);
        params.set('limit', String(limit));
        if (cursor) params.set('cursor', cursor);
        return await cachedGet<any>(`soundclouduser:/api/webamp/soundclouduser/playlisttracks?${params.toString()}`, `/api/webamp/soundclouduser/playlisttracks?${params.toString()}`);
    }
};

