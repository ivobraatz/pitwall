import { LitElement, css, html, nothing } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { snapshotDiagnostics } from '../core/buffer.js';
import { readPrefs, subscribePrefs, writePrefs } from '../core/prefs.js';
import {
  clearPending, packRecording, recorderStore, retroactiveSpanMs, startProcedure, takeRetroactive, type Recording,
} from '../core/recorder.js';
import { getPitwall, type NewTicketPrefill } from '../core/runtime.js';
import { TICKET_CATEGORIES, TICKET_SEVERITIES, type KnownIssue, type TicketCategory, type TicketSeverity } from '../core/types.js';
import { formatBytes, formatDuration, t } from './i18n.js';
import { base, icons } from './styles.js';
import { definePlayerElement } from './player.js';

const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

interface Draft {
  title: string; body: string; category: TicketCategory; severity: TicketSeverity;
  attachDiagnostics: boolean; attachRetroactive: boolean;
}

const EMPTY: Draft = { title: '', body: '', category: 'bug', severity: 'normal', attachDiagnostics: true, attachRetroactive: false };

/**
 * The one form for "something is wrong". Opened from anywhere through `pitwall.openNewTicket()`,
 * with whatever the opener already knows (a trace id, a title). The draft outlives the dialog:
 * "record the steps" closes it, and what was typed is there when the recording ends.
 */
export class PitwallNewTicket extends LitElement {
  static properties = {
    _open: { state: true },
    _draft: { state: true },
    _images: { state: true },
    _known: { state: true },
    _preview: { state: true },
    _retro: { state: true },
    _pending: { state: true },
    _buffer: { state: true },
    _submitting: { state: true },
    _progress: { state: true },
    _mask: { state: true },
    _error: { state: true },
  };

  static styles = [base, css`
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .evidence { border: 1px solid var(--_border); border-radius: var(--_radius); background: var(--_muted-bg); padding: 12px; display: flex; flex-direction: column; gap: 12px; }
    .section-title { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--_fg-subtle); margin: 0; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .attached { display: flex; align-items: center; gap: 10px; border: 1px solid var(--_border); background: var(--_surface); border-radius: calc(var(--_radius) - 2px); padding: 8px 10px; }
    .attached .grow { flex: 1; min-width: 0; }
    .thumbs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .thumb { position: relative; border: 1px solid var(--_border); border-radius: 6px; overflow: hidden; background: var(--_surface); }
    .thumb img { display: block; width: 96px; height: 64px; object-fit: cover; }
    .thumb .size { font-family: var(--_mono); font-size: 10px; color: var(--_fg-subtle); padding: 1px 6px; }
    .thumb button { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 4px; border: 0; background: rgba(0,0,0,.6); color: #fff; display: grid; place-items: center; }
    .thumb button .icon { width: 11px; height: 11px; }
    .choose { cursor: pointer; }
    .error { color: var(--_danger); font-size: 12px; }
    .progress { margin-right: auto; font-size: 12px; color: var(--_fg-muted); }
    .accent { color: var(--_accent); }
    a.link, button.link { color: inherit; text-decoration: underline; background: none; border: 0; padding: 0; }
    @media (max-width: 520px) { .grid2 { grid-template-columns: 1fr; } }
  `];

  private _open = false;
  private _draft: Draft = { ...EMPTY };
  private _images: File[] = [];
  private _known: KnownIssue | null = null;
  private _preview: Recording | null = null;
  private _retro: Recording | null = null;
  private _pending: Recording | null = null;
  private _buffer: 'on' | 'off' = 'off';
  private _submitting = false;
  private _progress: string | null = null;
  private _mask = true;
  private _error: string | null = null;
  private savedDraft: Draft | null = null;
  private previews: string[] = [];
  private prefill: NewTicketPrefill = {};
  private unsub: Array<() => void> = [];

  private get pw() { return getPitwall(); }
  private get tr() { return t(this.pw.locale); }

  connectedCallback(): void {
    super.connectedCallback();
    this._mask = readPrefs().maskData;
    this.unsub.push(subscribePrefs(() => { this._mask = readPrefs().maskData; }));
    this.unsub.push(recorderStore.subscribe((s) => { this._pending = s.pending; this._buffer = s.buffer; }));
    this.unsub.push(this.pw.ui.subscribe((s) => {
      if (s.newTicketOpen && !this._open) this.onOpen(s.prefill);
      if (!s.newTicketOpen && this._open) this._open = false;
    }));
    const r = recorderStore.get();
    this._pending = r.pending;
    this._buffer = r.buffer;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsub.forEach((u) => u());
    this.unsub = [];
  }

