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

