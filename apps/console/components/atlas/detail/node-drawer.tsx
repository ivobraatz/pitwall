'use client';

import * as React from 'react';

/*
 * Placeholder of level 3 (the component drawer). E2 replaces this file with the real panel and keeps
 * the same props; the map only depends on the signature.
 */
export function NodeDrawer({ nodeId, onClose }: { nodeId: string | null; onClose: () => void; onNode: (id: string) => void }) {
  if (!nodeId) return null;
  return (
    <aside role="dialog" aria-label={nodeId} data-testid="atlas-node-drawer" className="fixed top-0 right-0 z-50 h-full w-full max-w-md overflow-y-auto bg-overlay p-5 shadow-popover">
      <p className="font-mono text-[13px] break-all text-fg-secondary">{nodeId}</p>
      <button type="button" onClick={onClose} className="mt-4 h-9 rounded-full bg-well px-4 text-[14px] text-fg">Fechar</button>
    </aside>
  );
}
