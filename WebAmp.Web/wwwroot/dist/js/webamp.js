// wwwroot/ts/router/routes.ts
var WEBAMP_ROOT = "/webamp";
function normalizePath(path) {
  if (!path) return "/";
  const withLeading = path.startsWith("/") ? path : `/${path}`;
  if (withLeading.length > 1 && withLeading.endsWith("/")) {
    return withLeading.slice(0, -1);
  }
  return withLeading;
}
function stripWebAmpRoot(pathname) {
  const p = normalizePath(pathname);
  if (p === WEBAMP_ROOT) return "/";
  if (p.startsWith(`${WEBAMP_ROOT}/`)) {
    return p.slice(WEBAMP_ROOT.length);
  }
  return "/";
}
function matchWebAmpRoute(pathname) {
  const inner = stripWebAmpRoot(pathname);
  const cleaned = normalizePath(inner);
  if (cleaned === "/" || cleaned === "") {
    return { view: "landing", canonicalPath: WEBAMP_ROOT };
  }
  const segments = cleaned.split("/").filter(Boolean);
  const head = segments[0] || "";
  const tail = segments[1];
  if (head === "home") {
    return { view: "home", canonicalPath: `${WEBAMP_ROOT}/home` };
  }
  if (head === "search") {
    return { view: "search", canonicalPath: `${WEBAMP_ROOT}/search` };
  }
  if (head === "liked") {
    return { view: "liked", canonicalPath: `${WEBAMP_ROOT}/liked` };
  }
  if (head === "playlists") {
    if (tail) return { view: "playlist", entityId: tail, canonicalPath: `${WEBAMP_ROOT}/playlists/${tail}` };
    return { view: "playlist", canonicalPath: `${WEBAMP_ROOT}/playlists` };
  }
  if (head === "albums") {
    if (tail) return { view: "album", entityId: tail, canonicalPath: `${WEBAMP_ROOT}/albums/${tail}` };
    return { view: "album", canonicalPath: `${WEBAMP_ROOT}/albums` };
  }
  if (head === "artists") {
    if (tail) return { view: "artist", entityId: tail, canonicalPath: `${WEBAMP_ROOT}/artists/${tail}` };
    return { view: "artist", canonicalPath: `${WEBAMP_ROOT}/artists` };
  }
  return { view: "landing", canonicalPath: WEBAMP_ROOT };
}

// wwwroot/ts/router/webAmpRouter.ts
function closestAttrEl(start, attr) {
  if (!start) return null;
  const el = start.closest(`[${attr}]`);
  return el instanceof HTMLElement ? el : null;
}
var LANDING_PATH = WEBAMP_ROOT;
var HOME_PATH = `${WEBAMP_ROOT}/home`;
function isGuardPairPath(path) {
  const p = path.replace(/\/$/, "") || WEBAMP_ROOT;
  return p === LANDING_PATH || p === HOME_PATH;
}
function isGuardRedirectPair(pathA, pathB) {
  return isGuardPairPath(pathA) && isGuardPairPath(pathB);
}
var WebAmpRouter = class {
  root;
  dom;
  views;
  services;
  activeViewId = null;
  activeController = null;
  lastMatch = null;
  // In-app history tracking so we can enable/disable back/forward buttons.
  historyStack = [];
  historyIndex = 0;
  // Optional per-view breadcrumb override set by controllers.
  customBreadcrumbs = null;
  constructor(opts) {
    this.root = opts.root ?? WEBAMP_ROOT;
    this.dom = opts.dom;
    this.views = opts.views;
    this.services = opts.services ?? {};
  }
  /**
   * Starts initial render, click interception, and popstate handling
   */
  start() {
    this.syncToLocation(
      /* pushHistory */
      false
    );
    document.addEventListener("click", (e) => {
      const target = e.target;
      const backBtn = closestAttrEl(target, "data-wa-nav-back");
      if (backBtn) {
        e.preventDefault();
        e.stopPropagation();
        this.goBack();
        return;
      }
      const fwdBtn = closestAttrEl(target, "data-wa-nav-forward");
      if (fwdBtn) {
        e.preventDefault();
        e.stopPropagation();
        this.goForward();
        return;
      }
      const navEl = closestAttrEl(target, "data-wa-nav");
      if (navEl) {
        const href = navEl.getAttribute("href");
        if (href && href.startsWith(this.root)) {
          e.preventDefault();
          this.navigate(href);
        }
        return;
      }
      const navHrefEl = closestAttrEl(target, "data-wa-nav-href");
      if (navHrefEl) {
        const href = navHrefEl.getAttribute("data-wa-nav-href");
        if (href && href.startsWith(this.root)) {
          e.preventDefault();
          this.navigate(href);
        }
      }
    });
    window.addEventListener("popstate", (e) => {
      const state = e.state ?? {};
      const pathname = window.location.pathname;
      const isOurState = state?.wa === true && typeof state.waIndex === "number";
      const isOurPath = pathname === this.root || pathname.startsWith(this.root + "/");
      if (isOurState && isOurPath) {
        this.historyIndex = state.waIndex;
        const path = state.path ?? pathname;
        if (!this.historyStack.length) {
          this.historyStack = [path];
        } else {
          this.historyStack[this.historyIndex] = path;
        }
        this.syncToLocation(
          /* pushHistory */
          false
        );
        return;
      }
      if (this.historyStack.length && this.historyIndex >= 0) {
        const currentPath = this.historyStack[this.historyIndex];
        const match = this.resolveGuard(matchWebAmpRoute(currentPath));
        const search = window.location.search || "";
        const url = `${match.canonicalPath}${search}`;
        history.replaceState(
          { wa: true, path: match.canonicalPath, waIndex: this.historyIndex },
          "",
          url
        );
        this.render(match);
        this.updateHistoryButtons();
      }
    });
  }
  /**
   * Goes back one step in internal view history (avoids browser history which may include external URLs like OAuth redirects).
   */
  goBack() {
    if (this.historyIndex <= 0) return;
    this.historyIndex--;
    const path = this.historyStack[this.historyIndex];
    const match = this.resolveGuard(matchWebAmpRoute(path));
    const search = window.location.search || "";
    const url = `${match.canonicalPath}${search}`;
    history.replaceState({ wa: true, path: match.canonicalPath, waIndex: this.historyIndex }, "", url);
    this.render(match);
    this.updateHistoryButtons();
  }
  /**
   * Goes forward one step in internal view history.
   */
  goForward() {
    if (this.historyIndex >= this.historyStack.length - 1) return;
    this.historyIndex++;
    const path = this.historyStack[this.historyIndex];
    const match = this.resolveGuard(matchWebAmpRoute(path));
    const search = window.location.search || "";
    const url = `${match.canonicalPath}${search}`;
    history.replaceState({ wa: true, path: match.canonicalPath, waIndex: this.historyIndex }, "", url);
    this.render(match);
    this.updateHistoryButtons();
  }
  /**
   * Navigates within the WebAmp app and renders the matched view.
   * Avoids pushing a new history entry when the only transition is the guard
   * redirect (landing ↔ home), e.g. after reload when auth state settles.
   */
  navigate(path) {
    const match = this.resolveGuard(matchWebAmpRoute(path));
    const search = window.location.search || "";
    const url = `${match.canonicalPath}${search}`;
    if (!this.historyStack.length) {
      this.historyStack = [match.canonicalPath];
      this.historyIndex = 0;
      history.replaceState({ wa: true, path: match.canonicalPath, waIndex: this.historyIndex }, "", url);
    } else if (this.historyStack.length === 1 && this.historyIndex === 0 && isGuardRedirectPair(this.historyStack[0], match.canonicalPath)) {
      this.historyStack[0] = match.canonicalPath;
      history.replaceState({ wa: true, path: match.canonicalPath, waIndex: 0 }, "", url);
    } else {
      this.historyStack = this.historyStack.slice(0, this.historyIndex + 1);
      this.historyStack.push(match.canonicalPath);
      this.historyIndex = this.historyStack.length - 1;
      history.pushState({ wa: true, path: match.canonicalPath, waIndex: this.historyIndex }, "", url);
    }
    this.render(match);
    this.updateHistoryButtons();
  }
  /**
   * Renders current location, optionally pushing history
   */
  syncToLocation(pushHistory) {
    const match = this.resolveGuard(matchWebAmpRoute(window.location.pathname));
    const search = window.location.search || "";
    const url = `${match.canonicalPath}${search}`;
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
      history.pushState({ wa: true, path: match.canonicalPath, waIndex: this.historyIndex }, "", url);
    } else {
      history.replaceState({ wa: true, path: match.canonicalPath, waIndex: this.historyIndex }, "", url);
    }
    this.render(match);
    this.updateHistoryButtons();
  }
  /**
   * Mounts a view from its template and calls controller lifecycle hooks
   */
  render(match) {
    const controller = this.views[match.view];
    const template = this.dom.templates[match.view];
    if (!controller || !template) {
      return;
    }
    this.customBreadcrumbs = null;
    this.lastMatch = match;
    try {
      this.activeController?.unmount?.();
    } catch {
    }
    this.dom.viewHost.replaceChildren();
    const mountWrap = document.createElement("div");
    mountWrap.className = "wa-view-mount";
    mountWrap.appendChild(template.content.cloneNode(true));
    this.dom.viewHost.appendChild(mountWrap);
    this.animateViewMount(mountWrap);
    const viewRoot = mountWrap.querySelector(`[data-wa-view="${match.view}"]`) ?? mountWrap;
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
      getViewLabel: (viewId) => this.getViewLabel(viewId)
    });
    this.dom.appRoot.scrollIntoView({ block: "start" });
  }
  /**
   * Applies a scale/blur/opacity "enter" animation to the active view mount
   * View mount transition tuning
   */
  animateViewMount(el) {
    el.classList.add("wa-view-mount--initial");
    requestAnimationFrame(() => {
      el.classList.remove("wa-view-mount--initial");
      el.classList.add("wa-view-mount--enter");
      window.setTimeout(() => {
        el.classList.remove("wa-view-mount--enter");
      }, 220);
    });
  }
  /**
   * Navigation guard.
   *
   * Originally this enforced "landing-only until Spotify is connected".
   * Now that WebAmp also supports SoundCloud (which does not require per-user
   * auth), we only auto-redirect *away* from landing when Spotify is
   * connected, but we do not block access to the rest of the app when
   * Spotify is disconnected.
   */
  resolveGuard(match) {
    const spotifySource = this.services.musicSource;
    const soundCloudSource = this.services.soundCloudSource;
    const authed = (spotifySource?.getState().isConnected ?? false) || (soundCloudSource?.getState().isConnected ?? false);
    if (!authed && match.view !== "landing") {
      return matchWebAmpRoute(WEBAMP_ROOT);
    }
    if (authed && match.view === "landing") {
      return matchWebAmpRoute(`${WEBAMP_ROOT}/home`);
    }
    return match;
  }
  /**
   * Updates app-level dataset and global header bits
   */
  updateAppChrome(match) {
    const spotifySource = this.services.musicSource;
    const soundCloudSource = this.services.soundCloudSource;
    const spotifyConnected = spotifySource?.getState().isConnected ?? false;
    const scConnected = soundCloudSource?.getState().isConnected ?? false;
    const authed = spotifyConnected || scConnected;
    this.dom.appRoot.dataset.waView = match.view;
    this.dom.appRoot.dataset.waAuth = authed ? "true" : "false";
    let src = "none";
    if (spotifyConnected && !scConnected) src = "spotify";
    else if (scConnected && !spotifyConnected) src = "soundcloud";
    this.dom.appRoot.dataset.waSource = src;
    const likedHeadings = Array.from(document.querySelectorAll("[data-wa-liked-heading]"));
    const likedList = document.querySelector("[data-wa-liked]");
    const likedRootHeadings = Array.from(document.querySelectorAll("[data-wa-liked-heading-root]"));
    const setLikedHeadingText = (el, text) => {
      const labelEl = el.querySelector("[data-wa-liked-heading-text]");
      if (labelEl) {
        labelEl.textContent = text;
        return;
      }
      el.textContent = text;
    };
    if (likedHeadings.length || likedRootHeadings.length || likedList) {
      if (src === "soundcloud") {
        likedHeadings.forEach((el) => {
          setLikedHeadingText(el, "Likes");
        });
        likedRootHeadings.forEach((el) => {
          el.textContent = "Likes";
        });
        if (likedList) likedList.setAttribute("aria-label", "Likes");
      } else {
        likedHeadings.forEach((el) => {
          setLikedHeadingText(el, "Liked Songs");
        });
        likedRootHeadings.forEach((el) => {
          el.textContent = "Liked Songs";
        });
        if (likedList) likedList.setAttribute("aria-label", "Liked songs");
      }
    }
    const topbarTitle = document.querySelector("[data-wa-topbar-title]");
    if (topbarTitle) {
      topbarTitle.textContent = match.view === "landing" ? "WebAmp" : this.getViewLabel(match.view);
    }
  }
  /**
   * Sets `data-wa-active` on nav items matching the current view id
   */
  updateActiveNav(viewId) {
    const links = Array.from(document.querySelectorAll("[data-wa-nav]"));
    for (const el of links) {
      const isActive = el.getAttribute("data-wa-nav") === viewId;
      if (isActive) {
        el.setAttribute("data-wa-active", "true");
      } else {
        el.removeAttribute("data-wa-active");
      }
    }
  }
  /**
   * Updates `document.title` based on the current logical location.
   *
   * For non-landing views this now prefers the label of the "current"
   * breadcrumb (i.e., the last crumb in the trail) so that detail pages
   * use the human-friendly title instead of raw ids.
   */
  updateTitle(match) {
    const base = "WebAmp";
    const crumbs = this.customBreadcrumbs ?? this.buildBreadcrumbs(match);
    let suffix = null;
    if (crumbs.length) {
      const current = crumbs[crumbs.length - 1];
      const label = current.label?.trim();
      suffix = label && label.length > 0 ? label : null;
    } else if (match.view !== "landing") {
      const label = this.getViewLabel(match.view)?.trim();
      suffix = label && label.length > 0 ? label : null;
    } else {
      suffix = null;
    }
    document.title = suffix ? `${base} \u2014 ${suffix}` : base;
  }
  /**
   * Public hook for views to override the default breadcrumb trail for the active route.
   */
  setBreadcrumbs(crumbs) {
    this.customBreadcrumbs = crumbs;
    if (this.lastMatch) {
      this.updateBreadcrumbs(this.lastMatch);
      this.updateTitle(this.lastMatch);
    }
  }
  /**
   * Renders breadcrumb trail above the view title when a breadcrumbs host is present
   */
  updateBreadcrumbs(match) {
    const container = document.querySelector("[data-wa-breadcrumbs]");
    if (!container) return;
    const crumbs = this.customBreadcrumbs ?? this.buildBreadcrumbs(match);
    container.replaceChildren();
    if (!crumbs.length) {
      container.style.display = "none";
      return;
    }
    container.style.display = "";
    crumbs.forEach((crumb, index) => {
      const isLast = index === crumbs.length - 1;
      if (index > 0) {
        const sep = document.createElement("span");
        sep.className = "wa-breadcrumbs__sep";
        sep.textContent = "\u203A";
        container.appendChild(sep);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = crumb.label;
      btn.className = "wa-breadcrumbs__item";
      if (isLast || !crumb.path) {
        btn.classList.add("wa-breadcrumbs__item--current");
        btn.disabled = true;
        btn.setAttribute("aria-current", "page");
      } else {
        btn.classList.add("wa-breadcrumbs__item--link");
        btn.addEventListener("click", () => {
          this.navigate(crumb.path);
        });
      }
      container.appendChild(btn);
    });
  }
  /**
   * Builds logical breadcrumbs from the current route
   */
  buildBreadcrumbs(match) {
    const crumbs = [];
    if (match.view === "landing") {
      return crumbs;
    }
    const label = this.getViewLabel(match.view);
    crumbs.push({ label, path: match.canonicalPath });
    return crumbs;
  }
  /**
   * Enables/disables header back/forward buttons based on internal stack position
   */
  updateHistoryButtons() {
    const canBack = this.historyIndex > 0;
    const canForward = this.historyIndex < this.historyStack.length - 1;
    const backBtns = document.querySelectorAll("[data-wa-nav-back]");
    backBtns.forEach((btn) => {
      btn.disabled = !canBack;
    });
    const fwdBtns = document.querySelectorAll("[data-wa-nav-forward]");
    fwdBtns.forEach((btn) => {
      btn.disabled = !canForward;
    });
  }
  /**
   * Derives a human-friendly label for a given view id using existing nav text where possible.
   * This keeps things flexible for other music services that reuse the router.
   */
  getViewLabel(view) {
    const sideLabel = document.querySelector(`.wa-sidenav__link[data-wa-nav="${view}"] .wa-sidenav__label`)?.textContent?.trim();
    if (sideLabel) {
      return sideLabel;
    }
    const topLabel = document.querySelector(`.wa-topnav__links [data-wa-nav="${view}"]`)?.textContent?.trim();
    if (topLabel) {
      return topLabel;
    }
    return view.charAt(0).toUpperCase() + view.slice(1);
  }
};

// wwwroot/ts/internal/indiumApi.ts
import {
  apiPath,
  assetPath,
  attachInfiniteScroll,
  bootIndium,
  createGradNoiseCanvas,
  openPopupMenu,
  createSidebarController,
  routePath,
  setIndiumConfig,
  showAlert,
  showConfirm,
  showPrompt
} from "/apps/indium/dist/indium.js";

// wwwroot/ts/internal/paths.ts
function trimLeadingSlash(path) {
  return path.replace(/^\/+/, "");
}
function routePath2(path) {
  return routePath(path);
}
function apiPath2(path) {
  return apiPath(path);
}
function assetPath2(path) {
  return assetPath(path);
}
function indiumSvg(name) {
  return assetPath2(`assets/svg/${trimLeadingSlash(name)}`);
}
function webAmpBrandAsset(path) {
  return `/apps/webamp/assets/${trimLeadingSlash(path)}`;
}

// wwwroot/ts/views/landingView.ts
var unsubscribeFromSource = null;
var gradNoiseCanvas = null;
var landingBgHost = null;
var LANDING_BG_ATTR = "data-wa-landing-bg";
var LANDING_BG_CANVAS_ID = "wa-landing-gnc";
function destroyLandingBackground() {
  gradNoiseCanvas?.destroy();
  gradNoiseCanvas = null;
  window.gradNoiseCanvasInstance = null;
  landingBgHost?.remove();
  landingBgHost = null;
}
var landingView = {
  id: "landing",
  mount(ctx) {
    const root = ctx.rootEl;
    const appRoot = document.querySelector("[data-wa-app]");
    const statusEl = root.querySelector("[data-wa-landing-status]");
    const connectBtn = root.querySelector('[data-wa-action="spotify-connect"]');
    const continueBtn = root.querySelector('[data-wa-action="continue"]');
    const soundcloudBtn = root.querySelector('[data-wa-action="soundcloud-enter"]');
    const setStatus = (text) => {
      if (statusEl) statusEl.textContent = text;
    };
    const spotifySource = ctx.services.musicSource;
    const soundCloudSource = ctx.services.soundCloudSource;
    destroyLandingBackground();
    if (appRoot) {
      const stale = appRoot.querySelector(`[${LANDING_BG_ATTR}]`);
      stale?.remove();
      const host = document.createElement("div");
      host.className = "gnc-container wa-app__landing-bg";
      host.setAttribute(LANDING_BG_ATTR, "true");
      host.setAttribute("aria-hidden", "true");
      const canvas = document.createElement("canvas");
      canvas.id = LANDING_BG_CANVAS_ID;
      host.appendChild(canvas);
      appRoot.prepend(host);
      landingBgHost = host;
      gradNoiseCanvas = createGradNoiseCanvas(canvas);
      window.gradNoiseCanvasInstance = gradNoiseCanvas;
    }
    const syncUi = () => {
      const spotifyConnected = spotifySource?.getState().isConnected ?? false;
      const scConnected = soundCloudSource?.getState().isConnected ?? false;
      const connected = spotifyConnected || scConnected;
      if (continueBtn) continueBtn.disabled = !connected;
      if (spotifyConnected && scConnected) {
        setStatus("Spotify and SoundCloud connected");
      } else if (spotifyConnected) {
        setStatus("Spotify connected");
      } else if (scConnected) {
        setStatus("SoundCloud connected");
      } else {
        setStatus("Not connected");
      }
    };
    syncUi();
    if (!connectBtn) return;
    unsubscribeFromSource?.();
    unsubscribeFromSource = spotifySource?.onChange(() => syncUi()) ?? null;
    connectBtn.addEventListener("click", () => {
      if (!spotifySource) {
        setStatus("Spotify source not configured");
        return;
      }
      connectBtn.disabled = true;
      setStatus("Connecting\u2026");
      try {
        void spotifySource.connect();
      } finally {
        connectBtn.disabled = false;
      }
    });
    continueBtn?.addEventListener("click", () => {
      ctx.router.navigate(routePath2("home"));
    });
    soundcloudBtn?.addEventListener("click", () => {
      if (!soundCloudSource) {
        setStatus("SoundCloud source not configured");
        return;
      }
      try {
        void soundCloudSource.connect();
      } catch {
      }
    });
  },
  unmount() {
    unsubscribeFromSource?.();
    unsubscribeFromSource = null;
    destroyLandingBackground();
  }
};

// wwwroot/ts/internal/logging.ts
function logEvent(component, event, data, note, level = "info") {
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  const fieldSegment = data ? Object.entries(data).filter(([, value]) => value !== void 0).map(([key, value]) => `${key}=${value === null ? "null" : String(value)}`).join(" ") : "";
  const noteSegment = note ? ` (${note})` : "";
  const message = fieldSegment ? `[${component}] ${event} - ${fieldSegment}${noteSegment}` : `[${component}] ${event}${noteSegment}`;
  logger(message);
}

