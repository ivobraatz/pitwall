import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { eventWithTime } from '@rrweb/types';
import type { Replayer as ReplayerType } from '@rrweb/replay';
import type { DiagnosticsBundle } from '../core/types.js';
import type { Locale } from '../core/runtime.js';
import { formatDuration, t } from './i18n.js';
import { rrwebStyle } from './rrweb-style.js';
import { base, icons } from './styles.js';

const SPEEDS = [1, 2, 4, 8];

/** One row of the side timeline: a request, a log line or an error, in the order it happened. */
interface TimelineItem { t: number; tone: 'ok' | 'warn' | 'error' | 'muted'; text: string; detail?: string }

export function buildTimeline(d: DiagnosticsBundle | null | undefined, startTime: number, endTime: number): TimelineItem[] {
  if (!d) return [];
  const items: TimelineItem[] = [];
  for (const r of d.requests ?? []) items.push({
    t: r.t, tone: r.status >= 500 || r.status === 0 ? 'error' : r.status >= 400 ? 'warn' : 'ok',
    text: `${r.method} ${r.path}`,
    detail: `${r.status || r.code || '—'} · ${r.ms}ms${r.traceId ? ` · ${r.traceId}` : ''}`,
  });
  for (const l of d.logs ?? []) items.push({ t: l.t, tone: l.level === 'error' ? 'error' : l.level === 'warn' ? 'warn' : 'muted', text: l.msg });
  for (const e of d.errors ?? []) items.push({ t: e.t, tone: 'error', text: e.msg, detail: e.kind });
  for (const e of d.events ?? []) items.push({ t: e.t, tone: 'muted', text: `${e.kind}: ${e.detail}` });
  // Only what overlaps the recording, with slack for the request in flight at either end.
  return items.filter((i) => i.t >= startTime - 5_000 && i.t <= endTime + 5_000).sort((a, b) => a.t - b.t);
}

/**
 * Plays a DOM recording: the screen scaled to fit, a scrubber, speed, and — the point of
 * recording the DOM rather than pixels — a timeline of what the page logged and requested,
 * moving in step. Click an entry to jump the replay to that moment.
 *
 * The recorded page never runs its scripts or reaches the network: rrweb rebuilds it in a
 * sandboxed iframe from the event stream.
 */
export class PitwallPlayer extends LitElement {
  static properties = {
    events: { attribute: false },
    diagnostics: { attribute: false },
    autoplay: { type: Boolean },
    locale: { type: String },
    _ready: { state: true },
    _playing: { state: true },
    _current: { state: true },
    _total: { state: true },
    _start: { state: true },
    _speed: { state: true },
    _skip: { state: true },
    _failed: { state: true },
    _fit: { state: true },
  };

  static styles = [base, rrwebStyle, css`
    :host { display: flex; flex-direction: column; min-height: 320px; border: 1px solid var(--_border); border-radius: var(--_radius); overflow: hidden; background: var(--_surface); }
    .main { display: flex; flex: 1; min-height: 0; }
    .stage { position: relative; flex: 1; min-width: 0; min-height: 260px; background: #111; overflow: hidden; }
    .mount { position: absolute; left: 0; top: 0; transform-origin: top left; }
    .loading { position: absolute; inset: 0; display: grid; place-items: center; color: #a1a1aa; font-size: 12px; }
    .timeline { width: 290px; flex-shrink: 0; overflow-y: auto; border-left: 1px solid var(--_border); background: var(--_bg); font-family: var(--_mono); font-size: 11px; }
    @media (max-width: 760px) { .timeline { display: none; } }
    .row { display: block; width: 100%; text-align: left; border: 0; background: none; padding: 5px 10px; border-bottom: 1px solid color-mix(in srgb, var(--_border) 60%, transparent); }
    .row:hover { background: var(--_muted-bg); }
    .row.active { background: color-mix(in srgb, var(--_accent) 12%, transparent); }
    .row.future { opacity: .45; }
    .row .line { display: flex; gap: 8px; align-items: baseline; }
    .row .when { color: var(--_fg-subtle); flex-shrink: 0; }
    .row .what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row .detail { padding-left: 40px; color: var(--_fg-subtle); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tone-error { color: var(--_danger); } .tone-warn { color: var(--_warning); } .tone-ok { color: var(--_fg-muted); } .tone-muted { color: var(--_fg-subtle); }
    .controls { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-top: 1px solid var(--_border); }
    .play { width: 30px; height: 30px; border-radius: 6px; border: 0; display: grid; place-items: center; background: var(--_accent); color: var(--_accent-fg); }
    .time { font-family: var(--_mono); font-size: 11px; color: var(--_fg-muted); width: 80px; flex-shrink: 0; }
    input[type=range] { flex: 1; min-width: 0; accent-color: var(--_accent); }
    .speed { border: 0; background: none; padding: 2px 6px; border-radius: 4px; font-family: var(--_mono); font-size: 11px; color: var(--_fg-subtle); }
    .speed.on { background: var(--_muted-bg); color: var(--_fg); }
    .failed { padding: 16px; font-size: 12px; color: var(--_fg-muted); }
  `];

