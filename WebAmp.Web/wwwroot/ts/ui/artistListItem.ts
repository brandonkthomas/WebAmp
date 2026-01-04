import { escapeHtml } from './common';

export interface ArtistListItemModel {
    id: string;
    name: string;
    artUrlSmall?: string;
}

/**
 * Creates an artist list item.
 */
export function createArtistListItem(opts: {
    artist: ArtistListItemModel;
    onClick: () => void;
}): HTMLButtonElement {
    const { artist, onClick } = opts;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wa-listitem wa-trackitem';
    btn.setAttribute('data-wa-artist', artist.id);

    const art = artist.artUrlSmall ?? '';
    btn.innerHTML = `
        <span class="wa-trackitem__art" aria-hidden="true" style="border-radius:999px;">
            ${art ? `<img class="wa-trackitem__img" src="${escapeHtml(art)}" alt="" loading="lazy" decoding="async" />` : `<span class="wa-trackitem__img wa-trackitem__img--empty"></span>`}
        </span>
        <span class="wa-trackitem__text">
            <span class="wa-trackitem__title">${escapeHtml(artist.name)}</span>
            <span class="wa-trackitem__meta">Artist</span>
        </span>
    `;

    btn.addEventListener('click', onClick);
    return btn;
}