// wwwroot/ts/storage/clientCache.ts
var DB_NAME = "webamp-client-cache";
var DB_VERSION = 1;
var ART_STORE = "art";
var ART_CACHE = "webamp-art-cache-v1";
var ART_LIMIT = 100;
var ART_TTL_MS = 24 * 60 * 60 * 1e3;
var metaCache = /* @__PURE__ */ new Map();
var dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ART_STORE)) {
          db.createObjectStore(ART_STORE, { keyPath: "url" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}
function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function getMetaTotalSize() {
  let sum = 0;
  for (const rec of metaCache.values()) sum += rec.size || 0;
  return sum;
}
async function getArtRecord(url) {
  const db = await openDb();
  const tx = db.transaction(ART_STORE, "readonly");
  const store = tx.objectStore(ART_STORE);
  const record = await promisify(store.get(url));
  return record ?? null;
}
async function getArtRecords() {
  const db = await openDb();
  const tx = db.transaction(ART_STORE, "readonly");
  const store = tx.objectStore(ART_STORE);
  return await promisify(store.getAll());
}
async function setArtRecord(url, size) {
  const db = await openDb();
  const tx = db.transaction(ART_STORE, "readwrite");
  const store = tx.objectStore(ART_STORE);
  const record = {
    url,
    size,
    addedAt: Date.now()
  };
  await promisify(store.put(record));
}
async function touchArtRecord(url) {
  const existing = await getArtRecord(url);
  if (!existing) return;
  await setArtRecord(url, existing.size);
}
async function deleteArtRecord(url) {
  const db = await openDb();
  const tx = db.transaction(ART_STORE, "readwrite");
  const store = tx.objectStore(ART_STORE);
  await promisify(store.delete(url));
}
async function getArtTotalSize() {
  const records = await getArtRecords();
  return records.reduce((sum, rec) => sum + (rec.size || 0), 0);
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}
function isArtExpired(rec) {
  return Date.now() - rec.addedAt > ART_TTL_MS;
}
async function logCacheSizes(context) {
  const [metaSize, artSize] = [getMetaTotalSize(), await getArtTotalSize()];
  logEvent("WebAmp", "cache:size", {
    context,
    metadata: formatBytes(metaSize),
    art: formatBytes(artSize)
  });
}
async function enforceArtLimit() {
  const records = await getArtRecords();
  const valid = records.filter((r) => !isArtExpired(r));
  const expired = records.filter((r) => isArtExpired(r));
  if (expired.length) {
    const cache2 = await caches.open(ART_CACHE);
    for (const rec of expired) {
      await cache2.delete(rec.url);
      await deleteArtRecord(rec.url);
    }
  }
  if (valid.length <= ART_LIMIT) return;
  valid.sort((a, b) => b.addedAt - a.addedAt);
  const evict = valid.slice(ART_LIMIT);
  if (!evict.length) return;
  const cache = await caches.open(ART_CACHE);
  for (const rec of evict) {
    await cache.delete(rec.url);
    await deleteArtRecord(rec.url);
  }
}
async function cachedJsonFetch(key, fetcher) {
  const cached = metaCache.get(key);
  if (cached) return cached.value;
  const data = await fetcher();
  const json = JSON.stringify(data);
  metaCache.set(key, { value: data, size: new TextEncoder().encode(json).length });
  void logCacheSizes("metadata+");
  return data;
}
function clearCachedJsonByPrefix(prefix) {
  if (!prefix) return;
  for (const key of metaCache.keys()) {
    if (key.startsWith(prefix)) {
      metaCache.delete(key);
    }
  }
}
async function responseToObjectUrl(res) {
  try {
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}
function shouldBypassArtCaching(url) {
  try {
    const normalized = String(url).trim();
    const parsed = new URL(normalized, location.href);
    return parsed.origin !== location.origin;
  } catch {
    return true;
  }
}
async function resolveCachedArtUrl(url) {
  if (!url || typeof caches === "undefined") return url ?? null;
  if (shouldBypassArtCaching(url)) return url;
  try {
    const cache = await caches.open(ART_CACHE);
    const cached = await cache.match(url);
    if (cached) {
      const artRec = await getArtRecord(url);
      if (artRec && !isArtExpired(artRec)) {
        void touchArtRecord(url);
        const objectUrl = await responseToObjectUrl(cached.clone());
        return objectUrl ?? url;
      }
      await cache.delete(url);
      if (artRec) await deleteArtRecord(url);
    }
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return url;
    const clone = res.clone();
    await cache.put(url, clone);
    const blob = await res.blob();
    await setArtRecord(url, blob.size);
    await enforceArtLimit();
    await logCacheSizes("art+");
    return URL.createObjectURL(blob);
  } catch {
    return url;
  }
}
async function clearClientCacheAndReload() {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
    }
    dbPromise = null;
  }
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
  if (typeof caches !== "undefined") {
    await caches.delete(ART_CACHE);
  }
  location.reload();
}
function applyCachedArt(img, url) {
  if (!img) return;
  if (!url) {
    const prev = img.dataset.waArtObjectUrl;
    if (prev) URL.revokeObjectURL(prev);
    delete img.dataset.waArtObjectUrl;
    img.removeAttribute("src");
    return;
  }
  const token = String(Date.now()) + Math.random().toString(16).slice(2);
  img.dataset.waArtToken = token;
  void (async () => {
    const resolved = await resolveCachedArtUrl(url);
    if (!resolved) return;
    if (img.dataset.waArtToken !== token) return;
    const prev = img.dataset.waArtObjectUrl;
    if (prev) URL.revokeObjectURL(prev);
    img.src = resolved;
    if (resolved.startsWith("blob:")) {
      img.dataset.waArtObjectUrl = resolved;
    } else {
      delete img.dataset.waArtObjectUrl;
    }
  })();
}

// wwwroot/ts/ui/errorDialog.ts
async function showErrorDialog(message, title = "Error") {
  logEvent("WebAmp", "ui:error", { title, message }, void 0, "error");
  return await showAlert({
    title,
    message,
    variant: "danger"
  });
}
function formatErrorMessage(error) {
  if (error instanceof Error) {
    const message = error.message;
    if (message.includes("502")) {
      return "The music service is temporarily unavailable. Please try again in a moment.";
    }
    if (message.includes("401") || message.includes("403")) {
      return "Your session has expired. Please sign in again.";
    }
    if (message.includes("404")) {
      return "The requested content could not be found.";
    }
    if (message.includes("429")) {
      return "Too many requests. Please wait a moment before trying again.";
    }
    if (message.includes("500") || message.includes("503")) {
      return "The music service is experiencing issues. Please try again later.";
    }
    if (message.includes("network") || message.includes("fetch")) {
      return "Network error. Please check your connection and try again.";
    }
    const jsonMatch = message.match(/\{.*"message":\s*"([^"]+)"[^}]*\}/);
    if (jsonMatch) {
      return jsonMatch[1];
    }
    return message.replace(/^(Spotify API proxy error|Error):\s*/i, "").trim() || "An unexpected error occurred.";
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unexpected error occurred. Please try again.";
}

// wwwroot/ts/sources/soundcloudUserApi.ts
function soundCloudUserApiPath(path) {
  return apiPath2(`soundclouduser/${path.replace(/^\/+/, "")}`);
}
async function jsonFetch(url, init) {
  const startedAt = performance.now();
  const method = init?.method ?? "GET";
  let status = null;
  let errorLogged = false;
  try {
    const res = await fetch(url, {
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...init?.headers ?? {}
      },
      ...init
    });
    status = res.status;
    if (!res.ok) {
      const text2 = await res.text().catch(() => "");
      const error = new Error(`SoundCloud user API proxy error ${res.status}: ${text2}`);
      logEvent("WebAmp", "api:error", { source: "soundcloud-user", method, status, ms: Math.round(performance.now() - startedAt), url }, error.message, "error");
      errorLogged = true;
      void showErrorDialog(formatErrorMessage(error), "Music Service Error");
      throw error;
    }
    logEvent("WebAmp", "api:ok", { source: "soundcloud-user", method, status, ms: Math.round(performance.now() - startedAt), url });
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch (error) {
    if (!errorLogged) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logEvent("WebAmp", "api:error", { source: "soundcloud-user", method, status, ms: Math.round(performance.now() - startedAt), url }, message, "error");
    }
    if (!(error instanceof Error && error.message.includes("SoundCloud user API proxy error"))) {
      void showErrorDialog(formatErrorMessage(error), "Music Service Error");
    }
    throw error;
  }
}
async function cachedGet(key, url) {
  return await cachedJsonFetch(key, () => jsonFetch(url));
}
var soundcloudUserApi = {
  async status() {
    return await jsonFetch(soundCloudUserApiPath("status"));
  },
  async logout() {
    await jsonFetch(soundCloudUserApiPath("logout"), { method: "POST", body: "{}" });
  },
  async myPlaylists(limit = 20, cursor) {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (cursor) params.set("cursor", cursor);
    const url = `${soundCloudUserApiPath("myplaylists")}?${params.toString()}`;
    return await cachedGet(`soundclouduser:${url}`, url);
  },
  async likedTracks(limit = 20, cursor) {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (cursor) params.set("cursor", cursor);
    const url = `${soundCloudUserApiPath("likedtracks")}?${params.toString()}`;
    return await cachedGet(`soundclouduser:${url}`, url);
  },
  async track(id) {
    const url = `${soundCloudUserApiPath("track")}?id=${encodeURIComponent(id)}`;
    return await jsonFetch(url);
  },
  async likeTrack(trackUrn) {
    const url = `${soundCloudUserApiPath("liketrack")}?trackUrn=${encodeURIComponent(trackUrn)}`;
    await jsonFetch(url, { method: "POST" });
  },
  async unlikeTrack(trackUrn) {
    const url = `${soundCloudUserApiPath("unliketrack")}?trackUrn=${encodeURIComponent(trackUrn)}`;
    await jsonFetch(url, { method: "POST" });
  },
  async recentActivities(limit = 10, cursor) {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    if (cursor) params.set("cursor", cursor);
    const url = `${soundCloudUserApiPath("recentactivities")}?${params.toString()}`;
    return await cachedGet(`soundclouduser:${url}`, url);
  },
  async playlist(id) {
    const url = `${soundCloudUserApiPath("playlist")}?id=${encodeURIComponent(id)}`;
    return await cachedGet(`soundclouduser:${url}`, url);
  },
  async playlistTracks(id, limit = 100, cursor, nextHref) {
    const params = new URLSearchParams();
    if (nextHref) {
      params.set("next_href", nextHref);
    } else {
      params.set("id", id);
      params.set("limit", String(limit));
      if (cursor) params.set("cursor", cursor);
    }
    const url = `${soundCloudUserApiPath("playlisttracks")}?${params.toString()}`;
    return await cachedGet(`soundclouduser:${url}`, url);
  }
};

// wwwroot/ts/sources/spotify/spotifyApi.ts
function spotifyApiPath(path) {
  return apiPath2(`spotify/${path.replace(/^\/+/, "")}`);
}
async function jsonFetch2(url, init) {
  const startedAt = performance.now();
  const method = init?.method ?? "GET";
  let status = null;
  let errorLogged = false;
  try {
    const res = await fetch(url, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...init?.headers ?? {} },
      ...init
    });
    status = res.status;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const error = new Error(`Spotify API proxy error ${res.status}: ${text}`);
      logEvent("WebAmp", "api:error", { source: "spotify", method, status, ms: Math.round(performance.now() - startedAt), url }, error.message, "error");
      errorLogged = true;
      void showErrorDialog(formatErrorMessage(error), "Music Service Error");
      throw error;
    }
    logEvent("WebAmp", "api:ok", { source: "spotify", method, status, ms: Math.round(performance.now() - startedAt), url });
    return await res.json();
  } catch (error) {
    if (!errorLogged) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logEvent("WebAmp", "api:error", { source: "spotify", method, status, ms: Math.round(performance.now() - startedAt), url }, message, "error");
    }
    if (!(error instanceof Error && error.message.includes("Spotify API proxy error"))) {
      void showErrorDialog(formatErrorMessage(error), "Music Service Error");
    }
    throw error;
  }
}
async function cachedGet2(key, url) {
  return await cachedJsonFetch(key, () => jsonFetch2(url));
}
var spotifyApi = {
  /** Gets auth status for current session */
  async status() {
    return await jsonFetch2(spotifyApiPath("status"));
  },
  /** Logs out current Spotify session */
  async logout() {
    await jsonFetch2(spotifyApiPath("logout"), { method: "POST", body: "{}" });
  },
  /** Gets an access token for Spotify Web Playback SDK */
  async accessToken() {
    return await jsonFetch2(spotifyApiPath("accesstoken"));
  },
  /** Searches Spotify content via proxy */
  async search(q, type = "track,artist,album,playlist", limit = 10, offset = 0) {
    const url = `${spotifyApiPath("search")}?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}&limit=${limit}&offset=${offset}`;
    return await cachedGet2(`spotify:${url}`, url);
  },
  /** Lists current user playlists (paged) */
  async myPlaylists(limit = 20, offset = 0) {
    const url = `${spotifyApiPath("myplaylists")}?limit=${limit}&offset=${offset}`;
    return await cachedGet2(`spotify:${url}`, url);
  },
  /** Lists current user saved tracks (paged) */
  async savedTracks(limit = 20, offset = 0) {
    const url = `${spotifyApiPath("savedtracks")}?limit=${limit}&offset=${offset}`;
    return await cachedGet2(`spotify:${url}`, url);
  },
  async savedTracksContains(id) {
    const url = `${spotifyApiPath("savedtrackscontains")}?id=${encodeURIComponent(id)}`;
    const data = await jsonFetch2(url);
    return Array.isArray(data) ? !!data[0] : false;
  },
  async saveTrack(id) {
    const url = `${spotifyApiPath("savetrack")}?id=${encodeURIComponent(id)}`;
    await jsonFetch2(url, { method: "POST" });
  },
  async removeTrack(id) {
    const url = `${spotifyApiPath("removetrack")}?id=${encodeURIComponent(id)}`;
    await jsonFetch2(url, { method: "POST" });
  },
  /** Lists current user saved albums (paged) */
  async savedAlbums(limit = 20, offset = 0) {
    const url = `${spotifyApiPath("savedalbums")}?limit=${limit}&offset=${offset}`;
    return await cachedGet2(`spotify:${url}`, url);
  },
  /** Lists followed artists using cursor pagination */
  async followedArtists(limit = 20, after) {
    const a = after ? `&after=${encodeURIComponent(after)}` : "";
    const url = `${spotifyApiPath("followedartists")}?limit=${limit}${a}`;
    return await cachedGet2(`spotify:${url}`, url);
  },
  /** Lists playlist tracks (paged) */
  async playlistTracks(id, limit = 100, offset = 0) {
    const url = `${spotifyApiPath("playlisttracks")}?id=${encodeURIComponent(id)}&limit=${limit}&offset=${offset}`;
    return await cachedGet2(`spotify:${url}`, url);
  },
  /** Fetches playlist metadata */
  async playlist(id) {
    const url = `${spotifyApiPath("playlist")}?id=${encodeURIComponent(id)}`;
    return await cachedGet2(`spotify:${url}`, url);
  },
  /** Lists album tracks (paged) */
  async albumTracks(id, limit = 50, offset = 0) {
    const url = `${spotifyApiPath("albumtracks")}?id=${encodeURIComponent(id)}&limit=${limit}&offset=${offset}`;
    return await cachedGet2(`spotify:${url}`, url);
  },
  /** Fetches album metadata */
  async album(id) {
    const url = `${spotifyApiPath("album")}?id=${encodeURIComponent(id)}`;
    return await cachedGet2(`spotify:${url}`, url);
  },
  /** Fetches track metadata */
  async track(id) {
    const url = `${spotifyApiPath("track")}?id=${encodeURIComponent(id)}`;
    return await cachedGet2(`spotify:${url}`, url);
  },
  /** Fetches artist top tracks for a market */
  async artistTopTracks(id, market = "US") {
    const url = `${spotifyApiPath("artisttoptracks")}?id=${encodeURIComponent(id)}&market=${encodeURIComponent(market)}`;
    return await cachedGet2(`spotify:${url}`, url);
  },
  /** Fetches artist metadata */
  async artist(id) {
    const url = `${spotifyApiPath("artist")}?id=${encodeURIComponent(id)}`;
    return await cachedGet2(`spotify:${url}`, url);
  },
  /** Lists artist albums (paged) */
  async artistAlbums(id, includeGroups = "album,single", limit = 50, offset = 0) {
    const url = `${spotifyApiPath("artistalbums")}?id=${encodeURIComponent(id)}&includeGroups=${encodeURIComponent(includeGroups)}&limit=${limit}&offset=${offset}`;
    return await cachedGet2(`spotify:${url}`, url);
  },
  /** Transfers playback to the Web Playback SDK device */
  async transfer(deviceId, play = true) {
    logEvent("WebAmp", "spotify:api:transfer", { deviceId, play });
    await jsonFetch2(spotifyApiPath("transfer"), {
      method: "POST",
      body: JSON.stringify({ deviceId, play })
    });
  },
  /** Starts playback of a track URI on the given device */
  async playTrack(deviceId, trackUri, positionMs) {
    logEvent("WebAmp", "spotify:api:play", { deviceId, trackUri, positionMs: positionMs ?? null });
    await jsonFetch2(spotifyApiPath("play"), {
      method: "POST",
      body: JSON.stringify({ deviceId, trackUri, positionMs })
    });
  },
  /** Pauses playback */
  async pause(deviceId) {
    logEvent("WebAmp", "spotify:api:pause", { deviceId });
    await jsonFetch2(spotifyApiPath("pause"), { method: "POST", body: JSON.stringify({ deviceId }) });
  },
  /** Resumes playback */
  async resume(deviceId) {
    logEvent("WebAmp", "spotify:api:resume", { deviceId });
    await jsonFetch2(spotifyApiPath("resume"), { method: "POST", body: JSON.stringify({ deviceId }) });
  },
  /** Skips to next track */
  async next(deviceId) {
    logEvent("WebAmp", "spotify:api:next", { deviceId });
    await jsonFetch2(spotifyApiPath("next"), { method: "POST", body: JSON.stringify({ deviceId }) });
  },
  /** Skips to previous track */
  async previous(deviceId) {
    logEvent("WebAmp", "spotify:api:previous", { deviceId });
    await jsonFetch2(spotifyApiPath("previous"), { method: "POST", body: JSON.stringify({ deviceId }) });
  },
  /** Seeks playback position */
  async seek(deviceId, positionMs) {
    logEvent("WebAmp", "spotify:api:seek", { deviceId, positionMs });
    await jsonFetch2(spotifyApiPath("seek"), {
      method: "POST",
      body: JSON.stringify({ deviceId, positionMs })
    });
  },
  /** Navigates to login endpoint (starts OAuth) */
  login(returnUrl) {
    const ru = returnUrl ?? window.location.pathname + window.location.search + window.location.hash;
    window.location.assign(`${routePath2("spotify/login")}?returnUrl=${encodeURIComponent(ru)}`);
  }
};

// wwwroot/ts/utils.ts
function escapeHtml(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function shuffleCopy(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}
function appendFragment(parent, build) {
  const frag = document.createDocumentFragment();
  build(frag);
  parent.appendChild(frag);
}
function isSoundCloudTrackPlayable(track) {
  const access = typeof track?.access === "string" ? track.access.trim().toLowerCase() : "";
  if (!access) return true;
  return access === "playable";
}

// wwwroot/ts/library/trackLibrary.ts
var libraryStateCache = /* @__PURE__ */ new Map();
function getTrackSource(track) {
  return track.source ?? "spotify";
}
function getTrackLibraryKey(track) {
  return `${getTrackSource(track)}:${track.id}`;
}
function getSoundCloudTrackUrn(track) {
  return `soundcloud:tracks:${track.id}`;
}
function invalidateLibraryCaches(track) {
  switch (getTrackSource(track)) {
    case "soundcloud":
      clearCachedJsonByPrefix("soundclouduser:/api/webamp/soundclouduser/likedtracks");
      break;
    case "spotify":
    default:
      clearCachedJsonByPrefix("spotify:/api/webamp/spotify/savedtracks");
      break;
  }
}
function rememberTrackLibraryState(track, inLibrary) {
  track.inLibrary = inLibrary;
  libraryStateCache.set(getTrackLibraryKey(track), inLibrary);
  return track;
}
function getKnownTrackLibraryState(track) {
  if (!track) return void 0;
  if (typeof track.inLibrary === "boolean") {
    libraryStateCache.set(getTrackLibraryKey(track), track.inLibrary);
    return track.inLibrary;
  }
  return libraryStateCache.get(getTrackLibraryKey(track));
}
function applyKnownTrackLibraryState(track) {
  const known = getKnownTrackLibraryState(track);
  if (typeof known === "boolean") {
    track.inLibrary = known;
  }
  return track;
}
function createSpotifyTrack(raw, overrides = {}) {
  const images = raw?.album?.images ?? [];
  const artUrlSmall = images?.[images.length - 1]?.url;
  const artUrl = images?.[1]?.url ?? images?.[0]?.url;
  const artUrlLarge = images?.[0]?.url ?? images?.[1]?.url ?? artUrl;
  const artist = Array.isArray(raw?.artists) ? raw.artists.map((a) => a.name).join(", ") : "";
  const album = raw?.album?.name ?? "";
  const track = {
    id: raw.id,
    source: "spotify",
    title: raw.name,
    artist,
    albumId: raw?.album?.id,
    album,
    primaryArtistId: Array.isArray(raw?.artists) && raw.artists.length ? raw.artists[0]?.id : void 0,
    durationSec: Math.round((raw?.duration_ms ?? 0) / 1e3),
    artUrl,
    artUrlSmall,
    artUrlLarge,
    uri: raw?.uri,
    ...overrides
  };
  track.source = "spotify";
  return typeof track.inLibrary === "boolean" ? rememberTrackLibraryState(track, track.inLibrary) : applyKnownTrackLibraryState(track);
}
function createSoundCloudTrack(raw, overrides = {}) {
  const artUrl = typeof raw?.artwork_url === "string" ? raw.artwork_url : typeof raw?.user?.avatar_url === "string" ? raw.user.avatar_url : void 0;
  const baseInLibrary = typeof raw?.user_favorite === "boolean" ? raw.user_favorite : void 0;
  const track = {
    id: String(raw?.id),
    source: "soundcloud",
    title: typeof raw?.title === "string" ? raw.title : "(untitled)",
    artist: typeof raw?.user?.username === "string" ? raw.user.username : typeof raw?.user?.name === "string" ? raw.user.name : "",
    isPlayable: isSoundCloudTrackPlayable(raw),
    durationSec: Math.round((typeof raw?.duration === "number" ? raw.duration : 0) / 1e3),
    artUrl,
    artUrlSmall: artUrl,
    permalinkUrl: typeof raw?.permalink_url === "string" ? raw.permalink_url : void 0,
    inLibrary: baseInLibrary,
    ...overrides
  };
  track.source = "soundcloud";
  return typeof track.inLibrary === "boolean" ? rememberTrackLibraryState(track, track.inLibrary) : applyKnownTrackLibraryState(track);
}
async function resolveSpotifyTrackLibraryState(track) {
  return await spotifyApi.savedTracksContains(track.id);
}
async function resolveSoundCloudTrackLibraryState(track) {
  const data = await soundcloudUserApi.track(track.id);
  return !!data?.user_favorite;
}
async function ensureTrackLibraryState(track) {
  if (!track) return false;
  const known = getKnownTrackLibraryState(track);
  if (typeof known === "boolean") return known;
  const resolved = getTrackSource(track) === "soundcloud" ? await resolveSoundCloudTrackLibraryState(track) : await resolveSpotifyTrackLibraryState(track);
  rememberTrackLibraryState(track, resolved);
  return resolved;
}
function primeTrackLibraryState(track) {
  if (!track || typeof getKnownTrackLibraryState(track) === "boolean") return;
  void ensureTrackLibraryState(track).catch(() => {
  });
}
async function addTrackToLibrary(track) {
  switch (getTrackSource(track)) {
    case "soundcloud":
      await soundcloudUserApi.likeTrack(getSoundCloudTrackUrn(track));
      break;
    case "spotify":
    default:
      await spotifyApi.saveTrack(track.id);
      break;
  }
}
async function removeTrackFromLibrary(track) {
  switch (getTrackSource(track)) {
    case "soundcloud":
      await soundcloudUserApi.unlikeTrack(getSoundCloudTrackUrn(track));
      break;
    case "spotify":
    default:
      await spotifyApi.removeTrack(track.id);
      break;
  }
}
function getTrackLibraryActionTitle(track) {
  return getKnownTrackLibraryState(track) ? "Remove From Library" : "Add To Library";
}
async function toggleTrackLibrary(track) {
  if (!track) return null;
  try {
    const inLibrary = await ensureTrackLibraryState(track);
    const nextInLibrary = !inLibrary;
    if (nextInLibrary) {
      await addTrackToLibrary(track);
    } else {
      await removeTrackFromLibrary(track);
    }
    rememberTrackLibraryState(track, nextInLibrary);
    invalidateLibraryCaches(track);
    logEvent("WebAmp", nextInLibrary ? "track:add-to-library" : "track:remove-from-library", {
      source: getTrackSource(track),
      trackId: track.id
    });
    return nextInLibrary;
  } catch (error) {
    const message = formatErrorMessage(error);
    logEvent("WebAmp", "track:toggle-library:error", {
      source: getTrackSource(track),
      trackId: track.id
    }, message, "error");
    await showErrorDialog(message, "Library Update Failed");
    return null;
  }
}

// wwwroot/ts/ui/skeleton.ts
function renderListSkeleton(container, rows = 6) {
  container.replaceChildren();
  for (let i = 0; i < rows; i++) {
    const el = document.createElement("div");
    el.className = "wa-listitem wa-listitem--skeleton";
    el.innerHTML = `
            <span class="wa-skeleton wa-skeleton--title" aria-hidden="true"></span>
            <span class="wa-skeleton wa-skeleton--meta" aria-hidden="true"></span>
        `;
    container.appendChild(el);
  }
}

// wwwroot/ts/sources/soundcloud/soundcloudApi.ts
function soundCloudApiPath(path) {
  return apiPath2(`soundcloud/${path.replace(/^\/+/, "")}`);
}
async function jsonFetch3(url, init) {
  const startedAt = performance.now();
  const method = init?.method ?? "GET";
  let status = null;
  let errorLogged = false;
  try {
    const res = await fetch(url, {
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...init?.headers ?? {}
      },
      ...init
    });
    status = res.status;
    if (!res.ok) {
      const text2 = await res.text().catch(() => "");
      const error = new Error(`SoundCloud API proxy error ${res.status}: ${text2}`);
      logEvent("WebAmp", "api:error", { source: "soundcloud", method, status, ms: Math.round(performance.now() - startedAt), url }, error.message, "error");
      errorLogged = true;
      void showErrorDialog(formatErrorMessage(error), "Music Service Error");
      throw error;
    }
    logEvent("WebAmp", "api:ok", { source: "soundcloud", method, status, ms: Math.round(performance.now() - startedAt), url });
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch (error) {
    if (!errorLogged) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logEvent("WebAmp", "api:error", { source: "soundcloud", method, status, ms: Math.round(performance.now() - startedAt), url }, message, "error");
    }
    if (!(error instanceof Error && error.message.includes("SoundCloud API proxy error"))) {
      void showErrorDialog(formatErrorMessage(error), "Music Service Error");
    }
    throw error;
  }
}
async function cachedGet3(key, url) {
  return await cachedJsonFetch(key, () => jsonFetch3(url));
}
var soundcloudApi = {
  /** Checks if SoundCloud is configured and the server can obtain a token. */
  async status() {
    return await jsonFetch3(soundCloudApiPath("status"));
  },
  /** Searches public, playable SoundCloud tracks via server proxy. */
  async searchTracks(q, limit = 20, cursor) {
    const params = new URLSearchParams();
    params.set("q", q);
    params.set("limit", String(limit));
    if (cursor) params.set("cursor", cursor);
    const url = `${soundCloudApiPath("searchtracks")}?${params.toString()}`;
    return await cachedGet3(`soundcloud:${url}`, url);
  },
  /** Searches public SoundCloud playlists via server proxy. */
  async searchPlaylists(q, limit = 20, cursor) {
    const params = new URLSearchParams();
    params.set("q", q);
    params.set("limit", String(limit));
    if (cursor) params.set("cursor", cursor);
    const url = `${soundCloudApiPath("searchplaylists")}?${params.toString()}`;
    return await cachedGet3(`soundcloud:${url}`, url);
  },
  /** Searches public SoundCloud users via server proxy. */
  async searchUsers(q, limit = 20, cursor) {
    const params = new URLSearchParams();
    params.set("q", q);
    params.set("limit", String(limit));
    if (cursor) params.set("cursor", cursor);
    const url = `${soundCloudApiPath("searchusers")}?${params.toString()}`;
    return await cachedGet3(`soundcloud:${url}`, url);
  },
  /** Fetches raw SoundCloud track metadata for a given id. */
  async track(id) {
    const url = `${soundCloudApiPath("track")}?id=${encodeURIComponent(id)}`;
    return await cachedGet3(`soundcloud:${url}`, url);
  },
  /**
   * Resolves a direct stream URL (or descriptor) for a SoundCloud track id.
   * Frontend should feed the returned `url` into an <audio> element.
   */
  async stream(id) {
    const url = `${soundCloudApiPath("stream")}?id=${encodeURIComponent(id)}`;
    return await jsonFetch3(url);
  }
};

// wwwroot/ts/share/currentTrackShare.ts
var MOBILE_SHARE_MEDIA_QUERY = "(max-width: 820px)";
function isMobileViewport() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(MOBILE_SHARE_MEDIA_QUERY).matches;
}
function getTrackShareText(track) {
  const title = track.title?.trim() || "Track";
  const artist = track.artist?.trim();
  return artist ? `${artist} - ${title}` : title;
}
function getSpotifyExternalUrl(data) {
  const url = data?.external_urls?.spotify;
  return typeof url === "string" && url.trim() ? url : null;
}
async function copyToClipboard(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (typeof document === "undefined") {
    throw new Error("Clipboard is unavailable.");
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    const ok = document.execCommand("copy");
    if (!ok) throw new Error("Copy failed.");
  } finally {
    textarea.remove();
  }
}
async function shareOnMobile(track, url) {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function" || !isMobileViewport()) {
    return false;
  }
  const payload = {
    title: track.title,
    text: getTrackShareText(track),
    url
  };
  if (typeof navigator.canShare === "function" && !navigator.canShare(payload)) {
    return false;
  }
  try {
    await navigator.share(payload);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return true;
    }
    throw error;
  }
}
async function resolveCurrentTrackShareUrl(track) {
  if (typeof track.permalinkUrl === "string" && track.permalinkUrl.trim()) {
    return track.permalinkUrl;
  }
  switch (track.source) {
    case "soundcloud": {
      const info = await soundcloudApi.stream(track.id);
      const url = info?.permalinkUrl;
      return typeof url === "string" && url.trim() ? url : null;
    }
    case "spotify":
    default: {
      const data = await spotifyApi.track(track.id);
      const externalUrl = getSpotifyExternalUrl(data);
      if (externalUrl) return externalUrl;
      return track.id ? `https://open.spotify.com/track/${encodeURIComponent(track.id)}` : null;
    }
  }
}
async function shareCurrentTrack(track) {
  if (!track) return;
  try {
    const url = await resolveCurrentTrackShareUrl(track);
    if (!url) {
      throw new Error("This track does not have a shareable provider URL.");
    }
    const mode = await shareOnMobile(track, url) ? "sheet" : "clipboard";
    if (mode === "clipboard") {
      await copyToClipboard(url);
      await showAlert({
        title: "Share Song",
        message: "Song URL copied to clipboard."
      });
    }
    logEvent("WebAmp", "track:share", {
      source: track.source ?? "spotify",
      trackId: track.id,
      mode
    });
  } catch (error) {
    const message = formatErrorMessage(error);
    logEvent("WebAmp", "track:share:error", {
      source: track.source ?? "spotify",
      trackId: track.id
    }, message, "error");
    await showErrorDialog(message, "Share Failed");
  }
}

// wwwroot/ts/ui/trackContextMenu.ts
function openTrackContextMenu(opts) {
  const {
    anchor,
    track,
    title = "Track Actions",
    allowNavigateOnMobile = true,
    onLibraryBusyChange,
    onShareBusyChange
  } = opts;
  const t = track;
  const canShowAlbum = !!t?.albumId;
  const canShowArtist = !!t?.primaryArtistId;
  void (async () => {
    try {
      onLibraryBusyChange?.(true);
      await ensureTrackLibraryState(track);
      const items = [
        {
          id: "toggle-library",
          title: getTrackLibraryActionTitle(track),
          iconSrc: indiumSvg("heart-filled.svg"),
          onSelect: async () => {
            try {
              onLibraryBusyChange?.(true);
              await toggleTrackLibrary(track);
            } finally {
              onLibraryBusyChange?.(false);
            }
          }
        },
        ...canShowAlbum ? [{
          id: "show-album",
          title: "Show Album",
          iconSrc: indiumSvg("album-filled.svg"),
          onSelect: () => {
            const albumId = t?.albumId;
            if (!albumId) return;
            if (!allowNavigateOnMobile && window.matchMedia("(max-width: 820px)").matches) return;
            window.dispatchEvent(
              new CustomEvent("wa:navigate:album", { detail: { albumId } })
            );
          }
        }] : [],
        ...canShowArtist ? [{
          id: "show-artist",
          title: "Show Artist",
          iconSrc: indiumSvg("artist-filled.svg"),
          onSelect: () => {
            const artistId = t?.primaryArtistId;
            if (!artistId) return;
            if (!allowNavigateOnMobile && window.matchMedia("(max-width: 820px)").matches) return;
            window.dispatchEvent(
              new CustomEvent("wa:navigate:artist", { detail: { artistId } })
            );
          }
        }] : [],
        {
          id: "share",
          title: "Share",
          iconSrc: indiumSvg("share.svg"),
          onSelect: async () => {
            try {
              onShareBusyChange?.(true);
              await shareCurrentTrack(track);
            } finally {
              onShareBusyChange?.(false);
            }
          }
        }
      ];
      openPopupMenu({
        anchor,
        title,
        items
      });
    } finally {
      onLibraryBusyChange?.(false);
    }
  })();
}