  events: eventWithTime[] = [];
  diagnostics: DiagnosticsBundle | null = null;
  autoplay = false;
  locale: Locale = 'pt';
  private _ready = false;
  private _playing = false;
  private _current = 0;
  private _total = 0;
  private _start = 0;
  private _speed = 1;
  private _skip = true;
  private _failed: string | null = null;
  private _fit = { scale: 1, x: 0, y: 0, width: 0, height: 0 };
  private replayer: ReplayerType | null = null;
  private frame = 0;
  private resize: ResizeObserver | null = null;
  private size: { width: number; height: number } | null = null;

  private get tr() { return t(this.locale); }

  protected updated(changed: PropertyValues): void {
    if (changed.has('events')) void this.build();
    if (changed.has('_current')) this.scrollTimeline();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.teardown();
  }

  private teardown() {
    cancelAnimationFrame(this.frame);
    this.resize?.disconnect();
    this.replayer?.destroy();
    this.replayer = null;
  }

  private async build() {
    this.teardown();
    this._ready = false;
    this._playing = false;
    this._current = 0;
    this._failed = null;
    const mount = this.renderRoot.querySelector<HTMLDivElement>('.mount');
    if (!mount || !this.events?.length) return;
    try {
      const { Replayer } = await import('@rrweb/replay');
      mount.innerHTML = '';
      const replayer = new Replayer(this.events, {
        root: mount, speed: this._speed, skipInactive: this._skip, showWarning: false, showDebug: false,
        mouseTail: false, useVirtualDom: true, UNSAFE_replayCanvas: false,
      });
      replayer.on('resize', (payload) => {
        this.size = payload as { width: number; height: number };
        this.measure();
      });
      replayer.on('finish', () => { this._playing = false; });
      const meta = replayer.getMetaData();
      this._total = meta.totalTime;
      this._start = meta.startTime;
      this.replayer = replayer;
      replayer.pause(0);
      this._ready = true;
      const stage = this.renderRoot.querySelector<HTMLDivElement>('.stage')!;
      this.resize = new ResizeObserver(() => this.measure());
      this.resize.observe(stage);
      if (this.autoplay) this.toggle();
    } catch (err) {
      this._failed = err instanceof Error ? err.message : String(err);
    }
  }

  /** Scales the recorded viewport into whatever room the stage has, centred. */
  private measure() {
    const stage = this.renderRoot.querySelector<HTMLDivElement>('.stage');
    if (!stage || !this.size) return;
    const rect = stage.getBoundingClientRect();
    const scale = Math.min(rect.width / this.size.width, rect.height / this.size.height, 1);
    this._fit = {
      scale, width: this.size.width, height: this.size.height,
      x: (rect.width - this.size.width * scale) / 2, y: (rect.height - this.size.height * scale) / 2,
    };
  }

