import { escapeHtml } from '../utils';

/**
 * Playlist list item view model
 */
export interface PlaylistListItemModel {
    id: string;
    title: string;
    owner: string;
    artUrlSmall?: string;
}

/**
 * Creates a clickable playlist row button
 */
export function createPlaylistListItem(opts: {
    playlist: PlaylistListItemModel;
    onClick: () => void;
}): HTMLButtonElement {
    const { playlist, onClick } = opts;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wa-listitem wa-trackitem';
    btn.setAttribute('data-wa-playlist', playlist.id);

    const art = playlist.artUrlSmall ?? '';
    btn.innerHTML = `
        <span class="wa-trackitem__art" aria-hidden="true">
            ${art ? `<img class="wa-trackitem__img" src="${escapeHtml(art)}" alt="" loading="lazy" decoding="async" />` : `<span class="wa-trackitem__img wa-trackitem__img--empty"></span>`}
        </span>
        <span class="wa-trackitem__text">
            <span class="wa-trackitem__title">${escapeHtml(playlist.title)}</span>
            <span class="wa-trackitem__meta">${escapeHtml(playlist.owner)}</span>
        </span>
    `;

    btn.addEventListener('click', onClick);
    return btn;
}