// wwwroot/ts/ui/trackListItem.ts
function createTrackListItem(opts) {
  const { track, onClick } = opts;
  const isPlayable = track.isPlayable !== false;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wa-listitem wa-trackitem";
  btn.setAttribute("data-wa-track", track.id);
  if (!isPlayable) {
    btn.classList.add("wa-listitem--disabled", "wa-trackitem--disabled");
    btn.setAttribute("aria-disabled", "true");
  }
  const art = track.artUrlSmall ?? track.artUrl ?? "";
  const leading = opts.leading ?? "art";
  const showMeta = opts.showMeta ?? true;
  const idx = typeof opts.index === "number" ? opts.index : typeof track.trackNumber === "number" ? track.trackNumber : void 0;
  const variant = opts.variant ?? "default";
  const defaultMeta = `${track.artist}${track.album ? ` \u2014 ${track.album}` : ""}`;
  const indicatorHtml = isPlayable ? `
        <span class="wa-trackitem__indicator" data-wa-track-toggle="${escapeHtml(track.id)}" aria-hidden="true">
            <img class="wa-trackitem__indicator-icon wa-trackitem__indicator-icon--wave" src="${indiumSvg("waveform.svg")}" alt="" decoding="async" />
            <img class="wa-trackitem__indicator-icon wa-trackitem__indicator-icon--wave-paused" src="${indiumSvg("waveform-paused.svg")}" alt="" decoding="async" />
            <img class="wa-trackitem__indicator-icon wa-trackitem__indicator-icon--play" src="${indiumSvg("play-filled.svg")}" alt="" decoding="async" />
            <img class="wa-trackitem__indicator-icon wa-trackitem__indicator-icon--pause" src="${indiumSvg("pause-filled.svg")}" alt="" decoding="async" />
        </span>
    ` : "";
  const blockedHtml = !isPlayable ? `
        <span class="wa-trackitem__blocked" aria-hidden="true">
            <img class="wa-trackitem__blocked-icon" src="${indiumSvg("no.svg")}" alt="" decoding="async" />
        </span>
        ` : "";
  if (variant === "artistTop") {
    const indexLabel = typeof idx === "number" ? String(idx) : "\u2013";
    const albumLabel = track.album ?? "";
    const artHtml = `
        <span class="wa-trackitem__art" aria-hidden="true">
            ${art ? `<img class="wa-trackitem__img" alt="" loading="lazy" decoding="async" />` : `<span class="wa-trackitem__img wa-trackitem__img--empty"></span>`}
            ${indicatorHtml}
        </span>
        `;
    btn.innerHTML = `
        ${artHtml}
        <span class="wa-trackitem__text wa-trackitem__textindex">
            <span class="wa-trackitem__title">${escapeHtml(indexLabel)}</span>
        </span>
        <span class="wa-trackitem__text">
            <span class="wa-trackitem__title">${escapeHtml(track.title)}</span>
            ${albumLabel ? `<span class="wa-trackitem__meta">${escapeHtml(albumLabel)}</span>` : ""}
        </span>
        ${blockedHtml}
        `;
  } else {
    const leadingHtml = leading === "index" ? `
        <span class="wa-trackitem__art wa-trackitem__art--index" aria-hidden="true">
            <span class="wa-trackitem__index">${escapeHtml(String(idx ?? "\u2013"))}</span>
            ${indicatorHtml}
        </span>
        ` : `
        <span class="wa-trackitem__art" aria-hidden="true">
            ${art ? `<img class="wa-trackitem__img" alt="" loading="lazy" decoding="async" />` : `<span class="wa-trackitem__img wa-trackitem__img--empty"></span>`}
            ${indicatorHtml}
        </span>
        `;
    btn.innerHTML = `
        ${leadingHtml}
        <span class="wa-trackitem__text">
            <span class="wa-trackitem__title">${escapeHtml(track.title)}</span>
            ${showMeta ? `<span class="wa-trackitem__meta">${escapeHtml(defaultMeta)}</span>` : ""}
        </span>
        ${blockedHtml}
        `;
  }
  if (art) {
    const img = btn.querySelector(
      "img.wa-trackitem__img"
    );
    applyCachedArt(img, art);
  }
  if (isPlayable) {
    const toggle = btn.querySelector("[data-wa-track-toggle]");
    toggle?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent("wa:track:toggle", {
          detail: { trackId: track.id }
        })
      );
    });
  }
  btn.addEventListener("click", (e) => {
    if (!isPlayable) {
      e.preventDefault();
      e.stopPropagation();
      void showAlert({
        title: "Track Unavailable",
        message: "SoundCloud does not allow this song to be streamed by external apps.",
        variant: "danger"
      });
      return;
    }
    onClick();
  });
  btn.addEventListener("contextmenu", (e) => {
    if (!isPlayable) return;
    openTrackContextMenu({
      anchor: btn,
      track,
      title: "Track Actions"
    });
    e.preventDefault();
    e.stopPropagation();
  });
  let touchTimer = null;
  let initialTouchY = null;
  const LONG_PRESS_MS = 500;
  const MOVE_CANCEL_THRESHOLD_PX = 8;
  btn.addEventListener(
    "touchstart",
    (e) => {
      if (!isPlayable) return;
      if (touchTimer !== null) {
        window.clearTimeout(touchTimer);
        touchTimer = null;
      }
      initialTouchY = e.touches[0]?.clientY ?? null;
      touchTimer = window.setTimeout(() => {
        touchTimer = null;
        openTrackContextMenu({
          anchor: btn,
          track,
          title: "Track Actions"
        });
      }, LONG_PRESS_MS);
    },
    { passive: true }
  );
  btn.addEventListener(
    "touchmove",
    (e) => {
      if (touchTimer === null || initialTouchY === null) return;
      const currentTouchY = e.touches[0]?.clientY;
      if (typeof currentTouchY !== "number") return;
      const yCoordDiffInPxAfterTimer = Math.abs(
        currentTouchY - initialTouchY
      );
      if (yCoordDiffInPxAfterTimer > MOVE_CANCEL_THRESHOLD_PX) {
        window.clearTimeout(touchTimer);
        touchTimer = null;
        initialTouchY = null;
      }
    },
    { passive: true }
  );
  const cancelTouch = () => {
    if (touchTimer !== null) {
      window.clearTimeout(touchTimer);
      touchTimer = null;
    }
    initialTouchY = null;
  };
  btn.addEventListener("touchend", cancelTouch);
  btn.addEventListener("touchcancel", cancelTouch);
  return btn;
}

// wwwroot/ts/ui/playlistListItem.ts
function createPlaylistListItem(opts) {
  const { playlist, onClick } = opts;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wa-listitem wa-trackitem";
  btn.setAttribute("data-wa-playlist", playlist.id);
  const art = playlist.artUrlSmall ?? "";
  btn.innerHTML = `
        <span class="wa-trackitem__art" aria-hidden="true">
            ${art ? `<img class="wa-trackitem__img" alt="" loading="lazy" decoding="async" />` : `<span class="wa-trackitem__img wa-trackitem__img--empty"></span>`}
        </span>
        <span class="wa-trackitem__text">
            <span class="wa-trackitem__title">${escapeHtml(playlist.title)}</span>
            <span class="wa-trackitem__meta">${escapeHtml(playlist.owner)}</span>
        </span>
    `;
  if (art) {
    const img = btn.querySelector("img.wa-trackitem__img");
    applyCachedArt(img, art);
  }
  btn.addEventListener("click", onClick);
  return btn;
}

// wwwroot/ts/ui/queueActions.ts
var LS_KEY = "wa_shuffle_enabled";
var shuffleDirty = false;
function playableTracks(tracks) {
  return tracks.filter((t) => t?.isPlayable !== false);
}
function getShufflePref() {
  return window.localStorage.getItem(LS_KEY) === "true";
}
function setShufflePref(enabled) {
  window.localStorage.setItem(LS_KEY, enabled ? "true" : "false");
}
function isShuffleDirty() {
  return shuffleDirty;
}
function setShuffleEnabled(enabled, opts) {
  const next = !!enabled;
  setShufflePref(next);
  if (opts?.markDirty) {
    shuffleDirty = true;
  }
  const topbar = document.querySelector('[data-wa-action="shuffle-toggle"]');
  const nowPlaying = document.querySelector("[data-wa-nowplaying-shuffle]");
  if (topbar) topbar.checked = next;
  if (nowPlaying) nowPlaying.checked = next;
  window.dispatchEvent(new CustomEvent("wa:shuffle:set", { detail: { enabled: next } }));
}
function bindQueueActions(opts) {
  const actions = document.querySelector("[data-wa-queue-actions]");
  const shuffleInput = actions?.querySelector('[data-wa-action="shuffle-toggle"]');
  const playBtn = actions?.querySelector('[data-wa-action="queue-play"]');
  const playIcon = actions?.querySelector(".wa-topbar__play-icon img");
  const playLabel = actions?.querySelector(".wa-topbar__play-label");
  if (!actions || !shuffleInput || !playBtn) return () => {
  };
  let isViewQueueActive = false;
  const syncVisible = () => {
    const hasTracks = playableTracks(opts.getTracks()).length > 0;
    actions.style.display = hasTracks ? "flex" : "none";
  };
  const syncPlayButton = (isPlaying) => {
    if (playLabel) playLabel.textContent = isPlaying ? "Pause" : "Play";
    if (playBtn) playBtn.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
    if (playIcon) {
      const src = isPlaying ? indiumSvg("pause-filled.svg") : indiumSvg("play-filled.svg");
      if (playIcon.getAttribute("src") !== src) {
        playIcon.setAttribute("src", src);
      }
    }
  };
  const computeKey = (tracks) => tracks.map((t) => t.id).join("|");
  const updateViewQueueActive = (globalTracksRaw) => {
    const viewTracks = playableTracks(opts.getTracks());
    const globalTracks = playableTracks(globalTracksRaw);
    if (!viewTracks.length || !globalTracks.length) {
      isViewQueueActive = false;
      return;
    }
    isViewQueueActive = computeKey(viewTracks) === computeKey(globalTracks);
  };
  const onTrackSelect = (e) => {
    const ev = e;
    const tracks = Array.isArray(ev.detail?.tracks) ? ev.detail.tracks : [];
    if (!tracks.length) {
      isViewQueueActive = false;
      return;
    }
    updateViewQueueActive(tracks);
  };
  window.addEventListener("wa:track:select", onTrackSelect);
  shuffleInput.checked = getShufflePref();
  syncVisible();
  const onShuffle = () => {
    setShuffleEnabled(!!shuffleInput.checked, { markDirty: true });
  };
  const onPlay = () => {
    const tracks = playableTracks(opts.getTracks());
    if (!tracks.length) return;
    if (isViewQueueActive) {
      window.dispatchEvent(new CustomEvent("wa:player:toggle"));
      return;
    }
    const shuffle = !!shuffleInput.checked;
    const queue = shuffle ? shuffleCopy(tracks) : tracks.slice();
    opts.onQueueApplied?.(queue);
    window.dispatchEvent(new CustomEvent("wa:queue:set", { detail: { tracks: queue, wrap: false } }));
    window.dispatchEvent(new CustomEvent("wa:track:select", { detail: { trackId: queue[0]?.id, from: "queue-play", tracks: queue } }));
    syncVisible();
  };
  shuffleInput.addEventListener("change", onShuffle);
  playBtn.addEventListener("click", onPlay);
  const destroy = (() => {
    shuffleInput.removeEventListener("change", onShuffle);
    playBtn.removeEventListener("click", onPlay);
    window.removeEventListener("wa:track:select", onTrackSelect);
  });
  destroy.refresh = syncVisible;
  return destroy;
}

// wwwroot/ts/views/homeView.ts
var homeView = {
  id: "home",
  mount(ctx) {
    const root = ctx.rootEl;
    const playlistsEl = root.querySelector("[data-wa-playlists]");
    const playlistsStatusEl = root.querySelector("[data-wa-playlists-status]");
    const likedEl = root.querySelector("[data-wa-liked]");
    const likedStatusEl = root.querySelector("[data-wa-liked-status]");
    const recentEl = root.querySelector("[data-wa-home-recent]");
    const recentCard = root.querySelector("[data-wa-home-recent-card]");
    const setPlaylistsStatus = (t) => {
      if (playlistsStatusEl) playlistsStatusEl.textContent = t;
    };
    const setLikedStatus = (t) => {
      if (likedStatusEl) likedStatusEl.textContent = t;
    };
    const cleanupActions = bindQueueActions({
      root,
      getTracks: () => []
      // always empty > syncVisible hides the actions
    });
    homeView._cleanup = () => {
      cleanupActions();
    };
    const spotifySource = ctx.services.musicSource;
    const soundCloudSource = ctx.services.soundCloudSource;
    const isSpotifyConnected = spotifySource?.getState().isConnected ?? false;
    const isSoundCloudConnected = soundCloudSource?.getState().isConnected ?? false;
    const loadPlaylistsCard = async () => {
      if (!playlistsEl) return;
      if (!isSpotifyConnected && !isSoundCloudConnected) {
        playlistsEl.replaceChildren();
        setPlaylistsStatus("Connect to a music source to see your playlists.");
        return;
      }
      if (isSpotifyConnected) {
        try {
          setPlaylistsStatus("Loading\u2026");
          renderListSkeleton(playlistsEl, 6);
          const data = await spotifyApi.myPlaylists(20, 0);
          const items = data?.items ?? [];
          playlistsEl.replaceChildren();
          for (const p of items) {
            const id = p?.id;
            const name = p?.name ?? "(untitled)";
            const owner = p?.owner?.display_name ?? p?.owner?.id ?? "\u2014";
            const images = p?.images ?? [];
            const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
            if (!id) continue;
            playlistsEl.appendChild(createPlaylistListItem({
              playlist: { id, title: name, owner, artUrlSmall },
              onClick: () => ctx.router.navigate(routePath2(`playlists/${id}`))
            }));
          }
          setPlaylistsStatus(items.length ? "" : "No playlists found.");
        } catch (err) {
          setPlaylistsStatus(err?.message ?? "Failed to load playlists");
          playlistsEl.replaceChildren();
        }
        return;
      }
      if (isSoundCloudConnected) {
        try {
          setPlaylistsStatus("Loading\u2026");
          renderListSkeleton(playlistsEl, 6);
          const data = await soundcloudUserApi.myPlaylists(20);
          const items = data?.collection ?? data?.items ?? [];
          playlistsEl.replaceChildren();
          for (const p of items) {
            const id = p?.id;
            if (!id) continue;
            const title = p?.title ?? "(untitled)";
            const owner = typeof p?.user?.username === "string" && p.user.username || typeof p?.user?.name === "string" && p.user.name || "\u2014";
            const artUrlSmall = typeof p?.artwork_url === "string" ? p.artwork_url : Array.isArray(p?.tracks) && p.tracks.length && typeof p.tracks[0]?.artwork_url === "string" ? p.tracks[0].artwork_url : void 0;
            playlistsEl.appendChild(createPlaylistListItem({
              playlist: { id: String(id), title, owner, artUrlSmall },
              onClick: () => ctx.router.navigate(routePath2(`playlists/${id}`))
            }));
          }
          setPlaylistsStatus(items.length ? "" : "No playlists found.");
        } catch (err) {
          setPlaylistsStatus(err?.message ?? "Failed to load playlists");
          playlistsEl.replaceChildren();
        }
      }
    };
    const loadLikedCard = async () => {
      if (!likedEl) return;
      if (!isSpotifyConnected && !isSoundCloudConnected) {
        likedEl.replaceChildren();
        setLikedStatus("Connect to a music source to see your liked songs.");
        return;
      }
      if (isSpotifyConnected) {
        try {
          setLikedStatus("Loading\u2026");
          renderListSkeleton(likedEl, 6);
          const data = await spotifyApi.savedTracks(20, 0);
          const items = data?.items ?? [];
          const tracks = items.map((it) => it?.track).filter(Boolean).map((t) => createSpotifyTrack(t, { inLibrary: true }));
          likedEl.replaceChildren();
          for (const t of tracks) {
            likedEl.appendChild(createTrackListItem({
              track: t,
              onClick: () => {
                window.dispatchEvent(new CustomEvent("wa:track:select", { detail: { trackId: t.id, tracks: tracks.slice(), wrap: false, from: "liked" } }));
              }
            }));
          }
          setLikedStatus(tracks.length ? "" : "No liked songs found.");
        } catch (err) {
          setLikedStatus(err?.message ?? "Failed to load liked songs");
          likedEl.replaceChildren();
        }
        return;
      }
      if (isSoundCloudConnected) {
        try {
          setLikedStatus("");
          renderListSkeleton(likedEl, 6);
          const data = await soundcloudUserApi.likedTracks(20);
          const collection = data?.collection ?? [];
          const tracks = collection.map((it) => it?.track ?? it).filter(Boolean).map((t) => createSoundCloudTrack(t, { inLibrary: true })).filter(Boolean);
          likedEl.replaceChildren();
          for (const t of tracks) {
            likedEl.appendChild(createTrackListItem({
              track: t,
              onClick: () => {
                window.dispatchEvent(new CustomEvent("wa:track:select", { detail: { trackId: t.id, tracks: tracks.slice(), wrap: false, from: "liked" } }));
              }
            }));
          }
          setLikedStatus(tracks.length ? "" : "No liked songs found.");
        } catch (err) {
          setLikedStatus(err?.message ?? "Failed to load liked songs");
          likedEl.replaceChildren();
        }
      }
    };
    const loadRecentCard = async () => {
      if (!recentCard || !recentEl) return;
      if (isSoundCloudConnected) {
        try {
          recentCard.style.display = "";
          recentEl.replaceChildren();
          renderListSkeleton(recentEl, 5);
          const data = await soundcloudUserApi.recentActivities(10);
          const collection = data?.collection ?? [];
          recentEl.replaceChildren();
          for (const item of collection) {
            const origin = item?.origin ?? item?.playlist ?? item?.track ?? null;
            if (!origin) continue;
            const kind = origin.kind;
            if (kind === "track") {
              const id = origin.id;
              if (!id) continue;
              const title = typeof origin.title === "string" ? origin.title : "(untitled)";
              const artist = typeof origin?.user?.username === "string" ? origin.user.username : typeof origin?.user?.name === "string" ? origin.user.name : "";
              const track = createSoundCloudTrack(origin);
              const row = createTrackListItem({
                track,
                onClick: () => {
                  window.dispatchEvent(new CustomEvent("wa:track:select", {
                    detail: {
                      trackId: track.id,
                      tracks: [track],
                      wrap: false,
                      from: "home-recent"
                    }
                  }));
                }
              });
              const pill = document.createElement("span");
              pill.className = "wa-listitem__pill";
              pill.textContent = "Track";
              row.appendChild(pill);
              recentEl.appendChild(row);
            }
          }
          if (!recentEl.children.length) {
            recentCard.style.display = "none";
          }
        } catch {
          recentCard.style.display = "none";
          recentEl.replaceChildren();
        }
      } else if (isSpotifyConnected) {
        recentCard.style.display = "none";
        recentEl.replaceChildren();
      } else {
        recentCard.style.display = "none";
        recentEl.replaceChildren();
      }
    };
    void loadPlaylistsCard();
    void loadLikedCard();
    void loadRecentCard();
  },
  unmount() {
    homeView._cleanup?.();
    homeView._cleanup = null;
  }
};

// wwwroot/ts/ui/albumListItem.ts
function createAlbumListItem(opts) {
  const { album, onClick } = opts;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wa-listitem wa-trackitem";
  btn.setAttribute("data-wa-album", album.id);
  const art = album.artUrlSmall ?? "";
  btn.innerHTML = `
        <span class="wa-trackitem__art" aria-hidden="true">
            ${art ? `<img class="wa-trackitem__img" alt="" loading="lazy" decoding="async" />` : `<span class="wa-trackitem__img wa-trackitem__img--empty"></span>`}
        </span>
        <span class="wa-trackitem__text">
            <span class="wa-trackitem__title">${escapeHtml(album.title)}</span>
            <span class="wa-trackitem__meta">${escapeHtml(album.artist)}</span>
        </span>
    `;
  if (art) {
    const img = btn.querySelector("img.wa-trackitem__img");
    applyCachedArt(img, art);
  }
  btn.addEventListener("click", onClick);
  return btn;
}

// wwwroot/ts/ui/artistListItem.ts
function createArtistListItem(opts) {
  const { artist, onClick } = opts;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wa-listitem wa-trackitem";
  btn.setAttribute("data-wa-artist", artist.id);
  const art = artist.artUrlSmall ?? "";
  btn.innerHTML = `
        <span class="wa-trackitem__art" aria-hidden="true" style="border-radius:999px;">
            ${art ? `<img class="wa-trackitem__img" alt="" loading="lazy" decoding="async" />` : `<span class="wa-trackitem__img wa-trackitem__img--empty"></span>`}
        </span>
        <span class="wa-trackitem__text">
            <span class="wa-trackitem__title">${escapeHtml(artist.name)}</span>
            <span class="wa-trackitem__meta">Artist</span>
        </span>
    `;
  if (art) {
    const img = btn.querySelector("img.wa-trackitem__img");
    applyCachedArt(img, art);
  }
  btn.addEventListener("click", onClick);
  return btn;
}

// wwwroot/ts/views/searchView.ts
function mapSpotifyTrack(it) {
  return createSpotifyTrack(it);
}
var searchView = {
  id: "search",
  mount(ctx) {
    const root = ctx.rootEl;
    const form = root.querySelector(
      "[data-wa-search-form]"
    );
    const input = root.querySelector(
      "[data-wa-search-input]"
    );
    const statusEl = root.querySelector(
      "[data-wa-search-status]"
    );
    const resultsEl = root.querySelector(
      "[data-wa-search-results]"
    );
    const resultsCard = root.querySelector(
      "[data-wa-search-results-card]"
    );
    if (!form || !input || !resultsEl) return;
    const setStatus = (t) => {
      if (statusEl) statusEl.textContent = t;
    };
    let destroyed = false;
    let currentQuery = "";
    const baseTracks = [];
    let queueActive = baseTracks;
    const cleanupActions = bindQueueActions({
      root,
      getTracks: () => baseTracks,
      onQueueApplied: (q) => {
        queueActive = q.slice();
      }
    });
    const reset = () => {
      baseTracks.splice(0, baseTracks.length);
      queueActive = baseTracks;
      resultsEl.replaceChildren();
    };
    const spotifySource = ctx.services.musicSource;
    const soundCloudSource = ctx.services.soundCloudSource;
    const isSpotifyConnected = spotifySource?.getState().isConnected ?? false;
    const isSoundCloudConnected = soundCloudSource?.getState().isConnected ?? false;
    const updateUrlQuery = (q) => {
      try {
        const url = new URL(window.location.href);
        if (q) {
          url.searchParams.set("q", q);
        } else {
          url.searchParams.delete("q");
        }
        history.replaceState(history.state, "", url.toString());
      } catch {
      }
    };
    const runSearch = async (rawQuery) => {
      const q = rawQuery.trim();
      if (!q) {
        currentQuery = "";
        updateUrlQuery("");
        if (resultsCard) resultsCard.style.display = "none";
        setStatus("");
        reset();
        return;
      }
      currentQuery = q;
      updateUrlQuery(q);
      reset();
      if (resultsCard) resultsCard.style.display = "block";
      setStatus("Searching\u2026");
      renderListSkeleton(resultsEl, 8);
      try {
        if (!isSpotifyConnected && !isSoundCloudConnected) {
          setStatus("Connect to a music source to search.");
          resultsEl.replaceChildren();
          if (resultsCard) resultsCard.style.display = "none";
          return;
        }
        const useSpotify = isSpotifyConnected || !isSoundCloudConnected;
        if (useSpotify) {
          const data = await spotifyApi.search(
            currentQuery,
            "track,album,artist,playlist",
            5,
            0
          );
          if (destroyed) return;
          const trackItems = data?.tracks?.items ?? [];
          const albumItems = data?.albums?.items ?? [];
          const artistItems = data?.artists?.items ?? [];
          const playlistItems = data?.playlists?.items ?? [];
          const tracks = trackItems.map(mapSpotifyTrack);
          baseTracks.push(...tracks);
          queueActive = baseTracks;
          cleanupActions.refresh?.();
          resultsEl.replaceChildren();
          const makeSection = (title) => {
            const wrap = document.createElement("div");
            const h = document.createElement("h2");
            h.className = "wa-h2";
            h.textContent = title;
            const list = document.createElement("div");
            list.className = "wa-list";
            wrap.appendChild(h);
            wrap.appendChild(list);
            return { wrap, list };
          };
          const tracksSec = makeSection("Tracks");
          const albumsSec = makeSection("Albums");
          const artistsSec = makeSection("Artists");
          const playlistsSec = makeSection("Playlists");
          const qLower = currentQuery.toLowerCase();
          const startsWithQuery = (name) => !!name && name.toLowerCase().startsWith(qLower);
          let topHit = null;
          if (!topHit) {
            for (const t of tracks) {
              if (startsWithQuery(t.title)) {
                topHit = { kind: "track", payload: t };
                break;
              }
            }
          }
          if (!topHit) {
            for (const a of artistItems) {
              const name = typeof a?.name === "string" ? a.name : "";
              if (!startsWithQuery(name)) continue;
              const id = a?.id;
              if (!id) continue;
              const images = a?.images ?? [];
              const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
              topHit = {
                kind: "artist",
                payload: {
                  id,
                  name: name || "(untitled)",
                  artUrlSmall
                }
              };
              break;
            }
          }
          if (!topHit) {
            for (const a of albumItems) {
              const name = typeof a?.name === "string" ? a.name : "";
              if (!startsWithQuery(name)) continue;
              const id = a?.id;
              if (!id) continue;
              const artist = Array.isArray(a?.artists) ? a.artists.map((x) => x.name).join(", ") : "";
              const images = a?.images ?? [];
              const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
              topHit = {
                kind: "album",
                payload: {
                  id,
                  title: name || "(untitled)",
                  artist,
                  artUrlSmall
                }
              };
              break;
            }
          }
          if (!topHit) {
            for (const p of playlistItems) {
              const name = typeof p?.name === "string" ? p.name : "";
              if (!startsWithQuery(name)) continue;
              const id = p?.id;
              if (!id) continue;
              const owner = p?.owner?.display_name ?? p?.owner?.id ?? "\u2014";
              const images = p?.images ?? [];
              const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
              topHit = {
                kind: "playlist",
                payload: {
                  id,
                  title: name || "(untitled)",
                  owner,
                  artUrlSmall
                }
              };
              break;
            }
          }
          let topHitSec = null;
          if (topHit) {
            topHitSec = makeSection("Top Hit");
            switch (topHit.kind) {
              case "track": {
                const t = topHit.payload;
                topHitSec.list.appendChild(
                  createTrackListItem({
                    track: t,
                    onClick: () => window.dispatchEvent(
                      new CustomEvent(
                        "wa:track:select",
                        {
                          detail: {
                            trackId: t.id,
                            tracks: baseTracks.slice(),
                            wrap: false,
                            from: "search"
                          }
                        }
                      )
                    )
                  })
                );
                break;
              }
              case "album": {
                const a = topHit.payload;
                topHitSec.list.appendChild(
                  createAlbumListItem({
                    album: a,
                    onClick: () => ctx.router.navigate(
                      routePath2(`albums/${a.id}`)
                    )
                  })
                );
                break;
              }
              case "artist": {
                const a = topHit.payload;
                topHitSec.list.appendChild(
                  createArtistListItem({
                    artist: a,
                    onClick: () => ctx.router.navigate(
                      routePath2(`artists/${a.id}`)
                    )
                  })
                );
                break;
              }
              case "playlist": {
                const p = topHit.payload;
                topHitSec.list.appendChild(
                  createPlaylistListItem({
                    playlist: p,
                    onClick: () => ctx.router.navigate(
                      routePath2(`playlists/${p.id}`)
                    )
                  })
                );
                break;
              }
            }
          }
          for (let i = 0; i < tracks.length; i++) {
            const t = tracks[i];
            tracksSec.list.appendChild(
              createTrackListItem({
                track: t,
                onClick: () => window.dispatchEvent(
                  new CustomEvent("wa:track:select", {
                    detail: {
                      trackId: t.id,
                      tracks: baseTracks.slice(),
                      wrap: false,
                      from: "search"
                    }
                  })
                )
              })
            );
          }
          for (const a of albumItems) {
            const id = a?.id;
            if (!id) continue;
            const title = a?.name ?? "(untitled)";
            const artist = Array.isArray(a?.artists) ? a.artists.map((x) => x.name).join(", ") : "";
            const images = a?.images ?? [];
            const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
            albumsSec.list.appendChild(
              createAlbumListItem({
                album: { id, title, artist, artUrlSmall },
                onClick: () => ctx.router.navigate(
                  routePath2(`albums/${id}`)
                )
              })
            );
          }
          for (const a of artistItems) {
            const id = a?.id;
            if (!id) continue;
            const name = a?.name ?? "(untitled)";
            const images = a?.images ?? [];
            const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
            artistsSec.list.appendChild(
              createArtistListItem({
                artist: { id, name, artUrlSmall },
                onClick: () => ctx.router.navigate(
                  routePath2(`artists/${id}`)
                )
              })
            );
          }
          for (const p of playlistItems) {
            const id = p?.id;
            if (!id) continue;
            const title = p?.name ?? "(untitled)";
            const owner = p?.owner?.display_name ?? p?.owner?.id ?? "\u2014";
            const images = p?.images ?? [];
            const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
            playlistsSec.list.appendChild(
              createPlaylistListItem({
                playlist: { id, title, owner, artUrlSmall },
                onClick: () => ctx.router.navigate(
                  routePath2(`playlists/${id}`)
                )
              })
            );
          }
          const any = tracksSec.list.childElementCount || albumItems.length || artistItems.length || playlistItems.length;
          if (!any) {
            setStatus("No results found.");
            if (resultsCard) resultsCard.style.display = "none";
            return;
          }
          if (topHitSec) resultsEl.appendChild(topHitSec.wrap);
          if (tracksSec.list.childElementCount)
            resultsEl.appendChild(tracksSec.wrap);
          if (albumsSec.list.childElementCount)
            resultsEl.appendChild(albumsSec.wrap);
          if (artistsSec.list.childElementCount)
            resultsEl.appendChild(artistsSec.wrap);
          if (playlistsSec.list.childElementCount)
            resultsEl.appendChild(playlistsSec.wrap);
          setStatus("");
        } else {
          const [tracksRes, playlistsRes, usersRes] = await Promise.allSettled([
            soundcloudApi.searchTracks(currentQuery, 25),
            soundcloudApi.searchPlaylists(currentQuery, 12),
            soundcloudApi.searchUsers(currentQuery, 12)
          ]);
          if (destroyed) return;
          if (tracksRes.status === "rejected") {
            throw tracksRes.reason;
          }
          const toCollection = (data) => Array.isArray(data?.collection) ? data.collection : Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
          const trackItems = toCollection(tracksRes.value);
          const playlistItems = playlistsRes.status === "fulfilled" ? toCollection(playlistsRes.value) : [];
          const userItems = usersRes.status === "fulfilled" ? toCollection(usersRes.value) : [];
          const scTracks = trackItems.filter(
            (it) => !!it && typeof it.id !== "undefined"
          ).map((it) => {
            return createSoundCloudTrack(it);
          });
          baseTracks.push(...scTracks);
          queueActive = baseTracks;
          cleanupActions.refresh?.();
          resultsEl.replaceChildren();
          const makeSection = (title) => {
            const wrap = document.createElement("div");
            const h = document.createElement("h2");
            h.className = "wa-h2";
            h.textContent = title;
            const list = document.createElement("div");
            list.className = "wa-list";
            wrap.appendChild(h);
            wrap.appendChild(list);
            return { wrap, list };
          };
          const tracksSec = makeSection("Tracks");
          const playlistsSec = makeSection("Playlists");
          const artistsSec = makeSection("Artists");
          for (const t of scTracks) {
            tracksSec.list.appendChild(
              createTrackListItem({
                track: t,
                onClick: () => window.dispatchEvent(
                  new CustomEvent("wa:track:select", {
                    detail: {
                      trackId: t.id,
                      tracks: baseTracks.slice(),
                      wrap: false,
                      from: "search"
                    }
                  })
                )
              })
            );
          }
          const scPlaylists = playlistItems.filter((p) => !!p && typeof p.id !== "undefined").map((p) => {
            const id = String(p.id);
            const title = typeof p.title === "string" ? p.title : typeof p.name === "string" ? p.name : "(untitled)";
            const owner = typeof p?.user?.username === "string" && p.user.username || typeof p?.user?.name === "string" && p.user.name || "\u2014";
            const artUrlSmall = typeof p?.artwork_url === "string" ? p.artwork_url : Array.isArray(p?.tracks) && p.tracks.length && typeof p.tracks[0]?.artwork_url === "string" ? p.tracks[0].artwork_url : void 0;
            return { id, title, owner, artUrlSmall };
          });
          for (const p of scPlaylists) {
            playlistsSec.list.appendChild(
              createPlaylistListItem({
                playlist: p,
                onClick: () => ctx.router.navigate(
                  routePath2(`playlists/${p.id}`)
                )
              })
            );
          }
          const scArtists = userItems.filter((u) => !!u && typeof u.id !== "undefined").map((u) => {
            const id = String(u.id);
            const name = typeof u.username === "string" && u.username || typeof u.full_name === "string" && u.full_name || typeof u.name === "string" && u.name || "(untitled)";
            const artUrlSmall = typeof u.avatar_url === "string" ? u.avatar_url : void 0;
            const permalinkUrl = typeof u.permalink_url === "string" ? u.permalink_url : void 0;
            return { id, name, artUrlSmall, permalinkUrl };
          });
          for (const a of scArtists) {
            artistsSec.list.appendChild(
              createArtistListItem({
                artist: {
                  id: a.id,
                  name: a.name,
                  artUrlSmall: a.artUrlSmall
                },
                onClick: () => {
                  if (a.permalinkUrl)
                    window.open(
                      a.permalinkUrl,
                      "_blank",
                      "noopener"
                    );
                }
              })
            );
          }
          const any = tracksSec.list.childElementCount || playlistsSec.list.childElementCount || artistsSec.list.childElementCount;
          if (!any) {
            setStatus("No results found.");
            if (resultsCard) resultsCard.style.display = "none";
            return;
          }
          if (tracksSec.list.childElementCount)
            resultsEl.appendChild(tracksSec.wrap);
          if (playlistsSec.list.childElementCount)
            resultsEl.appendChild(playlistsSec.wrap);
          if (artistsSec.list.childElementCount)
            resultsEl.appendChild(artistsSec.wrap);
          setStatus("");
        }
      } catch (err) {
        setStatus(err?.message ?? "Search failed");
        resultsEl.replaceChildren();
      }
    };
    let debounceHandle = null;
    input.addEventListener("input", () => {
      if (debounceHandle !== null) {
        window.clearTimeout(debounceHandle);
        debounceHandle = null;
      }
      const value = input.value;
      const trimmed = value.trim();
      if (!trimmed) {
        updateUrlQuery("");
        setStatus("");
        if (resultsCard) resultsCard.style.display = "none";
        reset();
        return;
      }
      debounceHandle = window.setTimeout(() => {
        if (destroyed) return;
        void runSearch(input.value);
      }, 350);
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (debounceHandle !== null) {
        window.clearTimeout(debounceHandle);
        debounceHandle = null;
      }
      void runSearch(input.value);
    });
    try {
      const url = new URL(window.location.href);
      const initialQuery = url.searchParams.get("q");
      if (initialQuery) {
        input.value = initialQuery;
        void runSearch(initialQuery);
      }
    } catch {
    }
    input.focus();
    searchView._cleanup = () => {
      destroyed = true;
      cleanupActions();
    };
  },
  unmount() {
    searchView._cleanup?.();
    searchView._cleanup = null;
  }
};

