import type { WebAmpViewController, WebAmpViewContext } from '../router/webAmpRouter';

let unsubscribeFromSource: (() => void) | null = null;

export const landingView: WebAmpViewController = {
    id: 'landing',
    mount(ctx: WebAmpViewContext) {
        const root = ctx.rootEl;
        const statusEl = root.querySelector<HTMLElement>('[data-wa-landing-status]');
        const connectBtn = root.querySelector<HTMLButtonElement>('[data-wa-action="spotify-connect"]');
        const continueBtn = root.querySelector<HTMLButtonElement>('[data-wa-action="continue"]');
        const soundcloudBtn = root.querySelector<HTMLButtonElement>('[data-wa-action="soundcloud-enter"]');

        const setStatus = (text: string) => {
            if (statusEl) statusEl.textContent = text;
        };

        const spotifySource = ctx.services.musicSource;
        const soundCloudSource = ctx.services.soundCloudSource;
        if (!connectBtn) return;

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
    }
};
