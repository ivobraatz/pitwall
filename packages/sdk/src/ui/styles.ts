import { css } from 'lit';

/**
 * The look every widget shares. Products theme it with CSS custom properties on any ancestor
 * (`:root`, `.dark`…) — they inherit through the shadow root:
 *
 *   --pw-accent, --pw-accent-fg, --pw-bg, --pw-surface, --pw-muted-bg, --pw-fg, --pw-fg-muted,
 *   --pw-fg-subtle, --pw-border, --pw-danger, --pw-warning, --pw-success, --pw-radius, --pw-font,
 *   --pw-mono, --pw-z
 *
 * Without them it follows the system's light/dark preference.
 */
export const base = css`
  :host {
    --_accent: var(--pw-accent, #0891b2);
    --_accent-fg: var(--pw-accent-fg, #ffffff);
    --_bg: var(--pw-bg, #ffffff);
    --_surface: var(--pw-surface, #ffffff);
    --_muted-bg: var(--pw-muted-bg, #f4f4f5);
    --_fg: var(--pw-fg, #18181b);
    --_fg-muted: var(--pw-fg-muted, #52525b);
    --_fg-subtle: var(--pw-fg-subtle, #a1a1aa);
    --_border: var(--pw-border, #e4e4e7);
    --_danger: var(--pw-danger, #dc2626);
    --_warning: var(--pw-warning, #d97706);
    --_success: var(--pw-success, #16a34a);
    --_radius: var(--pw-radius, 8px);
    --_font: var(--pw-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif);
    --_mono: var(--pw-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    --_z: var(--pw-z, 2147483000);
    font-family: var(--_font);
    color: var(--_fg);
    font-size: 14px;
    line-height: 1.45;
  }
  @media (prefers-color-scheme: dark) {
    :host {
      --_bg: var(--pw-bg, #09090b);
      --_surface: var(--pw-surface, #18181b);
      --_muted-bg: var(--pw-muted-bg, #27272a);
      --_fg: var(--pw-fg, #fafafa);
      --_fg-muted: var(--pw-fg-muted, #a1a1aa);
      --_fg-subtle: var(--pw-fg-subtle, #71717a);
      --_border: var(--pw-border, #3f3f46);
      --_accent: var(--pw-accent, #22d3ee);
      --_accent-fg: var(--pw-accent-fg, #083344);
    }
  }
  *, *::before, *::after { box-sizing: border-box; }
  button { font: inherit; color: inherit; cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .5; }
  input, textarea, select { font: inherit; color: inherit; }

  .btn {
    display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px;
    border-radius: calc(var(--_radius) - 2px); border: 1px solid var(--_border);
    background: var(--_surface); color: var(--_fg); font-size: 13px; font-weight: 500; white-space: nowrap;
  }
  .btn:hover:not(:disabled) { background: var(--_muted-bg); }
  .btn.primary { background: var(--_accent); color: var(--_accent-fg); border-color: transparent; }
  .btn.primary:hover:not(:disabled) { filter: brightness(1.08); background: var(--_accent); }
  .btn.ghost { border-color: transparent; background: transparent; }
  .btn.sm { height: 26px; padding: 0 9px; font-size: 12px; }

  .field { display: flex; flex-direction: column; gap: 4px; }
  .label { font-size: 12px; font-weight: 500; color: var(--_fg-muted); }
  .hint { font-size: 12px; color: var(--_fg-subtle); }
  .input, .textarea, .select {
    width: 100%; border: 1px solid var(--_border); background: var(--_bg); border-radius: calc(var(--_radius) - 2px);
    padding: 7px 10px; font-size: 14px; outline: none;
  }
  .input:focus, .textarea:focus, .select:focus { border-color: var(--_accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--_accent) 20%, transparent); }
  .textarea { resize: vertical; min-height: 110px; }

  .pill {
    display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 999px;
    font-size: 11px; font-weight: 500; white-space: nowrap; border: 1px solid transparent;
  }
  .pill.info { background: color-mix(in srgb, var(--_accent) 12%, transparent); color: var(--_accent); }
  .pill.running { background: color-mix(in srgb, #6366f1 14%, transparent); color: #6366f1; }
  .pill.warn { background: color-mix(in srgb, var(--_warning) 14%, transparent); color: var(--_warning); }
  .pill.ok { background: color-mix(in srgb, var(--_success) 14%, transparent); color: var(--_success); }
  .pill.error { background: color-mix(in srgb, var(--_danger) 14%, transparent); color: var(--_danger); }
  .pill.idle { background: var(--_muted-bg); color: var(--_fg-muted); }

  .callout { border-radius: var(--_radius); padding: 10px 12px; font-size: 13px; border: 1px solid; }
  .callout strong { display: block; margin-bottom: 2px; }
  .callout.info { border-color: color-mix(in srgb, var(--_accent) 35%, transparent); background: color-mix(in srgb, var(--_accent) 7%, transparent); }
  .callout.success { border-color: color-mix(in srgb, var(--_success) 35%, transparent); background: color-mix(in srgb, var(--_success) 7%, transparent); }
  .callout.warning { border-color: color-mix(in srgb, var(--_warning) 35%, transparent); background: color-mix(in srgb, var(--_warning) 7%, transparent); }

  .switch { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .switch .text { min-width: 0; }
  .switch .title { font-size: 13px; }
  .toggle {
    position: relative; flex-shrink: 0; width: 34px; height: 20px; margin-top: 1px; border-radius: 999px; border: 0;
    background: var(--_border); transition: background .15s;
  }
  .toggle::after {
    content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
    background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: transform .15s;
  }
  .toggle[aria-checked='true'] { background: var(--_accent); }
  .toggle[aria-checked='true']::after { transform: translateX(14px); }

  .mono { font-family: var(--_mono); }
  .muted { color: var(--_fg-muted); }
  .subtle { color: var(--_fg-subtle); }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .spinner {
    display: inline-block; width: 14px; height: 14px; border-radius: 50%;
    border: 2px solid currentColor; border-top-color: transparent; animation: pw-spin .7s linear infinite;
  }
  @keyframes pw-spin { to { transform: rotate(360deg); } }

  /* Modal */
  .backdrop {
    position: fixed; inset: 0; z-index: var(--_z); background: rgba(0,0,0,.45);
    display: flex; align-items: flex-start; justify-content: center; padding: 6vh 16px 16px; overflow-y: auto;
  }
  .dialog {
    width: 100%; max-width: 640px; background: var(--_surface); border: 1px solid var(--_border);
    border-radius: calc(var(--_radius) + 4px); box-shadow: 0 20px 50px rgba(0,0,0,.25);
    display: flex; flex-direction: column; max-height: 88vh;
  }
  .dialog.xl { max-width: 1100px; }
  .dialog header { padding: 16px 20px 8px; display: flex; align-items: flex-start; gap: 12px; }
  .dialog header h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .dialog header p { margin: 2px 0 0; font-size: 13px; color: var(--_fg-muted); }
  .dialog header .x { margin-left: auto; }
  .dialog .body { padding: 8px 20px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
  .dialog footer { padding: 12px 20px; border-top: 1px solid var(--_border); display: flex; align-items: center; gap: 8px; justify-content: flex-end; }

  .icon { width: 16px; height: 16px; flex-shrink: 0; }
`;

const svg = (path: string, size = 16) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

/** A handful of line icons, inline: the widget must not depend on the product's icon set. */
export const icons = {
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  play: svg('<path d="m6 4 14 8-14 8z"/>'),
  pause: svg('<path d="M7 4h3v16H7zM14 4h3v16h-3z"/>'),
  monitor: svg('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="m10 8 4 2-4 2z"/><path d="M8 21h8M12 17v4"/>'),
  paperclip: svg('<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>'),
  send: svg('<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>'),
  image: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3-3-9 9"/>'),
  file: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  skip: svg('<path d="m5 4 10 8-10 8zM19 5v14"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  message: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  ticket: svg('<path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z"/>'),
  square: svg('<rect x="5" y="5" width="14" height="14" rx="1"/>', 12),
};

export const STATUS_TONE: Record<string, string> = {
  open: 'info', in_progress: 'running', waiting_customer: 'warn', fixed_pending_deploy: 'ok', resolved: 'ok', closed: 'idle',
};
export const SEVERITY_TONE: Record<string, string> = { low: 'idle', normal: 'info', high: 'warn', critical: 'error' };
