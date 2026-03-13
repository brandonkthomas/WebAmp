import type { PlayerState, PlayerStore } from '../../state/playerStore';
import { applyCachedArt } from '../../storage/clientCache';
import { getShufflePref, setShuffleEnabled } from '../../ui/queueActions';
import { indiumSvg } from '../../internal/paths';
import { openPopupMenu } from '../../internal/indiumApi';
import { ensureTrackLibraryState, getTrackLibraryActionTitle, toggleTrackLibrary } from '../../library/trackLibrary';
import { shareCurrentTrack } from '../../share/currentTrackShare';

function upgradeSoundCloudArtworkUrl(url: string): string {
    if (!url) return url;
    // Common SoundCloud sizes: large, t300x300, t500x500
    // Prefer t500x500 when present/compatible.
    return url
        .replace('-large.', '-t500x500.')
        .replace('-t300x300.', '-t500x500.');
}

function formatTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * Mobile-only fullscreen "Now Playing" sheet.
 * Opens from player bar tap / swipe-up and slides up from bottom.
 */
export class NowPlayingMobile {
    private readonly root: HTMLElement;
    private readonly store: PlayerStore;
    private unsubscribe: (() => void) | null = null;

    private readonly isMobileMql: MediaQueryList;
    private enabled = false;
    private open = false;

    private readonly playerBarRoot: HTMLElement | null;

    private sheet: HTMLElement | null;
    private contentEl: HTMLElement | null;
    private grabBtn: HTMLButtonElement | null;
    private closeEls: HTMLElement[];

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
    private shuffleInput: HTMLInputElement | null;
    private topbarShuffleInput: HTMLInputElement | null = null;
    private onTopbarShuffleChange: (() => void) | null = null;

    private lastArtUrl: string | null = null;
    private shareBusy = false;
    private libraryBusy = false;
    private scrollLocked = false;
    private scrollLockBodyStyle: Partial<CSSStyleDeclaration> | null = null;
    private scrollLockHtmlStyle: Partial<CSSStyleDeclaration> | null = null;

    // gesture state
    private barTouchStartY: number | null = null;
    private barTouchStartX: number | null = null;

    private dragStartY: number | null = null;
    private dragLastY: number | null = null;
    private dragging = false;
    private didDrag = false;

    constructor(opts: { root: HTMLElement; playerBarRoot?: HTMLElement | null; store: PlayerStore }) {
        this.root = opts.root;
        this.store = opts.store;
        this.playerBarRoot = opts.playerBarRoot ?? null;

        // Ensure fullscreen overlays are not constrained by any app container
        // (some browsers treat `position: fixed` as fixed-to-ancestor when inside
        // transformed/overflowed roots). We always mount to <body>.
        if (typeof document !== 'undefined' && this.root.parentElement !== document.body) {
            document.body.appendChild(this.root);
        }

        // Match the CSS mobile breakpoint used throughout webamp.css
        this.isMobileMql = window.matchMedia('(max-width: 820px)');

        this.sheet = this.root.querySelector<HTMLElement>('.wa-nowplaying__sheet');
        this.contentEl = this.root.querySelector<HTMLElement>('.wa-nowplaying__content');
        this.grabBtn = this.root.querySelector<HTMLButtonElement>('[data-wa-nowplaying-grab]');
        this.closeEls = Array.from(this.root.querySelectorAll<HTMLElement>('[data-wa-nowplaying-close]'));

        this.titleEl = this.root.querySelector<HTMLElement>('[data-wa-nowplaying-title]');
        this.artistEl = this.root.querySelector<HTMLElement>('[data-wa-nowplaying-artist]');
        this.artImg = this.root.querySelector<HTMLImageElement>('[data-wa-nowplaying-art]');
        this.toggleIconEl = this.root.querySelector<HTMLImageElement>('[data-wa-nowplaying-toggle-icon]');

        this.btnPrev = this.root.querySelector<HTMLButtonElement>('[data-wa-nowplaying-prev]');
        this.btnNext = this.root.querySelector<HTMLButtonElement>('[data-wa-nowplaying-next]');
        this.btnToggle = this.root.querySelector<HTMLButtonElement>('[data-wa-nowplaying-toggle]');
        this.btnMenu = this.root.querySelector<HTMLButtonElement>('[data-wa-nowplaying-menu]');

        this.timeCurrentEl = this.root.querySelector<HTMLElement>('[data-wa-nowplaying-time-current]');
        this.timeDurationEl = this.root.querySelector<HTMLElement>('[data-wa-nowplaying-time-duration]');
        this.scrubber = this.root.querySelector<HTMLInputElement>('[data-wa-nowplaying-scrubber]');

        this.shuffleInput = this.root.querySelector<HTMLInputElement>('[data-wa-nowplaying-shuffle]');

        this.bind();
    }

