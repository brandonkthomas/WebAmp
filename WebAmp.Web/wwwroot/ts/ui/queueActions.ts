import type { Track } from '../state/playerStore';
import { shuffleCopy } from '../utils';

const LS_KEY = 'wa_shuffle_enabled';
let shuffleDirty = false;

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
 * Returns whether the shuffle toggle has been manually changed this session.
 */
export function isShuffleDirty(): boolean {
    return shuffleDirty;
}

/**
 * Applies shuffle state across persisted pref, known UI toggles, and PlayerStore event.
 */
export function setShuffleEnabled(enabled: boolean, opts?: { markDirty?: boolean }) {
    const next = !!enabled;
    setShufflePref(next);
    if (opts?.markDirty) {
        shuffleDirty = true;
    }

    const topbar = document.querySelector<HTMLInputElement>('[data-wa-action="shuffle-toggle"]');
    const nowPlaying = document.querySelector<HTMLInputElement>('[data-wa-nowplaying-shuffle]');
    if (topbar) topbar.checked = next;
    if (nowPlaying) nowPlaying.checked = next;

    window.dispatchEvent(new CustomEvent('wa:shuffle:set', { detail: { enabled: next } }));
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
    const playIcon = actions?.querySelector<HTMLImageElement>('.wa-topbar__play-icon img');
    const playLabel = actions?.querySelector<HTMLElement>('.wa-topbar__play-label');

    if (!actions || !shuffleInput || !playBtn) return () => {};

    let isViewQueueActive = false;

    const syncVisible = () => {
        const hasTracks = opts.getTracks().length > 0;
        actions.style.display = hasTracks ? 'flex' : 'none';
    };

    const syncPlayButton = (isPlaying: boolean) => {
        if (playLabel) playLabel.textContent = isPlaying ? 'Pause' : 'Play';
        if (playBtn) playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
        if (playIcon) {
            const src = isPlaying
                ? '/apps/webamp/assets/svg/pause-filled.svg'
                : '/apps/webamp/assets/svg/play-filled.svg';
            if (playIcon.getAttribute('src') !== src) {
                playIcon.setAttribute('src', src);
            }
        }
    };

    const computeKey = (tracks: Track[]): string =>
        tracks.map((t) => t.id).join('|');

    const updateViewQueueActive = (globalTracks: Track[]) => {
        const viewTracks = opts.getTracks();
        if (!viewTracks.length || !globalTracks.length) {
            isViewQueueActive = false;
            return;
        }
        isViewQueueActive = computeKey(viewTracks) === computeKey(globalTracks);
    };

    const onTrackSelect = (e: Event) => {
        const ev = e as CustomEvent<{ trackId?: string; tracks?: Track[]; wrap?: boolean }>;
        const tracks = Array.isArray(ev.detail?.tracks) ? (ev.detail.tracks as Track[]) : [];
        if (!tracks.length) {
            isViewQueueActive = false;
            return;
        }
        updateViewQueueActive(tracks);
        // Visual state is handled separately via wa:player:state; no need to
        // force "playing" here.
    };

    window.addEventListener('wa:track:select', onTrackSelect as any);

    // Init shuffle UI from persisted pref.
    shuffleInput.checked = getShufflePref();
    syncVisible();

    const onShuffle = () => {
        setShuffleEnabled(!!shuffleInput.checked, { markDirty: true });
    };

    const onPlay = () => {
        const tracks = opts.getTracks();
        if (!tracks.length) return;

        // If this view already owns the active queue, treat the button as a
        // global play/pause toggle instead of restarting the playlist.
        if (isViewQueueActive) {
            window.dispatchEvent(new CustomEvent('wa:player:toggle'));
            return;
        }

        const shuffle = !!shuffleInput.checked;
        const queue = shuffle ? shuffleCopy(tracks) : tracks.slice();
        opts.onQueueApplied?.(queue);

        window.dispatchEvent(new CustomEvent('wa:queue:set', { detail: { tracks: queue, wrap: false } }));
        window.dispatchEvent(new CustomEvent('wa:track:select', { detail: { trackId: queue[0]?.id, from: 'queue-play', tracks: queue } }));
        syncVisible();
        syncPlayButton(true);
    };

    shuffleInput.addEventListener('change', onShuffle);
    playBtn.addEventListener('click', onPlay);

    const destroy = (() => {
        shuffleInput.removeEventListener('change', onShuffle);
        playBtn.removeEventListener('click', onPlay);
        window.removeEventListener('wa:track:select', onTrackSelect as any);
    }) as (() => void) & { refresh?: () => void };

    destroy.refresh = syncVisible;
    return destroy;
}
