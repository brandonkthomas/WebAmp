import type { WebAmpViewController, WebAmpViewContext } from '../router/webAmpRouter';

let unsubscribeFromSource: (() => void) | null = null;

export const landingView: WebAmpViewController = {
    id: 'landing',
    mount(ctx: WebAmpViewContext) {
        const root = ctx.rootEl;
        const statusEl = root.querySelector<HTMLElement>('[data-wa-landing-status]');
        const connectBtn = root.querySelector<HTMLButtonElement>('[data-wa-action="spotify-connect"]');
        const continueBtn = root.querySelector<HTMLButtonElement>('[data-wa-action="continue"]');

        const setStatus = (text: string) => {
            if (statusEl) statusEl.textContent = text;
        };

        const musicSource = ctx.services.musicSource;
        if (!connectBtn) return;

        const syncUi = () => {
            const connected = musicSource?.getState().isConnected ?? false;
            if (continueBtn) continueBtn.disabled = !connected;
            setStatus(connected ? `${musicSource?.displayName ?? 'Spotify'} connected (stub)` : 'Not connected');
        };

        // Initial status
        syncUi();

        unsubscribeFromSource?.();
        unsubscribeFromSource = musicSource?.onChange(() => syncUi()) ?? null;

        connectBtn.addEventListener('click', async () => {
            if (!musicSource) {
                setStatus('Spotify source not configured');
                return;
            }

            connectBtn.disabled = true;
            setStatus('Connecting…');
            try {
                await musicSource.connect();
                syncUi();
            } finally {
                connectBtn.disabled = false;
            }
        });

        continueBtn?.addEventListener('click', () => {
            ctx.router.navigate('/webamp/home');
        });
    },
    unmount() {
        unsubscribeFromSource?.();
        unsubscribeFromSource = null;
    }
};
