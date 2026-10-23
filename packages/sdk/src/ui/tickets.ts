import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { eventWithTime } from '@rrweb/types';
import { readPrefs, subscribePrefs, writePrefs } from '../core/prefs.js';
import { unpackRecording } from '../core/recorder.js';
import { getPitwall } from '../core/runtime.js';
import type { DiagnosticsBundle, Paged, TicketAttachment, TicketDetail, TicketSummary } from '../core/types.js';
import { formatBytes, formatDuration, relTime, t, type Key } from './i18n.js';
import { SEVERITY_TONE, STATUS_TONE, base, icons } from './styles.js';
import { definePlayerElement } from './player.js';

const pill = (tone: string, text: string) => html`<span class="pill ${tone}">${text}</span>`;

/**
 * The customer's list of tickets: their account's, newest activity first. Clicking a row goes to
 * the product's ticket screen (`ticketHref` in `Pitwall.init`) and emits `pitwall-open-ticket`.
 */
export class PitwallTickets extends LitElement {
  static properties = {
    /** The host draws its own page header (title and "new ticket"); the list starts at the filters. */
    noHeader: { type: Boolean, attribute: 'no-header' },
    _scope: { state: true }, _search: { state: true }, _page: { state: true },
    _data: { state: true }, _loading: { state: true }, _failed: { state: true },
    _prefs: { state: true },
  };

  static styles = [base, css`
    :host { display: block; }
    .head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
    .head h1 { margin: 0; font-size: 20px; font-weight: 600; }
    .head p { margin: 2px 0 0; color: var(--_fg-muted); font-size: 13px; }
    .head .btn { margin-left: auto; }
    .filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .seg { display: inline-flex; border: 1px solid var(--_border); border-radius: calc(var(--_radius) - 2px); padding: 2px; background: var(--_surface); }
    .seg button { border: 0; background: none; padding: 4px 10px; font-size: 12px; border-radius: 4px; color: var(--_fg-muted); }
    .seg button.on { background: var(--_muted-bg); color: var(--_fg); }
    .search { max-width: 280px; height: 32px; padding: 4px 10px; }
    .list { border: 1px solid var(--_border); border-radius: var(--_radius); background: var(--_surface); overflow: hidden; }
    .row { display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-bottom: 1px solid var(--_border); cursor: pointer; text-decoration: none; color: inherit; }
    .row:last-child { border-bottom: 0; }
    .row:hover { background: var(--_muted-bg); }
    .row.waiting { background: color-mix(in srgb, var(--_warning) 5%, transparent); }
    .code { font-family: var(--_mono); font-size: 11px; color: var(--_fg-subtle); width: 112px; flex-shrink: 0; }
    .main { flex: 1; min-width: 0; }
    .title { display: flex; align-items: center; gap: 6px; font-weight: 500; }
    .title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta { display: flex; gap: 6px; flex-wrap: wrap; font-size: 12px; color: var(--_fg-muted); margin-top: 2px; }
    .answered { color: var(--_accent); }
    .accent { color: var(--_accent); display: inline-flex; }
    .empty { text-align: center; padding: 40px 16px; color: var(--_fg-muted); }
    .empty .big { font-size: 15px; color: var(--_fg); font-weight: 500; margin: 8px 0 4px; }
    .pager { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 10px; font-size: 12px; color: var(--_fg-muted); }
    .prefs { margin-top: 20px; max-width: 640px; border: 1px solid var(--_border); border-radius: var(--_radius); background: var(--_surface); padding: 14px; display: flex; flex-direction: column; gap: 12px; }
    .section-title { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--_fg-subtle); margin: 0; }
    .skeleton { height: 54px; border-bottom: 1px solid var(--_border); background: linear-gradient(90deg, transparent, var(--_muted-bg), transparent); background-size: 200% 100%; animation: pw-shimmer 1.2s infinite; }
    @keyframes pw-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
    @media (max-width: 600px) { .code, .sev { display: none; } }
  `];

