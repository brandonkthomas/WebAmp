/**
 * Handle returned by `attachInfiniteScroll`
 */
export interface InfiniteScrollController {
    destroy(): void;
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
    const sentinel = document.createElement('div');
    sentinel.className = 'wa-infinite-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    // Insert as a sibling right after the list so callers can freely replaceChildren() on listEl
    // without destroying the observer target.
    opts.listEl.insertAdjacentElement('afterend', sentinel);

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

    const io = new IntersectionObserver(
        (entries) => {
            const entry = entries[0];
            if (!entry?.isIntersecting) return;
            if (!opts.hasMore()) return;
            if (opts.isLoading()) return;
            
            // Start the load operation
            const loadPromise = Promise.resolve(opts.loadMore());
            
            // Call render() immediately and again after a microtask to catch loading state changes
            render();
            queueMicrotask(() => {
                render(); // Update after loadMore has had a chance to set loading = true
            });
            
            // Update render after load completes
            loadPromise.finally(() => {
                requestAnimationFrame(() => render());
            });
        },
        {
            root: opts.root ?? null,
            rootMargin: opts.rootMargin ?? '600px 0px',
            threshold: 0.01
        }
    );

    io.observe(sentinel);

    return {
        /** Disconnects observer and removes sentinel */
        destroy() {
            try { io.disconnect(); } catch { /* no-op */ }
            try { sentinel.remove(); } catch { /* no-op */ }
        }
    };
}
