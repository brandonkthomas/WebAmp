import { logEvent } from '../../../../../Portfolio/wwwroot/ts/common';

const DB_NAME = 'webamp-client-cache';
const DB_VERSION = 1;
const META_STORE = 'meta';
const ART_STORE = 'art';
const ART_CACHE = 'webamp-art-cache-v1';
const ART_LIMIT = 100;

type MetaRecord = {
    key: string;
    value: any;
    size: number;
    updatedAt: number;
};

type ArtRecord = {
    url: string;
    size: number;
    addedAt: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(META_STORE)) {
                    db.createObjectStore(META_STORE, { keyPath: 'key' });
                }
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

async function getMetaRecord<T>(key: string): Promise<MetaRecord | null> {
    const db = await openDb();
    const tx = db.transaction(META_STORE, 'readonly');
    const store = tx.objectStore(META_STORE);
    const record = await promisify<MetaRecord | undefined>(store.get(key));
    return record ?? null;
}

async function setMetaRecord(key: string, value: any): Promise<void> {
    const db = await openDb();
    const tx = db.transaction(META_STORE, 'readwrite');
    const store = tx.objectStore(META_STORE);
    const json = JSON.stringify(value);
    const size = new TextEncoder().encode(json).length;
    const record: MetaRecord = {
        key,
        value,
        size,
        updatedAt: Date.now()
    };
    await promisify(store.put(record));
}

async function getMetaTotalSize(): Promise<number> {
    const db = await openDb();
    const tx = db.transaction(META_STORE, 'readonly');
    const store = tx.objectStore(META_STORE);
    const records = await promisify<MetaRecord[]>(store.getAll());
    return records.reduce((sum, rec) => sum + (rec.size || 0), 0);
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

async function logCacheSizes(context: string): Promise<void> {
    const [metaSize, artSize] = await Promise.all([getMetaTotalSize(), getArtTotalSize()]);
    logEvent('WebAmp', 'cache:size', {
        context,
        metadata: formatBytes(metaSize),
        art: formatBytes(artSize)
    });
}

async function enforceArtLimit(): Promise<void> {
    const records = await getArtRecords();
    if (records.length <= ART_LIMIT) return;
    records.sort((a, b) => b.addedAt - a.addedAt);
    const evict = records.slice(ART_LIMIT);
    if (!evict.length) return;
    const cache = await caches.open(ART_CACHE);
    for (const rec of evict) {
        await cache.delete(rec.url);
        await deleteArtRecord(rec.url);
    }
}

export async function cachedJsonFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    try {
        const cached = await getMetaRecord<T>(key);
        if (cached) {
            return cached.value as T;
        }
    } catch {
        // Ignore cache read errors and fall through to fetch.
    }
    const data = await fetcher();
    try {
        await setMetaRecord(key, data);
        await logCacheSizes('metadata+');
    } catch {
        // Ignore cache write errors to avoid breaking requests.
    }
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

export async function resolveCachedArtUrl(url: string): Promise<string | null> {
    if (!url || typeof caches === 'undefined') return url ?? null;
    try {
        const cache = await caches.open(ART_CACHE);
        const cached = await cache.match(url);
        if (cached) {
            void touchArtRecord(url);
            const objectUrl = await responseToObjectUrl(cached.clone());
            return objectUrl ?? url;
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