// wwwroot/ts/views/likedView.ts
function mapSpotifyTrack2(t) {
  return createSpotifyTrack(t, { inLibrary: true });
}
var likedView = {
  id: "liked",
  mount(ctx) {
    const root = ctx.rootEl;
    const likedEl = root.querySelector("[data-wa-liked]");
    const likedStatusEl = root.querySelector("[data-wa-liked-status]");
    if (!likedEl) return;
    const setStatus = (t) => {
      if (likedStatusEl) likedStatusEl.textContent = t;
    };
    let destroyed = false;
    let offset = 0;
    let loading = false;
    let hasMore = true;
    const allTracks = [];
    let queueCommitted = false;
    let queueActive = [];
    let scroller = null;
    const cleanupActions = bindQueueActions({
      root,
      getTracks: () => allTracks,
      onQueueApplied: (q) => {
        queueCommitted = true;
        queueActive = q.slice();
      }
    });
    const appendTracks = (tracks) => {
      appendFragment(likedEl, (frag) => {
        for (const t of tracks) {
          frag.appendChild(createTrackListItem({
            track: t,
            onClick: () => {
              queueCommitted = true;
              queueActive = allTracks.slice();
              window.dispatchEvent(new CustomEvent("wa:track:select", { detail: { trackId: t.id, tracks: queueActive, wrap: false, from: "liked" } }));
            }
          }));
        }
      });
    };
    const spotifySource = ctx.services.musicSource;
    const soundCloudSource = ctx.services.soundCloudSource;
    const isSpotifyConnected = spotifySource?.getState().isConnected ?? false;
    const isSoundCloudConnected = soundCloudSource?.getState().isConnected ?? false;
    let scCursor = null;
    const loadMoreSpotify = async () => {
      if (destroyed || loading || !hasMore) return;
      loading = true;
      try {
        const data = await spotifyApi.savedTracks(50, offset);
        const items = data?.items ?? [];
        const next = items.map((it) => it?.track).filter(Boolean).map(mapSpotifyTrack2);
        if (destroyed) return;
        if (offset === 0) {
          likedEl.replaceChildren();
        }
        offset += items.length;
        hasMore = items.length > 0 && next.length > 0 && items.length >= 50;
        allTracks.push(...next);
        cleanupActions.refresh?.();
        if (queueCommitted) {
          queueActive.push(...next);
          window.dispatchEvent(new CustomEvent("wa:queue:set", { detail: { tracks: queueActive, wrap: false } }));
        }
        appendTracks(next);
        setStatus(allTracks.length ? "" : "No liked songs found.");
      } catch (err) {
        setStatus(err?.message ?? "Failed to load liked songs");
        hasMore = false;
      } finally {
        loading = false;
      }
    };
    const loadMoreSoundCloud = async () => {
      if (destroyed || loading || !hasMore) return;
      loading = true;
      try {
        const data = await soundcloudUserApi.likedTracks(50, scCursor ?? void 0);
        const collection = data?.collection ?? [];
        const next = collection.map((it) => it?.track ?? it).filter(Boolean).map((t) => createSoundCloudTrack(t, { inLibrary: true })).filter(Boolean);
        if (destroyed) return;
        if (allTracks.length === 0) {
          likedEl.replaceChildren();
        }
        let nextCursor = null;
        const nextHref = typeof data?.next_href === "string" ? data.next_href : null;
        if (nextHref) {
          try {
            const url = new URL(nextHref);
            const c = url.searchParams.get("cursor");
            if (c) nextCursor = c;
          } catch {
          }
        }
        scCursor = nextCursor;
        hasMore = !!nextCursor && next.length > 0;
        allTracks.push(...next);
        cleanupActions.refresh?.();
        if (queueCommitted) {
          queueActive.push(...next);
          window.dispatchEvent(new CustomEvent("wa:queue:set", { detail: { tracks: queueActive, wrap: false } }));
        }
        appendTracks(next);
        setStatus(allTracks.length ? "" : "No liked songs found.");
      } catch (err) {
        setStatus(err?.message ?? "Failed to load liked songs");
        hasMore = false;
      } finally {
        loading = false;
      }
    };
    const init = async () => {
      const loadMore = isSpotifyConnected ? loadMoreSpotify : loadMoreSoundCloud;
      if (!isSpotifyConnected && !isSoundCloudConnected) {
        likedEl.replaceChildren();
        setStatus("Connect to a music source to see your liked songs.");
        return;
      }
      likedEl.replaceChildren();
      setStatus("");
      renderListSkeleton(likedEl, 10);
      await loadMore();
      scroller = attachInfiniteScroll({
        listEl: likedEl,
        loadMore,
        hasMore: () => hasMore,
        isLoading: () => loading
      });
    };
    void init();
    likedView._cleanup = () => {
      destroyed = true;
      scroller?.destroy();
      scroller = null;
      cleanupActions();
    };
  },
  unmount() {
    likedView._cleanup?.();
    likedView._cleanup = null;
  }
};

// wwwroot/ts/views/playlistView.ts
var playlistView = {
  id: "playlist",
  mount(ctx) {
    const headerTitle = document.querySelector("[data-wa-topbar-title]");
    const detailCard = ctx.rootEl.querySelector("[data-wa-playlist-detail]");
    const detailImg = ctx.rootEl.querySelector("[data-wa-playlist-img]");
    const detailTitle = ctx.rootEl.querySelector("[data-wa-playlist-title]");
    const detailMeta = ctx.rootEl.querySelector("[data-wa-playlist-meta]");
    const detailArt = detailImg?.parentElement;
    const playlistsCard = ctx.rootEl.querySelector("[data-wa-playlists-card]");
    const playlistsList = ctx.rootEl.querySelector("[data-wa-playlists-list]");
    const playlistsStatus = ctx.rootEl.querySelector("[data-wa-playlists-status]");
    const tracksCard = ctx.rootEl.querySelector("[data-wa-playlist-tracks-card]");
    const tracksList = ctx.rootEl.querySelector("[data-wa-playlist-tracks]");
    const tracksStatus = ctx.rootEl.querySelector("[data-wa-playlist-tracks-status]");
    const setPlaylistsStatus = (t) => {
      if (playlistsStatus) playlistsStatus.textContent = t;
    };
    const setTracksStatus = (t) => {
      if (tracksStatus) tracksStatus.textContent = t;
    };
    const appendPlaylistTracks = (tracks, allTracks, onInteract) => {
      if (!tracksList || !tracksCard) return;
      tracksCard.style.display = "block";
      appendFragment(tracksList, (frag) => {
        for (const t of tracks) {
          frag.appendChild(createTrackListItem({
            track: t,
            onClick: () => {
              onInteract();
              window.dispatchEvent(new CustomEvent("wa:track:select", { detail: { trackId: t.id, tracks: allTracks.slice(), wrap: false, from: "playlist" } }));
            }
          }));
        }
      });
    };
    let cleanup = null;
    let cleanupActions = bindQueueActions({
      root: ctx.rootEl,
      getTracks: () => []
      // overwritten in detail view when tracks exist
    });
    const spotifySource = ctx.services.musicSource;
    const soundCloudSource = ctx.services.soundCloudSource;
    const isSpotifyConnected = spotifySource?.getState().isConnected ?? false;
    const isSoundCloudConnected = soundCloudSource?.getState().isConnected ?? false;
    const loadAllPlaylists = async () => {
      if (!playlistsList || !playlistsCard) return;
      let destroyed = false;
      let offset = 0;
      let loading = false;
      let hasMore = true;
      let scCursor = null;
      playlistsCard.style.display = "block";
      if (!isSpotifyConnected && !isSoundCloudConnected) {
        playlistsList.replaceChildren();
        setPlaylistsStatus("Connect to a music source to see your playlists.");
        return;
      }
      setPlaylistsStatus("");
      renderListSkeleton(playlistsList, 8);
      const loadMoreSpotify = async () => {
        if (destroyed || loading || !hasMore) return;
        loading = true;
        try {
          const data = await spotifyApi.myPlaylists(50, offset);
          const items = data?.items ?? [];
          if (offset === 0) playlistsList.replaceChildren();
          for (const p of items) {
            const id = p?.id;
            const name = p?.name ?? "(untitled)";
            const owner = p?.owner?.display_name ?? p?.owner?.id ?? "\u2014";
            const images = p?.images ?? [];
            const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
            if (!id) continue;
            playlistsList.appendChild(createPlaylistListItem({
              playlist: { id, title: name, owner, artUrlSmall },
              onClick: () => ctx.router.navigate(routePath2(`playlists/${id}`))
            }));
          }
          offset += items.length;
          hasMore = items.length >= 50;
          const total = playlistsList.childElementCount;
          setPlaylistsStatus(total ? "" : "No playlists found.");
        } catch (err) {
          setPlaylistsStatus(err?.message ?? "Failed to load playlists");
          hasMore = false;
        } finally {
          loading = false;
        }
      };
      const loadMoreSoundCloud = async () => {
        if (destroyed || loading || !hasMore) return;
        loading = true;
        try {
          const data = await soundcloudUserApi.myPlaylists(50, scCursor ?? void 0);
          const items = data?.collection ?? data?.items ?? [];
          if (!scCursor) playlistsList.replaceChildren();
          for (const p of items) {
            const id = p?.id;
            if (!id) continue;
            const title = p?.title ?? "(untitled)";
            const owner = typeof p?.user?.username === "string" && p.user.username || typeof p?.user?.name === "string" && p.user.name || "\u2014";
            const artUrlSmall = typeof p?.artwork_url === "string" ? p.artwork_url : Array.isArray(p?.tracks) && p.tracks.length && typeof p.tracks[0]?.artwork_url === "string" ? p.tracks[0].artwork_url : void 0;
            playlistsList.appendChild(createPlaylistListItem({
              playlist: { id: String(id), title, owner, artUrlSmall },
              onClick: () => ctx.router.navigate(routePath2(`playlists/${id}`))
            }));
          }
          let nextCursor = null;
          const nextHref = typeof data?.next_href === "string" ? data.next_href : null;
          if (nextHref) {
            try {
              const url = new URL(nextHref);
              const c = url.searchParams.get("cursor");
              if (c) nextCursor = c;
            } catch {
            }
          }
          scCursor = nextCursor;
          hasMore = !!nextCursor && items.length > 0;
          const total = playlistsList.childElementCount;
          setPlaylistsStatus(total ? "" : "No playlists found.");
        } catch (err) {
          setPlaylistsStatus(err?.message ?? "Failed to load playlists");
          hasMore = false;
        } finally {
          loading = false;
        }
      };
      const loadMore = isSpotifyConnected ? loadMoreSpotify : loadMoreSoundCloud;
      const scroller = attachInfiniteScroll({
        listEl: playlistsList,
        loadMore,
        hasMore: () => hasMore,
        isLoading: () => loading
      });
      cleanup = () => {
        destroyed = true;
        scroller.destroy();
      };
      await loadMore();
    };
    if (ctx.entityId && tracksList && tracksCard) {
      (async () => {
        try {
          if (playlistsCard) playlistsCard.style.display = "none";
          if (detailCard) detailCard.style.display = "block";
          if (detailTitle) detailTitle.textContent = "Loading\u2026";
          if (detailMeta) detailMeta.textContent = "";
          if (detailImg) detailImg.removeAttribute("src");
          if (detailArt) detailArt.classList.add("wa-entityheader__art--loading");
          tracksCard.style.display = "block";
          setTracksStatus("");
          renderListSkeleton(tracksList, 10);
          let playlistName = ctx.getViewLabel("playlist");
          if (isSpotifyConnected) {
            try {
              const p = await spotifyApi.playlist(ctx.entityId);
              playlistName = p?.name ?? playlistName;
              if (detailTitle) detailTitle.textContent = playlistName;
              const owner = p?.owner?.display_name ?? p?.owner?.id ?? "";
              const total = p?.tracks?.total;
              if (detailMeta) detailMeta.textContent = `${owner}${typeof total === "number" ? ` \u2022 ${total} tracks` : ""}`;
              const images = p?.images ?? [];
              const artFull = images?.[0]?.url ?? images?.[1]?.url ?? images?.[images.length - 1]?.url;
              if (detailImg && artFull) {
                applyCachedArt(detailImg, artFull);
                if (detailArt) detailArt.classList.remove("wa-entityheader__art--loading");
              } else if (detailArt) {
                detailArt.classList.remove("wa-entityheader__art--loading");
              }
              if (headerTitle) headerTitle.textContent = playlistName;
              const rootLabel = ctx.getViewLabel("playlist");
              const rootPath = `${WEBAMP_ROOT}/playlists`;
              const detailPath = `${WEBAMP_ROOT}/playlists/${ctx.entityId}`;
              ctx.router.setBreadcrumbs([
                { label: rootLabel, path: rootPath },
                { label: playlistName, path: detailPath }
              ]);
            } catch {
              if (detailArt) detailArt.classList.remove("wa-entityheader__art--loading");
            }
          } else if (isSoundCloudConnected) {
            try {
              const p = await soundcloudUserApi.playlist(ctx.entityId);
              playlistName = p?.title ?? playlistName;
              if (detailTitle) detailTitle.textContent = playlistName;
              const owner = typeof p?.user?.username === "string" && p.user.username || typeof p?.user?.name === "string" && p.user.name || "";
              const trackCount = typeof p?.track_count === "number" ? p.track_count : void 0;
              if (detailMeta) {
                detailMeta.textContent = `${owner}${typeof trackCount === "number" ? ` \u2022 ${trackCount} tracks` : ""}`;
              }
              const artFull = typeof p?.artwork_url === "string" ? p.artwork_url : Array.isArray(p?.tracks) && p.tracks.length && typeof p.tracks[0]?.artwork_url === "string" ? p.tracks[0].artwork_url : void 0;
              if (detailImg && artFull) {
                applyCachedArt(detailImg, artFull);
                if (detailArt) detailArt.classList.remove("wa-entityheader__art--loading");
              } else if (detailArt) {
                detailArt.classList.remove("wa-entityheader__art--loading");
              }
              if (headerTitle) headerTitle.textContent = playlistName;
              const rootLabel = ctx.getViewLabel("playlist");
              const rootPath = `${WEBAMP_ROOT}/playlists`;
              const detailPath = `${WEBAMP_ROOT}/playlists/${ctx.entityId}`;
              ctx.router.setBreadcrumbs([
                { label: rootLabel, path: rootPath },
                { label: playlistName, path: detailPath }
              ]);
            } catch {
              if (detailArt) detailArt.classList.remove("wa-entityheader__art--loading");
            }
          }
          let destroyed = false;
          let offset = 0;
          let loading = false;
          let hasMore = true;
          let scNextHref = null;
          const allTracks = [];
          let queueCommitted = false;
          let queueActive = [];
          cleanupActions();
          cleanupActions = bindQueueActions({
            root: ctx.rootEl,
            getTracks: () => allTracks,
            onQueueApplied: (q) => {
              queueCommitted = true;
              queueActive = q.slice();
            }
          });
          const loadMoreSpotifyTracks = async () => {
            if (destroyed || loading || !hasMore) return;
            loading = true;
            try {
              const data = await spotifyApi.playlistTracks(ctx.entityId, 100, offset);
              const items = data?.items ?? [];
              const next = items.map((it) => it?.track).filter(Boolean).map((t) => createSpotifyTrack(t));
              if (offset === 0) tracksList.replaceChildren();
              allTracks.push(...next);
              cleanupActions.refresh?.();
              if (queueCommitted) {
                queueActive.push(...next);
                window.dispatchEvent(new CustomEvent("wa:queue:set", { detail: { tracks: queueActive, wrap: false } }));
              }
              appendPlaylistTracks(next, allTracks, () => {
                queueCommitted = true;
                queueActive = allTracks.slice();
              });
              offset += items.length;
              hasMore = items.length >= 100;
              setTracksStatus(allTracks.length ? "" : "No tracks found.");
            } catch (err) {
              setTracksStatus(err?.message ?? "Failed to load playlist tracks");
              hasMore = false;
            } finally {
              loading = false;
            }
          };
          const loadMoreSoundCloudTracks = async () => {
            if (destroyed || loading || !hasMore) return;
            loading = true;
            try {
              const data = await soundcloudUserApi.playlistTracks(
                ctx.entityId,
                100,
                void 0,
                scNextHref ?? void 0
              );
              const items = data?.collection ?? [];
              const next = items.filter((t) => !!t && typeof t.id !== "undefined").map((t) => createSoundCloudTrack(t));
              if (allTracks.length === 0) tracksList.replaceChildren();
              allTracks.push(...next);
              cleanupActions.refresh?.();
              if (queueCommitted) {
                queueActive.push(...next);
                window.dispatchEvent(new CustomEvent("wa:queue:set", { detail: { tracks: queueActive, wrap: false } }));
              }
              appendPlaylistTracks(next, allTracks, () => {
                queueCommitted = true;
                queueActive = allTracks.slice();
              });
              scNextHref = typeof data?.next_href === "string" ? data.next_href : null;
              hasMore = !!scNextHref && next.length > 0;
              setTracksStatus(allTracks.length ? "" : "No tracks found.");
            } catch (err) {
              setTracksStatus(err?.message ?? "Failed to load playlist tracks");
              hasMore = false;
            } finally {
              loading = false;
            }
          };
          const loadMoreTracks = isSpotifyConnected ? loadMoreSpotifyTracks : loadMoreSoundCloudTracks;
          const scroller = attachInfiniteScroll({
            listEl: tracksList,
            loadMore: loadMoreTracks,
            hasMore: () => hasMore,
            isLoading: () => loading
          });
          cleanup = () => {
            destroyed = true;
            scroller.destroy();
            cleanupActions();
          };
          await loadMoreTracks();
        } catch (err) {
          setTracksStatus(err?.message ?? "Failed to load playlist tracks");
          tracksList.replaceChildren();
        }
      })();
    } else {
      if (tracksCard) tracksCard.style.display = "none";
      if (detailCard) detailCard.style.display = "none";
      void loadAllPlaylists();
    }
    playlistView._cleanup = () => {
      cleanup?.();
      cleanupActions();
    };
  },
  unmount() {
    playlistView._cleanup?.();
    playlistView._cleanup = null;
  }
};

// wwwroot/ts/views/albumView.ts
var albumView = {
  id: "album",
  mount(ctx) {
    const headerTitle = document.querySelector("[data-wa-topbar-title]");
    const albumsCard = ctx.rootEl.querySelector("[data-wa-albums-card]");
    const albumsList = ctx.rootEl.querySelector("[data-wa-albums-list]");
    const albumsStatus = ctx.rootEl.querySelector("[data-wa-albums-status]");
    const detailCard = ctx.rootEl.querySelector("[data-wa-album-detail]");
    const detailImg = ctx.rootEl.querySelector("[data-wa-album-img]");
    const detailArt = detailImg?.parentElement;
    const detailTitle = ctx.rootEl.querySelector("[data-wa-album-title]");
    const detailMeta = ctx.rootEl.querySelector("[data-wa-album-meta]");
    const tracksCard = ctx.rootEl.querySelector("[data-wa-album-tracks-card]");
    const tracksList = ctx.rootEl.querySelector("[data-wa-album-tracks]");
    const tracksStatus = ctx.rootEl.querySelector("[data-wa-album-tracks-status]");
    const setAlbumsStatus = (t) => {
      if (albumsStatus) albumsStatus.textContent = t;
    };
    const setTracksStatus = (t) => {
      if (tracksStatus) tracksStatus.textContent = t;
    };
    const formatAlbumDuration = (totalSec) => {
      if (!Number.isFinite(totalSec) || totalSec <= 0) return "";
      const totalMinutes = Math.round(totalSec / 60);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      if (hours <= 0) return `${minutes}m`;
      if (minutes === 0) return `${hours}h`;
      return `${hours}h ${minutes}m`;
    };
    let cleanup = null;
    let cleanupActions = bindQueueActions({ root: ctx.rootEl, getTracks: () => [] });
    const spotifySource = ctx.services.musicSource;
    const isSpotifyConnected = spotifySource?.getState().isConnected ?? false;
    (async () => {
      if (ctx.entityId) {
        if (albumsCard) albumsCard.style.display = "none";
        return;
      }
      if (albumsCard) albumsCard.style.display = "block";
      if (!albumsList) return;
      let destroyed = false;
      let offset = 0;
      let loading = false;
      let hasMore = true;
      setAlbumsStatus("Loading\u2026");
      renderListSkeleton(albumsList, 8);
      const loadMoreAlbums = async () => {
        if (destroyed || loading || !hasMore) return;
        loading = true;
        try {
          if (!isSpotifyConnected) {
            albumsList.replaceChildren();
            setAlbumsStatus("Connect Spotify to see your saved albums.");
            hasMore = false;
            return;
          }
          const data = await spotifyApi.savedAlbums(50, offset);
          const items = data?.items ?? [];
          if (offset === 0) albumsList.replaceChildren();
          for (const it of items) {
            const album = it?.album;
            const id = album?.id;
            const name = album?.name ?? "(untitled)";
            const artist = Array.isArray(album?.artists) ? album.artists.map((a) => a.name).join(", ") : "";
            const images = album?.images ?? [];
            const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
            if (!id) continue;
            albumsList.appendChild(createAlbumListItem({
              album: { id, title: name, artist, artUrlSmall },
              onClick: () => ctx.router.navigate(routePath2(`albums/${id}`))
            }));
          }
          offset += items.length;
          hasMore = items.length >= 50;
          setAlbumsStatus(offset ? "" : "No saved albums found.");
        } catch (err) {
          setAlbumsStatus(err?.message ?? "Failed to load saved albums");
          hasMore = false;
        } finally {
          loading = false;
        }
      };
      const scroller = attachInfiniteScroll({
        listEl: albumsList,
        loadMore: loadMoreAlbums,
        hasMore: () => hasMore,
        isLoading: () => loading
      });
      cleanup = () => {
        destroyed = true;
        scroller.destroy();
      };
      await loadMoreAlbums();
    })();
    if (ctx.entityId && tracksCard && tracksList) {
      if (!isSpotifyConnected) {
        if (detailCard) detailCard.style.display = "block";
        if (detailTitle) detailTitle.textContent = "Albums not available";
        if (detailMeta) detailMeta.textContent = "Connect Spotify to view album details.";
        if (tracksCard) tracksCard.style.display = "none";
        setTracksStatus("Album tracks are only available for Spotify.");
        return;
      }
      (async () => {
        try {
          tracksCard.style.display = "block";
          setTracksStatus("Loading tracks\u2026");
          renderListSkeleton(tracksList, 10);
          if (detailCard) detailCard.style.display = "block";
          if (detailTitle) detailTitle.textContent = "Loading\u2026";
          if (detailMeta) detailMeta.textContent = "";
          if (detailImg) detailImg.removeAttribute("src");
          if (detailArt) detailArt.classList.add("wa-entityheader__art--loading");
          const album = await spotifyApi.album(ctx.entityId);
          const images = album?.images ?? [];
          const artUrlFull = images?.[0]?.url ?? images?.[1]?.url;
          const artUrl = images?.[1]?.url ?? images?.[0]?.url;
          const artUrlLarge = images?.[0]?.url ?? images?.[1]?.url ?? artUrl;
          const artUrlSmall = images?.[images.length - 1]?.url;
          const albumName = album?.name ?? ctx.getViewLabel("album");
          const artistName = Array.isArray(album?.artists) ? album.artists.map((a) => a.name).join(", ") : "";
          const albumTypeRaw = (album?.album_type ?? album?.album_group ?? "").toLowerCase();
          let albumTypeLabel;
          switch (albumTypeRaw) {
            case "single":
              albumTypeLabel = "Single";
              break;
            case "compilation":
              albumTypeLabel = "Compilation";
              break;
            default:
              albumTypeLabel = "Album";
              break;
          }
          const totalTracksCount = typeof album?.total_tracks === "number" ? album.total_tracks : void 0;
          const releaseDate = album?.release_date;
          const releaseYear = releaseDate && releaseDate.length >= 4 ? releaseDate.slice(0, 4) : void 0;
          let totalDurationSec;
          const updateDetailMeta = () => {
            if (!detailMeta) return;
            detailMeta.replaceChildren();
            const artistLineEl = document.createElement("div");
            artistLineEl.textContent = artistName;
            detailMeta.appendChild(artistLineEl);
            const parts = [];
            if (albumTypeLabel) parts.push(albumTypeLabel);
            if (releaseYear) parts.push(releaseYear);
            if (typeof totalTracksCount === "number" && totalTracksCount > 0) {
              parts.push(`${totalTracksCount} track${totalTracksCount === 1 ? "" : "s"}`);
            }
            if (typeof totalDurationSec === "number" && totalDurationSec > 0) {
              const lenLabel = formatAlbumDuration(totalDurationSec);
              if (lenLabel) {
                const lastIndex = parts.length - 1;
                if (lastIndex >= 0) {
                  parts[lastIndex] = `${parts[lastIndex]}, ${lenLabel}`;
                } else {
                  parts.push(lenLabel);
                }
              }
            }
            if (parts.length) {
              const metaLineEl = document.createElement("div");
              metaLineEl.textContent = parts.join(" \u2022 ");
              detailMeta.appendChild(metaLineEl);
            }
          };
          if (detailTitle) detailTitle.textContent = albumName;
          updateDetailMeta();
          if (detailImg && (artUrlFull || artUrl)) {
            applyCachedArt(detailImg, artUrlFull ?? artUrl);
            if (detailArt) detailArt.classList.remove("wa-entityheader__art--loading");
          } else if (detailArt) {
            detailArt.classList.remove("wa-entityheader__art--loading");
          }
          if (headerTitle) headerTitle.textContent = albumName;
          const primaryArtist = Array.isArray(album?.artists) && album.artists.length ? album.artists[0] : void 0;
          const primaryArtistName = primaryArtist?.name;
          const primaryArtistId = primaryArtist?.id;
          const albumPath = `${WEBAMP_ROOT}/albums/${ctx.entityId}`;
          if (primaryArtistId && primaryArtistName) {
            const artistsRootLabel = ctx.getViewLabel("artist");
            const artistsRootPath = `${WEBAMP_ROOT}/artists`;
            const artistDetailPath = `${WEBAMP_ROOT}/artists/${primaryArtistId}`;
            ctx.router.setBreadcrumbs([
              { label: artistsRootLabel, path: artistsRootPath },
              { label: primaryArtistName, path: artistDetailPath },
              { label: albumName, path: albumPath }
            ]);
          } else {
            const albumsRootLabel = ctx.getViewLabel("album");
            const albumsRootPath = `${WEBAMP_ROOT}/albums`;
            ctx.router.setBreadcrumbs([
              { label: albumsRootLabel, path: albumsRootPath },
              { label: albumName, path: albumPath }
            ]);
          }
          let destroyed = false;
          let offset = 0;
          let loading = false;
          let hasMore = true;
          const allTracks = [];
          let queueCommitted = false;
          let queueActive = [];
          cleanupActions();
          cleanupActions = bindQueueActions({
            root: ctx.rootEl,
            getTracks: () => allTracks,
            onQueueApplied: (q) => {
              queueCommitted = true;
              queueActive = q.slice();
            }
          });
          const loadMoreTracks = async () => {
            if (destroyed || loading || !hasMore) return;
            loading = true;
            try {
              const data = await spotifyApi.albumTracks(ctx.entityId, 50, offset);
              const items = data?.items ?? [];
              const next = items.map((t) => createSpotifyTrack(t, {
                albumId: ctx.entityId,
                album: albumName,
                trackNumber: t?.track_number,
                artUrl,
                artUrlSmall,
                artUrlLarge
              }));
              const pageDurationSec = next.reduce((sum, tr) => sum + (tr.durationSec ?? 0), 0);
              totalDurationSec = (totalDurationSec ?? 0) + pageDurationSec;
              if (offset === 0) tracksList.replaceChildren();
              allTracks.push(...next);
              cleanupActions.refresh?.();
              if (queueCommitted) {
                queueActive.push(...next);
                window.dispatchEvent(new CustomEvent("wa:queue:set", { detail: { tracks: queueActive, wrap: false } }));
              }
              appendFragment(tracksList, (frag) => {
                for (const t of next) {
                  frag.appendChild(createTrackListItem({
                    track: t,
                    leading: "index",
                    showMeta: false,
                    onClick: () => {
                      queueCommitted = true;
                      queueActive = allTracks.slice();
                      window.dispatchEvent(new CustomEvent("wa:track:select", { detail: { trackId: t.id, tracks: queueActive, wrap: false, from: "album" } }));
                    }
                  }));
                }
              });
              offset += items.length;
              hasMore = items.length >= 50;
              if (!hasMore && typeof totalDurationSec === "number") {
                updateDetailMeta();
              }
              setTracksStatus(allTracks.length ? "" : "No tracks found.");
            } catch (err) {
              setTracksStatus(err?.message ?? "Failed to load album tracks");
              hasMore = false;
            } finally {
              loading = false;
            }
          };
          const scroller = attachInfiniteScroll({
            listEl: tracksList,
            loadMore: loadMoreTracks,
            hasMore: () => hasMore,
            isLoading: () => loading
          });
          cleanup = () => {
            destroyed = true;
            scroller.destroy();
            cleanupActions();
          };
          await loadMoreTracks();
        } catch (err) {
          if (detailArt) detailArt.classList.remove("wa-entityheader__art--loading");
          setTracksStatus(err?.message ?? "Failed to load album tracks");
          tracksList.replaceChildren();
        }
      })();
    } else {
      if (tracksCard) tracksCard.style.display = "none";
      if (detailCard) detailCard.style.display = "none";
    }
    albumView._cleanup = () => {
      cleanup?.();
      cleanupActions();
    };
  },
  unmount() {
    albumView._cleanup?.();
    albumView._cleanup = null;
  }
};

