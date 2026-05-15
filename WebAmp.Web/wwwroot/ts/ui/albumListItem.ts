import { applyCachedArt } from '../storage/clientCache';
import { indiumSvg } from '../internal/paths';
import { openPopupMenu } from '../internal/indiumApi';
import { escapeHtml } from '../utils';
import { addSpotifyAlbumToQueue } from './entityQueue';

export interface AlbumListItemModel {
    id: string;
    title: string;
    artist: string;
    artUrlSmall?: string;
}

/**
 * Creates an album list item.
 */
export function createAlbumListItem(opts: {
    album: AlbumListItemModel;
    onClick: () => void;
}): HTMLButtonElement {
    const { album, onClick } = opts;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wa-listitem wa-trackitem';
    btn.setAttribute('data-wa-album', album.id);

    const art = album.artUrlSmall ?? '';
    btn.innerHTML = `
        <span class="wa-trackitem__art" aria-hidden="true">
            ${art ? `<img class="wa-trackitem__img" alt="" loading="lazy" decoding="async" />` : `<span class="wa-trackitem__img wa-trackitem__img--empty"></span>`}
        </span>
        <span class="wa-trackitem__text">
            <span class="wa-trackitem__title">${escapeHtml(album.title)}</span>
            <span class="wa-trackitem__meta">${escapeHtml(album.artist)}</span>
        </span>
    `;


    if (art) {
        const img = btn.querySelector<HTMLImageElement>('img.wa-trackitem__img');
        applyCachedArt(img, art);
    }

    btn.addEventListener('click', onClick);

    const openMenu = () => {
        openPopupMenu({
            anchor: btn,
            title: 'Album Actions',
            items: [
                {
                    id: 'add-to-queue',
                    title: 'Add to Queue',
                    iconSrc: indiumSvg('playlist-filled.svg'),
                    onSelect: async () => {
                        await addSpotifyAlbumToQueue(album.id);
                    }
                }
            ]
        });
    };

    btn.addEventListener('contextmenu', (e) => {
        openMenu();
        e.preventDefault();
        e.stopPropagation();
    });

    let touchTimer: number | null = null;
    let initialTouchY: number | null = null;
    const LONG_PRESS_MS = 500;
    const MOVE_CANCEL_THRESHOLD_PX = 8;

    btn.addEventListener('touchstart', (e) => {
        if (touchTimer !== null) {
            window.clearTimeout(touchTimer);
            touchTimer = null;
        }

        initialTouchY = e.touches[0]?.clientY ?? null;
        touchTimer = window.setTimeout(() => {
            touchTimer = null;
            openMenu();
        }, LONG_PRESS_MS);
    }, { passive: true });

    btn.addEventListener('touchmove', (e) => {
        if (touchTimer === null || initialTouchY === null) return;

        const currentTouchY = e.touches[0]?.clientY;
        if (typeof currentTouchY !== 'number') return;

        const yCoordDiffInPxAfterTimer = Math.abs(currentTouchY - initialTouchY);
        if (yCoordDiffInPxAfterTimer > MOVE_CANCEL_THRESHOLD_PX) {
            window.clearTimeout(touchTimer);
            touchTimer = null;
            initialTouchY = null;
        }
    }, { passive: true });

    const cancelTouch = () => {
        if (touchTimer !== null) {
            window.clearTimeout(touchTimer);
            touchTimer = null;
        }
        initialTouchY = null;
    };

    btn.addEventListener('touchend', cancelTouch);
    btn.addEventListener('touchcancel', cancelTouch);

    return btn;
}