    private bind() {
        const syncEnabled = () => {
            const next = !!this.isMobileMql.matches;
            if (next === this.enabled) return;
            this.enabled = next;
            if (!this.enabled) {
                this.close();
            }
        };

        // Keep enabled state synced with viewport.
        const mql = this.isMobileMql as any;
        if (typeof mql.addEventListener === 'function') mql.addEventListener('change', syncEnabled);
        else this.isMobileMql.addListener(syncEnabled);
        syncEnabled();

        // Wire controls.
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

        // Shuffle toggle mirrors the topbar localStorage-backed pref.
        if (this.shuffleInput) {
            this.shuffleInput.checked = getShufflePref();
            const onShuffle = () => {
                setShuffleEnabled(!!this.shuffleInput?.checked, { markDirty: true });
            };
            this.shuffleInput.addEventListener('change', onShuffle);
        }

        // Keep now-playing shuffle synced when the topbar toggle changes.
        this.topbarShuffleInput = document.querySelector<HTMLInputElement>('[data-wa-action="shuffle-toggle"]');
        if (this.topbarShuffleInput && this.shuffleInput) {
            const syncFromTopbar = () => {
                const enabled = !!this.topbarShuffleInput?.checked;
                this.shuffleInput!.checked = enabled;
            };
            this.onTopbarShuffleChange = syncFromTopbar;
            this.topbarShuffleInput.addEventListener('change', syncFromTopbar);
        }

        // Close interactions.
        for (const el of this.closeEls) {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                this.close();
            });
        }

        // Player bar: tap or swipe up to open.
        if (this.playerBarRoot) {
            this.playerBarRoot.addEventListener('click', (e) => {
                if (!this.enabled) return;
                if (this.open) return;
                if (!this.canOpenFromEventTarget(e.target as HTMLElement | null)) return;
                if (!this.store.getState().track) return;
                this.openSheet();
            });

            this.playerBarRoot.addEventListener('touchstart', (e: TouchEvent) => {
                if (!this.enabled) return;
                if (this.open) return;
                if (!this.canOpenFromEventTarget(e.target as any)) return;
                const t = e.touches[0];
                if (!t) return;
                this.barTouchStartY = t.clientY;
                this.barTouchStartX = t.clientX;
            }, { passive: true });

            this.playerBarRoot.addEventListener('touchend', (e: TouchEvent) => {
                if (!this.enabled) return;
                if (this.open) return;
                if (this.barTouchStartY === null || this.barTouchStartX === null) return;
                const t = e.changedTouches[0];
                if (!t) return;
                const dy = t.clientY - this.barTouchStartY;
                const dx = t.clientX - this.barTouchStartX;
                this.barTouchStartY = null;
                this.barTouchStartX = null;

                // Swipe-up threshold; tolerate small horizontal movement.
                if (dy < -40 && Math.abs(dx) < 60) {
                    if (!this.store.getState().track) return;
                    this.openSheet();
                }
            }, { passive: true });
        }

        // Drag down to close (grab handle OR anywhere on the sheet), except when
        // the gesture begins on interactive controls (especially the scrubber).
        const canStartSheetDragFromTarget = (target: HTMLElement | null) => {
            if (!target) return true;
            // The grab handle is always allowed.
            if (target.closest('[data-wa-nowplaying-grab]')) return true;
            // Don't steal gestures from interactive controls / inputs.
            if (target.closest('button')) return false;
            if (target.closest('input')) return false;
            if (target.closest('a')) return false;
            // Also treat the shuffle toggle label as interactive.
            if (target.closest('.comp-toggle')) return false;
            // Never start drag-to-close from the scrubber area.
            if (target.closest('.wa-nowplaying__scrub')) return false;
            if (target.closest('[data-wa-nowplaying-scrubber]')) return false;
            // If the content is scrolled, let the user scroll back up before drag-to-close.
            const c = this.contentEl;
            if (c && c.scrollTop > 1) return false;
            return true;
        };

        const startDrag = (clientY: number, captureEl?: HTMLElement, pointerId?: number) => {
            this.dragging = true;
            this.didDrag = false;
            this.dragStartY = clientY;
            this.dragLastY = clientY;
            if (captureEl && typeof pointerId === 'number') {
                try { captureEl.setPointerCapture(pointerId); } catch { /* ignore */ }
            }
            this.setDragging(true);
        };

        const moveDrag = (clientY: number) => {
            if (!this.dragging || this.dragStartY === null) return;
            this.dragLastY = clientY;
            const dy = Math.max(0, clientY - this.dragStartY);
            if (dy > 6) this.didDrag = true;
            this.setSheetTranslateY(dy);
        };

        const endDrag = () => {
            if (!this.dragging || this.dragStartY === null || this.dragLastY === null) return;
            const dy = Math.max(0, this.dragLastY - this.dragStartY);
            this.dragging = false;
            this.dragStartY = null;
            this.dragLastY = null;
            this.setDragging(false);

            // If pulled down enough, close; else snap back open.
            if (dy > 90) this.close();
            else this.setSheetTranslateY(0);
        };

        // PointerEvents path (desktop + some mobile browsers)
        const onPointerDown = (e: PointerEvent) => {
            if (!this.enabled) return;
            if (!this.open) return;
            if (!canStartSheetDragFromTarget(e.target as HTMLElement | null)) return;
            e.preventDefault();
            e.stopPropagation();
            startDrag(e.clientY, e.currentTarget as HTMLElement, e.pointerId);
        };
        const onPointerMove = (e: PointerEvent) => {
            if (!this.dragging) return;
            e.preventDefault();
            e.stopPropagation();
            moveDrag(e.clientY);
        };
        const onPointerUp = (e: PointerEvent) => {
            if (!this.dragging) return;
            e.preventDefault();
            e.stopPropagation();
            endDrag();
        };

        this.grabBtn?.addEventListener('pointerdown', onPointerDown);
        this.grabBtn?.addEventListener('pointermove', onPointerMove);
        this.grabBtn?.addEventListener('pointerup', onPointerUp);
        this.grabBtn?.addEventListener('pointercancel', onPointerUp);
        // Tap grab handle closes (but a real drag should not be double-handled).
        this.grabBtn?.addEventListener('click', (e) => {
            if (!this.enabled) return;
            if (!this.open) return;
            e.preventDefault();
            e.stopPropagation();
            if (!this.didDrag) this.close();
        });

        // TouchEvents path (iOS Safari reliability)
        const onTouchStart = (e: TouchEvent) => {
            if (!this.enabled) return;
            if (!this.open) return;
            if (!canStartSheetDragFromTarget(e.target as HTMLElement | null)) return;
            const t = e.touches[0];
            if (!t) return;
            e.preventDefault();
            e.stopPropagation();
            startDrag(t.clientY);
        };
        const onTouchMove = (e: TouchEvent) => {
            if (!this.dragging) return;
            const t = e.touches[0];
            if (!t) return;
            e.preventDefault();
            e.stopPropagation();
            moveDrag(t.clientY);
        };
        const onTouchEnd = (e: TouchEvent) => {
            if (!this.dragging) return;
            e.preventDefault();
            e.stopPropagation();
            endDrag();
        };

        this.grabBtn?.addEventListener('touchstart', onTouchStart, { passive: false });
        this.grabBtn?.addEventListener('touchmove', onTouchMove, { passive: false });
        this.grabBtn?.addEventListener('touchend', onTouchEnd, { passive: false });
        this.grabBtn?.addEventListener('touchcancel', onTouchEnd, { passive: false });

        // Allow swipe-down starting anywhere on the sheet (except controls/scrubber).
        this.sheet?.addEventListener('pointerdown', onPointerDown);
        this.sheet?.addEventListener('pointermove', onPointerMove);
        this.sheet?.addEventListener('pointerup', onPointerUp);
        this.sheet?.addEventListener('pointercancel', onPointerUp);

        this.sheet?.addEventListener('touchstart', onTouchStart, { passive: false });
        this.sheet?.addEventListener('touchmove', onTouchMove, { passive: false });
        this.sheet?.addEventListener('touchend', onTouchEnd, { passive: false });
        this.sheet?.addEventListener('touchcancel', onTouchEnd, { passive: false });

        // Subscribe to state updates.
        this.unsubscribe = this.store.subscribe((state) => this.render(state));
    }

    private canOpenFromEventTarget(target: HTMLElement | null): boolean {
        if (!target) return true;
        // Don't open when interacting with actual controls.
        if (target.closest('button')) return false;
        if (target.closest('input')) return false;
        return true;
    }

    private openSheet() {
        this.open = true;
        document.documentElement.dataset.waNowPlayingOpen = 'true';
        document.body.dataset.waNowPlayingOpen = 'true';
        this.root.setAttribute('aria-hidden', 'false');
        this.lockScroll();
        this.setSheetTranslateY(0);
    }

    private close() {
        this.open = false;
        delete document.documentElement.dataset.waNowPlayingOpen;
        delete document.body.dataset.waNowPlayingOpen;
        this.root.setAttribute('aria-hidden', 'true');
        this.unlockScroll();
        this.setSheetTranslateY(0);
    }

    private lockScroll() {
        if (this.scrollLocked) return;
        this.scrollLocked = true;

        const html = document.documentElement.style;
        const b = document.body.style;
        this.scrollLockHtmlStyle = {
            overflow: html.overflow,
            overscrollBehavior: html.overscrollBehavior
        };
        this.scrollLockBodyStyle = {
            overflow: b.overflow,
            overscrollBehavior: b.overscrollBehavior
        };

        html.overflow = 'hidden';
        html.overscrollBehavior = 'none';
        b.overflow = 'hidden';
        b.overscrollBehavior = 'none';
    }

    private unlockScroll() {
        if (!this.scrollLocked) return;
        this.scrollLocked = false;

        const prevHtml = this.scrollLockHtmlStyle;
        const prev = this.scrollLockBodyStyle;
        this.scrollLockHtmlStyle = null;
        this.scrollLockBodyStyle = null;

        if (prevHtml) {
            const html = document.documentElement.style;
            html.overflow = prevHtml.overflow ?? '';
            html.overscrollBehavior = prevHtml.overscrollBehavior ?? '';
        }
        if (prev) {
            const b = document.body.style;
            b.overflow = prev.overflow ?? '';
            b.overscrollBehavior = prev.overscrollBehavior ?? '';
        }
    }

    private setDragging(isDragging: boolean) {
        if (!this.sheet) return;
        if (isDragging) this.sheet.classList.add('wa-nowplaying__sheet--dragging');
        else this.sheet.classList.remove('wa-nowplaying__sheet--dragging');
    }

    private setSheetTranslateY(px: number) {
        if (!this.sheet) return;
        // When open, allow temporary translate for drag.
        this.sheet.style.transform = px ? `translateY(${px}px)` : '';
    }

    destroy() {
        this.unsubscribe?.();
        this.unsubscribe = null;
        if (this.topbarShuffleInput && this.onTopbarShuffleChange) {
            this.topbarShuffleInput.removeEventListener('change', this.onTopbarShuffleChange);
        }
        this.onTopbarShuffleChange = null;
        this.topbarShuffleInput = null;
    }

    private render(state: PlayerState) {
        if (!this.enabled) return;

        const track = state.track;
        const duration = track?.durationSec ?? 0;
        const position = state.positionSec;

        if (!track && this.open) {
            this.close();
        }

        if (this.titleEl) this.titleEl.textContent = track?.title ?? 'Not Playing';
        if (this.artistEl) this.artistEl.textContent = track?.artist ?? '—';

        if (this.toggleIconEl) {
            const src = state.isPlaying
                ? indiumSvg('pause-filled.svg')
                : indiumSvg('play-filled.svg');
            if (this.toggleIconEl.getAttribute('src') !== src) {
                this.toggleIconEl.setAttribute('src', src);
            }
        }

        if (this.btnToggle) {
            if (state.isBusy) this.btnToggle.setAttribute('data-wa-busy', 'true');
            else this.btnToggle.removeAttribute('data-wa-busy');
        }

        if (this.btnMenu) {
            this.btnMenu.disabled = !track || this.shareBusy || this.libraryBusy;
        }

        if (this.timeCurrentEl) this.timeCurrentEl.textContent = formatTime(position);
        if (this.timeDurationEl) this.timeDurationEl.textContent = formatTime(duration);

        if (this.scrubber) {
            const ratio = duration ? (position / duration) : 0;
            this.scrubber.value = String(Math.max(0, Math.min(100, ratio * 100)));
        }

        if (this.artImg) {
            const baseUrl = track?.artUrlLarge ?? track?.artUrl ?? track?.artUrlSmall ?? null;
            const nextUrl = (track?.source === 'soundcloud' && baseUrl)
                ? upgradeSoundCloudArtworkUrl(baseUrl)
                : baseUrl;
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