  noHeader = false;
  private _scope: 'open' | 'done' | 'all' = 'open';
  private _search = '';
  private _page = 1;
  private _data: Paged<TicketSummary> | null = null;
  private _loading = true;
  private _failed = false;
  private _prefs = readPrefs();
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private unsub: Array<() => void> = [];

  private get pw() { return getPitwall(); }
  private get tr() { return t(this.pw.locale); }

  connectedCallback(): void {
    super.connectedCallback();
    this.unsub.push(subscribePrefs(() => { this._prefs = readPrefs(); }));
    const reload = () => void this.load();
    window.addEventListener('pitwall:ticket-created', reload);
    this.unsub.push(() => window.removeEventListener('pitwall:ticket-created', reload));
    void this.load();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsub.forEach((u) => u());
    this.unsub = [];
  }

  private async load() {
    this._loading = true;
    this._failed = false;
    try {
      this._data = await this.pw.client.listTickets({ status: this._scope, search: this._search || undefined, page: this._page, pageSize: 25 });
    } catch {
      this._failed = true;
    } finally {
      this._loading = false;
    }
  }

  private setScope(s: typeof this._scope) { this._scope = s; this._page = 1; void this.load(); }

  private onSearch(value: string) {
    this._search = value;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { this._page = 1; void this.load(); }, 300);
  }

  private open(id: string, e: Event) {
    this.dispatchEvent(new CustomEvent('pitwall-open-ticket', { detail: { id }, bubbles: true, composed: true }));
    if (this.pw.ticketHref(id)) { e.preventDefault(); this.pw.openTicket(id); }
  }

  private renderRow(ticket: TicketSummary) {
    const answered = ticket.lastTeamMessageAt && (!ticket.lastCustomerMessageAt || ticket.lastTeamMessageAt > ticket.lastCustomerMessageAt);
    const href = this.pw.ticketHref(ticket.id) ?? '#';
    return html`<a class="row ${ticket.status === 'waiting_customer' ? 'waiting' : ''}" href=${href} @click=${(e: Event) => this.open(ticket.id, e)}>
      <span class="code">${ticket.code}</span>
      <div class="main">
        <div class="title"><span>${ticket.title}</span>${ticket.hasRecording ? html`<span class="accent">${unsafeHTML(icons.monitor)}</span>` : nothing}</div>
        <div class="meta">
          <span>${ticket.openedBy ?? '—'}</span><span>·</span><span>${this.tr('list.updated')} ${relTime(ticket.updatedAt, this.pw.locale)}</span>
          ${ticket.messageCount > 0 ? html`<span>·</span><span>${ticket.messageCount} ${unsafeHTML(icons.message.replace('class="icon"', 'class="icon" style="width:11px;height:11px;vertical-align:-1px"'))}</span>` : nothing}
          ${answered ? html`<span class="answered">${this.tr('list.answered')}</span>` : nothing}
        </div>
      </div>
      <span class="sev">${pill(SEVERITY_TONE[ticket.severity], this.tr(`severity.${ticket.severity}` as Key))}</span>
      ${pill(STATUS_TONE[ticket.status], this.tr(`status.${ticket.status}` as Key))}
    </a>`;
  }

  render() {
    const d = this._data;
    const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
    return html`
      ${this.noHeader ? nothing : html`<div class="head">
        <div><h1>${this.tr('list.title')}</h1><p>${this.tr('list.subtitle')}</p></div>
        <button class="btn primary" @click=${() => this.pw.openNewTicket()}>${unsafeHTML(icons.plus)} ${this.tr('list.new')}</button>
      </div>`}
      <div class="filters">
        <div class="seg">${(['open', 'done', 'all'] as const).map((s) => html`<button class=${this._scope === s ? 'on' : ''} @click=${() => this.setScope(s)}>${this.tr(s === 'open' ? 'list.scopeOpen' : s === 'done' ? 'list.scopeDone' : 'list.scopeAll')}</button>`)}</div>
        <input class="input search" type="search" placeholder=${this.tr('list.search')} .value=${this._search} @input=${(e: Event) => this.onSearch((e.target as HTMLInputElement).value)} />
      </div>
      ${this._loading && !d ? html`<div class="list">${[1, 2, 3, 4].map(() => html`<div class="skeleton"></div>`)}</div>`
        : this._failed ? html`<div class="empty">${this.tr('detail.loadFailed')} <button class="btn sm" @click=${this.load}>${this.tr('detail.retry')}</button></div>`
        : d && d.items.length === 0 ? html`<div class="list"><div class="empty">${unsafeHTML(icons.ticket)}
            <div class="big">${this._scope === 'open' ? this.tr('list.emptyOpen') : this.tr('list.empty')}</div>
            <div>${this.tr('list.emptyHint')}</div>
            <div style="margin-top:12px"><button class="btn primary sm" @click=${() => this.pw.openNewTicket()}>${unsafeHTML(icons.plus)} ${this.tr('list.new')}</button></div></div></div>`
        : d ? html`<div class="list">${d.items.map((x) => this.renderRow(x))}</div>
            ${pages > 1 ? html`<div class="pager">
              <button class="btn sm" ?disabled=${this._page <= 1} @click=${() => { this._page--; void this.load(); }}>${this.tr('list.prev')}</button>
              <span>${this.tr('list.page', { page: this._page, pages })}</span>
              <button class="btn sm" ?disabled=${this._page >= pages} @click=${() => { this._page++; void this.load(); }}>${this.tr('list.next')}</button>
            </div>` : nothing}` : nothing}
      <div class="prefs">
        <p class="section-title">${this.tr('list.prefs')}</p>
        ${this.switchRow(this._prefs.bufferEnabled, (v) => { this._prefs = writePrefs({ bufferEnabled: v }); }, this.tr('list.prefsBuffer'), this.tr('list.prefsBufferHint'))}
        ${this.switchRow(this._prefs.maskData, (v) => { this._prefs = writePrefs({ maskData: v }); }, this.tr('new.mask'), this.tr('new.maskHint'))}
      </div>
    `;
  }

  private switchRow(checked: boolean, onChange: (v: boolean) => void, label: string, hint: string) {
    return html`<div class="switch"><div class="text"><div class="title">${label}</div><div class="hint">${hint}</div></div>
      <button class="toggle" role="switch" aria-checked=${String(checked)} aria-label=${label} @click=${() => onChange(!checked)}></button></div>`;
  }
}