  private onOpen(prefill: NewTicketPrefill) {
    this.prefill = prefill;
    this._error = null;
    if (this.savedDraft) {
      this._draft = this.savedDraft;
      this.savedDraft = null;
    } else {
      this._draft = { ...EMPTY, title: prefill.title ?? '', body: prefill.body ?? '', attachRetroactive: !!prefill.attachRetroactive };
      this.setImages([]);
    }
    this._known = null;
    // The rolling buffer is read once, at open: what is there now is what led here.
    this._retro = takeRetroactive();
    if (prefill.traceId) {
      this.pw.client.knownIssue(prefill.traceId).then((k) => { this._known = k; }).catch(() => { this._known = null; });
    }
    this._open = true;
    this.updateComplete.then(() => this.renderRoot.querySelector<HTMLInputElement>('#title')?.focus());
  }

  private close() {
    if (this._submitting) return;
    this.pw.closeNewTicket();
  }

  private patch(p: Partial<Draft>) { this._draft = { ...this._draft, ...p }; }

  private setImages(files: File[]) {
    this.previews.forEach((u) => URL.revokeObjectURL(u));
    this._images = files;
    this.previews = files.map((f) => URL.createObjectURL(f));
  }

  private addFiles(list: FileList | File[]) {
    const incoming = Array.from(list).filter((f) => f.type.startsWith('image/'));
    if (!incoming.length) return;
    const next = [...this._images];
    for (const f of incoming) {
      if (next.length >= MAX_IMAGES) { this.pw.toast({ tone: 'warning', title: this.tr('new.tooManyImages', { n: MAX_IMAGES }) }); break; }
      if (f.size > MAX_IMAGE_BYTES) { this.pw.toast({ tone: 'warning', title: this.tr('new.imageTooLarge', { name: f.name }) }); continue; }
      next.push(f);
    }
    this.setImages(next);
  }

  private onPaste(e: ClipboardEvent) {
    if (e.clipboardData && e.clipboardData.files.length > 0) {
      e.preventDefault();
      this.addFiles(e.clipboardData.files);
    }
  }

  private async record() {
    // Close first, then start: the form has no place in the recording.
    this.savedDraft = this._draft;
    this.pw.closeNewTicket();
    await this.updateComplete;
    await new Promise((r) => setTimeout(r, 120));
    await startProcedure();
    this.pw.toast({ tone: 'info', title: this.tr('record.started'), description: this.tr('record.startedHint') });
  }

  private async submit() {
    const d = this._draft;
    if (!d.title.trim() || !d.body.trim()) { this._error = this.tr('new.required'); return; }
    this._submitting = true;
    this._progress = null;
    this._error = null;
    try {
      const diagnostics = d.attachDiagnostics ? snapshotDiagnostics() : undefined;
      const traceIds = Array.from(new Set([...(this.prefill.traceId ? [this.prefill.traceId] : []), ...(diagnostics?.traceIds ?? [])]));
      const created = await this.pw.client.createTicket({
        title: d.title.trim(), body: d.body.trim(), category: d.category, severity: d.severity,
        route: this.prefill.route ?? location.pathname + location.search, diagnostics, traceIds,
      });

      const recordings: Recording[] = [];
      if (this._pending) recordings.push(this._pending);
      else if (d.attachRetroactive && this._retro) recordings.push(this._retro);
      for (const rec of recordings) {
        this._progress = this.tr('new.uploadingRecording');
        const packed = await packRecording(rec);
        await this.pw.client.uploadAttachment(created.id, packed.file, { kind: 'recording', meta: packed.meta });
      }
      for (const [i, file] of this._images.entries()) {
        this._progress = this.tr('new.uploadingImage', { n: i + 1, total: this._images.length });
        await this.pw.client.uploadAttachment(created.id, file, { kind: 'image' });
      }

      clearPending();
      this.setImages([]);
      this._submitting = false;
      this.pw.closeNewTicket();
      this.pw.toast({ tone: 'success', title: this.tr('new.created', { code: created.code }) });
      this.dispatchEvent(new CustomEvent('pitwall-ticket-created', { detail: created, bubbles: true, composed: true }));
      window.dispatchEvent(new CustomEvent('pitwall:ticket-created', { detail: created }));
      this.pw.openTicket(created.id);
    } catch (err) {
      this._error = err instanceof Error ? err.message : this.tr('new.failed');
    } finally {
      this._submitting = false;
      this._progress = null;
    }
  }

