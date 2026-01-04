import type { Track } from '../state/playerStore';
import { escapeHtml } from './common';

/**
 * Creates a clickable track row button
 * Emits `wa:track:toggle` when the indicator overlay is clicked
 */
export function createTrackListItem(opts: {
    track: Track;
    onClick: () => void;
    leading?: 'art' | 'index';
    index?: number;
    showMeta?: boolean;
}): HTMLButtonElement {
    const { track, onClick } = opts;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wa-listitem wa-trackitem';
    btn.setAttribute('data-wa-track', track.id);

    const art = track.artUrlSmall ?? track.artUrl ?? '';
    const meta = `${track.artist}${track.album ? ` — ${track.album}` : ''}`;
    const leading = opts.leading ?? 'art';
    const showMeta = opts.showMeta ?? true;
    const idx = typeof opts.index === 'number' ? opts.index : (typeof track.trackNumber === 'number' ? track.trackNumber : undefined);

    const indicatorHtml = `
        <span class="wa-trackitem__indicator" data-wa-track-toggle="${escapeHtml(track.id)}" aria-hidden="true">
            <img class="wa-trackitem__indicator-icon wa-trackitem__indicator-icon--wave" src="/apps/webamp/assets/svg/waveform.svg" alt="" decoding="async" />
            <img class="wa-trackitem__indicator-icon wa-trackitem__indicator-icon--wave-paused" src="/apps/webamp/assets/svg/waveform-paused.svg" alt="" decoding="async" />
            <img class="wa-trackitem__indicator-icon wa-trackitem__indicator-icon--play" src="/apps/webamp/assets/svg/play-filled.svg" alt="" decoding="async" />
            <img class="wa-trackitem__indicator-icon wa-trackitem__indicator-icon--pause" src="/apps/webamp/assets/svg/pause-filled.svg" alt="" decoding="async" />
        </span>
    `;

    const leadingHtml = leading === 'index'
        ? `
        <span class="wa-trackitem__art wa-trackitem__art--index" aria-hidden="true">
            <span class="wa-trackitem__index">${escapeHtml(String(idx ?? '–'))}</span>
            ${indicatorHtml}
        </span>
        `
        : `
        <span class="wa-trackitem__art" aria-hidden="true">
            ${art ? `<img class="wa-trackitem__img" src="${escapeHtml(art)}" alt="" loading="lazy" decoding="async" />` : `<span class="wa-trackitem__img wa-trackitem__img--empty"></span>`}
            ${indicatorHtml}
        </span>
        `;

    btn.innerHTML = `
        ${leadingHtml}
        <span class="wa-trackitem__text">
            <span class="wa-trackitem__title">${escapeHtml(track.title)}</span>
            ${showMeta ? `<span class="wa-trackitem__meta">${escapeHtml(meta)}</span>` : ''}
        </span>
    `;

    // Allow clicking the now-playing overlay without triggering the row click (which would restart the track).
    const toggle = btn.querySelector<HTMLElement>('[data-wa-track-toggle]');
    toggle?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('wa:track:toggle', { detail: { trackId: track.id } }));
    });

    btn.addEventListener('click', onClick);
    return btn;
}