/**
 * One ticket, as the customer sees it: the conversation with the team, the attachments
 * (recordings play in place), and what the team needs from them. Polls every 30 seconds so a
 * reply shows up without a reload.
 */
export class PitwallTicket extends LitElement {
  static properties = {
    ticketId: { type: String, attribute: 'ticket-id' },
    _ticket: { state: true }, _failed: { state: true }, _body: { state: true }, _files: { state: true },
    _sending: { state: true }, _busy: { state: true }, _urls: { state: true }, _player: { state: true },
  };

  static styles = [base, css`
    :host { display: block; }
    .head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
    .head h1 { margin: 0; font-size: 19px; font-weight: 600; }
    .head .code { font-family: var(--_mono); font-size: 12px; color: var(--_fg-subtle); }
    .head .btn { margin-left: auto; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 250px; gap: 18px; }
    @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
    .col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .thread { border: 1px solid var(--_border); border-radius: var(--_radius); background: var(--_muted-bg); display: flex; flex-direction: column; min-height: 420px; max-height: 72vh; }
    .messages { flex: 1; overflow-y: auto; padding: 12px 14px; }
    .day { display: flex; justify-content: center; margin: 12px 0; }
    .day span { font-size: 11px; color: var(--_fg-muted); background: var(--_surface); border: 1px solid var(--_border); border-radius: 999px; padding: 1px 10px; }
    .msg { display: flex; flex-direction: column; margin-top: 12px; max-width: 80%; }
    .msg.mine { margin-left: auto; align-items: flex-end; }
    .who { display: flex; gap: 6px; align-items: center; font-size: 11px; color: var(--_fg-muted); padding: 0 4px 2px; }
    .team { font-family: var(--_mono); font-size: 10px; background: color-mix(in srgb, var(--_accent) 14%, transparent); color: var(--_accent); padding: 0 4px; border-radius: 3px; }
    .bubble { border-radius: 12px; padding: 8px 12px; background: var(--_surface); border: 1px solid var(--_border); box-shadow: 0 1px 1px rgba(0,0,0,.04); }
    .msg.mine .bubble, .msg.fromteam .bubble { background: color-mix(in srgb, var(--_accent) 11%, var(--_surface)); border-color: color-mix(in srgb, var(--_accent) 25%, transparent); }
    .text { white-space: pre-wrap; word-break: break-word; }
    .clock { text-align: right; font-family: var(--_mono); font-size: 10px; color: var(--_fg-subtle); margin-top: 3px; }
    .atts { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .imgs { display: flex; flex-wrap: wrap; gap: 6px; }
    .img { border: 1px solid var(--_border); border-radius: 6px; overflow: hidden; background: var(--_bg); padding: 0; }
    .img img { display: block; width: 140px; height: 92px; object-fit: cover; }
    .file, .rec { display: flex; align-items: center; gap: 8px; border: 1px solid var(--_border); border-radius: 6px; background: var(--_bg); padding: 6px 10px; text-align: left; }
    .rec .grow, .file .grow { flex: 1; min-width: 0; }
    .accent { color: var(--_accent); display: inline-flex; }
    .composer { border-top: 1px solid var(--_border); background: var(--_surface); padding: 8px; border-radius: 0 0 var(--_radius) var(--_radius); }
    .composer .line { display: flex; align-items: flex-end; gap: 6px; }
    .composer textarea { flex: 1; resize: none; min-height: 38px; max-height: 160px; border-radius: 18px; padding: 8px 14px; }
    .round { width: 36px; height: 36px; border-radius: 50%; border: 0; display: grid; place-items: center; flex-shrink: 0; background: none; color: var(--_fg-muted); }
    .round.send { background: var(--_accent); color: var(--_accent-fg); }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 4px 6px; }
    .chip { display: inline-flex; align-items: center; gap: 4px; font-family: var(--_mono); font-size: 11px; background: var(--_muted-bg); border-radius: 4px; padding: 1px 6px; }
    .chip button { border: 0; background: none; padding: 0; display: inline-flex; }
    .chip .icon, .round .icon { width: 14px; height: 14px; }
    .readonly { padding: 12px; text-align: center; font-size: 12px; color: var(--_fg-muted); border-top: 1px solid var(--_border); background: var(--_surface); }
    .side { display: flex; flex-direction: column; gap: 14px; font-size: 13px; }
    .side .k { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--_fg-subtle); margin-bottom: 4px; }
    .side .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .break { word-break: break-all; }
    .center { padding: 40px; text-align: center; color: var(--_fg-muted); }
  `];

