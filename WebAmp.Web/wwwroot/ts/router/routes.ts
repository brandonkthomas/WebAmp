export type ViewId = 'landing' | 'home' | 'search' | 'liked' | 'playlist' | 'album' | 'artist';

/**
 * Result of matching a browser pathname into a view + optional entity id
 */
export interface RouteMatch {
    view: ViewId;
    entityId?: string;
    canonicalPath: string;
}

export const WEBAMP_ROOT = '/webamp';

/**
 * Normalizes a path to always start with `/` and never end with `/` (unless root)
 */
function normalizePath(path: string): string {
    if (!path) return '/';
    const withLeading = path.startsWith('/') ? path : `/${path}`;
    if (withLeading.length > 1 && withLeading.endsWith('/')) {
        return withLeading.slice(0, -1);
    }
    return withLeading;
}

/**
 * Removes the `/webamp` prefix and returns an inner path starting with `/`
 */
function stripWebAmpRoot(pathname: string): string {
    const p = normalizePath(pathname);
    if (p === WEBAMP_ROOT) return '/';
    if (p.startsWith(`${WEBAMP_ROOT}/`)) {
        return p.slice(WEBAMP_ROOT.length);
    }
    return '/';
}

/**
 * Converts a full pathname into the corresponding view and canonical path
 */
export function matchWebAmpRoute(pathname: string): RouteMatch {
    const inner = stripWebAmpRoot(pathname);
    const cleaned = normalizePath(inner);

    if (cleaned === '/' || cleaned === '') {
        return { view: 'landing', canonicalPath: WEBAMP_ROOT };
    }

    const segments = cleaned.split('/').filter(Boolean);
    const head = segments[0] || '';
    const tail = segments[1];

    if (head === 'home') {
        return { view: 'home', canonicalPath: `${WEBAMP_ROOT}/home` };
    }

    if (head === 'search') {
        return { view: 'search', canonicalPath: `${WEBAMP_ROOT}/search` };
    }

    if (head === 'liked') {
        return { view: 'liked', canonicalPath: `${WEBAMP_ROOT}/liked` };
    }

    if (head === 'playlists') {
        if (tail) return { view: 'playlist', entityId: tail, canonicalPath: `${WEBAMP_ROOT}/playlists/${tail}` };
        return { view: 'playlist', canonicalPath: `${WEBAMP_ROOT}/playlists` };
    }

    if (head === 'albums') {
        if (tail) return { view: 'album', entityId: tail, canonicalPath: `${WEBAMP_ROOT}/albums/${tail}` };
        return { view: 'album', canonicalPath: `${WEBAMP_ROOT}/albums` };
    }

    if (head === 'artists') {
        if (tail) return { view: 'artist', entityId: tail, canonicalPath: `${WEBAMP_ROOT}/artists/${tail}` };
        return { view: 'artist', canonicalPath: `${WEBAMP_ROOT}/artists` };
    }

    // Fallback: route unknown paths to landing for now.
    return { view: 'landing', canonicalPath: WEBAMP_ROOT };
}
