/**
 * @pitwall/sdk — the browser side.
 *
 *   import { Pitwall } from '@pitwall/sdk';
 *   const pitwall = Pitwall.init({
 *     endpoint: '/api/v1/support',              // the product's own bridge
 *     app: { version: '0.3.120', commit: 'abc1234' },
 *     ticketHref: (id) => `/support/view?id=${id}`,
 *   });
 *   pitwall.openNewTicket();                    // from a "Report a problem" button
 *
 * Then, on the product's support pages: <pitwall-tickets></pitwall-tickets> and
 * <pitwall-ticket ticket-id="…"></pitwall-ticket>. Works the same in React, Vue or plain HTML
 * (Vue: tell the compiler `isCustomElement: (tag) => tag.startsWith('pitwall-')`).
 */

import { Pitwall as PitwallRuntime, getPitwall, setPitwall, type PitwallConfig } from './core/runtime.js';
import { defineCoreElements } from './ui/new-ticket.js';
import { definePageElements } from './ui/tickets.js';

export const Pitwall = {
  /**
   * Starts diagnostics capture and the rolling recorder, and mounts the ticket dialog, the
   * recording bar and the notices on `document.body`. Call once, after sign-in — the bridge needs
   * a session. Calling it again replaces the previous instance.
   */
  init(config: PitwallConfig): PitwallRuntime {
    try { getPitwall().destroy(); } catch { /* first init */ }
    const instance = new PitwallRuntime(config);
    setPitwall(instance);
    instance.start();
    if (typeof document !== 'undefined') {
      defineCoreElements();
      definePageElements();
      // Mounted fresh each time: the elements subscribe to the instance when they connect, so ones
      // left from a previous init would keep listening to the destroyed instance (a React effect
      // that re-runs, StrictMode in development) and "new ticket" would open nothing.
      for (const tag of ['pitwall-new-ticket', 'pitwall-recording-bar', 'pitwall-toasts']) {
        document.querySelector(tag)?.remove();
        document.body.appendChild(document.createElement(tag));
      }
    }
    return instance;
  },

  /** The running instance (after `init`). */
  get current(): PitwallRuntime { return getPitwall(); },
};

export type { PitwallConfig, NewTicketPrefill, Locale, Toast } from './core/runtime.js';
export type { Pitwall as PitwallInstance } from './core/runtime.js';
export { PitwallClient, PitwallError } from './core/client.js';
export { snapshotDiagnostics, recordLog, recordRequest, recordError, recordEvent } from './core/buffer.js';
export { readPrefs, writePrefs } from './core/prefs.js';
export { packRecording, unpackRecording, type Recording } from './core/recorder.js';
export * from './core/types.js';
