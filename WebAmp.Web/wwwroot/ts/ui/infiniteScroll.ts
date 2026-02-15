import { logEvent } from '../../../../../Portfolio/wwwroot/ts/common';

/**
 * Handle returned by `attachInfiniteScroll`
 */
export interface InfiniteScrollController {
    destroy(): void;
}

function isDebugScrollEnabled(): boolean {
    try {
        const qs = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        if (qs?.get('waDebugScroll') === '1') return true;
    } catch {
        // ignore
    }
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem('waDebugScroll') === '1';
    } catch {
        return false;
    }
}

function debugLog(enabled: boolean, list: string, event: string, data?: any) {
    if (!enabled) return;
    try {
        const payload = data ? JSON.parse(JSON.stringify(data)) : undefined;
        // eslint-disable-next-line no-console
        console.log(`[wa:scroll] ${list} :: ${event}`, payload ?? '');
    } catch {
        // eslint-disable-next-line no-console
        console.log(`[wa:scroll] ${list} :: ${event}`, data ?? '');
    }
}

function getListLabel(el: HTMLElement): string {
    return el.getAttribute('aria-label') || el.getAttribute('data-wa-view') || el.getAttribute('data-wa-list') || el.className || 'list';
}

function findScrollParent(el: HTMLElement): Element | null {
    let cur: HTMLElement | null = el.parentElement;
    while (cur) {
        const style = getComputedStyle(cur);
        const overflow = `${style.overflow} ${style.overflowY} ${style.overflowX}`;
        if (/(auto|scroll|overlay)/.test(overflow)) return cur;
        cur = cur.parentElement;
    }
    return null;
}

function normalizeRoot(root: Element | null): Element | null {
    // iOS Safari often scrolls the documentElement even when body has overflow rules.
    // Using root=null (viewport) is the most reliable default for document scrolling.
    if (!root) return null;
    try {
        if (root === document.body || root === document.documentElement) return null;
    } catch {
        // ignore
    }
    return root;
}

function parseRootMarginBottomPx(rootMargin: string): number {
    // We only need the bottom margin for our "manual check" fallback.
    // Supports strings like "600px 0px" or "0px 0px 200px 0px".
    const parts = rootMargin.trim().split(/\s+/).filter(Boolean);
    const getPx = (s: string | undefined) => {
        if (!s) return 0;
        const m = s.match(/^(-?\d+(?:\.\d+)?)px$/);
        return m ? Number(m[1]) : 0;
    };
    if (parts.length === 1) return getPx(parts[0]);
    if (parts.length === 2) return getPx(parts[0]); // vertical horizontal
    if (parts.length === 3) return getPx(parts[2]); // top horizontal bottom
    if (parts.length >= 4) return getPx(parts[2]); // top right bottom left
    return 0;
}

function pickRoot(listEl: HTMLElement, explicitRoot?: Element | null): Element | null {
    if (explicitRoot !== undefined) return normalizeRoot(explicitRoot);

    // WebAmp layout rule:
    // - Desktop (>=821px): `.wa-content` is the scroll container (body is overflow:hidden)
    // - Mobile (<=820px): the document/viewport scrolls
    try {
        const isDesktop = typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia('(min-width: 821px)').matches;

        if (!isDesktop) return null;

        const waContent = document.querySelector<HTMLElement>('.wa-content');
        if (waContent && waContent.contains(listEl)) return waContent;
    } catch {
        // ignore and fall back
    }

    return normalizeRoot(findScrollParent(listEl));
}

/**
 * Attaches an IntersectionObserver sentinel after `listEl` and calls `loadMore` when visible
 * Keeps sentinel as a sibling so callers can `replaceChildren()` on the list without breaking the observer
 */
