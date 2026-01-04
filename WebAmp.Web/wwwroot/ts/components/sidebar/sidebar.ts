export interface SidebarControllerOptions {
    appRoot: HTMLElement;
    sidebar: HTMLElement;
    overlay: HTMLElement;
    openBtn: HTMLElement | null;
    closeBtn: HTMLElement | null;
}

export class SidebarController {
    private readonly appRoot: HTMLElement;
    private readonly sidebar: HTMLElement;
    private readonly overlay: HTMLElement;
    private readonly openBtn: HTMLElement | null;
    private readonly closeBtn: HTMLElement | null;

    constructor(opts: SidebarControllerOptions) {
        this.appRoot = opts.appRoot;
        this.sidebar = opts.sidebar;
        this.overlay = opts.overlay;
        this.openBtn = opts.openBtn;
        this.closeBtn = opts.closeBtn;

        this.bind();
    }

    open() {
        this.appRoot.dataset.waSidebarOpen = 'true';
    }

    close() {
        delete this.appRoot.dataset.waSidebarOpen;
    }

    toggle() {
        const isOpen = this.appRoot.dataset.waSidebarOpen === 'true';
        if (isOpen) this.close();
        else this.open();
    }

    private bind() {
        this.openBtn?.addEventListener('click', () => this.open());
        this.closeBtn?.addEventListener('click', () => this.close());
        this.overlay.addEventListener('click', () => this.close());

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.close();
        });

        // Close after selecting a nav item (mobile slide-over convenience)
        this.sidebar.addEventListener('click', (e) => {
            const t = e.target as Element | null;
            if (t?.closest('[data-wa-nav]')) {
                this.close();
            }
        });
    }
}
