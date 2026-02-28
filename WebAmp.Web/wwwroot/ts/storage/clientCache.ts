import { logEvent } from '../internal/logging';

const DB_NAME = 'webamp-client-cache';
const DB_VERSION = 1;
const ART_STORE = 'art';
const ART_CACHE = 'webamp-art-cache-v1';
const ART_LIMIT = 100;
const ART_TTL_MS = 24 * 60 * 60 * 1000; // 24h

type ArtRecord = {
    url: string;
    size: number;
    addedAt: number;
};

/** Metadata cache: in-memory only, cleared on page refresh. */
const metaCache = new Map<string, { value: any; size: number }>();

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(ART_STORE)) {
                    db.createObjectStore(ART_STORE, { keyPath: 'url' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function getMetaTotalSize(): number {
    let sum = 0;
    for (const rec of metaCache.values()) sum += rec.size || 0;
    return sum;
}

async function getArtRecord(url: string): Promise<ArtRecord | null> {
    const db = await openDb();
    const tx = db.transaction(ART_STORE, 'readonly');
    const store = tx.objectStore(ART_STORE);
    const record = await promisify<ArtRecord | undefined>(store.get(url));
    return record ?? null;
}

async function getArtRecords(): Promise<ArtRecord[]> {
    const db = await openDb();
    const tx = db.transaction(ART_STORE, 'readonly');
    const store = tx.objectStore(ART_STORE);
    return await promisify<ArtRecord[]>(store.getAll());
}

async function setArtRecord(url: string, size: number): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(ART_STORE, 'readwrite');
    const store = tx.objectStore(ART_STORE);
    const record: ArtRecord = {
        url,
        size,
        addedAt: Date.now()
    };
    await promisify(store.put(record));
}

async function touchArtRecord(url: string): Promise<void> {
    const existing = await getArtRecord(url);
    if (!existing) return;
    await setArtRecord(url, existing.size);
}

async function deleteArtRecord(url: string): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(ART_STORE, 'readwrite');
    const store = tx.objectStore(ART_STORE);
    await promisify(store.delete(url));
}

async function getArtTotalSize(): Promise<number> {
    const records = await getArtRecords();
    return records.reduce((sum, rec) => sum + (rec.size || 0), 0);
}

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
        value /= 1024;
        idx++;
    }
    return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function isArtExpired(rec: ArtRecord): boolean {
    return Date.now() - rec.addedAt > ART_TTL_MS;
}

async function logCacheSizes(context: string): Promise<void> {
    const [metaSize, artSize] = [getMetaTotalSize(), await getArtTotalSize()];
    logEvent('WebAmp', 'cache:size', {
        context,
        metadata: formatBytes(metaSize),
        art: formatBytes(artSize)
    });
}

async function enforceArtLimit(): Promise<void> {
    const records = await getArtRecords();
    const valid = records.filter((r) => !isArtExpired(r));
    const expired = records.filter((r) => isArtExpired(r));
    if (expired.length) {
        const cache = await caches.open(ART_CACHE);
        for (const rec of expired) {
            await cache.delete(rec.url);
            await deleteArtRecord(rec.url);
        }
    }
    if (valid.length <= ART_LIMIT) return;
    valid.sort((a, b) => b.addedAt - a.addedAt);
    const evict = valid.slice(ART_LIMIT);
    if (!evict.length) return;
    const cache = await caches.open(ART_CACHE);
    for (const rec of evict) {
        await cache.delete(rec.url);
        await deleteArtRecord(rec.url);
    }
}

export async function cachedJsonFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = metaCache.get(key);
    if (cached) return cached.value as T;
    const data = await fetcher();
    const json = JSON.stringify(data);
    metaCache.set(key, { value: data, size: new TextEncoder().encode(json).length });
    void logCacheSizes('metadata+');
    return data;
}

async function responseToObjectUrl(res: Response): Promise<string | null> {
    try {
        const blob = await res.blob();
        return URL.createObjectURL(blob);
    } catch {
        return null;
    }
}

function shouldBypassArtCaching(url: string): boolean {
    try {
        const normalized = String(url).trim();
        const parsed = new URL(normalized, location.href);
        // Only cache same-origin artwork via fetch/caches APIs.
        // Cross-origin image URLs should be used directly in <img src>, which avoids CORS
        // preflight/response issues from third-party CDNs (including SoundCloud artwork).
        return parsed.origin !== location.origin;
    } catch {
        // Fail open to bypass: if URL parsing is odd, avoid client fetch attempts.
        return true;
    }
}

export async function resolveCachedArtUrl(url: string): Promise<string | null> {
    if (!url || typeof caches === 'undefined') return url ?? null;
    if (shouldBypassArtCaching(url)) return url;
    try {
        const cache = await caches.open(ART_CACHE);
        const cached = await cache.match(url);
        if (cached) {
            const artRec = await getArtRecord(url);
            if (artRec && !isArtExpired(artRec)) {
                void touchArtRecord(url);
                const objectUrl = await responseToObjectUrl(cached.clone());
                return objectUrl ?? url;
            }
            await cache.delete(url);
            if (artRec) await deleteArtRecord(url);
        }
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) return url;
        const clone = res.clone();
        await cache.put(url, clone);
        const blob = await res.blob();
        await setArtRecord(url, blob.size);
        await enforceArtLimit();
        await logCacheSizes('art+');
        return URL.createObjectURL(blob);
    } catch {
        return url;
    }
}

/**
 * Clears the client metadata and art cache, then reloads the page.
 * Exposed as window.waClearCacheAndReload for DevTools use.
 */
export async function clearClientCacheAndReload(): Promise<void> {
    if (dbPromise) {
        try {
            const db = await dbPromise;
            db.close();
        } catch { /* ignore */ }
        dbPromise = null;
    }
    await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve();
    });
    if (typeof caches !== 'undefined') {
        await caches.delete(ART_CACHE);
    }
    location.reload();
}

export function applyCachedArt(img: HTMLImageElement | null, url?: string | null): void {
    if (!img) return;
    if (!url) {
        const prev = img.dataset.waArtObjectUrl;
        if (prev) URL.revokeObjectURL(prev);
        delete img.dataset.waArtObjectUrl;
        img.removeAttribute('src');
        return;
    }
    const token = String(Date.now()) + Math.random().toString(16).slice(2);
    img.dataset.waArtToken = token;
    void (async () => {
        const resolved = await resolveCachedArtUrl(url);
        if (!resolved) return;
        if (img.dataset.waArtToken !== token) return;
        const prev = img.dataset.waArtObjectUrl;
        if (prev) URL.revokeObjectURL(prev);
        img.src = resolved;
        if (resolved.startsWith('blob:')) {
            img.dataset.waArtObjectUrl = resolved;
        } else {
            delete img.dataset.waArtObjectUrl;
        }
    })();
}
