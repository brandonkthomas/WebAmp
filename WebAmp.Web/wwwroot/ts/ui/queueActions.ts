import type { Track } from '../state/playerStore';
import { shuffleCopy } from '../utils';

const LS_KEY = 'wa_shuffle_enabled';

/**
 * Reads shuffle toggle from localStorage
 */
export function getShufflePref(): boolean {
    return window.localStorage.getItem(LS_KEY) === 'true';
}

/**
 * Persists shuffle toggle to localStorage
 */
export function setShufflePref(enabled: boolean) {
    window.localStorage.setItem(LS_KEY, enabled ? 'true' : 'false');
}

/**
 * Wires up queue actions UI (shuffle toggle + play) inside `root`
 * Emits `wa:queue:set` then `wa:track:select` on queue play
 */
export function bindQueueActions(opts: {
    root: HTMLElement;
    getTracks: () => Track[];
    /** Optional: called when the queue order changes (e.g. shuffle play) */
    onQueueApplied?: (tracks: Track[]) => void;
}): (() => void) & { refresh?: () => void } {
    // Queue actions live in the global top bar so that shuffle/play
    // controls stay consistent across views. Views still pass `getTracks`
    // for their own context.
    const actions = document.querySelector<HTMLElement>('[data-wa-queue-actions]');
    const shuffleInput = actions?.querySelector<HTMLInputElement>('[data-wa-action="shuffle-toggle"]');
    const playBtn = actions?.querySelector<HTMLButtonElement>('[data-wa-action="queue-play"]');

    if (!actions || !shuffleInput || !playBtn) return () => {};

    const syncVisible = () => {
        const hasTracks = opts.getTracks().length > 0;
        console.log('syncVisible', hasTracks);
        actions.style.display = hasTracks ? 'flex' : 'none';
    };

    // Init shuffle UI from persisted pref.
    shuffleInput.checked = getShufflePref();
    syncVisible();

    const onShuffle = () => {
        setShufflePref(!!shuffleInput.checked);
    };

    const onPlay = () => {
        const tracks = opts.getTracks();
        if (!tracks.length) return;

        const shuffle = !!shuffleInput.checked;
        const queue = shuffle ? shuffleCopy(tracks) : tracks.slice();
        opts.onQueueApplied?.(queue);

        window.dispatchEvent(new CustomEvent('wa:queue:set', { detail: { tracks: queue, wrap: false } }));
        window.dispatchEvent(new CustomEvent('wa:track:select', { detail: { trackId: queue[0]?.id, from: 'queue-play' } }));
        syncVisible();
    };

    shuffleInput.addEventListener('change', onShuffle);
    playBtn.addEventListener('click', onPlay);

    const destroy = (() => {
        shuffleInput.removeEventListener('change', onShuffle);
        playBtn.removeEventListener('click', onPlay);
    }) as (() => void) & { refresh?: () => void };

    destroy.refresh = syncVisible;
    return destroy;
}
