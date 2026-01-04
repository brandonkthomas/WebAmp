import { escapeHtml } from './common';

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
            ${art ? `<img class="wa-trackitem__img" src="${escapeHtml(art)}" alt="" loading="lazy" decoding="async" />` : `<span class="wa-trackitem__img wa-trackitem__img--empty"></span>`}
        </span>
        <span class="wa-trackitem__text">
            <span class="wa-trackitem__title">${escapeHtml(album.title)}</span>
            <span class="wa-trackitem__meta">${escapeHtml(album.artist)}</span>
        </span>
    `;

    btn.addEventListener('click', onClick);
    return btn;
}
