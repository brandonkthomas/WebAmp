import { matchWebAmpRoute, WEBAMP_ROOT } from './routes';
import type { RouteMatch, ViewId } from './routes';
import type { MusicSource } from '../sources/musicSource';

/**
 * Optional services injected into views
 */
export interface WebAmpServices {
    musicSource?: MusicSource;
}

/**
 * Per-view mount context created by the router
 */
export interface WebAmpViewContext {
    viewId: ViewId;
    entityId?: string;
    rootEl: HTMLElement;
    router: WebAmpRouter;
    services: WebAmpServices;
}

/**
 * View controller contract used by `WebAmpRouter`
 */
export interface WebAmpViewController {
    id: ViewId;
    mount(ctx: WebAmpViewContext): void;
    unmount?(): void;
}

/**
 * Router-owned DOM handles + template map
 */
export interface WebAmpRouterDom {
    appRoot: HTMLElement;
    viewHost: HTMLElement;
    templates: Record<ViewId, HTMLTemplateElement>;
}

/**
 * Router configuration
 */
export interface WebAmpRouterOptions {
    root?: string;
    dom: WebAmpRouterDom;
    views: Record<ViewId, WebAmpViewController>;
    services?: WebAmpServices;
}

/**
 * Finds closest HTMLElement that has the given attribute
 */
function closestAttrEl(start: Element | null, attr: string): HTMLElement | null {
    if (!start) return null;
    const el = start.closest(`[${attr}]`);
    return el instanceof HTMLElement ? el : null;
}

/**
 * SPA-style router for WebAmp templates + controllers
 */
export class WebAmpRouter {
    private readonly root: string;
    private readonly dom: WebAmpRouterDom;
    private readonly views: Record<ViewId, WebAmpViewController>;
    private readonly services: WebAmpServices;

    private activeViewId: ViewId | null = null;
    private activeController: WebAmpViewController | null = null;

    constructor(opts: WebAmpRouterOptions) {
        this.root = opts.root ?? WEBAMP_ROOT;
        this.dom = opts.dom;
        this.views = opts.views;
        this.services = opts.services ?? {};
    }

    /**
     * Starts initial render, click interception, and popstate handling
     */
    start() {
        // Initial render (no push)
        this.syncToLocation(/* pushHistory */ false);

        // Intercept in-app navigation (anchors and buttons)
        document.addEventListener('click', (e) => {
            const target = e.target as Element | null;

            const navEl = closestAttrEl(target, 'data-wa-nav');
            if (navEl) {
                const href = navEl.getAttribute('href');
                if (href && href.startsWith(this.root)) {
                    e.preventDefault();
                    this.navigate(href);
                }
                return;
            }

            const navHrefEl = closestAttrEl(target, 'data-wa-nav-href');
            if (navHrefEl) {
                const href = navHrefEl.getAttribute('data-wa-nav-href');
                if (href && href.startsWith(this.root)) {
                    e.preventDefault();
                    this.navigate(href);
                }
            }
        });

        // Back/forward
        window.addEventListener('popstate', () => {
            this.syncToLocation(/* pushHistory */ false);
        });
    }

    /**
     * Navigates within the WebAmp app and renders the matched view
     */
    navigate(path: string) {
        const match = this.resolveGuard(matchWebAmpRoute(path));
        history.pushState({ wa: true, path: match.canonicalPath }, '', match.canonicalPath);
        this.render(match);
    }

    /**
     * Renders current location, optionally pushing history
     */
    private syncToLocation(pushHistory: boolean) {
        const match = this.resolveGuard(matchWebAmpRoute(window.location.pathname));
        if (pushHistory) {
            history.pushState({ wa: true, path: match.canonicalPath }, '', match.canonicalPath);
        } else {
            history.replaceState({ wa: true, path: match.canonicalPath }, '', match.canonicalPath);
        }
        this.render(match);
    }