// wwwroot/ts/views/artistView.ts
var artistView = {
  id: "artist",
  mount(ctx) {
    const headerTitle = document.querySelector("[data-wa-topbar-title]");
    const artistsCard = ctx.rootEl.querySelector("[data-wa-artists-card]");
    const artistsList = ctx.rootEl.querySelector("[data-wa-artists-list]");
    const artistsStatus = ctx.rootEl.querySelector("[data-wa-artists-status]");
    const detailCard = ctx.rootEl.querySelector("[data-wa-artist-detail]");
    const detailImg = ctx.rootEl.querySelector("[data-wa-artist-img]");
    const detailArt = detailImg?.parentElement;
    const detailName = ctx.rootEl.querySelector("[data-wa-artist-name]");
    const detailMeta = ctx.rootEl.querySelector("[data-wa-artist-meta]");
    const topCard = ctx.rootEl.querySelector("[data-wa-artist-toptracks-card]");
    const topList = ctx.rootEl.querySelector("[data-wa-artist-toptracks]");
    const topStatus = ctx.rootEl.querySelector("[data-wa-artist-toptracks-status]");
    const albumsCard = ctx.rootEl.querySelector("[data-wa-artist-albums-card]");
    const albumsList = ctx.rootEl.querySelector("[data-wa-artist-albums]");
    const albumsStatus = ctx.rootEl.querySelector("[data-wa-artist-albums-status]");
    const singlesCard = ctx.rootEl.querySelector("[data-wa-artist-singles-card]");
    const singlesList = ctx.rootEl.querySelector("[data-wa-artist-singles]");
    const singlesStatus = ctx.rootEl.querySelector("[data-wa-artist-singles-status]");
    const setArtistsStatus = (t) => {
      if (artistsStatus) artistsStatus.textContent = t;
    };
    const setTopStatus = (t) => {
      if (topStatus) topStatus.textContent = t;
    };
    const setAlbumsStatus = (t) => {
      if (albumsStatus) albumsStatus.textContent = t;
    };
    const setSinglesStatus = (t) => {
      if (singlesStatus) singlesStatus.textContent = t;
    };
    let cleanup = null;
    let cleanupActions = bindQueueActions({ root: ctx.rootEl, getTracks: () => [] });
    const spotifySource = ctx.services.musicSource;
    const isSpotifyConnected = spotifySource?.getState().isConnected ?? false;
    (async () => {
      if (ctx.entityId) {
        if (artistsCard) artistsCard.style.display = "none";
        return;
      }
      if (artistsCard) artistsCard.style.display = "block";
      if (!artistsList) return;
      let destroyed = false;
      let after = void 0;
      let loading = false;
      let hasMore = true;
      setArtistsStatus("Loading\u2026");
      renderListSkeleton(artistsList, 8);
      const loadMoreArtists = async () => {
        if (destroyed || loading || !hasMore) return;
        loading = true;
        try {
          if (!isSpotifyConnected) {
            artistsList.replaceChildren();
            setArtistsStatus("Connect Spotify to see your followed artists.");
            hasMore = false;
            return;
          }
          const data = await spotifyApi.followedArtists(50, after);
          const artists = data?.artists;
          const items = artists?.items ?? [];
          const nextAfter = artists?.cursors?.after;
          if (!after) artistsList.replaceChildren();
          for (const a of items) {
            const id = a?.id;
            const name = a?.name ?? "(untitled)";
            const images = a?.images ?? [];
            const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
            if (!id) continue;
            artistsList.appendChild(createArtistListItem({
              artist: { id, name, artUrlSmall },
              onClick: () => ctx.router.navigate(routePath2(`artists/${id}`))
            }));
          }
          after = nextAfter;
          hasMore = Boolean(nextAfter) && items.length > 0;
          setArtistsStatus(items.length ? "" : "No followed artists found.");
        } catch (err) {
          setArtistsStatus(err?.message ?? "Failed to load followed artists");
          hasMore = false;
        } finally {
          loading = false;
        }
      };
      const scroller = attachInfiniteScroll({
        listEl: artistsList,
        loadMore: loadMoreArtists,
        hasMore: () => hasMore,
        isLoading: () => loading
      });
      cleanup = () => {
        destroyed = true;
        scroller.destroy();
      };
      await loadMoreArtists();
    })();
    if (ctx.entityId && topCard && topList) {
      if (!isSpotifyConnected) {
        if (detailCard) detailCard.style.display = "block";
        if (detailName) detailName.textContent = "Artists not available";
        if (detailMeta) detailMeta.textContent = "Connect Spotify to view artist details.";
        if (topCard) topCard.style.display = "none";
        setTopStatus("Artist top tracks are only available for Spotify.");
        return;
      }
      (async () => {
        try {
          if (detailCard) detailCard.style.display = "block";
          if (detailName) detailName.textContent = "Loading\u2026";
          if (detailMeta) detailMeta.textContent = "";
          if (detailImg) detailImg.removeAttribute("src");
          if (detailArt) detailArt.classList.add("wa-entityheader__art--loading");
          topCard.style.display = "block";
          setTopStatus("Loading top tracks\u2026");
          renderListSkeleton(topList, 10);
          try {
            const a = await spotifyApi.artist(ctx.entityId);
            const artistName = a?.name ?? ctx.getViewLabel("artist");
            if (detailName) detailName.textContent = artistName;
            const followers = a?.followers?.total;
            const genres = Array.isArray(a?.genres) ? a.genres.slice(0, 3).join(" \u2022 ") : "";
            const followersText = typeof followers === "number" ? `${followers.toLocaleString()} followers` : "";
            const meta = [followersText, genres].filter(Boolean).join(" \u2022 ");
            if (detailMeta) detailMeta.textContent = meta;
            const images = a?.images ?? [];
            const artUrl = images?.[0]?.url ?? images?.[1]?.url ?? images?.[images.length - 1]?.url;
            if (detailImg && artUrl) {
              applyCachedArt(detailImg, artUrl);
              if (detailArt) detailArt.classList.remove("wa-entityheader__art--loading");
            } else if (detailArt) {
              detailArt.classList.remove("wa-entityheader__art--loading");
            }
            if (headerTitle) headerTitle.textContent = artistName;
            const rootLabel = ctx.getViewLabel("artist");
            const rootPath = `${WEBAMP_ROOT}/artists`;
            const detailPath = `${WEBAMP_ROOT}/artists/${ctx.entityId}`;
            ctx.router.setBreadcrumbs([
              { label: rootLabel, path: rootPath },
              { label: artistName, path: detailPath }
            ]);
          } catch {
            if (detailArt) detailArt.classList.remove("wa-entityheader__art--loading");
          }
          const data = await spotifyApi.artistTopTracks(ctx.entityId, "US");
          const items = data?.tracks ?? [];
          const tracks = items.map((t) => createSpotifyTrack(t, {
            primaryArtistId: ctx.entityId
          }));
          topList.replaceChildren();
          cleanupActions();
          cleanupActions = bindQueueActions({
            root: ctx.rootEl,
            getTracks: () => tracks
          });
          cleanupActions.refresh?.();
          appendFragment(topList, (frag) => {
            for (let i = 0; i < tracks.length; i++) {
              const t = tracks[i];
              frag.appendChild(createTrackListItem({
                track: t,
                index: i + 1,
                variant: "artistTop",
                onClick: () => window.dispatchEvent(new CustomEvent("wa:track:select", { detail: { trackId: t.id, tracks: tracks.slice(), wrap: false, from: "artist" } }))
              }));
            }
          });
          setTopStatus(tracks.length ? "" : "No top tracks found.");
        } catch (err) {
          if (detailArt) detailArt.classList.remove("wa-entityheader__art--loading");
          setTopStatus(err?.message ?? "Failed to load top tracks");
          topList.replaceChildren();
        }
      })();
    } else {
      if (topCard) topCard.style.display = "none";
      if (detailCard) detailCard.style.display = "none";
    }
    if (ctx.entityId && (albumsCard || singlesCard) && albumsList && singlesList) {
      if (!isSpotifyConnected) {
        if (albumsCard) albumsCard.style.display = "none";
        if (singlesCard) singlesCard.style.display = "none";
        setAlbumsStatus("Artist albums are only available for Spotify.");
        setSinglesStatus("Artist singles are only available for Spotify.");
        return;
      }
      (async () => {
        try {
          if (albumsCard) albumsCard.style.display = "block";
          if (singlesCard) singlesCard.style.display = "block";
          setAlbumsStatus("Loading\u2026");
          setSinglesStatus("Loading\u2026");
          renderListSkeleton(albumsList, 6);
          renderListSkeleton(singlesList, 6);
          const data = await spotifyApi.artistAlbums(ctx.entityId, "album,single", 50, 0);
          const items = data?.items ?? [];
          const seen = /* @__PURE__ */ new Set();
          const deduped = items.filter((it) => {
            const id = it?.id;
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
          });
          const albums = deduped.filter((it) => (it?.album_group ?? it?.album_type) === "album");
          const singles = deduped.filter((it) => (it?.album_group ?? it?.album_type) === "single");
          albumsList.replaceChildren();
          singlesList.replaceChildren();
          for (const a of albums) {
            const id = a?.id;
            if (!id) continue;
            const title = a?.name ?? "(untitled)";
            const artist = Array.isArray(a?.artists) ? a.artists.map((x) => x.name).join(", ") : "";
            const images = a?.images ?? [];
            const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
            albumsList.appendChild(createAlbumListItem({
              album: { id, title, artist, artUrlSmall },
              onClick: () => ctx.router.navigate(routePath2(`albums/${id}`))
            }));
          }
          for (const s of singles) {
            const id = s?.id;
            if (!id) continue;
            const title = s?.name ?? "(untitled)";
            const artist = Array.isArray(s?.artists) ? s.artists.map((x) => x.name).join(", ") : "";
            const images = s?.images ?? [];
            const artUrlSmall = images?.[images.length - 1]?.url ?? images?.[0]?.url;
            singlesList.appendChild(createAlbumListItem({
              album: { id, title, artist, artUrlSmall },
              onClick: () => ctx.router.navigate(routePath2(`albums/${id}`))
            }));
          }
          setAlbumsStatus(albums.length ? "" : "No albums found.");
          setSinglesStatus(singles.length ? "" : "No singles found.");
        } catch (err) {
          setAlbumsStatus(err?.message ?? "Failed to load albums");
          setSinglesStatus(err?.message ?? "Failed to load singles");
          albumsList.replaceChildren();
          singlesList.replaceChildren();
        }
      })();
    } else {
      if (albumsCard) albumsCard.style.display = "none";
      if (singlesCard) singlesCard.style.display = "none";
    }
    artistView._cleanup = () => {
      cleanup?.();
      cleanupActions();
    };
  },
  unmount() {
    artistView._cleanup?.();
    artistView._cleanup = null;
  }
};

// wwwroot/ts/state/playerStore.ts
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
var PlayerStore = class {
  state = {
    track: null,
    isPlaying: false,
    isBusy: false,
    positionSec: 0
  };
  listeners = [];
  baseQueue = [];
  queue = [];
  queueWrap = false;
  shuffleEnabled = false;
  rafId = null;
  lastTickMs = null;
  lastUiEmitMs = null;
  transport = null;
  lastLoggedPlayback = null;
  // When using a real transport (Spotify), we still need a local "clock" to animate progress,
  // because Web Playback SDK state updates are not emitted continuously.
  remoteRafId = null;
  remoteBaseMs = null;
  remoteBasePosSec = null;
  remoteUiEmitMs = null;
  /**
   * Tracks whether a transport (e.g. SoundCloud widget) has indicated it is
   * busy performing an async operation such as loading/switching tracks.
   * While this flag is true, remote state snapshots should not clear the
   * user's perceived "loading" spinner.
   */
  transportBusy = false;
  constructor(seedQueue = []) {
    this.baseQueue = seedQueue.slice();
    this.queue = seedQueue.slice();
    if (typeof window !== "undefined") {
      window.addEventListener("wa:player:state", ((e) => {
        const ev = e;
        const state = ev.detail;
        const actions = document.querySelector("[data-wa-queue-actions]");
        const playBtn = actions?.querySelector('[data-wa-action="queue-play"]');
        const playIcon = actions?.querySelector(".wa-topbar__play-icon img");
        const playLabel = actions?.querySelector(".wa-topbar__play-label");
        if (!playBtn || !playIcon || !playLabel) return;
        const isPlaying = state.isPlaying && !!state.track;
        playLabel.textContent = isPlaying ? "Pause" : "Play";
        playBtn.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
        const src = isPlaying ? indiumSvg("pause-filled.svg") : indiumSvg("play-filled.svg");
        if (playIcon.getAttribute("src") !== src) {
          playIcon.setAttribute("src", src);
        }
      }));
    }
  }
  /**
   * Enables/disables shuffle for the active queue.
   * This affects playback order for next/prev/auto-advance (not just "shuffle play").
   */
  setShuffleEnabled(enabled) {
    const next = !!enabled;
    if (this.shuffleEnabled === next) return;
    this.shuffleEnabled = next;
    this.applyQueueTransform();
    logEvent("WebAmp", "queue:shuffle", { enabled: this.shuffleEnabled, size: this.queue.length });
  }
  applyQueueTransform() {
    const currentId = this.state.track?.id ?? null;
    const base = this.baseQueue.slice();
    if (!this.shuffleEnabled) {
      this.queue = base;
    } else if (currentId) {
      const current = base.find((t) => t.id === currentId) ?? null;
      const rest = base.filter((t) => t.id !== currentId);
      this.queue = current ? [current, ...shuffleCopy(rest)] : shuffleCopy(base);
    } else {
      this.queue = shuffleCopy(base);
    }
    if (currentId) {
      const nextTrack = this.queue.find((t) => t.id === currentId) ?? this.state.track;
      this.state = { ...this.state, track: nextTrack ?? null };
      this.emit();
    }
  }
  /**
   * Subscribes to state changes, returns an unsubscribe function
   */
  subscribe(listener) {
    this.listeners.push(listener);
    listener(this.getState());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
  /**
   * Returns a shallow snapshot of current state
   */
  getState() {
    return { ...this.state };
  }
  setBusy(isBusy) {
    this.transportBusy = isBusy;
    if (this.state.isBusy === isBusy) return;
    this.state = { ...this.state, isBusy };
    this.emit();
  }
  /**
   * Replaces the current queue
   */
  setQueue(queue, opts) {
    const filtered = queue.filter((t) => t?.isPlayable !== false);
    this.baseQueue = filtered.slice();
    this.queue = filtered.slice();
    this.queueWrap = opts?.wrap ?? false;
    if (this.shuffleEnabled) {
      this.applyQueueTransform();
    }
    const size = this.queue.length;
    logEvent("WebAmp", "queue:set", {
      size,
      filteredOut: Math.max(0, queue.length - size),
      wrap: this.queueWrap,
      firstId: this.queue[0]?.id ?? null,
      source: this.queue[0]?.source ?? null
    });
  }
  getAdjacentTrack(direction, fromTrackId) {
    if (!this.queue.length) return null;
    const currentId = fromTrackId ?? this.state.track?.id ?? null;
    const idx = currentId ? this.queue.findIndex((t) => t.id === currentId) : -1;
    if (direction === "next") {
      const atEnd = idx >= 0 && idx === this.queue.length - 1;
      if (atEnd && !this.queueWrap) {
        return null;
      }
      const nextIdx = idx >= 0 ? (idx + 1) % this.queue.length : 0;
      return this.queue[nextIdx] ?? null;
    }
    const prevIdx = idx >= 0 ? (idx - 1 + this.queue.length) % this.queue.length : 0;
    return this.queue[prevIdx] ?? null;
  }
  getUpcomingTracks(fromTrackId, limit = Number.POSITIVE_INFINITY) {
    if (!this.queue.length) return [];
    const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : this.queue.length;
    if (max <= 0) return [];
    const currentId = fromTrackId ?? this.state.track?.id ?? null;
    const idx = currentId ? this.queue.findIndex((t) => t.id === currentId) : -1;
    const upcoming = [];
    const pushRange = (start, endExclusive) => {
      for (let i = start; i < endExclusive; i++) {
        if (upcoming.length >= max) return;
        const track = this.queue[i];
        if (track) upcoming.push(track);
      }
    };
    if (idx < 0) {
      pushRange(0, this.queue.length);
      return upcoming;
    }
    pushRange(idx + 1, this.queue.length);
    if (this.queueWrap && upcoming.length < max) {
      pushRange(0, idx);
    }
    return upcoming;
  }
  /**
   * Installs or removes a real playback transport
   */
  setTransport(transport) {
    this.transport = transport;
    if (transport) {
      if (this.rafId !== null) cancelAnimationFrame(this.rafId);
      this.rafId = null;
      this.lastTickMs = null;
      this.lastUiEmitMs = null;
      this.stopRemoteTicker();
    }
  }
  /**
   * Selects a track from the queue by id and optionally starts playback
   */
  selectTrackById(trackId, autoplay = true) {
    const track = this.queue.find((t) => t.id === trackId) ?? null;
    if (!track) return;
    const optimisticPlaying = this.transport ? false : !!autoplay;
    this.state = {
      track,
      isPlaying: optimisticPlaying,
      isBusy: this.transport ? !!autoplay : false,
      positionSec: 0
    };
    this.emit();
    if (this.transport) {
      this.stopRemoteTicker();
      void this.transport.play(track, 0, { autoplay });
      return;
    }
    if (this.state.isPlaying) this.ensureTicker();
  }
  /**
   * Toggles play/pause, auto-selects first track if none is selected
   */
  togglePlay() {
    if (!this.state.track && this.queue.length) {
      this.selectTrackById(this.queue[0].id, true);
      return;
    }
    if (this.transport) {
      const next = !this.state.isPlaying;
      this.state = next ? { ...this.state, isPlaying: false, isBusy: true } : { ...this.state, isPlaying: false, isBusy: false };
      this.emit();
      void this.transport.togglePlay(
        !next
        /* previous */
      );
      this.stopRemoteTicker();
      return;
    }
    this.state = { ...this.state, isPlaying: !this.state.isPlaying };
    this.emit();
    this.ensureTicker();
  }
  /**
   * Advances to next track, stops at end unless queue wrap is enabled
   */
  next(opts) {
    if (!this.queue.length) return;
    const shouldAutoplay = typeof opts?.autoplay === "boolean" ? opts.autoplay : this.state.isPlaying;
    const currentId = this.state.track?.id;
    const idx = currentId ? this.queue.findIndex((t) => t.id === currentId) : -1;
    const atEnd = idx >= 0 && idx === this.queue.length - 1;
    if (atEnd && !this.queueWrap) {
      this.state = { ...this.state, isPlaying: false, positionSec: this.state.track?.durationSec ?? this.state.positionSec };
      this.emit();
      this.stopRemoteTicker();
      if (this.transport) void this.transport.togglePlay(true);
      return;
    }
    const nextIdx = idx >= 0 ? (idx + 1) % this.queue.length : 0;
    this.selectTrackById(this.queue[nextIdx].id, shouldAutoplay);
  }
  /**
   * Goes to previous track, restarts track if current position > 3s
   */
  prev(opts) {
    if (!this.queue.length) return;
    const shouldAutoplay = typeof opts?.autoplay === "boolean" ? opts.autoplay : this.state.isPlaying;
    if (this.state.track && this.state.positionSec > 3) {
      this.seek(0);
      return;
    }
    const currentId = this.state.track?.id;
    const idx = currentId ? this.queue.findIndex((t) => t.id === currentId) : -1;
    const prevIdx = idx >= 0 ? (idx - 1 + this.queue.length) % this.queue.length : 0;
    this.selectTrackById(this.queue[prevIdx].id, shouldAutoplay);
  }
  /**
   * Seeks to an absolute position (seconds), clamps to track duration
   */
  seek(positionSec) {
    const duration = this.state.track?.durationSec ?? 0;
    const clamped = duration ? clamp(positionSec, 0, duration) : 0;
    this.state = { ...this.state, positionSec: clamped };
    this.emit();
    if (this.transport) {
      this.remoteBaseMs = performance.now();
      this.remoteBasePosSec = clamped;
      if (this.state.isPlaying) this.startRemoteTicker();
      void this.transport.seek(clamped);
    }
  }
  /**
   * Seeks to a position based on a 0..1 ratio of track duration
   */
  seekByRatio(ratio) {
    const duration = this.state.track?.durationSec ?? 0;
    if (!duration) return;
    this.seek(duration * clamp(ratio, 0, 1));
  }
  /**
   * Update UI state from a real playback engine (e.g. Spotify Web Playback SDK)
   * without triggering local transport commands.
   */
  syncFromRemote(update) {
    const hasTrackProp = Object.prototype.hasOwnProperty.call(update, "track");
    const incomingTrack = hasTrackProp ? update.track : void 0;
    const safeUpdate = hasTrackProp && incomingTrack === null ? (({ track: _t, ...rest }) => rest)(update) : update;
    let mergedTrack = this.state.track;
    if (hasTrackProp && incomingTrack && this.state.track) {
      const prev = this.state.track;
      const next2 = incomingTrack;
      mergedTrack = {
        ...prev,
        ...next2,
        // Keep sticky navigation metadata when the remote snapshot does not provide it
        albumId: next2.albumId ?? prev.albumId,
        primaryArtistId: next2.primaryArtistId ?? prev.primaryArtistId
      };
    } else if (hasTrackProp && incomingTrack) {
      mergedTrack = incomingTrack;
    }
    const next = {
      ...this.state,
      ...safeUpdate,
      track: mergedTrack
    };
    const incomingId = hasTrackProp && incomingTrack ? incomingTrack.id : mergedTrack?.id;
    const shouldClearBusy = !!this.state.isBusy && !this.transportBusy && !!mergedTrack && typeof incomingId === "string" && mergedTrack.id === incomingId && (typeof safeUpdate.isPlaying === "boolean" || typeof safeUpdate.positionSec === "number");
    this.state = shouldClearBusy ? { ...next, isBusy: false } : next;
    if (typeof safeUpdate.positionSec === "number") {
      this.remoteBaseMs = performance.now();
      this.remoteBasePosSec = safeUpdate.positionSec;
    }
    if (typeof safeUpdate.isPlaying === "boolean") {
      if (safeUpdate.isPlaying) this.startRemoteTicker();
      else this.stopRemoteTicker();
    }
    this.emit();
  }
  emit() {
    const snapshot = this.getState();
    const trackId = snapshot.track?.id ?? null;
    const last = this.lastLoggedPlayback;
    if (!last || last.trackId != trackId || last.isPlaying !== snapshot.isPlaying || last.isBusy !== snapshot.isBusy) {
      logEvent("WebAmp", "playback:state", {
        trackId,
        source: snapshot.track?.source ?? null,
        isPlaying: snapshot.isPlaying,
        isBusy: snapshot.isBusy
      });
      this.lastLoggedPlayback = { trackId, isPlaying: snapshot.isPlaying, isBusy: snapshot.isBusy };
    }
    for (const l of this.listeners) l(snapshot);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("wa:player:state", { detail: snapshot }));
    }
  }
  startRemoteTicker() {
    if (!this.transport) return;
    if (!this.state.isPlaying) return;
    if (this.remoteRafId !== null) return;
    const tick = (nowMs) => {
      if (!this.transport || !this.state.isPlaying || !this.state.track) {
        this.remoteRafId = null;
        this.remoteUiEmitMs = null;
        return;
      }
      const baseMs = this.remoteBaseMs ?? nowMs;
      const basePos = this.remoteBasePosSec ?? (this.state.positionSec ?? 0);
      const deltaSec = (nowMs - baseMs) / 1e3;
      const duration = this.state.track.durationSec ?? 0;
      const nextPos = duration ? clamp(basePos + deltaSec, 0, duration) : Math.max(0, basePos + deltaSec);
      const lastEmit = this.remoteUiEmitMs ?? 0;
      if (nowMs - lastEmit >= 250) {
        this.remoteUiEmitMs = nowMs;
        this.state = { ...this.state, positionSec: nextPos };
        this.emit();
      }
      this.remoteRafId = requestAnimationFrame(tick);
    };
    this.remoteRafId = requestAnimationFrame(tick);
  }
  stopRemoteTicker() {
    if (this.remoteRafId !== null) cancelAnimationFrame(this.remoteRafId);
    this.remoteRafId = null;
    this.remoteUiEmitMs = null;
    this.remoteBaseMs = null;
    this.remoteBasePosSec = null;
  }
  ensureTicker() {
    if (!this.state.isPlaying) {
      if (this.rafId !== null) cancelAnimationFrame(this.rafId);
      this.rafId = null;
      this.lastTickMs = null;
      this.lastUiEmitMs = null;
      return;
    }
    if (this.transport) return;
    if (this.rafId !== null) return;
    const tick = (nowMs) => {
      if (!this.state.isPlaying) {
        this.rafId = null;
        this.lastTickMs = null;
        this.lastUiEmitMs = null;
        return;
      }
      const last = this.lastTickMs ?? nowMs;
      const deltaSec = (nowMs - last) / 1e3;
      this.lastTickMs = nowMs;
      const duration = this.state.track?.durationSec ?? 0;
      if (duration > 0) {
        const nextPos = this.state.positionSec + deltaSec;
        if (nextPos >= duration) {
          this.next();
        } else {
          this.state = { ...this.state, positionSec: nextPos };
          const lastEmit = this.lastUiEmitMs ?? 0;
          if (nowMs - lastEmit >= 250) {
            this.lastUiEmitMs = nowMs;
            this.emit();
          }
        }
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }
};

// wwwroot/ts/components/playerBar/playerBar.ts
function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
var PlayerBar = class {
  root;
  store;
  unsubscribe = null;
  titleEl;
  artistEl;
  artImg;
  toggleIconEl;
  btnPrev;
  btnNext;
  btnToggle;
  btnMenu;
  timeCurrentEl;
  timeDurationEl;
  scrubber;
  lastArtUrl = null;
  shareBusy = false;
  libraryBusy = false;
  constructor(opts) {
    this.root = opts.root;
    this.store = opts.store;
    this.titleEl = this.root.querySelector("[data-wa-player-title]");
    this.artistEl = this.root.querySelector("[data-wa-player-artist]");
    this.artImg = this.root.querySelector("[data-wa-player-art]");
    this.toggleIconEl = this.root.querySelector("[data-wa-player-toggle-icon]");
    this.btnPrev = this.root.querySelector("[data-wa-player-prev]");
    this.btnNext = this.root.querySelector("[data-wa-player-next]");
    this.btnToggle = this.root.querySelector("[data-wa-player-toggle]");
    this.btnMenu = this.root.querySelector("[data-wa-player-menu]");
    this.timeCurrentEl = this.root.querySelector("[data-wa-player-time-current]");
    this.timeDurationEl = this.root.querySelector("[data-wa-player-time-duration]");
    this.scrubber = this.root.querySelector("[data-wa-player-scrubber]");
    this.bind();
  }
  /**
   * Binds DOM event handlers and subscribes to store updates
   */
  bind() {
    this.btnPrev?.addEventListener("click", () => this.store.prev({ autoplay: true }));
    this.btnNext?.addEventListener("click", () => this.store.next({ autoplay: true }));
    this.btnToggle?.addEventListener("click", () => this.store.togglePlay());
    this.btnMenu?.addEventListener("click", () => {
      const track = this.store.getState().track;
      if (!track || this.shareBusy || this.libraryBusy || !this.btnMenu) return;
      this.render(this.store.getState());
      openTrackContextMenu({
        anchor: this.btnMenu,
        track,
        title: "Track Actions",
        allowNavigateOnMobile: false,
        onLibraryBusyChange: (busy) => {
          this.libraryBusy = busy;
          this.render(this.store.getState());
        },
        onShareBusyChange: (busy) => {
          this.shareBusy = busy;
          this.render(this.store.getState());
        }
      });
    });
    this.scrubber?.addEventListener("input", () => {
      const state = this.store.getState();
      const duration = state.track?.durationSec ?? 0;
      if (!duration) return;
      const value = Number(this.scrubber?.value ?? 0);
      this.store.seekByRatio(value / 100);
    });
    this.titleEl?.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 820px)").matches) return;
      const track = this.store.getState().track;
      const albumId = track?.albumId;
      if (!albumId) return;
      window.dispatchEvent(
        new CustomEvent("wa:navigate:album", { detail: { albumId } })
      );
    });
    this.artistEl?.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 820px)").matches) return;
      const track = this.store.getState().track;
      const artistId = track?.primaryArtistId;
      if (!artistId) return;
      window.dispatchEvent(
        new CustomEvent("wa:navigate:artist", { detail: { artistId } })
      );
    });
    this.unsubscribe = this.store.subscribe((state) => this.render(state));
  }
  /**
   * Unsubscribes from store updates
   */
  destroy() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
  render(state) {
    const track = state.track;
    const duration = track?.durationSec ?? 0;
    const position = state.positionSec;
    const canNavigateAlbum = !!track?.albumId;
    const canNavigateArtist = !!track?.primaryArtistId;
    if (this.titleEl) {
      this.titleEl.textContent = track?.title ?? "Not Playing";
      if (canNavigateAlbum) this.titleEl.classList.add("wa-playerbar__link");
      else this.titleEl.classList.remove("wa-playerbar__link");
    }
    if (this.artistEl) {
      this.artistEl.textContent = track?.artist ?? "\u2014";
      if (canNavigateArtist) this.artistEl.classList.add("wa-playerbar__link");
      else this.artistEl.classList.remove("wa-playerbar__link");
    }
    if (this.toggleIconEl) {
      const src = state.isPlaying ? indiumSvg("pause-filled.svg") : indiumSvg("play-filled.svg");
      if (this.toggleIconEl.getAttribute("src") !== src) {
        this.toggleIconEl.setAttribute("src", src);
      }
    }
    if (this.btnToggle) {
      if (state.isBusy) this.btnToggle.setAttribute("data-wa-busy", "true");
      else this.btnToggle.removeAttribute("data-wa-busy");
      this.btnToggle.disabled = !track;
    }
    if (this.btnPrev) {
      this.btnPrev.disabled = !track;
    }
    if (this.btnNext) {
      this.btnNext.disabled = !track;
    }
    if (this.btnMenu) {
      this.btnMenu.disabled = !track || this.shareBusy || this.libraryBusy;
    }
    if (this.timeCurrentEl) this.timeCurrentEl.textContent = formatTime(position);
    if (this.timeDurationEl) this.timeDurationEl.textContent = formatTime(duration);
    if (this.scrubber) {
      const ratio = duration ? position / duration : 0;
      this.scrubber.value = String(Math.max(0, Math.min(100, ratio * 100)));
      this.scrubber.disabled = !track || !duration;
    }
    if (this.artImg) {
      const nextUrl = track?.artUrl ?? null;
      if (nextUrl && nextUrl !== this.lastArtUrl) {
        this.lastArtUrl = nextUrl;
        applyCachedArt(this.artImg, nextUrl);
        this.artImg.style.display = "block";
      } else if (!nextUrl) {
        this.lastArtUrl = null;
        applyCachedArt(this.artImg, null);
        this.artImg.style.display = "none";
      }
    }
  }
};

