import type { PlayerState } from '../../state/playerStore';
import { applyCachedArt } from '../../storage/clientCache';
import type { PlayerStore } from '../../state/playerStore';
import { indiumSvg } from '../../internal/paths';
import { openPopupMenu } from '../../internal/indiumApi';
import { ensureTrackLibraryState, getTrackLibraryActionTitle, toggleTrackLibrary } from '../../library/trackLibrary';
import { shareCurrentTrack } from '../../share/currentTrackShare';

/**
 * Formats seconds as `m:ss`
 */
function formatTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * Player UI controller bound to a `PlayerStore`
 */
export class PlayerBar {
    private readonly root: HTMLElement;
    private readonly store: PlayerStore;
    private unsubscribe: (() => void) | null = null;

    private titleEl: HTMLElement | null;
    private artistEl: HTMLElement | null;
    private artImg: HTMLImageElement | null;
    private toggleIconEl: HTMLImageElement | null;
    private btnPrev: HTMLButtonElement | null;
    private btnNext: HTMLButtonElement | null;
    private btnToggle: HTMLButtonElement | null;
    private btnMenu: HTMLButtonElement | null;
    private timeCurrentEl: HTMLElement | null;
    private timeDurationEl: HTMLElement | null;
    private scrubber: HTMLInputElement | null;
    private lastArtUrl: string | null = null;
    private shareBusy = false;
    private libraryBusy = false;

    constructor(opts: { root: HTMLElement; store: PlayerStore }) {
        this.root = opts.root;
        this.store = opts.store;

        this.titleEl = this.root.querySelector<HTMLElement>('[data-wa-player-title]');
        this.artistEl = this.root.querySelector<HTMLElement>('[data-wa-player-artist]');
        this.artImg = this.root.querySelector<HTMLImageElement>('[data-wa-player-art]');
        this.toggleIconEl = this.root.querySelector<HTMLImageElement>('[data-wa-player-toggle-icon]');

        this.btnPrev = this.root.querySelector<HTMLButtonElement>('[data-wa-player-prev]');
        this.btnNext = this.root.querySelector<HTMLButtonElement>('[data-wa-player-next]');
        this.btnToggle = this.root.querySelector<HTMLButtonElement>('[data-wa-player-toggle]');
        this.btnMenu = this.root.querySelector<HTMLButtonElement>('[data-wa-player-menu]');
        this.timeCurrentEl = this.root.querySelector<HTMLElement>('[data-wa-player-time-current]');
        this.timeDurationEl = this.root.querySelector<HTMLElement>('[data-wa-player-time-duration]');
        this.scrubber = this.root.querySelector<HTMLInputElement>('[data-wa-player-scrubber]');

        this.bind();
    }

