import type { WebAmpViewController, WebAmpViewContext } from '../router/webAmpRouter';

export const homeView: WebAmpViewController = {
    id: 'home',
    mount(_ctx: WebAmpViewContext) {
        // Home is currently static scaffolding; navigation is handled by the router click interceptor.
    }
};
