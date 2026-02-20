# WebAmp CSS Redundancy Audit

This report identifies rules in WebAmp CSS that are already defined (or substantially defined) in Portfolio CSS.

Scope:
- WebAmp: `WebAmp.Web/wwwroot/css/webamp.*.css`
- Portfolio: `wwwroot/css/common.css`, `wwwroot/css/components/dialogs.css`, `wwwroot/css/components/glassSurface.css`, `wwwroot/css/components/toggleSwitch.css`

## Exact duplicates

### Loading overlay selectors (already in Portfolio `common.css`)
- WebAmp file: `WebAmp.Web/wwwroot/css/webamp.base.css`
- Portfolio file: `Portfolio/wwwroot/css/common.css`
- Selectors:
  - `.loading-overlay`
  - `.loading-overlay img`
  - `.loading-overlay .loading-logo`
  - `.loading-overlay img.loading-throbber`
  - `body[data-initial-state="ready"] .loading-overlay`

Notes:
- Selector set and core declarations are the same shape/purpose.
- WebAmp varies transition tuning for a faster hide animation (`0.2s` timing and different blur/scale end values).

## Near duplicates (same selector/purpose, value differences)

### Base page reset (`html, body`)
- WebAmp file: `WebAmp.Web/wwwroot/css/webamp.base.css`
- Portfolio file: `Portfolio/wwwroot/css/common.css`
- Overlap:
  - `margin: 0;`
  - `padding: 0;`
  - `width: 100%;`
  - dark background baseline
- Differences:
  - WebAmp uses `min-height: 100%` and white text defaults.
  - Portfolio uses `height: 100%`, hidden overflow by default, and dark text defaults.

### `.loading-overlay` animation details
- Same selectors as Exact duplicates section.
- Differences are in transition duration/easing and ready-state blur/scale values.

## Intentional delegation or specialization (not redundant to remove)

### Dialog system
- Portfolio source of truth: `Portfolio/wwwroot/css/components/dialogs.css`
- WebAmp use:
  - WebAmp includes no `ui-dialog-*` style definitions.
  - `webamp.responsive.css` only carries an explanatory comment that dialogs come from shared Portfolio CSS.
- Classification: intentional dependency, not duplication.

### Glass surface component
- Portfolio source of truth: `Portfolio/wwwroot/css/components/glassSurface.css`
- WebAmp specialization: `WebAmp.Web/wwwroot/css/webamp.shell-layout.css`
  - `.wa-shell.glass-surface`
  - `.wa-shell.glass-surface > .glass-surface__content`
  - `.wa-shell.glass-surface::before` under `@supports`
- Classification: override/specialization on top of shared component.

### Toggle switch component
- Portfolio source of truth: `Portfolio/wwwroot/css/components/toggleSwitch.css`
- WebAmp specialization:
  - Uses shared `.comp-toggle*` classes from Portfolio.
  - Adds only `.comp-toggle--nowplaying` transform tweak in `webamp.responsive.css`.
- Classification: extension only, not duplicated component styles.

## Summary

- Primary concrete redundancy is the loading-overlay block, which exists in both WebAmp and Portfolio CSS.
- Base reset overlap is partial and appears intentional to keep WebAmp self-contained.
- Dialog, glass-surface, and toggle-switch styles are primarily shared dependencies with WebAmp-specific overrides/extensions rather than duplicate redefinitions.