  ticketId = '';
  private _ticket: TicketDetail | null = null;
  private _failed: string | null = null;
  private _body = '';
  private _files: File[] = [];
  private _sending = false;
  private _busy = false;
  private _urls: Record<string, string> = {};
  private _player: { events: eventWithTime[] | null; diagnostics: DiagnosticsBundle | null; error?: string } | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private lastCount = 0;

  private get pw() { return getPitwall(); }
  private get tr() { return t(this.pw.locale); }

  connectedCallback(): void {
    super.connectedCallback();
    this.poll = setInterval(() => { if (document.visibilityState === 'visible') void this.load(true); }, 30_000);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.poll) clearInterval(this.poll);
    Object.values(this._urls).forEach((u) => URL.revokeObjectURL(u));
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has('ticketId') && this.ticketId) void this.load();
    if (changed.has('_ticket') && this._ticket && this._ticket.messages.length !== this.lastCount) {
      this.lastCount = this._ticket.messages.length;
      const list = this.renderRoot.querySelector('.messages');
      if (list) list.scrollTop = list.scrollHeight;
    }
  }

  private async load(quiet = false) {
    if (!quiet) this._failed = null;
    try {
      this._ticket = await this.pw.client.getTicket(this.ticketId);
      void this.loadImages();
    } catch (err) {
      if (!quiet) this._failed = (err as { status?: number }).status === 404 ? this.tr('detail.notFound') : this.tr('detail.loadFailed');
    }
  }

  /** Images need the session, which an `<img src>` cannot carry: fetch, then object URL. */
  private async loadImages() {
    const t = this._ticket;
    if (!t) return;
    for (const a of t.attachments.filter((x) => x.kind === 'image' && !this._urls[x.id])) {
      try {
        const { blob } = await this.pw.client.fetchAttachment(t.id, a.id);
        this._urls = { ...this._urls, [a.id]: URL.createObjectURL(blob) };
      } catch { /* the card shows the file name instead */ }
    }
  }

  private async send() {
    const body = this._body.trim();
    if (!body || this._sending || !this._ticket) return;
    this._sending = true;
    try {
      const { id } = await this.pw.client.postMessage(this._ticket.id, body);
      for (const f of this._files) await this.pw.client.uploadAttachment(this._ticket.id, f, { messageId: id });
      this._body = '';
      this._files = [];
      await this.load(true);
    } catch (err) {
      this.pw.toast({ tone: 'error', title: err instanceof Error ? err.message : this.tr('chat.sendFailed') });
    } finally {
      this._sending = false;
    }
  }

  private async closeOrReopen() {
    const tk = this._ticket;
    if (!tk) return;
    this._busy = true;
    try {
      if (tk.status === 'closed') { await this.pw.client.reopenTicket(tk.id); this.pw.toast({ tone: 'success', title: this.tr('detail.reopened') }); }
      else { await this.pw.client.closeTicket(tk.id); this.pw.toast({ tone: 'success', title: this.tr('detail.closed') }); }
      await this.load(true);
    } finally {
      this._busy = false;
    }
  }

  private async watch(a: TicketAttachment) {
    const tk = this._ticket!;
    this._player = { events: null, diagnostics: a.meta?.diagnostics ?? tk.diagnostics };
    try {
      const { blob, contentType } = await this.pw.client.fetchAttachment(tk.id, a.id);
      const events = await unpackRecording(blob, contentType || a.contentType);
      this._player = { events, diagnostics: a.meta?.diagnostics ?? tk.diagnostics };
    } catch (err) {
      this._player = { events: null, diagnostics: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async download(a: TicketAttachment) {
    const { blob } = await this.pw.client.fetchAttachment(this._ticket!.id, a.id, true);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = a.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private renderAttachments(list: TicketAttachment[]) {
    if (!list.length) return nothing;
    const recs = list.filter((a) => a.kind === 'recording');
    const imgs = list.filter((a) => a.kind === 'image');
    const files = list.filter((a) => a.kind === 'file');
    return html`<div class="atts">
      ${recs.map((a) => html`<div class="rec"><span class="accent">${unsafeHTML(icons.monitor)}</span>
        <div class="grow"><div>${a.meta?.mode === 'procedure' ? this.tr('attachment.procedure') : this.tr('attachment.retro')}</div>
          <div class="hint mono">${a.meta?.durationMs != null ? `${formatDuration(a.meta.durationMs)} · ` : ''}${formatBytes(a.sizeBytes)}</div></div>
        <button class="btn sm" @click=${() => this.watch(a)}>${this.tr('attachment.watch')}</button></div>`)}
      ${imgs.length || files.length ? html`<div class="imgs">
        ${imgs.map((a) => this._urls[a.id]
          ? html`<a class="img" href=${this._urls[a.id]} target="_blank" rel="noopener" title=${a.name}><img src=${this._urls[a.id]} alt=${a.name} /></a>`
          : html`<button class="file" @click=${() => this.download(a)}>${unsafeHTML(icons.image)}<span class="grow">${a.name}</span></button>`)}
        ${files.map((a) => html`<button class="file" @click=${() => this.download(a)} title=${this.tr('attachment.download')}>${unsafeHTML(icons.file)}
          <span class="grow"><div>${a.name}</div><div class="hint mono">${formatBytes(a.sizeBytes)}</div></span>${unsafeHTML(icons.download)}</button>`)}
      </div>` : nothing}
    </div>`;
  }

  private renderThread(tk: TicketDetail) {
    const locale = this.pw.locale === 'pt' ? 'pt-BR' : 'en';
    const items = [
      { id: 'opening', author: tk.openedBy, fromTeam: false, body: tk.body, at: tk.createdAt, opening: true, atts: tk.attachments.filter((a) => !a.messageId) },
      ...tk.messages.map((m) => ({ id: m.id, author: m.author, fromTeam: m.fromTeam, body: m.body, at: m.createdAt, opening: false, atts: tk.attachments.filter((a) => a.messageId === m.id) })),
    ];
    const day = (iso: string) => new Date(iso).toDateString();
    const dayLabel = (iso: string) => {
      const d = new Date(iso);
      const today = new Date();
      const y = new Date(); y.setDate(today.getDate() - 1);
      if (d.toDateString() === today.toDateString()) return this.tr('chat.today');
      if (d.toDateString() === y.toDateString()) return this.tr('chat.yesterday');
      return d.toLocaleDateString(locale, { day: 'numeric', month: 'long' });
    };
    return items.map((item, i) => html`
      ${i === 0 || day(items[i - 1].at) !== day(item.at) ? html`<div class="day"><span>${dayLabel(item.at)}</span></div>` : nothing}
      <div class="msg ${item.fromTeam ? 'fromteam' : 'mine'}">
        <div class="who"><span>${item.author?.name ?? '—'}</span>
          ${item.fromTeam ? html`<span class="team">${this.tr('chat.team')}</span>` : nothing}
          ${item.opening ? html`<span class="subtle">${this.tr('chat.opened')}</span>` : nothing}</div>
        <div class="bubble"><div class="text">${item.body}</div>${this.renderAttachments(item.atts)}
          <div class="clock">${new Date(item.at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</div></div>
      </div>`);
  }

  render() {
    if (this._failed) return html`<div class="center">${this._failed} <button class="btn sm" @click=${() => this.load()}>${this.tr('detail.retry')}</button></div>`;
    const tk = this._ticket;
    if (!tk) return html`<div class="center"><span class="spinner"></span></div>`;
    const tr = this.tr;
    return html`
      <div class="head">
        <div><h1>${tk.title}</h1><div class="code">${tk.code}</div></div>
        <button class="btn" ?disabled=${this._busy} @click=${this.closeOrReopen}>${tk.status === 'closed' ? tr('detail.reopen') : tr('detail.close')}</button>
      </div>
      <div class="layout">
        <div class="col">
          ${tk.status === 'fixed_pending_deploy' ? html`<div class="callout success"><strong>${tr('detail.fixedTitle')}</strong>${tr('detail.fixedBody')}${tk.fixedIn ? ` (${tk.fixedIn})` : ''}</div>` : nothing}
          ${tk.status === 'resolved' ? html`<div class="callout success"><strong>${tr('detail.resolvedTitle')}</strong>${tr('detail.resolvedBody')}</div>` : nothing}
          ${tk.status === 'waiting_customer' ? html`<div class="callout warning"><strong>${tr('detail.waitingTitle')}</strong>${tr('detail.waitingBody')}</div>` : nothing}
          <div class="thread">
            <div class="messages">${this.renderThread(tk)}</div>
            ${tk.status === 'closed' ? html`<div class="readonly">${tr('detail.closedHint')}</div>` : html`<div class="composer">
              ${this._files.length ? html`<div class="chips">${this._files.map((f, i) => html`<span class="chip">${unsafeHTML(icons.paperclip)} ${f.name}
                <button aria-label=${tr('common.remove')} @click=${() => { this._files = this._files.filter((_, j) => j !== i); }}>${unsafeHTML(icons.x)}</button></span>`)}</div>` : nothing}
              <div class="line">
                <label class="round" title=${tr('chat.attach')} style="cursor:pointer">${unsafeHTML(icons.paperclip)}
                  <input class="sr-only" type="file" multiple accept="image/*,.txt,.csv,.pdf,.json" @change=${(e: Event) => { const el = e.target as HTMLInputElement; if (el.files) this._files = [...this._files, ...Array.from(el.files)].slice(0, 6); el.value = ''; }} /></label>
                <textarea class="input" rows="1" maxlength="20000" placeholder=${tr('chat.placeholder')} .value=${this._body}
                  @input=${(e: Event) => { this._body = (e.target as HTMLTextAreaElement).value; }}
                  @paste=${(e: ClipboardEvent) => { const imgs = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/')); if (imgs.length) { e.preventDefault(); this._files = [...this._files, ...imgs].slice(0, 6); } }}
                  @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void this.send(); } }}></textarea>
                <button class="round send" aria-label=${tr('chat.send')} ?disabled=${!this._body.trim() || this._sending} @click=${this.send}>
                  ${this._sending ? html`<span class="spinner"></span>` : unsafeHTML(icons.send)}</button>
              </div>
              <div class="hint" style="text-align:right;padding:4px 6px 0;font-size:11px">${tr('chat.hint')}</div>
            </div>`}
          </div>
        </div>
        <aside class="side">
          <div class="grid">
            <div><div class="k">${tr('detail.status')}</div>${pill(STATUS_TONE[tk.status], tr(`status.${tk.status}` as Key))}</div>
            <div><div class="k">${tr('detail.severity')}</div>${pill(SEVERITY_TONE[tk.severity], tr(`severity.${tk.severity}` as Key))}</div>
          </div>
          <div><div class="k">${tr('detail.category')}</div>${tr(`category.${tk.category}` as Key)}</div>
          <div><div class="k">${tr('detail.openedBy')}</div>${tk.openedBy?.name ?? '—'}<div class="hint">${relTime(tk.createdAt, this.pw.locale)}</div></div>
          ${tk.lastTeamMessageAt ? html`<div><div class="k">${tr('detail.lastReply')}</div>${relTime(tk.lastTeamMessageAt, this.pw.locale)}</div>` : nothing}
          ${tk.route ? html`<div><div class="k">${tr('detail.route')}</div><span class="mono break" style="font-size:12px">${tk.route}</span></div>` : nothing}
          ${tk.diagnostics ? html`<div><div class="k">${tr('detail.diagnostics')}</div><span class="hint">${tr('detail.diagnosticsSummary', {
            logs: tk.diagnostics.logs?.length ?? 0, requests: tk.diagnostics.requests?.length ?? 0, errors: tk.diagnostics.errors?.length ?? 0 })}</span>
            ${tk.diagnostics.context?.appVersion ? html`<div class="mono subtle" style="font-size:11px">v${tk.diagnostics.context.appVersion}</div>` : nothing}</div>` : nothing}
        </aside>
      </div>
      ${this._player ? html`<div class="backdrop" @click=${(e: Event) => { if (e.target === e.currentTarget) this._player = null; }}>
        <div class="dialog xl" role="dialog" aria-modal="true">
          <header><div><h2>${tr('attachment.playerTitle')}</h2></div>
            <button class="btn ghost sm x" aria-label=${tr('common.close')} @click=${() => { this._player = null; }}>${unsafeHTML(icons.x)}</button></header>
          <div class="body">
            ${this._player.error ? html`<div class="hint">${tr('player.failed')} ${this._player.error}</div>`
              : this._player.events ? html`<pitwall-player style="height:70vh" autoplay .events=${this._player.events} .diagnostics=${this._player.diagnostics} .locale=${this.pw.locale}></pitwall-player>`
              : html`<div class="center"><span class="spinner"></span> ${tr('player.loading')}</div>`}
          </div>
        </div></div>` : nothing}
    `;
  }
}

export function definePageElements(): void {
  definePlayerElement();
  if (!customElements.get('pitwall-tickets')) customElements.define('pitwall-tickets', PitwallTickets);
  if (!customElements.get('pitwall-ticket')) customElements.define('pitwall-ticket', PitwallTicket);
}
