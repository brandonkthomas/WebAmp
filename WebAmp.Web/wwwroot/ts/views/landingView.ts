import type { WebAmpViewController, WebAmpViewContext } from '../router/webAmpRouter';
import { createGradNoiseCanvas } from '../../../../../Portfolio/wwwroot/ts/components/gradNoiseCanvas';

let unsubscribeFromSource: (() => void) | null = null;
let gradNoiseCanvas: { destroy: () => void } | null = null;
let landingBgHost: HTMLElement | null = null;

const LANDING_BG_ATTR = 'data-wa-landing-bg';
const LANDING_BG_CANVAS_ID = 'wa-landing-gnc';

function destroyLandingBackground() {
    gradNoiseCanvas?.destroy();
    gradNoiseCanvas = null;
    (window as any).gradNoiseCanvasInstance = null;

    landingBgHost?.remove();
    landingBgHost = null;
}

export const landingView: WebAmpViewController = {
    id: 'landing',
    mount(ctx: WebAmpViewContext) {
        const root = ctx.rootEl;
        const appRoot = document.querySelector<HTMLElement>('[data-wa-app]');
        const statusEl = root.querySelector<HTMLElement>('[data-wa-landing-status]');
        const connectBtn = root.querySelector<HTMLButtonElement>('[data-wa-action="spotify-connect"]');
        const continueBtn = root.querySelector<HTMLButtonElement>('[data-wa-action="continue"]');
        const soundcloudBtn = root.querySelector<HTMLButtonElement>('[data-wa-action="soundcloud-enter"]');

        const setStatus = (text: string) => {
            if (statusEl) statusEl.textContent = text;
        };

        const spotifySource = ctx.services.musicSource;
        const soundCloudSource = ctx.services.soundCloudSource;

        // Landing-only animated root backdrop. Keep it fully outside shell/content
        // constraints and remove it entirely when landing unmounts.
        destroyLandingBackground();
        if (appRoot) {
            const stale = appRoot.querySelector<HTMLElement>(`[${LANDING_BG_ATTR}]`);
            stale?.remove();

            const host = document.createElement('div');
            host.className = 'gnc-container wa-app__landing-bg';
            host.setAttribute(LANDING_BG_ATTR, 'true');
            host.setAttribute('aria-hidden', 'true');

            const canvas = document.createElement('canvas');
            canvas.id = LANDING_BG_CANVAS_ID;
            host.appendChild(canvas);

            appRoot.prepend(host);
            landingBgHost = host;

            gradNoiseCanvas = createGradNoiseCanvas(canvas);
            (window as any).gradNoiseCanvasInstance = gradNoiseCanvas;
        }

        const syncUi = () => {
            const spotifyConnected = spotifySource?.getState().isConnected ?? false;
            const scConnected = soundCloudSource?.getState().isConnected ?? false;
            const connected = spotifyConnected || scConnected;
            if (continueBtn) continueBtn.disabled = !connected;
            if (spotifyConnected && scConnected) {
                setStatus('Spotify and SoundCloud connected');
            } else if (spotifyConnected) {
                setStatus('Spotify connected');
            } else if (scConnected) {
                setStatus('SoundCloud connected');
            } else {
                setStatus('Not connected');
            }
        };

        // Initial status
        syncUi();

        if (!connectBtn) return;

        unsubscribeFromSource?.();
        // Keep landing status in sync with Spotify connection; SoundCloud state is
        // rarer to change during landing, so a single sync is fine.
        unsubscribeFromSource = spotifySource?.onChange(() => syncUi()) ?? null;

        connectBtn.addEventListener('click', () => {
            if (!spotifySource) {
                setStatus('Spotify source not configured');
                return;
            }

            connectBtn.disabled = true;
            setStatus('Connecting…');
            try {
                // OAuth flow will redirect the page; do not await.
                void spotifySource.connect();
            } finally {
                connectBtn.disabled = false;
            }
        });

        continueBtn?.addEventListener('click', () => {
            ctx.router.navigate('/webamp/home');
        });

        // SoundCloud path: start Authorization Code + PKCE flow.
        soundcloudBtn?.addEventListener('click', () => {
            if (!soundCloudSource) {
                setStatus('SoundCloud source not configured');
                return;
            }
            try {
                void soundCloudSource.connect();
            } catch {
                // Best-effort; any navigation errors will surface via dialogs.
            }
        });
    },
    unmount() {
        unsubscribeFromSource?.();
        unsubscribeFromSource = null;
        destroyLandingBackground();
    }
};
