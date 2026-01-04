import type { WebAmpViewController, WebAmpViewContext } from '../router/webAmpRouter';

export const albumView: WebAmpViewController = {
    id: 'album',
    mount(ctx: WebAmpViewContext) {
        const idEl = ctx.rootEl.querySelector<HTMLElement>('[data-wa-entity-id]');
        if (idEl) {
            idEl.textContent = ctx.entityId ?? '(all)';
        }

        const trackButtons = Array.from(ctx.rootEl.querySelectorAll<HTMLElement>('[data-wa-track]'));
        for (const btn of trackButtons) {
            btn.addEventListener('click', () => {
                const trackId = btn.getAttribute('data-wa-track') ?? '';
                window.dispatchEvent(new CustomEvent('wa:track:select', { detail: { trackId, from: 'album' } }));
            });
        }
    }
};