  private switchRow(checked: boolean, onChange: (v: boolean) => void, label: string, hint?: string, disabled = false) {
    return html`<div class="switch" style=${disabled ? 'opacity:.5' : ''}>
      <div class="text"><div class="title">${label}</div>${hint ? html`<div class="hint">${hint}</div>` : nothing}</div>
      <button class="toggle" role="switch" aria-checked=${String(checked)} ?disabled=${disabled} aria-label=${label} @click=${() => onChange(!checked)}></button>
    </div>`;
  }

  private renderKnown() {
    const k = this._known;
    if (!k?.known) return nothing;
    const text = k.status === 'fixed_pending_deploy' ? this.tr('known.fixedPending', { where: k.fixedIn ?? '' })
      : k.status === 'resolved' ? this.tr('known.resolved') : this.tr('known.inProgress');
    return html`<div class="callout ${k.status === 'resolved' ? 'success' : 'info'}">
      <strong>${this.tr('known.title')}</strong>${text}
      ${k.ticketId ? html` <button class="link" @click=${() => { this.close(); this.pw.openTicket(k.ticketId!); }}>${this.tr('known.openTicket', { code: k.ticketCode ?? '' })}</button>` : nothing}
    </div>`;
  }

  private renderEvidence() {
    const d = this._draft;
    const pending = this._pending;
    const canRetro = !!this._retro && !pending;
    const span = this._retro ? this._retro.durationMs : retroactiveSpanMs();
    return html`<div class="evidence">
      <p class="section-title">${this.tr('new.evidence')}</p>
      ${this.switchRow(d.attachDiagnostics, (v) => this.patch({ attachDiagnostics: v }), this.tr('new.attachDiagnostics'), this.tr('new.attachDiagnosticsHint'))}

      ${pending ? html`<div class="attached">
          <span class="accent">${unsafeHTML(icons.monitor)}</span>
          <div class="grow"><div>${this.tr('new.procedureAttached')}</div>
            <div class="hint mono">${formatDuration(pending.durationMs)} · ${pending.events.length} ${this.tr('new.events')} · ${pending.masked ? this.tr('new.masked') : this.tr('new.unmasked')}</div></div>
          <button class="btn sm" @click=${() => { this._preview = pending; }}>${this.tr('new.review')}</button>
          <button class="btn sm ghost" @click=${() => clearPending()}>${unsafeHTML(icons.trash)} ${this.tr('new.discard')}</button>
        </div>`
      : html`<div class="row">
          <div><div>${this.tr('new.recordProcedure')}</div><div class="hint">${this.tr('new.recordProcedureHint')}</div></div>
          <button class="btn sm" @click=${this.record}>${unsafeHTML(icons.monitor)} ${this.tr('new.recordButton')}</button>
        </div>`}

      ${pending ? nothing : html`<div class="row">
        <div style="flex:1;min-width:0">${this.switchRow(d.attachRetroactive && canRetro, (v) => this.patch({ attachRetroactive: v }), this.tr('new.attachRetro'),
          this._buffer === 'off' && !this._retro ? this.tr('new.retroOff') : canRetro ? this.tr('new.retroHint', { span: formatDuration(span) }) : this.tr('new.retroEmpty'), !canRetro)}</div>
        ${canRetro ? html`<button class="btn sm ghost" @click=${() => { this._preview = this._retro; }}>${this.tr('new.review')}</button>` : nothing}
      </div>`}

      ${this.switchRow(this._mask, (v) => { this._mask = writePrefs({ maskData: v }).maskData; }, this.tr('new.mask'), this.tr('new.maskHint'))}

      <div>
        <div class="row">
          <div><div>${this.tr('new.images')}</div><div class="hint">${this.tr('new.imagesHint')}</div></div>
          <label class="btn sm choose">${unsafeHTML(icons.paperclip)} ${this.tr('new.chooseImages')}
            <input class="sr-only" type="file" accept="image/*" multiple @change=${(e: Event) => { const el = e.target as HTMLInputElement; if (el.files) this.addFiles(el.files); el.value = ''; }} />
          </label>
        </div>
        ${this._images.length ? html`<div class="thumbs">${this._images.map((f, i) => html`
          <div class="thumb"><img src=${this.previews[i]} alt=${f.name} /><div class="size">${formatBytes(f.size)}</div>
            <button aria-label=${this.tr('common.remove')} @click=${() => this.setImages(this._images.filter((_, j) => j !== i))}>${unsafeHTML(icons.x)}</button></div>`)}</div>`
        : html`<div class="hint" style="margin-top:6px">${this.tr('new.pasteHint')}</div>`}
      </div>
    </div>`;
  }