// wwwroot/ts/components/nowPlayingMobile/nowPlayingMobile.ts
function upgradeSoundCloudArtworkUrl(url) {
  if (!url) return url;
  return url.replace("-large.", "-t500x500.").replace("-t300x300.", "-t500x500.");
}
function formatTime2(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
var NowPlayingMobile = class {
  root;
  store;
  unsubscribe = null;
  isMobileMql;
  enabled = false;
  open = false;
  playerBarRoot;
  sheet;
  contentEl;
  grabBtn;
  closeEls;
  titleEl;
  artistEl;
  artImg;
  toggleIconEl;
  btnPrev;
  btnNext;
  btnToggle;
  btnMenu;
  timeCurrentEl;
  timeDurationEl;
  scrubber;
  shuffleInput;
  topbarShuffleInput = null;
  onTopbarShuffleChange = null;
  lastArtUrl = null;
  shareBusy = false;
  libraryBusy = false;
  scrollLocked = false;
  scrollLockBodyStyle = null;
  scrollLockHtmlStyle = null;
  // gesture state
  barTouchStartY = null;
  barTouchStartX = null;
  dragStartY = null;
  dragLastY = null;
  dragging = false;
  didDrag = false;
  constructor(opts) {
    this.root = opts.root;
    this.store = opts.store;
    this.playerBarRoot = opts.playerBarRoot ?? null;
    if (typeof document !== "undefined" && this.root.parentElement !== document.body) {
      document.body.appendChild(this.root);
    }
    this.isMobileMql = window.matchMedia("(max-width: 820px)");
    this.sheet = this.root.querySelector(".wa-nowplaying__sheet");
    this.contentEl = this.root.querySelector(".wa-nowplaying__content");
    this.grabBtn = this.root.querySelector("[data-wa-nowplaying-grab]");
    this.closeEls = Array.from(this.root.querySelectorAll("[data-wa-nowplaying-close]"));
    this.titleEl = this.root.querySelector("[data-wa-nowplaying-title]");
    this.artistEl = this.root.querySelector("[data-wa-nowplaying-artist]");
    this.artImg = this.root.querySelector("[data-wa-nowplaying-art]");
    this.toggleIconEl = this.root.querySelector("[data-wa-nowplaying-toggle-icon]");
    this.btnPrev = this.root.querySelector("[data-wa-nowplaying-prev]");
    this.btnNext = this.root.querySelector("[data-wa-nowplaying-next]");
    this.btnToggle = this.root.querySelector("[data-wa-nowplaying-toggle]");
    this.btnMenu = this.root.querySelector("[data-wa-nowplaying-menu]");
    this.timeCurrentEl = this.root.querySelector("[data-wa-nowplaying-time-current]");
    this.timeDurationEl = this.root.querySelector("[data-wa-nowplaying-time-duration]");
    this.scrubber = this.root.querySelector("[data-wa-nowplaying-scrubber]");
    this.shuffleInput = this.root.querySelector("[data-wa-nowplaying-shuffle]");
    this.bind();
  }
  bind() {
    const syncEnabled = () => {
      const next = !!this.isMobileMql.matches;
      if (next === this.enabled) return;
      this.enabled = next;
      if (!this.enabled) {
        this.close();
      }
    };
    const mql = this.isMobileMql;
    if (typeof mql.addEventListener === "function") mql.addEventListener("change", syncEnabled);
    else this.isMobileMql.addListener(syncEnabled);
    syncEnabled();
    this.btnPrev?.addEventListener("click", () => this.store.prev({ autoplay: true }));
    this.btnNext?.addEventListener("click", () => this.store.next({ autoplay: true }));
    this.btnToggle?.addEventListener("click", () => this.store.togglePlay());
    this.btnMenu?.addEventListener("click", () => {
      const track = this.store.getState().track;
      if (!track || this.shareBusy || this.libraryBusy || !this.btnMenu) return;
      this.render(this.store.getState());
      openTrackContextMenu({
        anchor: this.btnMenu,
        track,
        title: "Track Actions",
        onLibraryBusyChange: (busy) => {
          this.libraryBusy = busy;
          this.render(this.store.getState());
        },
        onShareBusyChange: (busy) => {
          this.shareBusy = busy;
          this.render(this.store.getState());
        }
      });
    });
    this.scrubber?.addEventListener("input", () => {
      const state = this.store.getState();
      const duration = state.track?.durationSec ?? 0;
      if (!duration) return;
      const value = Number(this.scrubber?.value ?? 0);
      this.store.seekByRatio(value / 100);
    });
    if (this.shuffleInput) {
      this.shuffleInput.checked = getShufflePref();
      const onShuffle = () => {
        setShuffleEnabled(!!this.shuffleInput?.checked, { markDirty: true });
      };
      this.shuffleInput.addEventListener("change", onShuffle);
    }
    this.topbarShuffleInput = document.querySelector('[data-wa-action="shuffle-toggle"]');
    if (this.topbarShuffleInput && this.shuffleInput) {
      const syncFromTopbar = () => {
        const enabled = !!this.topbarShuffleInput?.checked;
        this.shuffleInput.checked = enabled;
      };
      this.onTopbarShuffleChange = syncFromTopbar;
      this.topbarShuffleInput.addEventListener("change", syncFromTopbar);
    }
    for (const el of this.closeEls) {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        this.close();
      });
    }
    if (this.playerBarRoot) {
      this.playerBarRoot.addEventListener("click", (e) => {
        if (!this.enabled) return;
        if (this.open) return;
        if (!this.canOpenFromEventTarget(e.target)) return;
        if (!this.store.getState().track) return;
        this.openSheet();
      });
      this.playerBarRoot.addEventListener("touchstart", (e) => {
        if (!this.enabled) return;
        if (this.open) return;
        if (!this.canOpenFromEventTarget(e.target)) return;
        const t = e.touches[0];
        if (!t) return;
        this.barTouchStartY = t.clientY;
        this.barTouchStartX = t.clientX;
      }, { passive: true });
      this.playerBarRoot.addEventListener("touchend", (e) => {
        if (!this.enabled) return;
        if (this.open) return;
        if (this.barTouchStartY === null || this.barTouchStartX === null) return;
        const t = e.changedTouches[0];
        if (!t) return;
        const dy = t.clientY - this.barTouchStartY;
        const dx = t.clientX - this.barTouchStartX;
        this.barTouchStartY = null;
        this.barTouchStartX = null;
        if (dy < -40 && Math.abs(dx) < 60) {
          if (!this.store.getState().track) return;
          this.openSheet();
        }
      }, { passive: true });
    }
    const canStartSheetDragFromTarget = (target) => {
      if (!target) return true;
      if (target.closest("[data-wa-nowplaying-grab]")) return true;
      if (target.closest("button")) return false;
      if (target.closest("input")) return false;
      if (target.closest("a")) return false;
      if (target.closest(".comp-toggle")) return false;
      if (target.closest(".wa-nowplaying__scrub")) return false;
      if (target.closest("[data-wa-nowplaying-scrubber]")) return false;
      const c = this.contentEl;
      if (c && c.scrollTop > 1) return false;
      return true;
    };
    const startDrag = (clientY, captureEl, pointerId) => {
      this.dragging = true;
      this.didDrag = false;
      this.dragStartY = clientY;
      this.dragLastY = clientY;
      if (captureEl && typeof pointerId === "number") {
        try {
          captureEl.setPointerCapture(pointerId);
        } catch {
        }
      }
      this.setDragging(true);
    };
    const moveDrag = (clientY) => {
      if (!this.dragging || this.dragStartY === null) return;
      this.dragLastY = clientY;
      const dy = Math.max(0, clientY - this.dragStartY);
      if (dy > 6) this.didDrag = true;
      this.setSheetTranslateY(dy);
    };
    const endDrag = () => {
      if (!this.dragging || this.dragStartY === null || this.dragLastY === null) return;
      const dy = Math.max(0, this.dragLastY - this.dragStartY);
      this.dragging = false;
      this.dragStartY = null;
      this.dragLastY = null;
      this.setDragging(false);
      if (dy > 90) this.close();
      else this.setSheetTranslateY(0);
    };
    const onPointerDown = (e) => {
      if (!this.enabled) return;
      if (!this.open) return;
      if (!canStartSheetDragFromTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      startDrag(e.clientY, e.currentTarget, e.pointerId);
    };
    const onPointerMove = (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      e.stopPropagation();
      moveDrag(e.clientY);
    };
    const onPointerUp = (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      e.stopPropagation();
      endDrag();
    };
    this.grabBtn?.addEventListener("pointerdown", onPointerDown);
    this.grabBtn?.addEventListener("pointermove", onPointerMove);
    this.grabBtn?.addEventListener("pointerup", onPointerUp);
    this.grabBtn?.addEventListener("pointercancel", onPointerUp);
    this.grabBtn?.addEventListener("click", (e) => {
      if (!this.enabled) return;
      if (!this.open) return;
      e.preventDefault();
      e.stopPropagation();
      if (!this.didDrag) this.close();
    });
    const onTouchStart = (e) => {
      if (!this.enabled) return;
      if (!this.open) return;
      if (!canStartSheetDragFromTarget(e.target)) return;
      const t = e.touches[0];
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      startDrag(t.clientY);
    };
    const onTouchMove = (e) => {
      if (!this.dragging) return;
      const t = e.touches[0];
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      moveDrag(t.clientY);
    };
    const onTouchEnd = (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      e.stopPropagation();
      endDrag();
    };
    this.grabBtn?.addEventListener("touchstart", onTouchStart, { passive: false });
    this.grabBtn?.addEventListener("touchmove", onTouchMove, { passive: false });
    this.grabBtn?.addEventListener("touchend", onTouchEnd, { passive: false });
    this.grabBtn?.addEventListener("touchcancel", onTouchEnd, { passive: false });
    this.sheet?.addEventListener("pointerdown", onPointerDown);
    this.sheet?.addEventListener("pointermove", onPointerMove);
    this.sheet?.addEventListener("pointerup", onPointerUp);
    this.sheet?.addEventListener("pointercancel", onPointerUp);
    this.sheet?.addEventListener("touchstart", onTouchStart, { passive: false });
    this.sheet?.addEventListener("touchmove", onTouchMove, { passive: false });
    this.sheet?.addEventListener("touchend", onTouchEnd, { passive: false });
    this.sheet?.addEventListener("touchcancel", onTouchEnd, { passive: false });
    this.unsubscribe = this.store.subscribe((state) => this.render(state));
  }
  canOpenFromEventTarget(target) {
    if (!target) return true;
    if (target.closest("button")) return false;
    if (target.closest("input")) return false;
    return true;
  }
  openSheet() {
    this.open = true;
    document.documentElement.dataset.waNowPlayingOpen = "true";
    document.body.dataset.waNowPlayingOpen = "true";
    this.root.setAttribute("aria-hidden", "false");
    this.lockScroll();
    this.setSheetTranslateY(0);
  }
  close() {
    this.open = false;
    delete document.documentElement.dataset.waNowPlayingOpen;
    delete document.body.dataset.waNowPlayingOpen;
    this.root.setAttribute("aria-hidden", "true");
    this.unlockScroll();
    this.setSheetTranslateY(0);
  }
  lockScroll() {
    if (this.scrollLocked) return;
    this.scrollLocked = true;
    const html = document.documentElement.style;
    const b = document.body.style;
    this.scrollLockHtmlStyle = {
      overflow: html.overflow,
      overscrollBehavior: html.overscrollBehavior
    };
    this.scrollLockBodyStyle = {
      overflow: b.overflow,
      overscrollBehavior: b.overscrollBehavior
    };
    html.overflow = "hidden";
    html.overscrollBehavior = "none";
    b.overflow = "hidden";
    b.overscrollBehavior = "none";
  }
  unlockScroll() {
    if (!this.scrollLocked) return;
    this.scrollLocked = false;
    const prevHtml = this.scrollLockHtmlStyle;
    const prev = this.scrollLockBodyStyle;
    this.scrollLockHtmlStyle = null;
    this.scrollLockBodyStyle = null;
    if (prevHtml) {
      const html = document.documentElement.style;
      html.overflow = prevHtml.overflow ?? "";
      html.overscrollBehavior = prevHtml.overscrollBehavior ?? "";
    }
    if (prev) {
      const b = document.body.style;
      b.overflow = prev.overflow ?? "";
      b.overscrollBehavior = prev.overscrollBehavior ?? "";
    }
  }
  setDragging(isDragging) {
    if (!this.sheet) return;
    if (isDragging) this.sheet.classList.add("wa-nowplaying__sheet--dragging");
    else this.sheet.classList.remove("wa-nowplaying__sheet--dragging");
  }
  setSheetTranslateY(px) {
    if (!this.sheet) return;
    this.sheet.style.transform = px ? `translateY(${px}px)` : "";
  }
  destroy() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.topbarShuffleInput && this.onTopbarShuffleChange) {
      this.topbarShuffleInput.removeEventListener("change", this.onTopbarShuffleChange);
    }
    this.onTopbarShuffleChange = null;
    this.topbarShuffleInput = null;
  }
  render(state) {
    if (!this.enabled) return;
    const track = state.track;
    const duration = track?.durationSec ?? 0;
    const position = state.positionSec;
    if (!track && this.open) {
      this.close();
    }
    if (this.titleEl) this.titleEl.textContent = track?.title ?? "Not Playing";
    if (this.artistEl) this.artistEl.textContent = track?.artist ?? "\u2014";
    if (this.toggleIconEl) {
      const src = state.isPlaying ? indiumSvg("pause-filled.svg") : indiumSvg("play-filled.svg");
      if (this.toggleIconEl.getAttribute("src") !== src) {
        this.toggleIconEl.setAttribute("src", src);
      }
    }
    if (this.btnToggle) {
      if (state.isBusy) this.btnToggle.setAttribute("data-wa-busy", "true");
      else this.btnToggle.removeAttribute("data-wa-busy");
    }
    if (this.btnMenu) {
      this.btnMenu.disabled = !track || this.shareBusy || this.libraryBusy;
    }
    if (this.timeCurrentEl) this.timeCurrentEl.textContent = formatTime2(position);
    if (this.timeDurationEl) this.timeDurationEl.textContent = formatTime2(duration);
    if (this.scrubber) {
      const ratio = duration ? position / duration : 0;
      this.scrubber.value = String(Math.max(0, Math.min(100, ratio * 100)));
    }
    if (this.artImg) {
      const baseUrl = track?.artUrlLarge ?? track?.artUrl ?? track?.artUrlSmall ?? null;
      const nextUrl = track?.source === "soundcloud" && baseUrl ? upgradeSoundCloudArtworkUrl(baseUrl) : baseUrl;
      if (nextUrl && nextUrl !== this.lastArtUrl) {
        this.lastArtUrl = nextUrl;
        applyCachedArt(this.artImg, nextUrl);
        this.artImg.style.display = "block";
      } else if (!nextUrl) {
        this.lastArtUrl = null;
        applyCachedArt(this.artImg, null);
        this.artImg.style.display = "none";
      }
    }
  }
};

// wwwroot/ts/sources/spotifySource.ts
var SpotifySource = class {
  id = "spotify";
  displayName = "Spotify";
  state = { isConnected: false };
  listeners = [];
  lastLoggedConnected = null;
  getState() {
    return { ...this.state };
  }
  onChange(listener) {
    this.listeners.push(listener);
    listener(this.getState());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
  /**
   * Probes auth state via `spotifyApi.status` and emits an initial snapshot
   */
  async init() {
    try {
      const s = await spotifyApi.status();
      this.state = { isConnected: !!s?.isAuthenticated };
    } catch {
      this.state = { isConnected: false };
    }
    this.emit();
  }
  /**
   * Starts OAuth flow via navigation, promise intentionally never resolves
   */
  async connect() {
    spotifyApi.login();
    await new Promise(() => {
    });
  }
  /**
   * Logs out via proxy endpoint, emits state, then navigates back to `/webamp`
   */
  async disconnect() {
    await spotifyApi.logout();
    this.state = { isConnected: false };
    this.emit();
    window.location.assign(routePath2("/"));
  }
  emit() {
    const snap = this.getState();
    if (this.lastLoggedConnected !== snap.isConnected) {
      logEvent("WebAmp", "source:state", { source: this.id, connected: snap.isConnected });
      this.lastLoggedConnected = snap.isConnected;
    }
    for (const l of this.listeners) l(snap);
  }
};

// wwwroot/ts/sources/soundCloudSource.ts
var SoundCloudSource = class {
  id = "soundcloud";
  displayName = "SoundCloud";
  state = { isConnected: false };
  listeners = [];
  lastLoggedConnected = null;
  getState() {
    return { ...this.state };
  }
  onChange(listener) {
    this.listeners.push(listener);
    listener(this.getState());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
  /**
   * Probes auth state via `/soundclouduser/status`.
   */
  async init() {
    try {
      const s = await soundcloudUserApi.status();
      this.state = { isConnected: !!s?.isAuthenticated };
    } catch {
      this.state = { isConnected: false };
    }
    this.emit();
  }
  /**
   * Starts OAuth flow by navigating to the SoundCloud login endpoint.
   */
  async connect() {
    const ru = window.location.pathname + window.location.search + window.location.hash;
    window.location.assign(`${routePath2("soundcloud/login")}?returnUrl=${encodeURIComponent(ru)}`);
    await new Promise(() => {
    });
  }
  /**
   * Logs out of SoundCloud user session.
   */
  async disconnect() {
    await soundcloudUserApi.logout();
    this.state = { isConnected: false };
    this.emit();
    window.location.assign(routePath2("/"));
  }
  emit() {
    const snap = this.getState();
    if (this.lastLoggedConnected !== snap.isConnected) {
      logEvent("WebAmp", "source:state", { source: this.id, connected: snap.isConnected });
      this.lastLoggedConnected = snap.isConnected;
    }
    for (const l of this.listeners) l(snap);
  }
};

// wwwroot/ts/sources/transportEvents.ts
function dispatchTransportFinish(source, trackId) {
  if (!trackId) return;
  try {
    window.dispatchEvent(new CustomEvent("wa:transport:finish", {
      detail: { source, trackId }
    }));
  } catch {
  }
}
function dispatchTransportBusy(busy) {
  try {
    window.dispatchEvent(new CustomEvent("wa:transport:busy", { detail: { busy } }));
  } catch {
  }
}

// wwwroot/ts/sources/spotify/spotifyPlayback.ts
var readyPromise = null;
var playerRef = null;
var deviceIdRef = null;
var stateListeners = /* @__PURE__ */ new Set();
var lastTrackId = null;
var lastIsPlaying = null;
var lastPositionSec = null;
function loadSdk() {
  return new Promise((resolve, reject) => {
    if (window.Spotify?.Player) {
      logEvent("WebAmp", "spotify:sdk:cached");
      resolve();
      return;
    }
    const existing = document.querySelector("script[data-wa-spotify-sdk]");
    if (existing) {
      logEvent("WebAmp", "spotify:sdk:inflight");
    } else {
      const script = document.createElement("script");
      script.src = "https://sdk.scdn.co/spotify-player.js";
      script.async = true;
      script.defer = true;
      script.setAttribute("data-wa-spotify-sdk", "true");
      script.onerror = () => {
        logEvent("WebAmp", "spotify:sdk:error", null, "Failed to load Spotify Web Playback SDK", "error");
        reject(new Error("Failed to load Spotify Web Playback SDK"));
      };
      document.head.appendChild(script);
      logEvent("WebAmp", "spotify:sdk:append", { src: script.src });
    }
    window.onSpotifyWebPlaybackSDKReady = () => {
      logEvent("WebAmp", "spotify:sdk:ready");
      resolve();
    };
  });
}
function mapPlayerStateToTrack(state) {
  const t = state?.track_window?.current_track;
  if (!t) return null;
  const art = t.album?.images?.[0]?.url;
  const artist = Array.isArray(t.artists) ? t.artists.map((a) => a.name).join(", ") : t.artists?.[0]?.name ?? "";
  const primaryArtistId = Array.isArray(t.artists) && t.artists.length ? t.artists[0]?.id : t.artists?.[0]?.id ?? void 0;
  return {
    id: t.id,
    source: "spotify",
    title: t.name,
    artist,
    albumId: t.album?.id,
    album: t.album?.name,
    primaryArtistId,
    durationSec: Math.round((t.duration_ms ?? 0) / 1e3),
    artUrl: art,
    uri: t.uri
  };
}
function emitState(state) {
  if (!state) {
    logEvent("WebAmp", "spotify:sdk:state:null");
    return;
  }
  const payload = {
    track: mapPlayerStateToTrack(state),
    isPlaying: !state.paused,
    positionSec: Math.round((state.position ?? 0) / 1e3)
  };
  logEvent("WebAmp", "spotify:sdk:state", {
    deviceId: deviceIdRef,
    trackId: payload.track?.id ?? null,
    isPlaying: payload.isPlaying,
    positionSec: payload.positionSec,
    durationSec: payload.track?.durationSec ?? null
  });
  if (payload.track && typeof payload.positionSec === "number") {
    const duration = payload.track.durationSec ?? 0;
    const epsilon = 2;
    const atEnd = duration > 0 && payload.positionSec >= duration - epsilon;
    const wasPlaying = lastIsPlaying === true;
    const sameTrack = lastTrackId !== null && lastTrackId === payload.track.id;
    if (wasPlaying && !payload.isPlaying && sameTrack && atEnd) {
      try {
        dispatchTransportFinish("spotify", payload.track.id);
      } catch {
      }
    }
  }
  lastTrackId = payload.track?.id ?? null;
  lastIsPlaying = payload.isPlaying;
  lastPositionSec = payload.positionSec;
  for (const l of stateListeners) l(payload);
}
async function ensureSpotifyPlayback(onState) {
  if (onState) stateListeners.add(onState);
  if (playerRef && deviceIdRef) {
    logEvent("WebAmp", "spotify:ensure:cached", { deviceId: deviceIdRef });
    return { deviceId: deviceIdRef, player: playerRef };
  }
  if (readyPromise) {
    logEvent("WebAmp", "spotify:ensure:pending");
    return readyPromise;
  }
  readyPromise = (async () => {
    try {
      logEvent("WebAmp", "spotify:ensure:start");
      await loadSdk();
      const player = new window.Spotify.Player({
        name: "WebAmp",
        volume: 0.8,
        getOAuthToken: async (cb) => {
          try {
            const { accessToken } = await spotifyApi.accessToken();
            logEvent("WebAmp", "spotify:token:ok", { length: accessToken?.length ?? 0 });
            cb(accessToken);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            logEvent("WebAmp", "spotify:token:error", null, message, "error");
            cb("");
          }
        }
      });
      logEvent("WebAmp", "spotify:player:created", {
        hasActivateElement: typeof player?.activateElement === "function",
        userAgent: navigator.userAgent
      });
      const deviceIdPromise = new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Spotify player did not respond.")), 15e3);
        player.addListener("ready", ({ device_id }) => {
          window.clearTimeout(timeout);
          logEvent("WebAmp", "spotify:player:ready", { deviceId: device_id });
          resolve(device_id);
        });
        player.addListener("not_ready", ({ device_id }) => {
          logEvent("WebAmp", "spotify:player:not_ready", { deviceId: device_id }, void 0, "warn");
        });
        player.addListener("initialization_error", ({ message }) => {
          logEvent("WebAmp", "spotify:player:init_error", null, message, "error");
          reject(new Error(message));
        });
        player.addListener("authentication_error", ({ message }) => {
          logEvent("WebAmp", "spotify:player:auth_error", null, message, "error");
          reject(new Error(message));
        });
        player.addListener("account_error", ({ message }) => {
          logEvent("WebAmp", "spotify:player:account_error", null, message, "error");
          reject(new Error(message));
        });
        player.addListener("playback_error", ({ message }) => {
          logEvent("WebAmp", "spotify:player:playback_error", null, message, "error");
        });
        player.addListener("autoplay_failed", () => {
          logEvent("WebAmp", "spotify:player:autoplay_failed", {
            deviceId: deviceIdRef,
            visibility: document.visibilityState,
            userAgent: navigator.userAgent
          }, void 0, "warn");
        });
      });
      player.addListener("player_state_changed", (state) => emitState(state));
      logEvent("WebAmp", "spotify:player:connect:start");
      const connected = await player.connect();
      logEvent("WebAmp", "spotify:player:connect:done", { connected });
      if (!connected) throw new Error("Spotify player failed to connect");
      const deviceId = await deviceIdPromise;
      playerRef = player;
      deviceIdRef = deviceId;
      logEvent("WebAmp", "spotify:ensure:done", { deviceId });
      return { deviceId, player };
    } catch (e) {
      readyPromise = null;
      const message = e instanceof Error ? e.message : "Unknown error";
      logEvent("WebAmp", "spotify:ensure:error", null, message, "error");
      throw e;
    }
  })();
  return readyPromise;
}

