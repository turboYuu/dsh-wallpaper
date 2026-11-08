/**
 * dsh-wallpaper / client half
 *
 * Owns everything visible:
 *
 *   - one entry in the left sidebar (`sidebar.panellist`), which opens a panel
 *     in the main area,
 *   - that panel: an image picker plus an opacity slider,
 *   - the wallpaper itself: a fixed, full-viewport layer drawn behind the app.
 *
 * The shell draws the app canvas with the theme token `--dsw-alias-bg-base`
 * ("application base background"). When a wallpaper is active this plugin turns
 * that canvas transparent and paints the image on a `body::before` layer that
 * sits between the `<html>` background and the app, so the image shows through
 * the whole frame while raised surfaces keep their own backgrounds. The layer
 * opacity is the slider value; behind it the `<html>` background stays the
 * theme base colour, so opacity 0 degrades back to a normal DSH look.
 *
 * State is a small document (enabled / opacity / image data URL). localStorage
 * mirrors the small fields for a fast first paint; the host half persists the
 * same document under `$DSH_HOME/dsh-wallpaper.json` (see index.js). Writing
 * the background never throws: the web shell fails its whole boot when a
 * plugin's apply throws.
 */
window.__ModuleLoader__.load({
  id: 'dsh-wallpaper',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useRef, useState, useSyncExternalStore } = React;

    /** Locale namespace owned by this plugin. */
    const NS = 'wallpaper';
    /** One id addresses both the sidebar cell and the main panel. */
    const PANEL_ID = 'wallpaper';
    const PACKAGE_NAME = 'dsh-wallpaper';
    const VERSION = '0.1.0';
    /** Route prefix served by the host half. */
    const API = '/api/dsh-wallpaper';
    /** localStorage key of the browser mirror. */
    const STORAGE_KEY = 'dsh.wallpaper.v1';
    /** html attribute that turns the transparent-canvas rules on. */
    const ON_ATTRIBUTE = 'data-dsw-wallpaper';
    /** Largest edge of a decoded wallpaper before it is downscaled (px). */
    const MAX_EDGE = 2560;

    // ───────────────────────────── text ─────────────────────────────

    const en = {
      label: 'Wallpaper',
      eyebrow: 'Appearance',
      title: 'Background image',
      lede: 'Choose a picture to use as the DeepSeek Harness background and tune how visible it is with the slider.',
      ready: 'Active',
      'switch.enable': 'Use a background image',
      'switch.enableHint': 'Turn it off to restore the plain theme background; your image is kept.',
      'image.title': 'Image',
      'image.pick': 'Choose image',
      'image.change': 'Change image',
      'image.empty': 'No image selected yet.',
      'image.remove': 'Remove background',
      'opacity.title': 'Opacity',
      'opacity.hint': 'Drag the slider to make the wallpaper more or less visible.',
      'opacity.value': '{value}%',
      'footer.version': 'Version {version}',
      'footer.slots': 'sidebar.panellist · main',
    };

    const zh = {
      label: '背景图',
      eyebrow: '外观',
      title: '背景图',
      lede: '选择一张图片作为 DeepSeek Harness 的背景，并用滑块调节它的透明程度。',
      ready: '已启用',
      'switch.enable': '使用背景图',
      'switch.enableHint': '关闭后恢复纯色主题背景，已选的图片会被保留。',
      'image.title': '图片',
      'image.pick': '选择图片',
      'image.change': '更换图片',
      'image.empty': '还没有选择图片。',
      'image.remove': '移除背景',
      'opacity.title': '不透明度',
      'opacity.hint': '拖动滑块，调节背景图的透明程度。',
      'opacity.value': '{value}%',
      'footer.version': '版本 {version}',
      'footer.slots': 'sidebar.panellist · main',
    };

    // ───────────────────────────── styles ─────────────────────────────

    const css = `
/* Canvas reveal, gated so a disabled wallpaper leaves DSH untouched. */
html[${ON_ATTRIBUTE}="on"] {
  background-color: var(--dsw-wallpaper-base, #151517);
}
html[${ON_ATTRIBUTE}="on"] body {
  background-color: transparent !important;
  --dsw-alias-bg-base: transparent !important;
}
html[${ON_ATTRIBUTE}="on"] body::before {
  content: "";
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-image: var(--dsw-wallpaper-image);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  opacity: var(--dsw-wallpaper-opacity, 0.6);
  transition: opacity 160ms ease;
}
@media (prefers-reduced-motion: reduce) {
  html[${ON_ATTRIBUTE}="on"] body::before { transition: none; }
}

/* Panel */
.wp-page {
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 20px;
}
.wp-page * { box-sizing: border-box; }
.wp-content {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 44px 40px 64px;
}
.wp-eyebrow-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.wp-eyebrow {
  font-size: 11px; line-height: 16px; font-weight: 600;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
}
.wp-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 9px 3px 7px; border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px; background: var(--dsw-alias-bg-layer-2);
  font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary);
}
.wp-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); flex: none; }
.wp-title { margin: 10px 0 0; font-size: 26px; line-height: 34px; font-weight: 600; letter-spacing: -0.01em; }
.wp-lede { margin: 10px 0 0; max-width: 620px; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-secondary); }

.wp-card {
  margin-top: 28px; padding: 18px 20px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
}
.wp-row { display: flex; align-items: center; gap: 12px; }
.wp-row + .wp-row { margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--dsw-alias-border-l1); }
.wp-row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.wp-row-title { font-size: 14px; line-height: 20px; font-weight: 600; }
.wp-muted { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }

.wp-switch {
  position: relative; box-sizing: border-box; width: 36px; height: 20px; flex: none; padding: 0;
  border: none; border-radius: 10px; background: var(--dsw-alias-border-l4, rgba(0,0,0,.16));
  cursor: pointer; transition: background .15s ease;
}
.wp-switch-on { background: var(--dsw-alias-state-business-primary, #4176e6); }
.wp-switch-knob {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
  background: #fff; transition: transform .15s ease;
}
.wp-switch-on .wp-switch-knob { transform: translateX(16px); }

.wp-preview {
  width: 100%; height: 150px; margin-top: 14px; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  background-color: var(--dsw-alias-bg-layer-2);
  background-size: cover; background-position: center; background-repeat: no-repeat;
  overflow: hidden;
}
.wp-preview-empty {
  display: flex; align-items: center; justify-content: center; height: 100%;
  color: var(--dsw-alias-label-secondary); font-size: 13px;
}

.wp-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 16px; }
.wp-button {
  appearance: none; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
  padding: 9px 16px; font-family: inherit; font-size: 13px; line-height: 18px; font-weight: 600;
  cursor: pointer; transition: background-color .15s ease, border-color .15s ease;
}
.wp-button:hover { background: var(--dsw-alias-bg-layer-2); }
.wp-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.wp-button-primary { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.wp-button-danger:hover { border-color: var(--dsw-alias-state-error-primary, #ef4444); color: var(--dsw-alias-state-error-primary, #ef4444); }
.wp-button:disabled { opacity: .45; cursor: default; }

.wp-slider-row { display: flex; align-items: center; gap: 14px; margin-top: 14px; }
.wp-range {
  appearance: none; -webkit-appearance: none; flex: 1; height: 20px; margin: 0;
  background: transparent; cursor: pointer;
}
.wp-range::-webkit-slider-runnable-track {
  height: 4px; border-radius: 2px; background: var(--dsw-alias-border-l3);
}
.wp-range::-webkit-slider-thumb {
  -webkit-appearance: none; width: 18px; height: 18px; margin-top: -7px; border-radius: 50%;
  background: var(--dsw-alias-state-business-primary, #4176e6); border: none;
}
.wp-range::-moz-range-track { height: 4px; border-radius: 2px; background: var(--dsw-alias-border-l3); }
.wp-range::-moz-range-thumb {
  width: 18px; height: 18px; border-radius: 50%; border: none;
  background: var(--dsw-alias-state-business-primary, #4176e6);
}
.wp-range:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; border-radius: 4px; }
.wp-range-value {
  flex: none; min-width: 44px; text-align: right; font-variant-numeric: tabular-nums;
  font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary);
}

.wp-footer {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px;
  margin-top: 36px; padding-top: 16px; border-top: 1px solid var(--dsw-alias-border-l1);
  font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary);
}
.wp-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }

@media (max-width: 640px) {
  .wp-content { padding: 32px 20px 56px; }
}
`;

    // ─────────────────────────── configuration ───────────────────────────

    /** A fresh, do-nothing document. */
    function emptyConfig() {
      return { version: 1, enabled: false, opacity: 0.6, image: '' };
    }

    /**
     * Coerce whatever was in storage into the shape this plugin reads.
     * @param {unknown} raw - the parsed document, if any.
     * @returns {{version:number,enabled:boolean,opacity:number,image:string}} a usable document.
     */
    function normalizeConfig(raw) {
      const config = emptyConfig();
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return config;
      if (typeof raw.enabled === 'boolean') config.enabled = raw.enabled;
      if (typeof raw.opacity === 'number' && Number.isFinite(raw.opacity)) {
        config.opacity = Math.min(1, Math.max(0, raw.opacity));
      }
      if (typeof raw.image === 'string' && raw.image.startsWith('data:image/')) {
        config.image = raw.image;
      }
      return config;
    }

    function readStoredConfig() {
      try {
        const text = window.localStorage.getItem(STORAGE_KEY);
        if (text === null) return emptyConfig();
        return normalizeConfig(JSON.parse(text));
      } catch {
        return emptyConfig();
      }
    }

    function writeStoredConfig(config) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      } catch {
        /* quota exceeded: the host copy still carries the full document */
      }
    }

    /**
     * Build the small external store shared by the panel and the background
     * manager. The snapshot reference changes only when the document changes,
     * so `useSyncExternalStore` can compare it directly.
     */
    function createConfigStore() {
      let snapshot = readStoredConfig();
      const listeners = new Set();
      let mirror = 0;
      const notify = () => {
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch (error) {
            console.error('[dsh-wallpaper] listener failed', error);
          }
        }
      };
      return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        commit: (next) => {
          snapshot = normalizeConfig(next);
          writeStoredConfig(snapshot);
          notify();
          window.clearTimeout(mirror);
          mirror = window.setTimeout(() => {
            void fetch(`${API}/config`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ document: snapshot }),
              cache: 'no-store',
              credentials: 'same-origin',
            }).catch(() => {
              /* the browser mirror still holds the small fields */
            });
          }, 400);
        },
        replace: (next) => {
          snapshot = normalizeConfig(next);
          writeStoredConfig(snapshot);
          notify();
        },
      };
    }

    const STORE = createConfigStore();

    // ─────────────────────────── wallpaper layer ───────────────────────────

    /** Capture the theme base colour so opacity 0 degrades to a normal look. */
    function captureThemeBase() {
      let base = '';
      try {
        base = getComputedStyle(document.body).backgroundColor;
      } catch {
        /* fall through */
      }
      if (!base || base === 'rgba(0, 0, 0, 0)' || base === 'transparent') base = '#151517';
      document.documentElement.style.setProperty('--dsw-wallpaper-base', base);
    }

    /** Project one document onto the document. */
    function applyWallpaper(config) {
      const html = document.documentElement;
      const on = config.enabled && config.image !== '';
      if (on) {
        html.setAttribute(ON_ATTRIBUTE, 'on');
        html.style.setProperty('--dsw-wallpaper-image', `url("${config.image}")`);
        html.style.setProperty('--dsw-wallpaper-opacity', String(config.opacity));
      } else {
        html.removeAttribute(ON_ATTRIBUTE);
        html.style.removeProperty('--dsw-wallpaper-image');
        html.style.removeProperty('--dsw-wallpaper-opacity');
      }
    }

    // ─────────────────────────── image handling ───────────────────────────

    /**
     * Downscale a raster image to keep the persisted data URL small.
     * @param {File} file - the picked file.
     * @returns {Promise<string>} a data URL (jpeg when possible, else the original).
     */
    function processImageFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('read failed'));
        reader.onload = () => {
          const dataUrl = String(reader.result);
          const img = new Image();
          img.onerror = () => resolve(dataUrl);
          img.onload = () => {
            try {
              let { width, height } = img;
              const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
              if (scale >= 1) return resolve(dataUrl);
              width = Math.round(width * scale);
              height = Math.round(height * scale);
              const canvas = document.createElement('canvas');
              canvas.width = width;
              canvas.height = height;
              const context = canvas.getContext('2d');
              if (context === null) return resolve(dataUrl);
              context.fillStyle = '#ffffff';
              context.fillRect(0, 0, width, height);
              context.drawImage(img, 0, 0, width, height);
              resolve(canvas.toDataURL('image/jpeg', 0.9));
            } catch {
              resolve(dataUrl);
            }
          };
          img.src = dataUrl;
        };
        reader.readAsDataURL(file);
      });
    }

    // ─────────────────────────── components ───────────────────────────

    /** Panel icon, sized and coloured by the sidebar cell. */
    function SidebarIcon({ size = 20, active = false }) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
          'aria-hidden': 'true', focusable: 'false',
          style: { display: 'block', flex: 'none' },
        },
        h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 3.5, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('circle', { cx: 8.5, cy: 9, r: 1.3, fill: 'currentColor', opacity: 0.7 }),
        h('path', {
          d: 'M4.5 16.5l4.2-4.2 3.2 3.2 2.6-2.6 5 5',
          stroke: active ? 'var(--dsw-alias-brand-primary)' : 'currentColor',
          strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
      );
    }

    /** A small on/off switch button. */
    function Switch({ checked, label, onChange }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': label,
          className: checked ? 'wp-switch wp-switch-on' : 'wp-switch',
          onClick: () => onChange(!checked),
        },
        h('span', { className: 'wp-switch-knob', 'aria-hidden': 'true' }),
      );
    }

    function WallpaperPanel({ t, subscribeLocale, getLocaleSnapshot }) {
      // Re-render whenever the active language changes, so `t()` resolves in
      // the current language.
      useSyncExternalStore(subscribeLocale, getLocaleSnapshot);
      const config = useSyncExternalStore(STORE.subscribe, STORE.getSnapshot);
      const [busy, setBusy] = useState(false);
      const fileInput = useRef(null);

      const enabled = config.enabled && config.image !== '';
      const percent = Math.round(config.opacity * 100);

      const commit = useCallback((patch) => {
        STORE.commit({ ...STORE.getSnapshot(), ...patch });
      }, []);

      const pick = useCallback(() => {
        if (fileInput.current !== null) fileInput.current.click();
      }, []);

      const onFile = useCallback(async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file === undefined) return;
        setBusy(true);
        try {
          const image = await processImageFile(file);
          commit({ image, enabled: true });
        } catch (error) {
          console.error('[dsh-wallpaper] failed to read image', error);
        } finally {
          setBusy(false);
        }
      }, [commit]);

      const previewStyle = config.image !== ''
        ? { backgroundImage: `url("${config.image}")` }
        : undefined;

      return h(
        'section',
        { className: 'wp-page', 'aria-label': t('title') },
        h(
          'div',
          { className: 'wp-content' },
          h(
            'header',
            null,
            h(
              'div',
              { className: 'wp-eyebrow-row' },
              h('span', { className: 'wp-eyebrow' }, t('eyebrow')),
              h(
                'span',
                { className: 'wp-pill' },
                h('span', { className: 'wp-dot', 'aria-hidden': 'true' }),
                t('ready'),
              ),
            ),
            h('h1', { className: 'wp-title' }, t('title')),
            h('p', { className: 'wp-lede' }, t('lede')),
          ),
          h(
            'div',
            { className: 'wp-card' },
            h(
              'div',
              { className: 'wp-row' },
              h(
                'div',
                { className: 'wp-row-text' },
                h('span', { className: 'wp-row-title' }, t('switch.enable')),
                h('p', { className: 'wp-muted' }, t('switch.enableHint')),
              ),
              h(Switch, {
                checked: config.enabled,
                label: t('switch.enable'),
                onChange: (enabled) => commit({ enabled }),
              }),
            ),
            h(
              'div',
              { className: 'wp-row' },
              h(
                'div',
                { style: { width: '100%', minWidth: 0 } },
                h('span', { className: 'wp-row-title' }, t('image.title')),
                h(
                  'div',
                  { className: 'wp-preview', style: previewStyle },
                  config.image === ''
                    ? h('div', { className: 'wp-preview-empty' }, t('image.empty'))
                    : null,
                ),
                h(
                  'div',
                  { className: 'wp-actions' },
                  h('input', {
                    ref: fileInput,
                    type: 'file',
                    accept: 'image/*',
                    style: { display: 'none' },
                    onChange: onFile,
                  }),
                  h(
                    'button',
                    { type: 'button', className: 'wp-button wp-button-primary', onClick: pick, disabled: busy },
                    busy ? '…' : config.image === '' ? t('image.pick') : t('image.change'),
                  ),
                  config.image !== '' &&
                    h(
                      'button',
                      { type: 'button', className: 'wp-button wp-button-danger', onClick: () => commit({ image: '', enabled: false }) },
                      t('image.remove'),
                    ),
                ),
              ),
            ),
            h(
              'div',
              { className: 'wp-row' },
              h(
                'div',
                { style: { width: '100%', minWidth: 0 } },
                h('span', { className: 'wp-row-title' }, t('opacity.title')),
                h('p', { className: 'wp-muted' }, t('opacity.hint')),
                h(
                  'div',
                  { className: 'wp-slider-row' },
                  h('input', {
                    className: 'wp-range',
                    type: 'range',
                    min: 0,
                    max: 100,
                    step: 1,
                    value: percent,
                    disabled: !enabled,
                    'aria-label': t('opacity.title'),
                    onChange: (event) => commit({ opacity: Number(event.target.value) / 100 }),
                  }),
                  h('span', { className: 'wp-range-value' }, t('opacity.value', { value: percent })),
                ),
              ),
            ),
          ),
          h(
            'footer',
            { className: 'wp-footer' },
            h('span', { className: 'wp-mono' }, PACKAGE_NAME),
            h(
              'span',
              null,
              t('footer.version', { version: VERSION }) + ' · ' + t('footer.slots'),
            ),
          ),
        ),
      );
    }

    // ─────────────────────────── plugin ───────────────────────────

    /**
     * Wake the browser mirror from the host document when the browser has
     * nothing of its own yet, so a fresh browser profile inherits the wallpaper.
     * @returns {Promise<void>}
     */
    async function hydrateFromHost() {
      try {
        if (window.localStorage.getItem(STORAGE_KEY) !== null) return;
      } catch {
        return;
      }
      try {
        const response = await fetch(`${API}/config`, { cache: 'no-store', credentials: 'same-origin' });
        if (!response.ok) return;
        const body = await response.json();
        const document = body?.document;
        if (document === null || typeof document !== 'object' || Array.isArray(document)) return;
        if (Object.keys(document).length === 0) return;
        STORE.replace(document);
      } catch {
        /* the host half may not be mounted on this build */
      }
    }

    function apply(ctx) {
      ctx.effect(
        () => ctx.locale.register(NS, { en, zh }),
        'wallpaper: locale dictionaries',
      );

      ctx.effect(() => {
        const selector = 'style[data-plugin-css="dsh-wallpaper/client.css"]';
        if (document.querySelector(selector) === null) {
          const tag = document.createElement('style');
          tag.dataset.plugin = PACKAGE_NAME;
          tag.dataset.pluginCss = 'dsh-wallpaper/client.css';
          tag.textContent = css;
          document.head.appendChild(tag);
          return () => {
            tag.remove();
          };
        }
        return () => {};
      }, 'wallpaper: styles');

      ctx.effect(() => {
        captureThemeBase();
        applyWallpaper(STORE.getSnapshot());
        const offStore = STORE.subscribe(() => applyWallpaper(STORE.getSnapshot()));
        const offTheme = typeof ctx.on === 'function'
          ? ctx.on('theme/change', () => captureThemeBase())
          : undefined;
        return () => {
          offStore();
          if (typeof offTheme === 'function') offTheme();
        };
      }, 'wallpaper: layer');

      ctx.effect(() => {
        void hydrateFromHost();
        return undefined;
      }, 'wallpaper: hydrate');

      const t = ctx.locale.bind(NS);

      ctx.slots.inject('main', () => {
        const locale = ctx.locale ?? {};
        const subscribeLocale = typeof locale.subscribe === 'function'
          ? locale.subscribe.bind(locale)
          : () => () => {};
        const getLocaleSnapshot = typeof locale.getSnapshot === 'function'
          ? locale.getSnapshot.bind(locale)
          : () => ({ active: 'en' });
        return ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            locale: NS,
            inject: () => ({
              t,
              subscribeLocale,
              getLocaleSnapshot,
            }),
          },
          WallpaperPanel,
        );
      });

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 25,
            locale: NS,
            label: () => t('label'),
          },
          SidebarIcon,
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    };
  },
});
