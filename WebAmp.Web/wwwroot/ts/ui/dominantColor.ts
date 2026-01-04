/**
 * Simple RGB tuple used for theming
 */
export interface Rgb {
    r: number;
    g: number;
    b: number;
}

const colorCache = new Map<string, Rgb>();

/**
 * Gets the dominant color of an image
 */
export async function getDominantColor(imageUrl: string): Promise<Rgb | null> {
    if (!imageUrl) return null;
    const cached = colorCache.get(imageUrl);
    if (cached) return cached;

    try {
        const img = await loadImage(imageUrl);
        const rgb = sampleAverageColor(img, 28, 28);
        if (!rgb) return null;
        colorCache.set(imageUrl, rgb);
        return rgb;
    } catch {
        return null;
    }
}

/**
 * Loads an image with CORS enabled for canvas sampling
 */
function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.loading = 'eager';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image load failed'));
        img.src = src;
    });
}

/**
 * Downsamples and averages opaque pixels to approximate dominant color
 */
function sampleAverageColor(img: HTMLImageElement, w: number, h: number): Rgb | null {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] ?? 0;
        if (a < 10) continue;
        r += data[i] ?? 0;
        g += data[i + 1] ?? 0;
        b += data[i + 2] ?? 0;
        n++;
    }
    if (!n) return null;

    return {
        r: Math.round(r / n),
        g: Math.round(g / n),
        b: Math.round(b / n)
    };
}
