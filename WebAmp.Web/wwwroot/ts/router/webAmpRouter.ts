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
    /**
     * Returns a human-friendly label for a given view id, usually sourced from nav text.
     */
    getViewLabel: (viewId: ViewId) => string;
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

interface WebAmpBreadcrumb {
    label: string;
    path?: string;
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
    private lastMatch: RouteMatch | null = null;

    // In-app history tracking so we can enable/disable back/forward buttons.
    private historyStack: string[] = [];
    private historyIndex = 0;

    // Optional per-view breadcrumb override set by controllers.
    private customBreadcrumbs: WebAmpBreadcrumb[] | null = null;

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

        // Intercept in-app navigation (anchors, buttons, and header nav controls)
        document.addEventListener('click', (e) => {
            const target = e.target as Element | null;

            const backBtn = closestAttrEl(target, 'data-wa-nav-back');
            if (backBtn) {
                e.preventDefault();
                window.history.back();
                return;
            }

            const fwdBtn = closestAttrEl(target, 'data-wa-nav-forward');
            if (fwdBtn) {
                e.preventDefault();
                window.history.forward();
                return;
            }

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

        // Back/forward (keep internal stack in sync so we can toggle header buttons)
        window.addEventListener('popstate', (e) => {
            const state = (e.state ?? {}) as any;

            if (state?.wa === true && typeof state.waIndex === 'number') {
                this.historyIndex = state.waIndex;
                const path = state.path ?? window.location.pathname;
                if (!this.historyStack.length) {
                    this.historyStack = [path];
                } else {
                    this.historyStack[this.historyIndex] = path;
                }
            } else {
                const path = window.location.pathname;
                const idx = this.historyStack.lastIndexOf(path);
                if (idx >= 0) {
                    this.historyIndex = idx;
                }
            }

            this.syncToLocation(/* pushHistory */ false);
        });
    }

    /**
     * Navigates within the WebAmp app and renders the matched view
     */
    navigate(path: string) {
        const match = this.resolveGuard(matchWebAmpRoute(path));
        // Update in-memory history for back/forward button disabling.
        if (!this.historyStack.length) {
            this.historyStack = [match.canonicalPath];
            this.historyIndex = 0;
            history.replaceState({ wa: true, path: match.canonicalPath, waIndex: this.historyIndex }, '', match.canonicalPath);
        } else {
            // Navigating forward from the middle of the stack should drop any "future" entries.
            this.historyStack = this.historyStack.slice(0, this.historyIndex + 1);
            this.historyStack.push(match.canonicalPath);
            this.historyIndex = this.historyStack.length - 1;
            history.pushState({ wa: true, path: match.canonicalPath, waIndex: this.historyIndex }, '', match.canonicalPath);
        }
        this.render(match);
        this.updateHistoryButtons();
    }

    /**
     * Renders current location, optionally pushing history
     */
    private syncToLocation(pushHistory: boolean) {
        const match = this.resolveGuard(matchWebAmpRoute(window.location.pathname));
        // Seed or update internal stack from the normalized canonical path.
        if (!this.historyStack.length) {
            this.historyStack = [match.canonicalPath];
            this.historyIndex = 0;
        } else if (pushHistory) {
            this.historyStack = this.historyStack.slice(0, this.historyIndex + 1);
            this.historyStack.push(match.canonicalPath);
            this.historyIndex = this.historyStack.length - 1;
        } else {
            this.historyStack[this.historyIndex] = match.canonicalPath;
        }

        if (pushHistory) {
            history.pushState({ wa: true, path: match.canonicalPath, waIndex: this.historyIndex }, '', match.canonicalPath);
        } else {
            history.replaceState({ wa: true, path: match.canonicalPath, waIndex: this.historyIndex }, '', match.canonicalPath);
        }

        this.render(match);
        this.updateHistoryButtons();
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

        // Reset any per-view overrides and cache current route match.
        this.customBreadcrumbs = null;
        this.lastMatch = match;

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
        this.updateBreadcrumbs(match);

        controller.mount({
            viewId: match.view,
            entityId: match.entityId,
            rootEl: viewRoot,
            router: this,
            services: this.services,
            getViewLabel: (viewId: ViewId) => this.getViewLabel(viewId)
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
                match.view === 'landing' ? 'WebAmp' : this.getViewLabel(match.view);
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
            match.view === 'landing' ? 'Landing' : this.getViewLabel(match.view);

        const withId = match.entityId ? `${suffix} • ${match.entityId}` : suffix;
        document.title = withId ? `${base} — ${withId}` : base;
    }

    /**
     * Public hook for views to override the default breadcrumb trail for the active route.
     */
    setBreadcrumbs(crumbs: WebAmpBreadcrumb[] | null) {
        this.customBreadcrumbs = crumbs;
        if (this.lastMatch) {
            this.updateBreadcrumbs(this.lastMatch);
        }
    }

    /**
     * Renders breadcrumb trail above the view title when a breadcrumbs host is present
     */
    private updateBreadcrumbs(match: RouteMatch) {
        const container = this.dom.viewHost.querySelector<HTMLElement>('[data-wa-breadcrumbs]');
        if (!container) return;

        const crumbs = this.customBreadcrumbs ?? this.buildBreadcrumbs(match);
        container.replaceChildren();

        if (!crumbs.length) {
            container.style.display = 'none';
            return;
        }

        container.style.display = '';

        crumbs.forEach((crumb, index) => {
            const isLast = index === crumbs.length - 1;

            if (index > 0) {
                const sep = document.createElement('span');
                sep.className = 'wa-breadcrumbs__sep';
                sep.textContent = '›';
                container.appendChild(sep);
            }

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = crumb.label;
            btn.className = 'wa-breadcrumbs__item';

            if (isLast || !crumb.path) {
                btn.classList.add('wa-breadcrumbs__item--current');
                btn.disabled = true;
                btn.setAttribute('aria-current', 'page');
            } else {
                btn.classList.add('wa-breadcrumbs__item--link');
                btn.addEventListener('click', () => {
                    this.navigate(crumb.path!);
                });
            }

            container.appendChild(btn);
        });
    }

    /**
     * Builds logical breadcrumbs from the current route
     */
    private buildBreadcrumbs(match: RouteMatch): WebAmpBreadcrumb[] {
        const crumbs: WebAmpBreadcrumb[] = [];

        // No breadcrumbs on landing page.
        if (match.view === 'landing') {
            return crumbs;
        }

        const label = this.getViewLabel(match.view);

        // Simple default: use the view label as a single root crumb.
        // Detail pages can override this via `setBreadcrumbs` once they know entity names.
        crumbs.push({ label, path: match.canonicalPath });

        return crumbs;
    }

    /**
     * Enables/disables header back/forward buttons based on internal stack position
     */
    private updateHistoryButtons() {
        const canBack = this.historyIndex > 0;
        const canForward = this.historyIndex < this.historyStack.length - 1;

        const backBtns = document.querySelectorAll<HTMLButtonElement>('[data-wa-nav-back]');
        backBtns.forEach((btn) => {
            btn.disabled = !canBack;
        });

        const fwdBtns = document.querySelectorAll<HTMLButtonElement>('[data-wa-nav-forward]');
        fwdBtns.forEach((btn) => {
            btn.disabled = !canForward;
        });
    }

    /**
     * Derives a human-friendly label for a given view id using existing nav text where possible.
     * This keeps things flexible for other music services that reuse the router.
     */
    private getViewLabel(view: ViewId): string {
        // Prefer sidebar label text (e.g., Home, Search, Liked Songs, Playlists, Albums, Artists)
        const sideLabel =
            document
                .querySelector<HTMLElement>(`.wa-sidenav__link[data-wa-nav="${view}"] .wa-sidenav__label`)
                ?.textContent?.trim();

        if (sideLabel) {
            return sideLabel;
        }

        // Fallback to top nav text if present (e.g., Landing, Home, Playlists, Albums, Artists)
        const topLabel =
            document
                .querySelector<HTMLElement>(`.wa-topnav__links [data-wa-nav="${view}"]`)
                ?.textContent?.trim();

        if (topLabel) {
            return topLabel;
        }

        // Final defensive fallback: simple title-cased id.
        return view.charAt(0).toUpperCase() + view.slice(1);
    }
}
