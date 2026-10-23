/**
 * Session recording for support tickets — DOM replay, not video.
 *
 * rrweb records DOM mutations, clicks, scrolls and typing as a compact event stream that replays
 * as the screen the person saw. Compared with a pixel recording it is a hundred times smaller,
 * needs no "share your screen?" prompt, works in desktop webviews, and — the reason it is the
 * only option here — it can be masked: the text of table cells, of anything marked
 * `data-pw-mask`, and the value of every input are replaced before they reach the buffer.
 *
 * Two modes, both opt-in to send and both held only in memory:
 *   - retroactive: an always-on rolling buffer of the last couple of minutes, so a ticket opened
 *     from an error can show what led up to it. Off when the person turns it off.
 *   - procedure: started on purpose ("record the steps"), stopped on purpose, reviewed before
 *     it is attached.
 *
 * The recording never leaves the browser unless the person attaches it to a ticket, they see it
 * before they do, and it lands in the team's private store rather than a third party's.
 */

import type { eventWithTime } from '@rrweb/types';
import { snapshotDiagnostics } from './buffer.js';
import { readPrefs, subscribePrefs, type SupportPrefs } from './prefs.js';
import { Store } from './store.js';
import type { DiagnosticsBundle } from './types.js';

type StopFn = () => void;
type RecordFn = typeof import('@rrweb/record').record;

/** Window between full snapshots in retroactive mode: the buffer holds one or two of these. */
const CHECKOUT_MS = 75_000;
/** A procedure recording that runs away is stopped here — a ticket does not need an hour. */
export const PROCEDURE_MAX_MS = 10 * 60_000;

/** Text replaced with asterisks when "mask data" is on: table cells and anything marked. */
const BASE_MASK_SELECTOR = 'td, [data-pw-mask], .pw-mask, [data-pw-mask] *';
/** Never recorded at all, whatever the setting — including Pitwall's own widgets. */
const BASE_BLOCK_SELECTOR = '[data-pw-block], .pw-block, pitwall-new-ticket, pitwall-recording-bar, pitwall-toasts';

export interface RecordingOptions {
  /** Extra selectors whose text is masked (e.g. the product's own `[data-dr-mask]`). */
  maskSelector?: string;
  /** Extra selectors never recorded at all. */
  blockSelector?: string;
}

export interface Recording {
  events: eventWithTime[];
  startedAt: number;
  endedAt: number;
  durationMs: number;
  masked: boolean;
  mode: 'retroactive' | 'procedure';
  /** The diagnostics bundle as of the moment the recording ended. */
  diagnostics: DiagnosticsBundle;
}

export interface RecorderState {
  buffer: 'off' | 'on';
  /** When a procedure recording started, while it runs. */
  procedureStartedAt: number | null;
  /** A finished procedure recording, waiting to be attached to a ticket. */
  pending: Recording | null;
}

export const recorderStore = new Store<RecorderState>({ buffer: 'off', procedureStartedAt: null, pending: null });

let options: RecordingOptions = {};
let recordFn: RecordFn | null = null;

async function loadRecord(): Promise<RecordFn> {
  if (recordFn) return recordFn;
  // Loaded on demand: rrweb is ~60 KB gzipped and a sign-in page has no use for it.
  const mod = await import('@rrweb/record');
  recordFn = mod.record;
  return recordFn;
}

function recordOptions(prefs: SupportPrefs) {
  const mask = [BASE_MASK_SELECTOR, options.maskSelector].filter(Boolean).join(', ');
  const block = [BASE_BLOCK_SELECTOR, options.blockSelector].filter(Boolean).join(', ');
  return {
    blockSelector: block,
    maskAllInputs: prefs.maskData,
    // Password fields are masked even when the person chose to show data.
    maskInputOptions: prefs.maskData ? undefined : { password: true },
    maskTextSelector: prefs.maskData ? mask : undefined,
    inlineStylesheet: true,
    // Canvas capture is what makes rrweb expensive; charts drawn in canvas show as blanks.
    recordCanvas: false,
    sampling: { mousemove: 80, mouseInteraction: true, scroll: 150, input: 'last' as const },
    slimDOMOptions: { script: true, comment: true, headFavicon: true, headMetaSocial: true, headMetaRobots: true, headMetaHttpEquiv: true, headMetaVerification: true },
  };
}

// ── Retroactive buffer ────────────────────────────────────────────────────────────────

let retroStop: StopFn | null = null;
let retroPrevious: eventWithTime[] = [];
let retroCurrent: eventWithTime[] = [];
let retroStartedAt = 0;
let retroMasked = true;

async function startRetroactive(): Promise<void> {
  if (retroStop || typeof window === 'undefined') return;
  if (!readPrefs().bufferEnabled) return;
  const record = await loadRecord();
  const prefs = readPrefs();
  if (retroStop || !prefs.bufferEnabled || procStop) return;
  retroPrevious = [];
  retroCurrent = [];
  retroStartedAt = Date.now();
  retroMasked = prefs.maskData;
  const stop = record({
    ...recordOptions(prefs),
    checkoutEveryNms: CHECKOUT_MS,
    emit(event: eventWithTime, isCheckout?: boolean) {
      if (isCheckout) {
        retroPrevious = retroCurrent;
        retroCurrent = [];
      }
      retroCurrent.push(event);
    },
  });
  retroStop = stop ?? null;
  recorderStore.set({ buffer: 'on' });
}