    /**
     * Mounts a view from its template and calls controller lifecycle hooks
     */
    private render(match: RouteMatch) {
        const controller = this.views[match.view];
        const template = this.dom.templates[match.view];

        if (!controller || !template) {
            return;
        }

        // Unmount previous
        try {
            this.activeController?.unmount?.();
        } catch {
            // no-op
        }

        // Clear host
        this.dom.viewHost.replaceChildren();

        // Mount new view from template
        const mountWrap = document.createElement('div');
        mountWrap.className = 'wa-view-mount';
        mountWrap.appendChild(template.content.cloneNode(true));
        this.dom.viewHost.appendChild(mountWrap);
        this.animateViewMount(mountWrap);

        const viewRoot =
            mountWrap.querySelector<HTMLElement>(`[data-wa-view="${match.view}"]`) ?? mountWrap;

        this.activeViewId = match.view;
        this.activeController = controller;

        this.updateAppChrome(match);
        this.updateActiveNav(match.view);
        this.updateTitle(match);

        controller.mount({
            viewId: match.view,
            entityId: match.entityId,
            rootEl: viewRoot,
            router: this,
            services: this.services
        });

        // Keep navigation snappy: jump to top of content on route change.
        this.dom.appRoot.scrollIntoView({ block: 'start' });
    }

    /**
     * Applies a scale/blur/opacity "enter" animation to the active view mount
     * BT 2026-01-07: mirrored styling from Portfolio homepage views
     */
    private animateViewMount(el: HTMLElement) {
        el.classList.add('wa-view-mount--initial');

        requestAnimationFrame(() => {
            el.classList.remove('wa-view-mount--initial');
            el.classList.add('wa-view-mount--enter');

            window.setTimeout(() => {
                el.classList.remove('wa-view-mount--enter');
            }, 220);
        });
    }

    /**
     * Auth guard enforcing landing-only when not connected
     */
    private resolveGuard(match: RouteMatch): RouteMatch {
        const musicSource = this.services.musicSource;
        const authed = musicSource?.getState().isConnected ?? false;

        // Only show landing when not authenticated.
        if (!authed && match.view !== 'landing') {
            return matchWebAmpRoute(WEBAMP_ROOT);
        }

        // If authenticated, landing should not be reachable.
        if (authed && match.view === 'landing') {
            return matchWebAmpRoute(`${WEBAMP_ROOT}/home`);
        }

        return match;
    }

    /**
     * Updates app-level dataset and global header bits
     */
    private updateAppChrome(match: RouteMatch) {
        const musicSource = this.services.musicSource;
        const authed = musicSource?.getState().isConnected ?? false;
        this.dom.appRoot.dataset.waView = match.view;
        this.dom.appRoot.dataset.waAuth = authed ? 'true' : 'false';

        const topbarTitle = document.querySelector<HTMLElement>('[data-wa-topbar-title]');
        if (topbarTitle) {
            topbarTitle.textContent =
                match.view === 'home' ? 'Home' :
                match.view === 'search' ? 'Search' :
                match.view === 'liked' ? 'Liked Songs' :
                match.view === 'playlist' ? 'Playlists' :
                match.view === 'album' ? 'Albums' :
                match.view === 'artist' ? 'Artists' :
                'WebAmp';
        }

        const statusEl = document.querySelector<HTMLElement>('[data-wa-auth-status]');
        if (statusEl) {
            statusEl.textContent = authed ? `${musicSource?.displayName ?? 'Spotify'} connected` : 'Not connected';
        }
    }

    /**
     * Sets `data-wa-active` on nav items matching the current view id
     */
    private updateActiveNav(viewId: ViewId) {
        const links = Array.from(document.querySelectorAll<HTMLElement>('[data-wa-nav]'));
        for (const el of links) {
            const isActive = el.getAttribute('data-wa-nav') === viewId;
            if (isActive) {
                el.setAttribute('data-wa-active', 'true');
            } else {
                el.removeAttribute('data-wa-active');
            }
        }
    }

    /**
     * Updates `document.title` based on view + optional entity id
     */
    private updateTitle(match: RouteMatch) {
        const base = 'WebAmp';
        const suffix =
            match.view === 'landing' ? 'Landing' :
            match.view === 'home' ? 'Home' :
            match.view === 'search' ? 'Search' :
            match.view === 'liked' ? 'Liked Songs' :
            match.view === 'playlist' ? 'Playlist' :
            match.view === 'album' ? 'Album' :
            match.view === 'artist' ? 'Artist' :
            '';

        const withId = match.entityId ? `${suffix} • ${match.entityId}` : suffix;
        document.title = withId ? `${base} — ${withId}` : base;
    }
}