export function attachInfiniteScroll(opts: {
    /** The scroll container element that contains the list items */
    listEl: HTMLElement;
    /** Called when we need to load the next page */
    loadMore: () => Promise<void> | void;
    /** Whether there is more data to load */
    hasMore: () => boolean;
    /** Whether a load is currently in flight */
    isLoading: () => boolean;
    /** Optional UI hook to show a loading row */
    renderSentinel?: (el: HTMLElement, state: { hasMore: boolean; isLoading: boolean }) => void;
    root?: Element | null;
    rootMargin?: string;
}): InfiniteScrollController {
    const debug = isDebugScrollEnabled();
    const sentinel = document.createElement('div');
    sentinel.className = 'wa-infinite-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    // Insert as a sibling right after the list so callers can freely replaceChildren() on listEl
    // without destroying the observer target.
    opts.listEl.insertAdjacentElement('afterend', sentinel);

    const listLabel = getListLabel(opts.listEl);
    debugLog(debug, listLabel, 'attach', {
        listTag: opts.listEl.tagName,
        listClass: opts.listEl.className,
        listId: opts.listEl.id || null,
        listParent: opts.listEl.parentElement?.className ?? null,
        sentinelParent: sentinel.parentElement?.className ?? null
    });

    const render = () => {
        const state = { hasMore: opts.hasMore(), isLoading: opts.isLoading() };
        if (opts.renderSentinel) {
            opts.renderSentinel(sentinel, state);
            return;
        }
        // Default: show throbber while loading, otherwise keep sentinel visible but minimal for IntersectionObserver.
        // Keep sentinel always visible (not display:none) so IntersectionObserver can detect it.
        if (state.isLoading) {
            sentinel.style.display = 'flex';
            sentinel.style.justifyContent = 'center';
            sentinel.style.padding = '0.75rem 0 0.25rem';
            sentinel.style.minHeight = 'auto';
            // Use Portfolio's throbber SVG (served from root /assets path)
            sentinel.innerHTML = `<img class="wa-throbber" src="/assets/svg/throbber-ring-indef.svg" alt="" />`;
        } else {
            // Keep sentinel visible but minimal so IntersectionObserver can still detect it
            sentinel.style.display = 'block';
            sentinel.style.minHeight = '1px';
            sentinel.style.padding = '0';
            sentinel.innerHTML = '';
        }
    };
    render();

    const rootRaw = opts.root !== undefined ? opts.root : findScrollParent(opts.listEl);
    const root = pickRoot(opts.listEl, opts.root);
    const rootMargin = opts.rootMargin ?? (root ? '200px 0px' : '600px 0px');
    const rootMarginBottomPx = parseRootMarginBottomPx(rootMargin);

    logEvent('WebAmp', 'scroll:init', {
        list: listLabel,
        hasRoot: !!root,
        rootMargin,
        rootTag: root ? ((root as any).tagName ?? '?') : null,
        rootId: root ? (((root as any).id as string) || null) : null,
        rootClass: root ? (((root as any).className as string) || null) : null,
        // capture what the heuristic initially found (helps debug mobile issues)
        rootRawTag: rootRaw ? ((rootRaw as any).tagName ?? '?') : null,
        rootRawId: rootRaw ? (((rootRaw as any).id as string) || null) : null,
        rootRawClass: rootRaw ? (((rootRaw as any).className as string) || null) : null
    });
    debugLog(debug, listLabel, 'init', {
        rootRaw: rootRaw
            ? { tag: (rootRaw as any).tagName, class: (rootRaw as any).className ?? null, id: (rootRaw as any).id ?? null }
            : null,
        root: root
            ? { tag: (root as any).tagName, class: (root as any).className ?? null, id: (root as any).id ?? null }
            : null,
        rootMargin,
        rootMarginBottomPx
    });

    const getScrollContainer = (): HTMLElement => {
        try {
            if (root && (root as any).scrollTop !== undefined) return root as any as HTMLElement;
        } catch {
            // ignore
        }
        return (document.scrollingElement as HTMLElement) || document.documentElement;
    };

    const isScrollable = (): boolean => {
        const c = getScrollContainer();
        // "Scrollable" means there's enough content to actually scroll.
        return c.scrollHeight > c.clientHeight + 40;
    };

    // Auto-fill: On mobile, some lists initially don't overflow, so the sentinel is visible immediately.
    // We want at most a couple extra pages to make the list scrollable, not to fetch the user's entire library.
    let autoFillBudget = 2;

    let pendingWhileLoading = false;
    let scrollRaf: number | null = null;
    let lastScrollLogMs = 0;

    const triggerLoadMore = (reason: string) => {
        if (!opts.hasMore()) return;
        if (opts.isLoading()) return;
        const hasMoreAtStart = opts.hasMore();
        debugLog(debug, listLabel, 'load:trigger', { reason, hasMore: hasMoreAtStart });
        logEvent('WebAmp', 'scroll:load', { list: listLabel, hasMore: hasMoreAtStart, reason });

        const loadPromise = Promise.resolve(opts.loadMore());
        render();
        queueMicrotask(() => render());
        loadPromise.finally(() => {
            requestAnimationFrame(() => {
                render();
                // If we observed an intersect while loading (and therefore could not start a request),
                // try once more after the load settles.
                if (pendingWhileLoading) {
                    pendingWhileLoading = false;
                    // Only re-trigger if we're still near the bottom.
                    maybeLoadMoreByScrollPosition('pending');
                }

                // Auto-fill only until the container becomes scrollable (and only up to a small budget).
                if (autoFillBudget > 0 && !isScrollable()) {
                    autoFillBudget--;
                    debugLog(debug, listLabel, 'autofill', { remaining: autoFillBudget });
                    triggerLoadMore('autofill');
                }
            });
            const hasMoreAtEnd = opts.hasMore();
            debugLog(debug, listLabel, 'load:done', { hasMore: hasMoreAtEnd, pendingWhileLoading, autoFillBudget });
            logEvent('WebAmp', 'scroll:done', { list: listLabel, hasMore: hasMoreAtEnd });
        });
    };

    const maybeLoadMoreByScrollPosition = (reason: string) => {
        if (!opts.hasMore()) return;
        if (opts.isLoading()) return;
        const c = getScrollContainer();
        const scrollTop = c.scrollTop ?? window.scrollY ?? 0;
        const clientHeight = c.clientHeight ?? window.innerHeight ?? 0;
        const scrollHeight = c.scrollHeight ?? 0;
        const distToBottom = scrollHeight - (scrollTop + clientHeight);
        const threshold = Math.max(220, rootMarginBottomPx);
        const now = performance.now();
        if (debug && now - lastScrollLogMs > 750) {
            lastScrollLogMs = now;
            debugLog(debug, listLabel, 'scroll:check', {
                reason,
                scrollEl: { tag: c.tagName, id: c.id || null, class: c.className || null },
                scrollTop,
                clientHeight,
                scrollHeight,
                distToBottom,
                threshold,
                hasMore: opts.hasMore(),
                isLoading: opts.isLoading()
            });
        }
        if (distToBottom <= threshold) {
            triggerLoadMore(reason);
        }
    };

    const io = new IntersectionObserver(
        (entries) => {
            const entry = entries[0];
            if (!entry?.isIntersecting) return;
            if (!opts.hasMore()) return;
            if (opts.isLoading()) {
                pendingWhileLoading = true;
                debugLog(debug, listLabel, 'io:intersectWhileLoading', {
                    intersectionRatio: entry.intersectionRatio,
                    pendingWhileLoading
                });
                return;
            }
            debugLog(debug, listLabel, 'io:intersect', {
                intersectionRatio: entry.intersectionRatio,
                rootBounds: entry.rootBounds
                    ? { top: entry.rootBounds.top, bottom: entry.rootBounds.bottom, height: entry.rootBounds.height }
                    : null,
                targetTop: entry.boundingClientRect?.top ?? null
            });
            triggerLoadMore('io');
        },
        { root, rootMargin, threshold: 0.01 }
    );
    io.observe(sentinel);

    // Scroll fallback for iOS Safari: if IO doesn't fire consistently, use scroll position.
    const scrollTarget: any = root ?? window;
    const onScroll = () => {
        if (scrollRaf !== null) return;
        scrollRaf = requestAnimationFrame(() => {
            scrollRaf = null;
            maybeLoadMoreByScrollPosition('scroll');
        });
    };
    try {
        scrollTarget.addEventListener('scroll', onScroll, { passive: true });
        debugLog(debug, listLabel, 'scroll:listenerAttached', {
            scrollTarget: root ? 'root' : 'window'
        });
    } catch {
        // ignore
    }

    // Initial check: attempt a single auto-fill chain, but only up to budget and only if not scrollable.
    requestAnimationFrame(() => {
        if (autoFillBudget > 0 && !isScrollable()) {
            autoFillBudget--;
            debugLog(debug, listLabel, 'autofill:init', { remaining: autoFillBudget });
            triggerLoadMore('autofill:init');
        }
    });

    return {
        /** Disconnects observer and removes sentinel */
        destroy() {
            debugLog(debug, listLabel, 'destroy');
            try { io.disconnect(); } catch { /* no-op */ }
            try { scrollTarget.removeEventListener('scroll', onScroll); } catch { /* no-op */ }
            try { if (scrollRaf !== null) cancelAnimationFrame(scrollRaf); } catch { /* no-op */ }
            try { sentinel.remove(); } catch { /* no-op */ }
        }
    };
}