function stopRetroactive(): void {
  retroStop?.();
  retroStop = null;
  retroPrevious = [];
  retroCurrent = [];
  recorderStore.set({ buffer: 'off' });
}

/** Everything in the rolling buffer, oldest first — or null when there is nothing usable yet. */
export function takeRetroactive(): Recording | null {
  const events = [...retroPrevious, ...retroCurrent];
  // A replay needs a full snapshot (type 2) to start from; a checkout begins with meta + snapshot.
  const firstSnapshot = events.findIndex((e) => e.type === 2);
  if (firstSnapshot < 0) return null;
  const usable = events.slice(Math.max(0, firstSnapshot - 1));
  const startedAt = usable[0]?.timestamp ?? retroStartedAt;
  const endedAt = usable[usable.length - 1]?.timestamp ?? Date.now();
  return {
    events: usable, startedAt, endedAt, durationMs: Math.max(0, endedAt - startedAt),
    masked: retroMasked, mode: 'retroactive', diagnostics: snapshotDiagnostics(),
  };
}

export function retroactiveSpanMs(): number {
  const first = retroPrevious[0] ?? retroCurrent[0];
  return first ? Date.now() - first.timestamp : 0;
}

// ── Procedure recording ────────────────────────────────────────────────────────────────

let procStop: StopFn | null = null;
let procEvents: eventWithTime[] = [];
let procMasked = true;
let procTimer: ReturnType<typeof setTimeout> | null = null;

export async function startProcedure(): Promise<void> {
  if (procStop || typeof window === 'undefined') return;
  const record = await loadRecord();
  if (procStop) return;
  const prefs = readPrefs();
  // One recorder at a time: the rolling buffer pauses while the procedure runs and comes back
  // afterwards, so the DOM is observed once, not twice.
  stopRetroactive();
  procEvents = [];
  procMasked = prefs.maskData;
  const startedAt = Date.now();
  const stop = record({ ...recordOptions(prefs), emit(event: eventWithTime) { procEvents.push(event); } });
  procStop = stop ?? null;
  recorderStore.set({ procedureStartedAt: startedAt, pending: null });
  procTimer = setTimeout(() => { void stopProcedure(); }, PROCEDURE_MAX_MS);
}

export function isProcedureRunning(): boolean {
  return procStop !== null;
}

/** Stops the procedure and parks the result for the ticket form to pick up. */
export async function stopProcedure(): Promise<Recording | null> {
  if (!procStop) return null;
  if (procTimer) { clearTimeout(procTimer); procTimer = null; }
  procStop();
  procStop = null;
  const startedAt = recorderStore.get().procedureStartedAt ?? Date.now();
  const endedAt = Date.now();
  const recording: Recording | null = procEvents.some((e) => e.type === 2)
    ? { events: procEvents, startedAt, endedAt, durationMs: endedAt - startedAt, masked: procMasked, mode: 'procedure', diagnostics: snapshotDiagnostics() }
    : null;
  procEvents = [];
  recorderStore.set({ procedureStartedAt: null, pending: recording });
  void startRetroactive();
  return recording;
}

export function discardProcedure(): void {
  if (procTimer) { clearTimeout(procTimer); procTimer = null; }
  procStop?.();
  procStop = null;
  procEvents = [];
  recorderStore.set({ procedureStartedAt: null });
  void startRetroactive();
}

export function clearPending(): void {
  recorderStore.set({ pending: null });
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────────────

let installed = false;

/** Starts the rolling buffer (if enabled) and follows the preference from then on. */
export function installRecorder(opts: RecordingOptions): () => void {
  options = opts;
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;
  void startRetroactive();
  const unsubscribe = subscribePrefs(() => {
    // Mask and buffer both take effect by restarting: a recorder's masking is fixed at start,
    // and events captured under the old setting must not linger.
    if (procStop) return;
    stopRetroactive();
    void startRetroactive();
  });
  return () => {
    unsubscribe();
    stopRetroactive();
    discardProcedure();
    installed = false;
  };
}

// ── Packing ────────────────────────────────────────────────────────────────────────────

/** The recording as the file Pitwall stores: gzip when the browser can, plain JSON otherwise. */
export async function packRecording(recording: Recording): Promise<{ file: File; meta: Record<string, unknown> }> {
  const json = JSON.stringify(recording.events);
  const meta = {
    mode: recording.mode,
    masked: recording.masked,
    startedAt: new Date(recording.startedAt).toISOString(),
    endedAt: new Date(recording.endedAt).toISOString(),
    durationMs: recording.durationMs,
    eventCount: recording.events.length,
    rawBytes: json.length,
    traceIds: recording.diagnostics.traceIds,
    diagnostics: recording.diagnostics,
  };
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
    const blob = await new Response(stream).blob();
    return { file: new File([blob], 'recording.json.gz', { type: 'application/gzip' }), meta: { ...meta, encoding: 'gzip' } };
  }
  return { file: new File([json], 'recording.json', { type: 'application/json' }), meta: { ...meta, encoding: 'none' } };
}

/** Reads a stored recording back into events, whichever way it was packed. */
export async function unpackRecording(blob: Blob, contentType: string): Promise<eventWithTime[]> {
  const gz = contentType.includes('gzip');
  const text = gz
    ? await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : await blob.text();
  return JSON.parse(text) as eventWithTime[];
}
