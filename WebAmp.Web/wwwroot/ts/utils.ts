/**
 * Small UI helpers shared by multiple view components.
 */

/**
 * Escapes text for safe interpolation into `innerHTML`.
 */
export function escapeHtml(s: string): string {
    return String(s)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

/**
 * Returns a shuffled copy of an array (Fisher-Yates).
 */
export function shuffleCopy<T>(arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
    }
    return a;
}

/**
 * SoundCloud artwork URLs often embed a size token (e.g. "-large", "t300x300").
 * Attempt to upgrade to a higher-res variant when possible.
 */
export function upgradeSoundCloudArtworkUrl(url: string): string {
    if (!url) return url;
    // Common SoundCloud sizes: large, t300x300, t500x500
    // Prefer t500x500 when present/compatible.
    return url
        .replace('-large.', '-t500x500.')
        .replace('-t300x300.', '-t500x500.');
}
