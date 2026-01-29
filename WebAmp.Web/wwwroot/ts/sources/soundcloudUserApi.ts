import { cachedJsonFetch } from '../storage/clientCache';
import { showErrorDialog, formatErrorMessage } from '../ui/errorDialog';

export interface SoundCloudUserStatus {
    isAuthenticated: boolean;
    profile?: any;
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
            const error = new Error(`SoundCloud user API proxy error ${res.status}: ${text}`);
            void showErrorDialog(formatErrorMessage(error), 'Music Service Error');
            throw error;
        }
        const text = await res.text();
        return (text ? (JSON.parse(text) as T) : ({} as T));
    } catch (error) {
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