  private tick = () => {
    if (!this.replayer) return;
    this._current = Math.min(this.replayer.getCurrentTime(), this._total);
    if (this._playing) this.frame = requestAnimationFrame(this.tick);
  };

  private toggle() {
    const r = this.replayer;
    if (!r) return;
    if (this._playing) { r.pause(); this._playing = false; return; }
    const from = this._current >= this._total - 50 ? 0 : this._current;
    r.play(from);
    this._playing = true;
    this.frame = requestAnimationFrame(this.tick);
  }

  private seek(ms: number) {
    const r = this.replayer;
    if (!r) return;
    const clamped = Math.max(0, Math.min(ms, this._total));
    this._current = clamped;
    if (this._playing) r.play(clamped); else r.pause(clamped);
  }

  private setSpeed(s: number) {
    this._speed = s;
    this.replayer?.setConfig({ speed: s });
  }

  private toggleSkip() {
    this._skip = !this._skip;
    this.replayer?.setConfig({ skipInactive: this._skip });
  }

  private scrollTimeline() {
    const el = this.renderRoot.querySelector<HTMLElement>('.row.active');
    el?.scrollIntoView({ block: 'nearest' });
  }

  render() {
    if (this._failed) return html`<div class="failed">${this.tr('player.failed')} <span class="mono">${this._failed}</span></div>`;
    const timeline = buildTimeline(this.diagnostics, this._start, this._start + this._total);
    const now = this._start + this._current;
    let active = -1;
    timeline.forEach((item, i) => { if (item.t <= now) active = i; });
    const fit = this._fit;
    return html`
      <div class="main">
        <div class="stage">
          <div class="mount" style=${fit.width ? `width:${fit.width}px;height:${fit.height}px;transform:translate(${fit.x}px,${fit.y}px) scale(${fit.scale})` : ''}></div>
          ${this._ready ? nothing : html`<div class="loading">${this.tr('player.loading')}</div>`}
        </div>
        ${timeline.length ? html`<div class="timeline">
          ${timeline.map((item, i) => html`
            <button class="row ${i === active ? 'active' : ''} ${i > active ? 'future' : ''}" @click=${() => this.seek(item.t - this._start)}>
              <div class="line"><span class="when">${formatDuration(Math.max(0, item.t - this._start))}</span><span class="what tone-${item.tone}">${item.text}</span></div>
              ${item.detail ? html`<div class="detail">${item.detail}</div>` : nothing}
            </button>`)}
        </div>` : nothing}
      </div>
      <div class="controls">
        <button class="play" ?disabled=${!this._ready} @click=${this.toggle} aria-label=${this._playing ? this.tr('player.pause') : this.tr('player.play')}>
          ${unsafeHTML(this._playing ? icons.pause : icons.play)}
        </button>
        <span class="time">${formatDuration(this._current)} / ${formatDuration(this._total)}</span>
        <input type="range" min="0" max=${Math.max(this._total, 1)} step="100" .value=${String(Math.min(this._current, this._total))}
          ?disabled=${!this._ready} aria-label=${this.tr('player.seek')} @input=${(e: Event) => this.seek(Number((e.target as HTMLInputElement).value))} />
        ${SPEEDS.map((s) => html`<button class="speed ${this._speed === s ? 'on' : ''}" @click=${() => this.setSpeed(s)}>${s}×</button>`)}
        <button class="speed ${this._skip ? 'on' : ''}" title=${this.tr('player.skipInactive')} @click=${this.toggleSkip}>${unsafeHTML(icons.skip)}</button>
      </div>
    `;
  }
}

/** Registers `<pitwall-player>`. Importing `@pitwall/sdk/player` does it too. */
export function definePlayerElement(): void {
  if (typeof customElements !== 'undefined' && !customElements.get('pitwall-player')) {
    customElements.define('pitwall-player', PitwallPlayer);
  }
}

definePlayerElement();

declare global {
  interface HTMLElementTagNameMap { 'pitwall-player': PitwallPlayer }
}