// wwwroot/ts/sources/spotify/spotifyTransport.ts
var SpotifyTransport = class {
  constructor(onRemoteState) {
    this.onRemoteState = onRemoteState;
  }
  deviceId = null;
  player = null;
  ready = null;
  activated = false;
  transferredDeviceId = null;
  /**
   * Pre-warms SDK and device id
   */
  async init() {
    await this.ensureReady();
  }
  prime() {
    if (this.ready) return;
    logEvent("WebAmp", "spotify:transport:prime:start");
    void this.ensureReady().catch((error) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      logEvent("WebAmp", "spotify:transport:prime:error", null, message, "error");
    });
  }
  primeActivation() {
    if (this.activated) {
      logEvent("WebAmp", "spotify:activate:prime:cached", { deviceId: this.deviceId });
      return;
    }
    if (!this.player || typeof this.player.activateElement !== "function") {
      logEvent("WebAmp", "spotify:activate:prime:skip", {
        deviceId: this.deviceId,
        hasPlayer: !!this.player
      });
      return;
    }
    logEvent("WebAmp", "spotify:activate:prime:start", {
      deviceId: this.deviceId,
      visibility: document.visibilityState,
      userAgent: navigator.userAgent
    });
    Promise.resolve(this.player.activateElement()).then(() => {
      this.activated = true;
      logEvent("WebAmp", "spotify:activate:prime:done", { deviceId: this.deviceId });
    }).catch((error) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      logEvent("WebAmp", "spotify:activate:prime:error", { deviceId: this.deviceId }, message, "error");
    });
  }
  requireDevice() {
    if (!this.deviceId) throw new Error("Spotify device not ready");
    return this.deviceId;
  }
  async ensureReady() {
    if (this.ready) return await this.ready;
    this.ready = (async () => {
      logEvent("WebAmp", "spotify:transport:ready:start");
      try {
        const ready = await ensureSpotifyPlayback(this.onRemoteState);
        this.deviceId = ready.deviceId;
        this.player = ready.player;
        logEvent("WebAmp", "spotify:transport:ready:done", {
          deviceId: this.deviceId,
          hasPlayer: !!this.player
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logEvent("WebAmp", "spotify:transport:ready:error", null, message, "error");
        throw error;
      }
    })();
    return await this.ready;
  }
  async ensureActivated() {
    if (this.activated) {
      logEvent("WebAmp", "spotify:activate:cached", { deviceId: this.deviceId });
      return;
    }
    try {
      logEvent("WebAmp", "spotify:activate:start", {
        deviceId: this.deviceId,
        hasActivateElement: typeof this.player?.activateElement === "function",
        visibility: document.visibilityState,
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints ?? 0
      });
      await this.player?.activateElement?.();
      this.activated = true;
      logEvent("WebAmp", "spotify:activate:done", { deviceId: this.deviceId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logEvent("WebAmp", "spotify:activate:error", { deviceId: this.deviceId }, message, "error");
    }
  }
  async ensureTransferred(play = false) {
    const deviceId = this.requireDevice();
    if (this.transferredDeviceId === deviceId) {
      logEvent("WebAmp", "spotify:transfer:cached", { deviceId, play });
      return;
    }
    logEvent("WebAmp", "spotify:transfer:start", { deviceId, play });
    await spotifyApi.transfer(deviceId, play);
    this.transferredDeviceId = deviceId;
    logEvent("WebAmp", "spotify:transfer:done", { deviceId, play });
  }
  /**
   * Plays a specific track URI on this device at an optional position
   */
  async play(track, positionSec = 0, opts) {
    try {
      logEvent("WebAmp", "spotify:transport:play:start", {
        trackId: track.id,
        trackUri: track.uri ?? null,
        positionSec: Math.max(0, Math.floor(positionSec)),
        autoplay: opts?.autoplay ?? true
      });
      await this.ensureReady();
      await this.ensureActivated();
      const deviceId = this.requireDevice();
      const uri = track.uri;
      if (!uri) throw new Error("Missing Spotify track URI");
      await this.ensureTransferred(false);
      logEvent("WebAmp", "spotify:transport:play:request", {
        deviceId,
        trackId: track.id,
        trackUri: uri,
        positionMs: Math.max(0, Math.floor(positionSec * 1e3))
      });
      await spotifyApi.playTrack(deviceId, uri, Math.max(0, Math.floor(positionSec * 1e3)));
      logEvent("WebAmp", "spotify:transport:play:done", {
        deviceId,
        trackId: track.id
      });
      if (opts?.autoplay === false) {
        logEvent("WebAmp", "spotify:transport:pause_after_load", {
          deviceId,
          trackId: track.id
        });
        await spotifyApi.pause(deviceId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logEvent("WebAmp", "spotify:transport:play:error", {
        trackId: track.id,
        trackUri: track.uri ?? null
      }, message, "error");
      if (!(error instanceof Error && error.message.includes("Spotify API proxy error"))) {
        void showErrorDialog(formatErrorMessage(error), "Music Service Error");
      }
      throw error;
    }
  }
  /**
   * Toggles pause/resume based on current playing state
   */
  async togglePlay(isPlaying) {
    try {
      logEvent("WebAmp", "spotify:transport:toggle:start", {
        previousIsPlaying: isPlaying
      });
      await this.ensureReady();
      await this.ensureActivated();
      const deviceId = this.requireDevice();
      if (isPlaying) {
        logEvent("WebAmp", "spotify:transport:pause:request", { deviceId });
        await spotifyApi.pause(deviceId);
        logEvent("WebAmp", "spotify:transport:pause:done", { deviceId });
      } else {
        await this.ensureTransferred(false);
        logEvent("WebAmp", "spotify:transport:resume:request", { deviceId });
        await spotifyApi.resume(deviceId);
        logEvent("WebAmp", "spotify:transport:resume:done", { deviceId });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logEvent("WebAmp", "spotify:transport:toggle:error", {
        previousIsPlaying: isPlaying,
        deviceId: this.deviceId
      }, message, "error");
      if (!(error instanceof Error && error.message.includes("Spotify API proxy error"))) {
        void showErrorDialog(formatErrorMessage(error), "Music Service Error");
      }
      throw error;
    }
  }
  /**
   * Seeks playback position (seconds) on this device
   */
  async seek(positionSec) {
    try {
      logEvent("WebAmp", "spotify:transport:seek:start", {
        positionMs: Math.max(0, Math.floor(positionSec * 1e3))
      });
      await this.ensureReady();
      await this.ensureActivated();
      const deviceId = this.requireDevice();
      await spotifyApi.seek(deviceId, Math.max(0, Math.floor(positionSec * 1e3)));
      logEvent("WebAmp", "spotify:transport:seek:done", {
        deviceId,
        positionMs: Math.max(0, Math.floor(positionSec * 1e3))
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logEvent("WebAmp", "spotify:transport:seek:error", {
        deviceId: this.deviceId,
        positionMs: Math.max(0, Math.floor(positionSec * 1e3))
      }, message, "error");
      if (!(error instanceof Error && error.message.includes("Spotify API proxy error"))) {
        void showErrorDialog(formatErrorMessage(error), "Music Service Error");
      }
      throw error;
    }
  }
};

// wwwroot/ts/sources/soundcloud/soundcloudTransport.ts
var STREAM_CACHE_TTL_MS = 30 * 60 * 1e3;
var PREFETCH_LOOKAHEAD_LIMIT = 25;
var SoundCloudTransport = class {
  constructor(onRemoteState, queue) {
    this.onRemoteState = onRemoteState;
    this.queue = queue;
  }
  audio = null;
  currentTrack = null;
  pendingTrack = null;
  desiredPlaying = false;
  lastKnownPlaying = false;
  lastProgressEmitMs = 0;
  primed = false;
  playRequestId = 0;
  switchingTrack = false;
  lifecycleBound = false;
  playbackPhase = "idle";
  streamInfoCache = /* @__PURE__ */ new Map();
  streamResolveInFlight = /* @__PURE__ */ new Map();
  prefetchGeneration = 0;
  //
  // track repeated errors while loading streams
  //
  lastAudioError = null;
  /**
   * Best-effort warmup for first interaction.
   */
  prime() {
    if (this.primed) return;
    this.primed = true;
    try {
      this.ensureAudio();
      this.bindLifecycleEvents();
      this.scheduleQueuePrefetch(this.currentTrack);
    } catch {
    }
  }
  getSource(track) {
    return track?.source ?? "spotify";
  }
  ensureAudio() {
    if (this.audio) return this.audio;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.crossOrigin = "anonymous";
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    this.audio = audio;
    this.bindAudioEvents(audio);
    this.bindLifecycleEvents();
    return audio;
  }
  setPlaybackPhase(phase, track = this.currentTrack) {
    if (this.playbackPhase === phase) return;
    this.playbackPhase = phase;
    logEvent("WebAmp", "soundcloud:phase", {
      phase,
      trackId: track?.id ?? null,
      visibility: typeof document !== "undefined" ? document.visibilityState : null
    });
  }
  bindLifecycleEvents() {
    if (this.lifecycleBound) return;
    this.lifecycleBound = true;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        logEvent("WebAmp", "soundcloud:lifecycle:visibility", {
          trackId: this.currentTrack?.id ?? null,
          desiredPlaying: this.desiredPlaying,
          visibility: document.visibilityState
        });
        if (document.visibilityState === "visible") {
          this.recoverDesiredPlayback("visibility");
          this.scheduleQueuePrefetch(this.currentTrack);
        }
      });
    }
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", () => {
        logEvent("WebAmp", "soundcloud:lifecycle:pagehide", {
          trackId: this.currentTrack?.id ?? null,
          desiredPlaying: this.desiredPlaying
        });
      });
      window.addEventListener("pageshow", () => {
        logEvent("WebAmp", "soundcloud:lifecycle:pageshow", {
          trackId: this.currentTrack?.id ?? null,
          desiredPlaying: this.desiredPlaying
        });
        this.recoverDesiredPlayback("pageshow");
        this.scheduleQueuePrefetch(this.currentTrack);
      });
    }
  }
  recoverDesiredPlayback(reason) {
    const audio = this.audio;
    if (!audio || !this.currentTrack || !this.desiredPlaying || !audio.paused)
      return;
    logEvent("WebAmp", "soundcloud:recover:request", {
      reason,
      trackId: this.currentTrack.id,
      positionSec: Math.round(Math.max(0, audio.currentTime || 0) * 100) / 100
    });
    this.requestPlay(audio, this.playRequestId, reason);
  }
  bindAudioEvents(audio) {
    audio.addEventListener("play", () => {
      if (this.switchingTrack) return;
      if (!this.currentTrack) return;
      this.lastKnownPlaying = true;
      logEvent("WebAmp", "soundcloud:audio:play", {
        trackId: this.currentTrack.id,
        positionSec: Math.round(Math.max(0, audio.currentTime || 0) * 100) / 100
      });
    });
    audio.addEventListener("playing", () => {
      if (this.switchingTrack) return;
      if (!this.currentTrack) return;
      this.lastKnownPlaying = true;
      this.setPlaybackPhase("playing", this.currentTrack);
      logEvent("WebAmp", "soundcloud:audio:playing", {
        trackId: this.currentTrack.id,
        positionSec: Math.round(Math.max(0, audio.currentTime || 0) * 100) / 100
      });
      this.emitRemote({
        track: this.currentTrack,
        isPlaying: true,
        positionSec: Math.max(0, audio.currentTime || 0)
      });
    });
    audio.addEventListener("pause", () => {
      if (this.switchingTrack) return;
      if (!this.currentTrack) return;
      this.lastKnownPlaying = false;
      this.setPlaybackPhase("paused", this.currentTrack);
      logEvent("WebAmp", "soundcloud:audio:pause", {
        trackId: this.currentTrack.id,
        positionSec: Math.round(Math.max(0, audio.currentTime || 0) * 100) / 100
      });
      this.emitRemote({
        track: this.currentTrack,
        isPlaying: false,
        positionSec: Math.max(0, audio.currentTime || 0)
      });
    });
    audio.addEventListener("timeupdate", () => {
      if (this.switchingTrack) return;
      if (!this.currentTrack) return;
      const now = performance.now();
      if (now - this.lastProgressEmitMs < 300) return;
      this.lastProgressEmitMs = now;
      this.emitRemote({
        track: this.currentTrack,
        isPlaying: !audio.paused,
        positionSec: Math.max(0, audio.currentTime || 0)
      });
    });
    audio.addEventListener("loadedmetadata", () => {
      logEvent("WebAmp", "soundcloud:audio:loadedmetadata", {
        trackId: this.currentTrack?.id ?? this.pendingTrack?.id ?? null,
        durationSec: Math.round(Math.max(0, audio.duration || 0) * 100) / 100
      });
    });
    audio.addEventListener("canplay", () => {
      logEvent("WebAmp", "soundcloud:audio:canplay", {
        trackId: this.currentTrack?.id ?? this.pendingTrack?.id ?? null
      });
    });
    audio.addEventListener("waiting", () => {
      logEvent(
        "WebAmp",
        "soundcloud:audio:waiting",
        {
          trackId: this.currentTrack?.id ?? this.pendingTrack?.id ?? null,
          positionSec: Math.round(Math.max(0, audio.currentTime || 0) * 100) / 100
        },
        void 0,
        "warn"
      );
    });
    audio.addEventListener("stalled", () => {
      logEvent(
        "WebAmp",
        "soundcloud:audio:stalled",
        {
          trackId: this.currentTrack?.id ?? this.pendingTrack?.id ?? null,
          positionSec: Math.round(Math.max(0, audio.currentTime || 0) * 100) / 100
        },
        void 0,
        "warn"
      );
    });
    audio.addEventListener("ended", () => {
      if (this.switchingTrack) return;
      if (!this.currentTrack) return;
      this.lastKnownPlaying = false;
      const finishedTrack = this.currentTrack;
      const duration = Number.isFinite(this.currentTrack.durationSec) ? this.currentTrack.durationSec : Math.max(0, audio.currentTime || 0);
      this.setPlaybackPhase("paused", this.currentTrack);
      logEvent("WebAmp", "soundcloud:audio:ended", {
        trackId: finishedTrack.id,
        positionSec: Math.round(duration * 100) / 100,
        desiredPlaying: this.desiredPlaying
      });
      this.emitRemote({
        track: this.currentTrack,
        isPlaying: false,
        positionSec: duration
      });
      if (!this.desiredPlaying) return;
      queueMicrotask(() => {
        if (this.currentTrack?.id !== finishedTrack.id) return;
        void this.handleNaturalTrackEnd(finishedTrack);
      });
    });
    audio.addEventListener("error", () => {
      if (!this.currentTrack) return;
      const mediaError = audio.error;
      const message = mediaError ? `Audio error (${mediaError.code})` : "Audio playback error";
      this.lastAudioError = {
        trackId: this.currentTrack.id,
        atMs: performance.now(),
        code: mediaError?.code ?? null
      };
      logEvent(
        "WebAmp",
        "soundcloud:audio:error",
        {
          trackId: this.currentTrack.id,
          errorCode: mediaError?.code ?? null
        },
        message,
        "error"
      );
    });
  }
  consumeRecentAudioError(trackId, withinMs = 5e3) {
    const recent = this.lastAudioError;
    if (!recent) return null;
    if (recent.trackId !== trackId) return null;
    if (performance.now() - recent.atMs > withinMs) return null;
    this.lastAudioError = null;
    return recent;
  }
  emitRemote(s) {
    if (!this.onRemoteState) return;
    this.onRemoteState({
      track: s.track,
      isPlaying: s.isPlaying,
      positionSec: s.positionSec
    });
  }
  setBusy(busy) {
    dispatchTransportBusy(busy);
  }
  async waitForLoadedMetadata(audio, timeoutMs = 3e3) {
    if (audio.readyState >= 1) return;
    await new Promise((resolve, reject) => {
      let done = false;
      const timeout = window.setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error("Timed out waiting for audio metadata."));
      }, timeoutMs);
      const onReady = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      };
      const onError = () => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error("Failed to load audio metadata."));
      };
      const cleanup = () => {
        window.clearTimeout(timeout);
        audio.removeEventListener("loadedmetadata", onReady);
        audio.removeEventListener("canplay", onReady);
        audio.removeEventListener("error", onError);
      };
      audio.addEventListener("loadedmetadata", onReady, { once: true });
      audio.addEventListener("canplay", onReady, { once: true });
      audio.addEventListener("error", onError, { once: true });
    });
  }
  normalizeStreamCandidates(stream) {
    const rawCandidates = Array.isArray(stream.candidates) && stream.candidates.length ? stream.candidates : stream.url ? [
      {
        kind: stream.kind ?? "unknown",
        url: stream.url,
        transport: stream.transport ?? (this.looksLikeHlsUrl(stream.url) ? "hls" : "progressive"),
        mimeType: stream.mimeType ?? (this.looksLikeHlsUrl(stream.url) ? "application/vnd.apple.mpegurl" : "audio/mpeg"),
        isPreview: !!stream.isPreview
      }
    ] : [];
    const deduped = /* @__PURE__ */ new Map();
    for (const candidate of rawCandidates) {
      const url = typeof candidate?.url === "string" ? candidate.url.trim() : "";
      if (!url) continue;
      if (deduped.has(url)) continue;
      deduped.set(url, {
        kind: typeof candidate.kind === "string" && candidate.kind.trim() ? candidate.kind : "unknown",
        url,
        transport: candidate.transport === "hls" ? "hls" : "progressive",
        mimeType: typeof candidate.mimeType === "string" && candidate.mimeType.trim() ? candidate.mimeType : candidate.transport === "hls" ? "application/vnd.apple.mpegurl" : "audio/mpeg",
        isPreview: !!candidate.isPreview
      });
    }
    return Array.from(deduped.values());
  }
  looksLikeHlsUrl(url) {
    return /\.m3u8($|\?)/i.test(url) || /\/playlist\//i.test(url);
  }
  isIphoneSafari() {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    return /iPhone/i.test(ua) && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
  }
  canPlayNativeHls() {
    const audio = this.ensureAudio();
    try {
      return !!audio.canPlayType("application/vnd.apple.mpegurl");
    } catch {
      return false;
    }
  }
  shouldPreferNativeHls() {
    return this.isIphoneSafari() && this.canPlayNativeHls();
  }
  isStreamStale(stream) {
    return performance.now() - stream.resolvedAtMs > STREAM_CACHE_TTL_MS;
  }
  isDocumentVisible() {
    return typeof document === "undefined" || document.visibilityState === "visible";
  }
  maybeRefreshStaleStream(trackId, staleStream) {
    if (!this.isDocumentVisible()) {
      logEvent("WebAmp", "soundcloud:cache:stale_hidden", {
        trackId,
        ageSec: Math.round(
          (performance.now() - staleStream.resolvedAtMs) / 1e3
        )
      });
      return;
    }
    if (this.streamResolveInFlight.has(trackId)) {
      return;
    }
    logEvent("WebAmp", "soundcloud:cache:refresh:start", {
      trackId,
      ageSec: Math.round(
        (performance.now() - staleStream.resolvedAtMs) / 1e3
      )
    });
    void this.resolveStream(trackId, {
      forceRefresh: true,
      allowStale: false
    }).then(() => {
      logEvent("WebAmp", "soundcloud:cache:refresh:done", {
        trackId
      });
    }).catch((error) => {
      const message = error instanceof Error ? error.message : "Unknown cache refresh error";
      logEvent(
        "WebAmp",
        "soundcloud:cache:refresh:error",
        { trackId },
        message,
        "warn"
      );
    });
  }
  chooseCandidate(candidates) {
    const progressive = candidates.filter(
      (candidate) => candidate.transport === "progressive"
    );
    const hls = candidates.filter(
      (candidate) => candidate.transport === "hls"
    );
    if (this.shouldPreferNativeHls() && hls.length) {
      return hls[0];
    }
    return progressive[0] ?? hls[0] ?? candidates[0];
  }
  async resolveStream(trackId, opts) {
    const allowStale = opts?.allowStale !== false;
    if (opts?.forceRefresh) {
      this.streamInfoCache.delete(trackId);
    }
    const cached = this.streamInfoCache.get(trackId);
    if (cached) {
      if (!this.isStreamStale(cached)) {
        return cached;
      }
      if (allowStale) {
        this.maybeRefreshStaleStream(trackId, cached);
        return cached;
      }
      this.streamInfoCache.delete(trackId);
    }
    const pending = this.streamResolveInFlight.get(trackId);
    if (pending) return await pending;
    const resolvePromise = (async () => {
      const info = await soundcloudApi.stream(trackId);
      const candidates = this.normalizeStreamCandidates(info);
      if (!candidates.length) {
        throw new Error("Missing SoundCloud stream URL.");
      }
      const resolved = {
        info,
        candidates,
        selected: this.chooseCandidate(candidates),
        resolvedAtMs: performance.now()
      };
      this.streamInfoCache.set(trackId, resolved);
      return resolved;
    })();
    this.streamResolveInFlight.set(trackId, resolvePromise);
    try {
      return await resolvePromise;
    } finally {
      this.streamResolveInFlight.delete(trackId);
    }
  }
  requestPlay(audio, reqId, reason, attempt = 1) {
    try {
      logEvent("WebAmp", "soundcloud:play:request", {
        reason,
        attempt,
        trackId: this.currentTrack?.id ?? this.pendingTrack?.id ?? null,
        visibility: typeof document !== "undefined" ? document.visibilityState : null
      });
      const playResult = audio.play();
      if (!playResult || typeof playResult.then !== "function") {
        return;
      }
      void playResult.then(() => {
        if (reqId !== this.playRequestId) return;
        logEvent("WebAmp", "soundcloud:play:resolved", {
          reason,
          attempt,
          trackId: this.currentTrack?.id ?? this.pendingTrack?.id ?? null
        });
      }).catch((error) => {
        if (reqId !== this.playRequestId) return;
        const message = error instanceof Error ? error.message : "Unknown play() error";
        logEvent(
          "WebAmp",
          "soundcloud:play:rejected",
          {
            reason,
            attempt,
            trackId: this.currentTrack?.id ?? this.pendingTrack?.id ?? null
          },
          message,
          "warn"
        );
        if (attempt >= 2 || !this.desiredPlaying) return;
        window.setTimeout(() => {
          if (reqId !== this.playRequestId || !this.desiredPlaying)
            return;
          this.requestPlay(
            audio,
            reqId,
            `${reason}:retry`,
            attempt + 1
          );
        }, 120);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown play() error";
      logEvent(
        "WebAmp",
        "soundcloud:play:throw",
        {
          reason,
          attempt,
          trackId: this.currentTrack?.id ?? this.pendingTrack?.id ?? null
        },
        message,
        "warn"
      );
    }
  }
  async waitForPlaybackStart(audio, baselinePosSec, timeoutMs = 1800) {
    if (!audio.paused && Math.max(0, audio.currentTime || 0) > baselinePosSec + 0.05) {
      return true;
    }
    return await new Promise((resolve) => {
      let done = false;
      const finish = (started) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(started);
      };
      const checkProgress = () => {
        const nextPos = Math.max(0, audio.currentTime || 0);
        if (!audio.paused && nextPos > baselinePosSec + 0.05) {
          finish(true);
        }
      };
      const timeout = window.setTimeout(() => finish(false), timeoutMs);
      const interval = window.setInterval(checkProgress, 120);
      const cleanup = () => {
        window.clearTimeout(timeout);
        window.clearInterval(interval);
        audio.removeEventListener("playing", onPlaying);
        audio.removeEventListener("timeupdate", onTimeUpdate);
        audio.removeEventListener("error", onError);
      };
      const onPlaying = () => finish(true);
      const onTimeUpdate = () => checkProgress();
      const onError = () => finish(false);
      audio.addEventListener("playing", onPlaying, { once: true });
      audio.addEventListener("timeupdate", onTimeUpdate);
      audio.addEventListener("error", onError, { once: true });
      checkProgress();
    });
  }
  /**
   * primarily used for mobile webkit sandbox bypasses
   * @param track
   * @param prepared
   * @param resumePosSec
   * @param reqId
   * @param reason
   * @returns
   */
  async recoverStalledPlayback(track, prepared, resumePosSec, reqId, reason) {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      logEvent(
        "WebAmp",
        "soundcloud:recover:skip_hidden",
        {
          trackId: track.id,
          reason
        },
        "Skipping aggressive fallback while page is hidden.",
        "warn"
      );
      return false;
    }
    const audio = this.ensureAudio();
    const alternates = prepared.candidates.filter(
      (candidate) => candidate.url !== prepared.selected.url
    );
    for (const alternate of alternates) {
      if (reqId !== this.playRequestId) return false;
      try {
        logEvent(
          "WebAmp",
          "soundcloud:recover:alternate",
          {
            trackId: track.id,
            kind: alternate.kind,
            transport: alternate.transport
          },
          reason,
          "warn"
        );
        this.switchingTrack = true;
        audio.src = alternate.url;
        if (resumePosSec > 0) {
          await this.waitForLoadedMetadata(audio, 2500);
          if (reqId !== this.playRequestId) return false;
          try {
            audio.currentTime = Math.max(0, resumePosSec);
          } catch {
          }
        }
        this.switchingTrack = false;
        const baseline = Math.max(
          0,
          audio.currentTime || resumePosSec || 0
        );
        this.requestPlay(
          audio,
          reqId,
          `${reason}:alternate:${alternate.kind}`
        );
        const started = await this.waitForPlaybackStart(
          audio,
          baseline,
          2200
        );
        if (!started) {
          continue;
        }
        const nextPrepared = {
          ...prepared,
          selected: alternate,
          resolvedAtMs: performance.now()
        };
        this.streamInfoCache.set(track.id, nextPrepared);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown recovery error";
        logEvent(
          "WebAmp",
          "soundcloud:recover:error",
          {
            trackId: track.id,
            kind: alternate.kind
          },
          message,
          "warn"
        );
      } finally {
        this.switchingTrack = false;
      }
    }
    return false;
  }
  getAdjacentTrack(direction, track = this.currentTrack) {
    return this.queue?.getAdjacentTrack?.(track, direction) ?? null;
  }
  getUpcomingQueueTracks(track) {
    const tracks = this.queue?.getUpcomingTracks?.(track, PREFETCH_LOOKAHEAD_LIMIT) ?? [];
    return tracks.filter(
      (candidate) => this.getSource(candidate) === "soundcloud"
    );
  }
  async prepareTrack(track) {
    try {
      const prepared = await this.resolveStream(track.id);
      logEvent("WebAmp", "soundcloud:prefetch:ready", {
        trackId: track.id,
        kind: prepared.selected.kind,
        transport: prepared.selected.transport
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown prefetch error";
      logEvent(
        "WebAmp",
        "soundcloud:prefetch:error",
        {
          trackId: track.id
        },
        message,
        "warn"
      );
    }
  }
  scheduleQueuePrefetch(track) {
    const tracks = this.getUpcomingQueueTracks(track);
    const generation = ++this.prefetchGeneration;
    if (!tracks.length) {
      return;
    }
    void (async () => {
      for (const candidate of tracks) {
        if (generation !== this.prefetchGeneration) return;
        try {
          const cached = this.streamInfoCache.get(candidate.id);
          if (cached && !this.isStreamStale(cached)) {
            continue;
          }
          await this.prepareTrack(candidate);
        } catch {
        }
      }
    })();
  }
  async getPreparedStream(track) {
    return await this.resolveStream(track.id);
  }
  async commitTrackSource(track, prepared, positionSec, autoplay, reqId, reason) {
    const audio = this.ensureAudio();
    const targetPos = Math.max(0, positionSec || 0);
    const currentSrc = audio.currentSrc || audio.src;
    const sourceChanged = currentSrc !== prepared.selected.url;
    this.setPlaybackPhase(
      this.currentTrack ? "switching" : "preparing",
      track
    );
    this.pendingTrack = track;
    this.switchingTrack = true;
    logEvent("WebAmp", "soundcloud:switch:start", {
      trackId: track.id,
      autoplay,
      sourceChanged,
      kind: prepared.selected.kind,
      transport: prepared.selected.transport,
      targetPosSec: Math.round(targetPos * 100) / 100
    });
    try {
      if (sourceChanged) {
        audio.src = prepared.selected.url;
      }
      if (targetPos > 0) {
        await this.waitForLoadedMetadata(audio, 2500);
        if (reqId !== this.playRequestId) return false;
        try {
          audio.currentTime = targetPos;
        } catch {
        }
      }
      this.currentTrack = track;
      this.pendingTrack = null;
      this.emitRemote({
        track: this.currentTrack,
        isPlaying: false,
        positionSec: Math.max(0, audio.currentTime || targetPos)
      });
      this.scheduleQueuePrefetch(track);
    } finally {
      this.switchingTrack = false;
    }
    if (!autoplay) {
      audio.pause();
      this.lastKnownPlaying = false;
      this.setPlaybackPhase("paused", track);
      this.emitRemote({
        track: this.currentTrack,
        isPlaying: false,
        positionSec: Math.max(0, audio.currentTime || targetPos)
      });
      return true;
    }
    const baseline = Math.max(0, audio.currentTime || targetPos);
    this.requestPlay(audio, reqId, reason);
    const started = await this.waitForPlaybackStart(audio, baseline, 2200);
    if (reqId !== this.playRequestId) return false;
    if (started) {
      this.lastKnownPlaying = true;
      this.setPlaybackPhase("playing", track);
      return true;
    }
    this.setPlaybackPhase("recovering", track);
    return await this.recoverStalledPlayback(
      track,
      prepared,
      baseline,
      reqId,
      reason
    );
  }
  /**
   *
   * @param track
   * @param positionSec
   * @param autoplay
   * @param reason
   * @returns
   */
  async playSoundCloudTrack(track, positionSec, autoplay, reason) {
    this.desiredPlaying = autoplay;
    this.lastProgressEmitMs = 0;
    const reqId = ++this.playRequestId;
    let attemptedFreshRefresh = false;
    this.setBusy(true);
    try {
      while (true) {
        const prepared = attemptedFreshRefresh ? await this.resolveStream(track.id, {
          forceRefresh: true,
          allowStale: false
        }) : await this.getPreparedStream(track);
        if (reqId !== this.playRequestId) return;
        const started = await this.commitTrackSource(
          track,
          prepared,
          positionSec,
          autoplay,
          reqId,
          reason
        );
        if (reqId !== this.playRequestId) return;
        if (started) {
          return;
        }
        const recentAudioError = this.consumeRecentAudioError(track.id);
        if (!attemptedFreshRefresh && recentAudioError) {
          attemptedFreshRefresh = true;
          logEvent(
            "WebAmp",
            "soundcloud:stream:refresh_after_audio_error",
            {
              trackId: track.id,
              errorCode: recentAudioError.code
            },
            "Retrying with a fresh SoundCloud stream URL.",
            "warn"
          );
          this.streamInfoCache.delete(track.id);
          continue;
        }
        if (recentAudioError) {
          throw new Error(
            `Audio error (${recentAudioError.code ?? 4})`
          );
        }
        throw new Error("Failed to start audio playback.");
      }
    } catch (error) {
      this.lastKnownPlaying = false;
      this.pendingTrack = null;
      this.setPlaybackPhase("paused", track);
      this.emitRemote({
        track: this.currentTrack ?? track,
        isPlaying: false,
        positionSec: 0
      });
      void showErrorDialog(
        formatErrorMessage(error),
        "Music Service Error"
      );
      throw error;
    } finally {
      if (reqId === this.playRequestId) {
        this.setBusy(false);
      }
    }
  }
  async advanceWithinSoundCloud(direction, reason) {
    const currentTrack = this.currentTrack;
    if (!currentTrack) return false;
    if (direction === "prev") {
      const audio = this.ensureAudio();
      if (Math.max(0, audio.currentTime || 0) > 3) {
        await this.seek(0);
        this.desiredPlaying = true;
        this.requestPlay(
          audio,
          ++this.playRequestId,
          `${reason}:restart`
        );
        return true;
      }
    }
    const adjacent = this.getAdjacentTrack(direction, currentTrack);
    if (!adjacent) {
      logEvent(
        "WebAmp",
        "soundcloud:queue:none",
        {
          direction,
          trackId: currentTrack.id
        },
        reason,
        "warn"
      );
      if (direction === "next") {
        this.desiredPlaying = false;
      }
      return true;
    }
    if (adjacent.source !== "soundcloud") {
      this.queue?.fallbackQueueAdvance?.(direction, true);
      return true;
    }
    await this.playSoundCloudTrack(adjacent, 0, true, reason);
    return true;
  }
  async handleNaturalTrackEnd(track) {
    const nextTrack = this.getAdjacentTrack("next", track);
    if (!nextTrack) {
      this.desiredPlaying = false;
      return;
    }
    if (nextTrack.source !== "soundcloud") {
      this.queue?.fallbackQueueAdvance?.("next", true);
      return;
    }
    await this.playSoundCloudTrack(nextTrack, 0, true, "ended");
  }
  /**
   * Starts playback of a SoundCloud track using direct stream URL playback.
   */
  async play(track, positionSec = 0, opts) {
    const source = this.getSource(track);
    if (source !== "soundcloud") return;
    const autoplay = typeof opts?.autoplay === "boolean" ? opts.autoplay : this.lastKnownPlaying;
    await this.playSoundCloudTrack(track, positionSec, autoplay, "play");
  }
  /**
   * Toggle play/pause on the active audio element.
   */
  async togglePlay(previouslyPlaying) {
    if (!this.currentTrack) return;
    const audio = this.ensureAudio();
    this.desiredPlaying = !previouslyPlaying;
    if (previouslyPlaying) {
      audio.pause();
      this.setPlaybackPhase("paused", this.currentTrack);
      return;
    }
    const reqId = ++this.playRequestId;
    this.setBusy(true);
    try {
      const baseline = Math.max(0, audio.currentTime || 0);
      this.requestPlay(audio, reqId, "resume");
      const resumed = await this.waitForPlaybackStart(
        audio,
        baseline,
        2200
      );
      if (reqId !== this.playRequestId) return;
      if (!resumed && this.currentTrack) {
        const prepared = await this.resolveStream(
          this.currentTrack.id,
          { forceRefresh: true }
        );
        await this.recoverStalledPlayback(
          this.currentTrack,
          prepared,
          baseline,
          reqId,
          "resume"
        );
      }
    } catch (error) {
      this.lastKnownPlaying = false;
      this.emitRemote({
        track: this.currentTrack,
        isPlaying: false,
        positionSec: Math.max(0, audio.currentTime || 0)
      });
      void showErrorDialog(
        formatErrorMessage(error),
        "Music Service Error"
      );
      throw error;
    } finally {
      if (reqId === this.playRequestId) {
        this.setBusy(false);
      }
    }
  }
  /**
   * Seek on the active audio element.
   */
  async seek(positionSec) {
    if (!this.currentTrack) return;
    const audio = this.ensureAudio();
    const nextPos = Math.max(0, positionSec || 0);
    try {
      audio.currentTime = nextPos;
    } catch (error) {
      void showErrorDialog(
        formatErrorMessage(error),
        "Music Service Error"
      );
      throw error;
    }
    this.emitRemote({
      track: this.currentTrack,
      isPlaying: !audio.paused,
      positionSec: Math.max(0, audio.currentTime || nextPos)
    });
  }
  async skipNext() {
    return await this.advanceWithinSoundCloud("next", "mediaSessionNext");
  }
  async skipPrev() {
    return await this.advanceWithinSoundCloud("prev", "mediaSessionPrev");
  }
};

// wwwroot/ts/sources/hybridTransport.ts
var HybridTransport = class {
  constructor(opts) {
    this.opts = opts;
    this.soundcloud = new SoundCloudTransport(
      (s) => this.opts.onRemoteState(s),
      {
        getAdjacentTrack: this.opts.getAdjacentTrack,
        getUpcomingTracks: this.opts.getUpcomingTracks,
        fallbackQueueAdvance: this.opts.fallbackQueueAdvance
      }
    );
  }
  spotify = null;
  soundcloud;
  lastSource = null;
  /**
   * Best-effort warm up for Safari autoplay policies.
   * Safe to call even if SoundCloud is never used.
   */
  primeSoundCloud() {
    this.soundcloud.prime();
  }
  primeSpotify() {
    if (!this.opts.spotifySource.getState().isConnected) return;
    this.ensureSpotify().prime();
  }
  primeSpotifyActivation() {
    if (!this.opts.spotifySource.getState().isConnected) return;
    this.ensureSpotify().primeActivation();
  }
  getSource(track) {
    if (!track) return null;
    return track.source ?? "spotify";
  }
  ensureSpotify() {
    if (!this.spotify) {
      this.spotify = new SpotifyTransport((s) => {
        this.opts.onRemoteState(s);
      });
    }
    return this.spotify;
  }
  async play(track, positionSec = 0, opts) {
    const source = this.getSource(track);
    if (!source) return;
    this.lastSource = source;
    if (source === "spotify") {
      if (!this.opts.spotifySource.getState().isConnected) {
        throw new Error("Spotify is not connected.");
      }
      const spotify = this.ensureSpotify();
      await spotify.play(track, positionSec, opts);
      return;
    }
    await this.soundcloud.play(track, positionSec, opts);
  }
  async togglePlay(previouslyPlaying) {
    const source = this.lastSource;
    if (!source) return;
    if (source === "spotify") {
      if (!this.spotify) return;
      await this.spotify.togglePlay(previouslyPlaying);
      return;
    }
    await this.soundcloud.togglePlay(previouslyPlaying);
  }
  async seek(positionSec) {
    const source = this.lastSource;
    if (!source) return;
    if (source === "spotify") {
      if (!this.spotify) return;
      await this.spotify.seek(positionSec);
      return;
    }
    await this.soundcloud.seek(positionSec);
  }
  async skipNext() {
    if (this.lastSource !== "soundcloud") return false;
    return await this.soundcloud.skipNext();
  }
  async skipPrev() {
    if (this.lastSource !== "soundcloud") return false;
    return await this.soundcloud.skipPrev();
  }
};

// wwwroot/ts/ui/dominantColor.ts
var colorCache = /* @__PURE__ */ new Map();
async function getDominantColor(imageUrl) {
  if (!imageUrl) return null;
  const cached = colorCache.get(imageUrl);
  if (cached) return cached;
  try {
    const img = await loadImage(imageUrl);
    const rgb = sampleAverageColor(img, 28, 28);
    if (!rgb) return null;
    colorCache.set(imageUrl, rgb);
    return rgb;
  } catch {
    return null;
  }
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.loading = "eager";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = src;
  });
}
function sampleAverageColor(img, w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] ?? 0;
    if (a < 10) continue;
    r += data[i] ?? 0;
    g += data[i + 1] ?? 0;
    b += data[i + 2] ?? 0;
    n++;
  }
  if (!n) return null;
  return {
    r: Math.round(r / n),
    g: Math.round(g / n),
    b: Math.round(b / n)
  };
}

