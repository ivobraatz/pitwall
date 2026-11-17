'use client';

/**
 * Autosave of the note open in the editor. Rules, all of them load-bearing:
 * - one PATCH in flight at a time; what is typed meanwhile waits and goes in the next one;
 * - every PATCH carries ifUpdatedAt = the updatedAt of the last answer, never the one from the first load;
 * - an answer updates the metadata and the saved text in the cache, and never the text the person is typing;
 * - leaving a note sends what is pending first, and the session lives on until that send settles, so
 *   coming back to the note in that moment shows what was typed, not the older saved text;
 * - a 409 stops the session: the server has a newer note and nothing typed here is sent over it.
 */

import { api, ApiError, type NoteDetail } from './api';
import type { NotePatch } from './notes';

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

export interface SaverHooks { status(s: SaveStatus): void; error(text: string): void }

/** Typing waits this long after the last key; a choice (stage, folder, pin...) goes at once. */
export const TEXT_DELAY = 800;
const RETRY_OFFLINE = 5_000;

const sessions = new Map<string, NoteSaver>();

export function sessionFor(code: string): NoteSaver | undefined {
  return sessions.get(code.toUpperCase());
}

/** The session of a note: the one still alive for it, or a new one from what the server last said. */
export function startSession(
  code: string, updatedAt: string, text: { title: string; body: string }, saved: (n: NoteDetail, sent: NotePatch) => void,
): NoteSaver {
  const key = code.toUpperCase();
  const existing = sessions.get(key);
  if (existing) return existing;
  const s = new NoteSaver(key, updatedAt, text, saved, (done) => { if (sessions.get(key) === done) sessions.delete(key); });
  sessions.set(key, s);
  return s;
}

export function endSession(code: string) {
  const key = code.toUpperCase();
  sessions.get(key)?.discard();
  sessions.delete(key);
}

export class NoteSaver {
  /** The latest text typed for this note (what a fresh editor shows if it opens while this session lives). */
  readonly text: { title: string; body: string };
  status: SaveStatus = 'saved';
  private pending: NotePatch = {};
  private hasPending = false;
  private inFlight = false;
  private stopped = false;
  private updatedAt: string;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private hooks: SaverHooks | null = null;

  constructor(
    readonly code: string, updatedAt: string, text: { title: string; body: string },
    private readonly saved: (n: NoteDetail, sent: NotePatch) => void,
    private readonly onIdle: (s: NoteSaver) => void,
  ) {
    this.updatedAt = updatedAt;
    this.text = { ...text };
  }

  get dirty(): boolean { return this.hasPending || this.inFlight; }

  /** An editor showing this note takes the session over; the status and errors go to it. */
  attach(hooks: SaverHooks) {
    this.hooks = hooks;
    if (!sessions.has(this.code)) sessions.set(this.code, this);
    hooks.status(this.status);
  }

  /** The editor is leaving: what is pending goes now, and the session ends once it has settled. */
  detach() {
    this.hooks = null;
    this.schedule(0);
    this.checkIdle();
  }

  /** Something other than the text changed the note (an archive, a restore...): its updatedAt is the new one. */
  rebase(updatedAt: string) {
    if (!this.dirty) this.updatedAt = updatedAt;
  }

  /** Stops everything; nothing pending is sent (used when the person chose to load the server's version). */
  discard() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.pending = {};
    this.hasPending = false;
  }

  queue(fields: NotePatch, delay: number) {
    if (this.stopped) return;
    if (fields.title !== undefined) this.text.title = fields.title;
    if (fields.body !== undefined) this.text.body = fields.body;
    Object.assign(this.pending, fields);
    this.hasPending = true;
    this.emit(this.inFlight ? 'saving' : 'dirty');
    this.schedule(delay);
  }

  private emit(s: SaveStatus) {
    this.status = s;
    this.hooks?.status(s);
  }

  private schedule(delay: number) {
    clearTimeout(this.timer);
    if (this.stopped || !this.hasPending) return;
    if (delay <= 0) void this.send();
    else this.timer = setTimeout(() => void this.send(), delay);
  }

  private checkIdle() {
    if (!this.hooks && !this.dirty) this.onIdle(this);
  }

  private async send() {
    clearTimeout(this.timer);
    if (this.inFlight || this.stopped || !this.hasPending) return;
    const sent = this.pending;
    this.pending = {};
    this.hasPending = false;
    this.inFlight = true;
    this.emit('saving');
    try {
      const res = await api<NoteDetail>(`/staff/notes/${this.code}`, { method: 'PATCH', json: { ...sent, ifUpdatedAt: this.updatedAt } });
      this.updatedAt = res.updatedAt;
      this.inFlight = false;
      this.saved(res, sent);
      if (this.hasPending) { this.emit('dirty'); this.schedule(TEXT_DELAY); }
      else this.emit('saved');
      this.checkIdle();
    } catch (e) {
      this.inFlight = false;
      if (e instanceof ApiError && e.status === 409) {
        this.stopped = true;
        this.pending = {};
        this.hasPending = false;
        this.emit('conflict');
        this.checkIdle();
        return;
      }
      // The failed fields go back under whatever was typed meanwhile, so nothing is lost by the next try.
      this.pending = { ...sent, ...this.pending };
      this.hasPending = true;
      this.emit('error');
      const text = e instanceof TypeError ? 'Sem conexão com o Pitwall. Tentando de novo.' : e instanceof Error ? e.message : 'Não foi possível salvar.';
      this.hooks?.error(text);
      if (e instanceof TypeError) this.timer = setTimeout(() => void this.send(), RETRY_OFFLINE);
      this.checkIdle();
    }
  }
}