  render() {
    if (!this._open && !this._preview) return nothing;
    const d = this._draft;
    return html`
      ${this._open ? html`<div class="backdrop" @click=${(e: Event) => { if (e.target === e.currentTarget) this.close(); }}>
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="pw-new-title" @keydown=${(e: KeyboardEvent) => { if (e.key === 'Escape') this.close(); }}>
          <header>
            <div><h2 id="pw-new-title">${this.tr('new.title')}</h2><p>${this.tr('new.description')}</p></div>
            <button class="btn ghost sm x" aria-label=${this.tr('common.close')} @click=${this.close}>${unsafeHTML(icons.x)}</button>
          </header>
          <div class="body">
            ${this.renderKnown()}
            <label class="field"><span class="label">${this.tr('new.fieldTitle')}</span>
              <input id="title" class="input" maxlength="200" .value=${d.title} placeholder=${this.tr('new.titlePlaceholder')}
                @input=${(e: Event) => this.patch({ title: (e.target as HTMLInputElement).value })} /></label>
            <div class="grid2">
              <label class="field"><span class="label">${this.tr('new.fieldCategory')}</span>
                <select class="select" .value=${d.category} @change=${(e: Event) => this.patch({ category: (e.target as HTMLSelectElement).value as TicketCategory })}>
                  ${TICKET_CATEGORIES.map((c) => html`<option value=${c} ?selected=${c === d.category}>${this.tr(`category.${c}`)}</option>`)}
                </select></label>
              <label class="field"><span class="label">${this.tr('new.fieldSeverity')}</span>
                <select class="select" .value=${d.severity} @change=${(e: Event) => this.patch({ severity: (e.target as HTMLSelectElement).value as TicketSeverity })}>
                  ${TICKET_SEVERITIES.map((s) => html`<option value=${s} ?selected=${s === d.severity}>${this.tr(`severity.${s}`)}</option>`)}
                </select></label>
            </div>
            <label class="field"><span class="label">${this.tr('new.fieldBody')}</span>
              <textarea class="textarea" rows="6" maxlength="20000" .value=${d.body} placeholder=${this.tr('new.bodyPlaceholder')}
                @input=${(e: Event) => this.patch({ body: (e.target as HTMLTextAreaElement).value })} @paste=${this.onPaste}></textarea>
              <span class="hint">${this.tr('new.bodyHint')}</span></label>
            ${this.renderEvidence()}
            ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
          </div>
          <footer>
            <span class="progress">${this._progress ?? ''}</span>
            <button class="btn ghost" ?disabled=${this._submitting} @click=${this.close}>${this.tr('common.cancel')}</button>
            <button class="btn primary" ?disabled=${this._submitting} @click=${this.submit}>
              ${this._submitting ? html`<span class="spinner"></span>` : nothing} ${this.tr('new.submit')}
            </button>
          </footer>
        </div>
      </div>` : nothing}
      ${this._preview ? html`<div class="backdrop" @click=${(e: Event) => { if (e.target === e.currentTarget) this._preview = null; }}>
        <div class="dialog xl" role="dialog" aria-modal="true">
          <header><div><h2>${this.tr('new.previewTitle')}</h2><p>${this.tr('new.previewDescription')}</p></div>
            <button class="btn ghost sm x" aria-label=${this.tr('common.close')} @click=${() => { this._preview = null; }}>${unsafeHTML(icons.x)}</button></header>
          <div class="body"><pitwall-player style="height:62vh" .events=${this._preview.events} .diagnostics=${this._preview.diagnostics} .locale=${this.pw.locale}></pitwall-player></div>
        </div>
      </div>` : nothing}
    `;
  }
}

/**
 * The floating "recording" strip, bottom centre. Blocked from the recording itself so the replay
 * shows the screen, not the bar.
 */