    /**
     * Binds DOM event handlers and subscribes to store updates
     */
    private bind() {
        // Treat next/prev as explicit intent to keep playback going.
        this.btnPrev?.addEventListener('click', () => this.store.prev({ autoplay: true }));
        this.btnNext?.addEventListener('click', () => this.store.next({ autoplay: true }));
        this.btnToggle?.addEventListener('click', () => this.store.togglePlay());
        this.btnMenu?.addEventListener('click', () => {
            const track = this.store.getState().track as any;
            if (!track || this.shareBusy || this.libraryBusy || !this.btnMenu) return;
            this.libraryBusy = true;
            this.render(this.store.getState());
            void (async () => {
                try {
                    await ensureTrackLibraryState(track);
                    const canShowAlbum: boolean = !!track?.albumId;
                    const canShowArtist: boolean = !!track?.primaryArtistId;
                    const items = [
                        ...(canShowAlbum
                            ? [{
                                id: 'show-album',
                                title: 'Show Album',
                                iconSrc: indiumSvg('album.svg'),
                                onSelect: () => {
                                    const albumId: string | undefined = track?.albumId;
                                    if (!albumId) return;
                                    // Desktop-only deep-link; mobile uses the fullscreen sheet.
                                    if (window.matchMedia('(max-width: 820px)').matches) return;
                                    window.dispatchEvent(
                                        new CustomEvent('wa:navigate:album', { detail: { albumId } })
                                    );
                                }
                            }] as const
                            : []),
                        ...(canShowArtist
                            ? [{
                                id: 'show-artist',
                                title: 'Show Artist',
                                iconSrc: indiumSvg('artist.svg'),
                                onSelect: () => {
                                    const artistId: string | undefined = track?.primaryArtistId;
                                    if (!artistId) return;
                                    // Desktop-only deep-link; mobile uses the fullscreen sheet.
                                    if (window.matchMedia('(max-width: 820px)').matches) return;
                                    window.dispatchEvent(
                                        new CustomEvent('wa:navigate:artist', { detail: { artistId } })
                                    );
                                }
                            }] as const
                            : []),
                        {
                            id: 'toggle-library',
                            title: getTrackLibraryActionTitle(track),
                            iconSrc: indiumSvg('heart-filled.svg'),
                            onSelect: async () => {
                                this.libraryBusy = true;
                                this.render(this.store.getState());
                                try {
                                    await toggleTrackLibrary(track);
                                } finally {
                                    this.libraryBusy = false;
                                    this.render(this.store.getState());
                                }
                            }
                        },
                        {
                            id: 'share',
                            title: 'Share',
                            iconSrc: indiumSvg('share.svg'),
                            onSelect: async () => {
                                this.shareBusy = true;
                                this.render(this.store.getState());
                                try {
                                    await shareCurrentTrack(track);
                                } finally {
                                    this.shareBusy = false;
                                    this.render(this.store.getState());
                                }
                            }
                        }
                    ] as const;
                    openPopupMenu({
                        anchor: this.btnMenu!,
                        title: 'Track Actions',
                        items
                    });
                } finally {
                    this.libraryBusy = false;
                    this.render(this.store.getState());
                }
            })();
        });

        this.scrubber?.addEventListener('input', () => {
            const state = this.store.getState();
            const duration = state.track?.durationSec ?? 0;
            if (!duration) return;
            const value = Number(this.scrubber?.value ?? 0);
            this.store.seekByRatio(value / 100);
        });

        // Desktop: clicking the title/artist in the bottom bar should navigate
        // to the corresponding album / artist detail view when we have IDs.
        this.titleEl?.addEventListener('click', () => {
            // Only deep-link from the desktop player bar; on mobile, the bar
            // opens the fullscreen Now Playing sheet instead.
            if (window.matchMedia('(max-width: 820px)').matches) return;
            const track = this.store.getState().track as any;
            const albumId: string | undefined = track?.albumId;
            if (!albumId) return;
            window.dispatchEvent(
                new CustomEvent('wa:navigate:album', { detail: { albumId } })
            );
        });

        this.artistEl?.addEventListener('click', () => {
            if (window.matchMedia('(max-width: 820px)').matches) return;
            const track = this.store.getState().track as any;
            const artistId: string | undefined = track?.primaryArtistId;
            if (!artistId) return;
            window.dispatchEvent(
                new CustomEvent('wa:navigate:artist', { detail: { artistId } })
            );
        });

        this.unsubscribe = this.store.subscribe((state) => this.render(state));
    }

    /**
     * Unsubscribes from store updates
     */
    destroy() {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    private render(state: PlayerState) {
        const track = state.track;
        const duration = track?.durationSec ?? 0;
        const position = state.positionSec;

        const canNavigateAlbum = !!track?.albumId;
        const canNavigateArtist = !!track?.primaryArtistId;

        if (this.titleEl) {
            this.titleEl.textContent = track?.title ?? 'Not Playing';
            if (canNavigateAlbum) this.titleEl.classList.add('wa-playerbar__link');
            else this.titleEl.classList.remove('wa-playerbar__link');
        }
        if (this.artistEl) {
            this.artistEl.textContent = track?.artist ?? '—';
            if (canNavigateArtist) this.artistEl.classList.add('wa-playerbar__link');
            else this.artistEl.classList.remove('wa-playerbar__link');
        }

        if (this.toggleIconEl) {
            const src = state.isPlaying
                ? indiumSvg('pause-filled.svg')
                : indiumSvg('play-filled.svg');

            // only update if the src is different (we dont want to hit the server 4x/sec)
            if (this.toggleIconEl.getAttribute('src') !== src) {
                this.toggleIconEl.setAttribute('src', src);
            }
        }

        // Busy state: show a throbber ring on the play button while switching tracks.
        if (this.btnToggle) {
            if (state.isBusy) this.btnToggle.setAttribute('data-wa-busy', 'true');
            else this.btnToggle.removeAttribute('data-wa-busy');
            this.btnToggle.disabled = !track;
        }

        if (this.btnPrev) {
            this.btnPrev.disabled = !track;
        }

        if (this.btnNext) {
            this.btnNext.disabled = !track;
        }

        if (this.btnMenu) {
            this.btnMenu.disabled = !track || this.shareBusy || this.libraryBusy;
        }

        if (this.timeCurrentEl) this.timeCurrentEl.textContent = formatTime(position);
        if (this.timeDurationEl) this.timeDurationEl.textContent = formatTime(duration);

        if (this.scrubber) {
            const ratio = duration ? (position / duration) : 0;
            this.scrubber.value = String(Math.max(0, Math.min(100, ratio * 100)));
            this.scrubber.disabled = !track || !duration;
        }

        if (this.artImg) {
            const nextUrl = track?.artUrl ?? null;
            if (nextUrl && nextUrl !== this.lastArtUrl) {
                this.lastArtUrl = nextUrl;
                applyCachedArt(this.artImg, nextUrl);
                this.artImg.style.display = 'block';
            } else if (!nextUrl) {
                this.lastArtUrl = null;
                applyCachedArt(this.artImg, null);
                this.artImg.style.display = 'none';
            }
        }
    }
}