// wwwroot/ts/webamp.ts
function getTemplate(id) {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLTemplateElement)) {
    throw new Error(`WebAmp missing template: ${id}`);
  }
  return el;
}
function boot() {
  const appRoot = document.querySelector("[data-wa-app]");
  const viewHost = document.querySelector("[data-wa-view-host]");
  const playerBarRoot = document.querySelector("[data-wa-playerbar]");
  const nowPlayingRoot = document.querySelector("[data-wa-nowplaying]");
  const versionEl = document.querySelector("[data-wa-version]");
  if (!appRoot || !viewHost) return;
  const routeRoot = routePath2("/");
  const indiumBoot = bootIndium({
    routeRoot: "/webamp",
    apiBasePath: "/api/webamp",
    assetBasePath: "/apps/indium",
    brandLogoSrc: webAmpBrandAsset("branding/icon-WebAmp-full256.png"),
    brandLogoAlt: "WebAmp logo"
  });
  if (versionEl) {
    const v = "0.0.124".trim().length ? "0.0.124".trim() : "dev";
    const m = v.match(/(\d+)\s*$/);
    const buildNum = m?.[1] ?? v;
    versionEl.textContent = `build ${buildNum}`;
  }
  let authResolved = false;
  document.body.dataset.initialState = "loading";
  window.addEventListener("load", () => {
    queueMicrotask(() => {
      if (!authResolved) document.body.dataset.initialState = "loading";
    });
  });
  const templates = {
    landing: getTemplate("wa-tpl-landing"),
    home: getTemplate("wa-tpl-home"),
    search: getTemplate("wa-tpl-search"),
    liked: getTemplate("wa-tpl-liked"),
    playlist: getTemplate("wa-tpl-playlist"),
    album: getTemplate("wa-tpl-album"),
    artist: getTemplate("wa-tpl-artist")
  };
  const seedTracks = [
    { id: "1", title: "Track 1", artist: "Artist", durationSec: 192 },
    { id: "2", title: "Track 2", artist: "Artist", durationSec: 178 },
    { id: "3", title: "Track 3", artist: "Artist", durationSec: 247 }
  ];
  const playerStore = new PlayerStore(seedTracks);
  const spotifySource = new SpotifySource();
  const soundCloudSource = new SoundCloudSource();
  const initialPath = window.location.pathname;
  playerStore.setShuffleEnabled(getShufflePref());
  window.addEventListener("wa:shuffle:set", (e) => {
    const ev = e;
    playerStore.setShuffleEnabled(!!ev.detail?.enabled);
  });
  const disconnectBtn = document.querySelector('[data-wa-action="source-disconnect"]');
  const disconnectIcon = document.querySelector("[data-wa-disconnect-icon]");
  const disconnectLabel = document.querySelector("[data-wa-disconnect-label]");
  const DISCONNECT_ICON_WEBAMP = webAmpBrandAsset("branding/icon-WebAmp-full256.png");
  const DISCONNECT_ICON_SPOTIFY = assetPath2("assets/svg/spotify.svg");
  const DISCONNECT_ICON_SOUNDCLOUD = assetPath2("assets/svg/soundcloud.svg");
  const updateSourceChrome = () => {
    const spotifyConnected = spotifySource.getState().isConnected;
    const scConnected = soundCloudSource.getState().isConnected;
    if (!disconnectBtn) return;
    if (!spotifyConnected && !scConnected) {
      disconnectBtn.disabled = true;
      disconnectBtn.style.opacity = "0.6";
      if (disconnectLabel) disconnectLabel.textContent = "Sign Out";
      if (disconnectIcon) {
        disconnectIcon.src = DISCONNECT_ICON_WEBAMP;
      }
      delete disconnectBtn.dataset.waSource;
      return;
    }
    disconnectBtn.disabled = false;
    disconnectBtn.style.opacity = "";
    if (spotifyConnected) {
      if (disconnectIcon) {
        disconnectIcon.src = DISCONNECT_ICON_SPOTIFY;
      }
      if (disconnectLabel) disconnectLabel.textContent = "Sign Out";
      disconnectBtn.dataset.waSource = "spotify";
    } else if (scConnected) {
      if (disconnectIcon) {
        disconnectIcon.src = DISCONNECT_ICON_SOUNDCLOUD;
      }
      if (disconnectLabel) disconnectLabel.textContent = "Sign Out";
      disconnectBtn.dataset.waSource = "soundcloud";
    }
  };
  disconnectBtn?.addEventListener("click", () => {
    const spotifyConnected = spotifySource.getState().isConnected;
    const scConnected = soundCloudSource.getState().isConnected;
    if (spotifyConnected && spotifySource.disconnect) {
      document.body.setAttribute("data-initial-state", "loading");
      void spotifySource.disconnect();
    } else if (scConnected && soundCloudSource.disconnect) {
      document.body.setAttribute("data-initial-state", "loading");
      void soundCloudSource.disconnect();
    }
  });
  spotifySource.onChange(updateSourceChrome);
  soundCloudSource.onChange(updateSourceChrome);
  updateSourceChrome();
  const router = new WebAmpRouter({
    root: routeRoot,
    dom: { appRoot, viewHost, templates },
    views: {
      landing: landingView,
      home: homeView,
      search: searchView,
      liked: likedView,
      playlist: playlistView,
      album: albumView,
      artist: artistView
    },
    services: {
      musicSource: spotifySource,
      soundCloudSource
    }
  });
  if (playerBarRoot) {
    new PlayerBar({ root: playerBarRoot, store: playerStore });
  }
  if (nowPlayingRoot) {
    new NowPlayingMobile({ root: nowPlayingRoot, playerBarRoot, store: playerStore });
  }
  let lastArtKey = null;
  let lastLibraryTrackKey = null;
  let lastNowPlayingId = null;
  let lastMediaMetaKey = null;
  let lastMediaPosSec = null;
  const themeMedia = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const mediaSession = typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null;
  const setMediaActionHandler = (action, handler) => {
    if (!mediaSession) return;
    try {
      mediaSession.setActionHandler(action, handler);
    } catch {
    }
  };
  const requestTransportSkip = (direction) => {
    const transportSkip = direction === "next" ? hybridTransport?.skipNext?.() : hybridTransport?.skipPrev?.();
    if (!transportSkip || typeof transportSkip.then !== "function") {
      if (!transportSkip) {
        if (direction === "next") playerStore.next({ autoplay: true });
        else playerStore.prev({ autoplay: true });
      }
      return;
    }
    void transportSkip.then((handled) => {
      if (handled) return;
      if (direction === "next") playerStore.next({ autoplay: true });
      else playerStore.prev({ autoplay: true });
    });
  };
  if (mediaSession) {
    setMediaActionHandler("play", () => {
      const st = playerStore.getState();
      if (!st.track) return;
      if (!st.isPlaying) playerStore.togglePlay();
    });
    setMediaActionHandler("pause", () => {
      const st = playerStore.getState();
      if (st.isPlaying) playerStore.togglePlay();
    });
    setMediaActionHandler("previoustrack", () => {
      requestTransportSkip("prev");
    });
    setMediaActionHandler("nexttrack", () => {
      requestTransportSkip("next");
    });
    setMediaActionHandler("seekto", (details) => {
      const t = typeof details?.seekTime === "number" ? details.seekTime : null;
      if (t === null || Number.isNaN(t)) return;
      playerStore.seek(t);
    });
    setMediaActionHandler("seekbackward", null);
    setMediaActionHandler("seekforward", null);
  }
  playerStore.subscribe((state) => {
    const libraryTrack = state.track;
    const libraryTrackKey = libraryTrack ? `${libraryTrack.source ?? "spotify"}:${libraryTrack.id}` : null;
    if (libraryTrackKey !== lastLibraryTrackKey) {
      lastLibraryTrackKey = libraryTrackKey;
      primeTrackLibraryState(libraryTrack);
    }
    const nowId = state.track?.id ?? null;
    if (nowId !== lastNowPlayingId) {
      const prev = document.querySelectorAll('[data-wa-track][data-wa-now-playing="true"]');
      prev.forEach((el) => {
        el.removeAttribute("data-wa-now-playing");
        el.removeAttribute("data-wa-playing");
      });
      lastNowPlayingId = nowId;
    }
    if (nowId) {
      const esc = window.CSS?.escape ? window.CSS.escape(nowId) : nowId.replace(/"/g, '\\"');
      const els = document.querySelectorAll(`[data-wa-track="${esc}"]`);
      els.forEach((el) => {
        el.setAttribute("data-wa-now-playing", "true");
        el.setAttribute("data-wa-playing", state.isPlaying ? "true" : "false");
      });
    }
    if (typeof document !== "undefined" && document.body) {
      document.body.dataset.waPlaying = state.isPlaying ? "true" : "false";
    }
    if (mediaSession) {
      const t = state.track;
      if (!t) {
        lastMediaMetaKey = null;
        lastMediaPosSec = null;
        try {
          mediaSession.metadata = null;
        } catch {
        }
        try {
          mediaSession.playbackState = "none";
        } catch {
        }
      } else {
        const title = t.title?.trim() || "WebAmp";
        const artist = t.artist?.trim() || "";
        const album = t.album?.trim() || "";
        const artCandidates = [t.artUrlLarge, t.artUrl, t.artUrlSmall].filter((u) => !!u && typeof u === "string");
        const artwork = Array.from(new Set(artCandidates)).map((src) => ({
          src,
          sizes: "512x512"
        }));
        const metaKey = [title, artist, album, artwork.map((a) => a.src).join("|")].join("::");
        if (metaKey !== lastMediaMetaKey) {
          lastMediaMetaKey = metaKey;
          try {
            mediaSession.metadata = new MediaMetadata({
              title,
              artist,
              album,
              artwork
            });
          } catch {
          }
        }
        try {
          mediaSession.playbackState = state.isPlaying ? "playing" : "paused";
        } catch {
        }
        const duration = t.durationSec ?? 0;
        const position = Math.max(0, state.positionSec ?? 0);
        if (Number.isFinite(duration) && duration > 0 && (lastMediaPosSec === null || Math.abs(position - lastMediaPosSec) >= 0.8 || !state.isPlaying)) {
          lastMediaPosSec = position;
          try {
            mediaSession.setPositionState({
              duration,
              playbackRate: 1,
              position: Math.min(duration, position)
            });
          } catch {
          }
        }
      }
    }
    const base = getIdleAccent();
    const art = state.track?.artUrlSmall ?? state.track?.artUrl ?? null;
    if (!art) {
      lastArtKey = null;
      setAccentActive(false);
      setAccent(base);
      return;
    }
    if (art === lastArtKey) return;
    lastArtKey = art;
    void (async () => {
      const rgb = await getDominantColor(art);
      if (!rgb) {
        setAccentActive(false);
        setAccent(base);
        return;
      }
      const mixed = mixRgb(rgb, base, 0.62);
      setAccent(mixed);
      setAccentActive(true);
    })();
  });
  const syncIdleAccent = () => {
    const target = document.body ?? document.documentElement;
    if (target.dataset.waAccentActive === "true") return;
    setAccent(getIdleAccent());
  };
  if (typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver(syncIdleAccent);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-wa-theme", "data-wa-theme-resolved"]
    });
  }
  if (themeMedia) {
    const handleThemeChange = () => syncIdleAccent();
    if (typeof themeMedia.addEventListener === "function") {
      themeMedia.addEventListener("change", handleThemeChange);
    } else if (typeof themeMedia.addListener === "function") {
      themeMedia.addListener(handleThemeChange);
    }
  }
  function setAccent(rgb) {
    const target = document.body ?? document.documentElement;
    target.style.setProperty("--wa-accent-r", String(rgb.r));
    target.style.setProperty("--wa-accent-g", String(rgb.g));
    target.style.setProperty("--wa-accent-b", String(rgb.b));
    logEvent("WebAmp", "setAccent", rgb);
  }
  function setAccentActive(active) {
    const target = document.body ?? document.documentElement;
    target.dataset.waAccentActive = active ? "true" : "false";
  }
  function getIdleAccent() {
    return isLightThemeResolved() ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  }
  function isLightThemeResolved() {
    const root = document.documentElement;
    if (root.classList.contains("wa-theme-light") || root.getAttribute("data-wa-theme") === "light" || root.getAttribute("data-wa-theme-resolved") === "light") {
      return true;
    }
    if (root.classList.contains("wa-theme-dark") || root.getAttribute("data-wa-theme") === "dark" || root.getAttribute("data-wa-theme-resolved") === "dark") {
      return false;
    }
    return !!themeMedia && !themeMedia.matches;
  }
  function mixRgb(a, b, t) {
    const k = Math.max(0, Math.min(1, t));
    return {
      r: Math.round(a.r * k + b.r * (1 - k)),
      g: Math.round(a.g * k + b.g * (1 - k)),
      b: Math.round(a.b * k + b.b * (1 - k))
    };
  }
  createSidebarController({ appRoot: indiumBoot.appRoot || appRoot });
  window.addEventListener("wa:track:toggle", (e) => {
    const ev = e;
    const trackId = ev.detail?.trackId;
    if (!trackId) return;
    const current = playerStore.getState().track?.id ?? null;
    if (current && current === trackId) {
      playerStore.togglePlay();
    } else {
      playerStore.selectTrackById(trackId, true);
    }
  });
  window.addEventListener("wa:player:toggle", () => {
    playerStore.togglePlay();
  });
  window.addEventListener("wa:transport:finish", (e) => {
    const ev = e;
    const finishedId = ev.detail?.trackId;
    if (!finishedId) return;
    if (ev.detail?.source === "soundcloud") return;
    const st = playerStore.getState();
    if (st.track?.id !== finishedId) return;
    playerStore.next({ autoplay: true });
  });
  window.addEventListener("wa:transport:busy", (e) => {
    const ev = e;
    playerStore.setBusy(!!ev.detail?.busy);
  });
  window.addEventListener("wa:track:select", (e) => {
    const ev = e;
    let trackId = ev.detail?.trackId;
    if (!trackId) return;
    const from = ev.detail?.from;
    const isSpecificTrackTap = from !== "queue-play";
    if (isSpecificTrackTap && getShufflePref() && !isShuffleDirty()) {
      setShuffleEnabled(false);
    }
    if (Array.isArray(ev.detail?.tracks)) {
      const queue = ev.detail.tracks.filter((t) => t?.isPlayable !== false);
      if (!queue.length) return;
      playerStore.setQueue(queue, { wrap: ev.detail?.wrap ?? false });
      if (!queue.some((t) => t.id === trackId)) {
        trackId = queue[0]?.id;
      }
    }
    playerStore.selectTrackById(trackId, true);
  });
  window.addEventListener("wa:queue:set", (e) => {
    const ev = e;
    const tracks = ev.detail?.tracks;
    if (!Array.isArray(tracks)) return;
    const queue = tracks.filter((t) => t?.isPlayable !== false);
    playerStore.setQueue(queue, { wrap: ev.detail?.wrap ?? false });
  });
  window.addEventListener("wa:navigate:album", (e) => {
    const ev = e;
    const albumId = ev.detail?.albumId;
    if (!albumId) return;
    router.navigate(routePath2(`albums/${albumId}`));
  });
  window.addEventListener("wa:navigate:artist", (e) => {
    const ev = e;
    const artistId = ev.detail?.artistId;
    if (!artistId) return;
    router.navigate(routePath2(`artists/${artistId}`));
  });
  router.start();
  window.waClearCacheAndReload = clearClientCacheAndReload;
  let transportInstalled = false;
  let hybridTransport = null;
  const ensureHybridTransport = () => {
    if (transportInstalled) return;
    transportInstalled = true;
    const transport = new HybridTransport({
      spotifySource,
      onRemoteState: (s) => {
        playerStore.syncFromRemote({
          track: s.track,
          isPlaying: s.isPlaying,
          positionSec: s.positionSec
        });
      },
      getAdjacentTrack: (currentTrack, direction) => playerStore.getAdjacentTrack(direction, currentTrack?.id ?? null),
      getUpcomingTracks: (currentTrack, limit) => playerStore.getUpcomingTracks(currentTrack?.id ?? null, limit),
      fallbackQueueAdvance: (direction, autoplay) => {
        if (direction === "next") {
          playerStore.next({ autoplay });
        } else {
          playerStore.prev({ autoplay });
        }
      }
    });
    hybridTransport = transport;
    playerStore.setTransport(transport);
    try {
      transport.primeSoundCloud();
    } catch {
    }
    try {
      transport.primeSpotify();
    } catch {
    }
    const primeOnce = () => {
      try {
        transport.primeSoundCloud();
      } catch {
      }
      try {
        transport.primeSpotify();
      } catch {
      }
      try {
        transport.primeSpotifyActivation();
      } catch {
      }
      window.removeEventListener("pointerdown", primeOnce, true);
      window.removeEventListener("touchstart", primeOnce, true);
      window.removeEventListener("mousedown", primeOnce, true);
    };
    window.addEventListener("pointerdown", primeOnce, true);
    window.addEventListener("touchstart", primeOnce, true);
    window.addEventListener("mousedown", primeOnce, true);
    const st = playerStore.getState();
    if (st.track && st.isPlaying) {
      void transport.play(st.track, st.positionSec, { autoplay: true });
    }
  };
  ensureHybridTransport();
  void Promise.all([spotifySource.init(), soundCloudSource.init()]).then(() => {
    const spotifyConnected = spotifySource.getState().isConnected;
    const scConnected = soundCloudSource.getState().isConnected;
    const authed = spotifyConnected || scConnected;
    const currentView = appRoot.dataset.waView;
    ensureHybridTransport();
    if (spotifyConnected) {
      try {
        hybridTransport?.primeSpotify();
      } catch {
      }
    }
    if (authed && currentView === "landing") {
      const desired = initialPath && initialPath.startsWith(`${routeRoot}/`) ? initialPath : routePath2("home");
      router.navigate(desired);
    }
    authResolved = true;
    document.body.dataset.initialState = "ready";
  });
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