export class PitwallRecordingBar extends LitElement {
  static properties = { _startedAt: { state: true }, _now: { state: true } };
  static styles = [base, css`
    .bar {
      position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%); z-index: var(--_z);
      display: flex; align-items: center; gap: 12px; padding: 6px 8px 6px 14px; border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--_danger) 40%, transparent); background: var(--_surface);
      box-shadow: 0 8px 24px rgba(0,0,0,.2); font-size: 12px;
    }
    .dot { position: relative; width: 10px; height: 10px; }
    .dot::before, .dot::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: var(--_danger); }
    .dot::before { animation: pw-ping 1.2s cubic-bezier(0,0,.2,1) infinite; opacity: .6; }
    @keyframes pw-ping { 75%, 100% { transform: scale(2); opacity: 0; } }
    .time { font-family: var(--_mono); color: var(--_fg-muted); font-variant-numeric: tabular-nums; }
    .stop { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 12px; border-radius: 999px; border: 0; background: var(--_danger); color: #fff; font-weight: 500; }
    .cancel { width: 26px; height: 26px; border-radius: 50%; border: 0; background: none; display: grid; place-items: center; color: var(--_fg-subtle); }
    .cancel:hover { background: var(--_muted-bg); color: var(--_fg); }
  `];

  private _startedAt: number | null = null;
  private _now = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsub = recorderStore.subscribe((s) => this.follow(s.procedureStartedAt));
    this.follow(recorderStore.get().procedureStartedAt);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsub?.();
    if (this.timer) clearInterval(this.timer);
  }

  private follow(startedAt: number | null) {
    this._startedAt = startedAt;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (startedAt) {
      this._now = Date.now();
      this.timer = setInterval(() => { this._now = Date.now(); }, 500);
    }
  }

  render() {
    if (!this._startedAt) return nothing;
    const pw = getPitwall();
    const tr = t(pw.locale);
    return html`<div class="bar" role="status">
      <span class="dot"></span>
      <span>${tr('record.recording')}</span>
      <span class="time">${formatDuration(this._now - this._startedAt)} / 10:00</span>
      <button class="stop" @click=${() => pw.stopRecording()}>${unsafeHTML(icons.square)} ${tr('record.stop')}</button>
      <button class="cancel" aria-label=${tr('record.cancel')} title=${tr('record.cancel')}
        @click=${async () => { const { discardProcedure } = await import('../core/recorder.js'); discardProcedure(); }}>${unsafeHTML(icons.x)}</button>
    </div>`;
  }
}

/** Notices, bottom right: confirmations, and the "something went wrong — tell the team?" prompt. */
export class PitwallToasts extends LitElement {
  static properties = { _toasts: { state: true } };
  static styles = [base, css`
    .stack { position: fixed; right: 16px; bottom: 16px; z-index: var(--_z); display: flex; flex-direction: column; gap: 8px; width: min(360px, calc(100vw - 32px)); }
    .toast { display: flex; gap: 10px; align-items: flex-start; padding: 12px 12px 12px 14px; border-radius: var(--_radius); border: 1px solid var(--_border); background: var(--_surface); box-shadow: 0 10px 30px rgba(0,0,0,.18); border-left-width: 3px; }
    .toast.info { border-left-color: var(--_accent); } .toast.success { border-left-color: var(--_success); }
    .toast.warning { border-left-color: var(--_warning); } .toast.error { border-left-color: var(--_danger); }
    .grow { flex: 1; min-width: 0; }
    .title { font-weight: 600; font-size: 13px; }
    .desc { font-size: 12px; color: var(--_fg-muted); margin-top: 2px; }
    .actions { display: flex; gap: 6px; margin-top: 8px; }
    .x { border: 0; background: none; color: var(--_fg-subtle); padding: 2px; }
  `];

  private _toasts = getPitwall().ui.get().toasts;
  private unsub: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsub = getPitwall().ui.subscribe((s) => { this._toasts = s.toasts; });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsub?.();
  }

  render() {
    const pw = getPitwall();
    return html`<div class="stack" aria-live="polite">${this._toasts.map((toast) => html`
      <div class="toast ${toast.tone}">
        <div class="grow">
          <div class="title">${toast.title}</div>
          ${toast.description ? html`<div class="desc">${toast.description}</div>` : nothing}
          ${toast.action ? html`<div class="actions"><button class="btn sm primary" @click=${() => { toast.action!.onClick(); pw.dismissToast(toast.id); }}>${toast.action.label}</button></div>` : nothing}
        </div>
        <button class="x" aria-label=${t(pw.locale)('common.close')} @click=${() => pw.dismissToast(toast.id)}>${unsafeHTML(icons.x)}</button>
      </div>`)}</div>`;
  }
}

export function defineCoreElements(): void {
  definePlayerElement();
  if (!customElements.get('pitwall-new-ticket')) customElements.define('pitwall-new-ticket', PitwallNewTicket);
  if (!customElements.get('pitwall-recording-bar')) customElements.define('pitwall-recording-bar', PitwallRecordingBar);
  if (!customElements.get('pitwall-toasts')) customElements.define('pitwall-toasts', PitwallToasts);
}
