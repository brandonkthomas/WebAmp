import type { PlayerState } from '../../state/playerStore';
import type { PlayerStore } from '../../state/playerStore';

function formatTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
}

export class PlayerBar {
    private readonly root: HTMLElement;
    private readonly store: PlayerStore;
    private unsubscribe: (() => void) | null = null;

    private titleEl: HTMLElement | null;
    private artistEl: HTMLElement | null;
    private artImg: HTMLImageElement | null;
    private toggleIconEl: HTMLElement | null;
    private btnPrev: HTMLButtonElement | null;
    private btnNext: HTMLButtonElement | null;
    private btnToggle: HTMLButtonElement | null;
    private timeCurrentEl: HTMLElement | null;
    private timeDurationEl: HTMLElement | null;
    private scrubber: HTMLInputElement | null;

    constructor(opts: { root: HTMLElement; store: PlayerStore }) {
        this.root = opts.root;
        this.store = opts.store;

        this.titleEl = this.root.querySelector<HTMLElement>('[data-wa-player-title]');
        this.artistEl = this.root.querySelector<HTMLElement>('[data-wa-player-artist]');
        this.artImg = this.root.querySelector<HTMLImageElement>('[data-wa-player-art]');
        this.toggleIconEl = this.root.querySelector<HTMLElement>('[data-wa-player-toggle-icon]');

        this.btnPrev = this.root.querySelector<HTMLButtonElement>('[data-wa-player-prev]');
        this.btnNext = this.root.querySelector<HTMLButtonElement>('[data-wa-player-next]');
        this.btnToggle = this.root.querySelector<HTMLButtonElement>('[data-wa-player-toggle]');
        this.timeCurrentEl = this.root.querySelector<HTMLElement>('[data-wa-player-time-current]');
        this.timeDurationEl = this.root.querySelector<HTMLElement>('[data-wa-player-time-duration]');
        this.scrubber = this.root.querySelector<HTMLInputElement>('[data-wa-player-scrubber]');

        this.bind();
    }

    private bind() {
        this.btnPrev?.addEventListener('click', () => this.store.prev());
        this.btnNext?.addEventListener('click', () => this.store.next());
        this.btnToggle?.addEventListener('click', () => this.store.togglePlay());

        this.scrubber?.addEventListener('input', () => {
            const state = this.store.getState();
            const duration = state.track?.durationSec ?? 0;
            if (!duration) return;
            const value = Number(this.scrubber?.value ?? 0);
            this.store.seekByRatio(value / 100);
        });

        this.unsubscribe = this.store.subscribe((state) => this.render(state));
    }

    destroy() {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    private render(state: PlayerState) {
        const track = state.track;
        const duration = track?.durationSec ?? 0;
        const position = state.positionSec;

        if (this.titleEl) this.titleEl.textContent = track?.title ?? 'Nothing playing';
        if (this.artistEl) this.artistEl.textContent = track?.artist ?? '—';

        if (this.toggleIconEl) {
            this.toggleIconEl.textContent = state.isPlaying ? '⏸' : '▶';
        }

        if (this.timeCurrentEl) this.timeCurrentEl.textContent = formatTime(position);
        if (this.timeDurationEl) this.timeDurationEl.textContent = formatTime(duration);

        if (this.scrubber) {
            const ratio = duration ? (position / duration) : 0;
            this.scrubber.value = String(Math.max(0, Math.min(100, ratio * 100)));
        }

        if (this.artImg) {
            if (track?.artUrl) {
                this.artImg.src = track.artUrl;
                this.artImg.style.display = 'block';
            } else {
                this.artImg.removeAttribute('src');
                this.artImg.style.display = 'none';
            }
        }
    }
}
