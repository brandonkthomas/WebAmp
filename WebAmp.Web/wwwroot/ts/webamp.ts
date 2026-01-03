/**
 * webamp.ts
 * Entry point for the WebAmp player UI.
 *
 * For now this is a lightweight shell that:
 *  - Wires up basic responsive behavior between the fullscreen now playing view (mobile)
 *    and the desktop mini player.
 *  - Provides a single place to initialize future Spotify / Apple Music integrations
 *    and the Winamp skin engine.
 */

class WebAmpApp {
    private nowPlayingEl: HTMLElement | null;
    private miniPlayerEl: HTMLElement | null;
    private resizeHandler: (() => void) | null;

    constructor() {
        this.nowPlayingEl = null;
        this.miniPlayerEl = null;
        this.resizeHandler = null;
        this.init();
    }

    //==============================================================================================
    /**
     * Initialize the WebAmp shell once the DOM is ready.
     */
    private init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setup());
        } else {
            this.setup();
        }
    }

    //==============================================================================================
    /**
     * Find core DOM elements and wire up basic responsive layout.
     */
    private setup() {
        this.nowPlayingEl = document.getElementById('wa-nowplaying');
        this.miniPlayerEl = document.getElementById('wa-mini-player');

        if (!this.nowPlayingEl || !this.miniPlayerEl) {
            // Nothing to do if the shell isn't present.
            return;
        }

        this.applyLayoutMode();
        this.bindResize();
    }

    //==============================================================================================
    /**
     * Detect viewport size and toggle layout modes.
     *
     * - On narrow/mobile viewports, emphasize the fullscreen now playing experience.
     * - On wider/desktop viewports, emphasize the mini player while keeping now playing visible.
     */
    private applyLayoutMode() {
        if (!this.nowPlayingEl || !this.miniPlayerEl) {
            return;
        }

        const isMobile = window.matchMedia('(max-width: 768px)').matches;

        if (isMobile) {
            this.nowPlayingEl.dataset.mode = 'mobile-fullscreen';
            this.miniPlayerEl.dataset.mode = 'mobile-secondary';
        } else {
            this.nowPlayingEl.dataset.mode = 'desktop-secondary';
            this.miniPlayerEl.dataset.mode = 'desktop-miniplayer';
        }
    }

    //==============================================================================================
    /**
     * Recompute layout mode on resize (throttled via requestAnimationFrame).
     */
    private bindResize() {
        let rafId: number | null = null;

        this.resizeHandler = () => {
            if (rafId !== null) return;
            rafId = window.requestAnimationFrame(() => {
                rafId = null;
                this.applyLayoutMode();
            });
        };

        window.addEventListener('resize', this.resizeHandler);
    }
}

// Initialize once per page.
new WebAmpApp();
