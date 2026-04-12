/**
 * Renders placeholder rows for list loading states
 */
export function renderListSkeleton(container: HTMLElement, rows: number = 6) {
    container.replaceChildren();
    for (let i = 0; i < rows; i++) {
        const el = document.createElement('div');
        el.className = 'wa-listitem wa-listitem--skeleton';
        el.innerHTML = `
            <span class="wa-skeleton wa-skeleton--title" aria-hidden="true"></span>
            <span class="wa-skeleton wa-skeleton--meta" aria-hidden="true"></span>
        `;
        container.appendChild(el);
    }
}
