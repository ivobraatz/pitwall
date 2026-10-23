'use client';

import * as React from 'react';
import { fetchBlob, type Attachment, type Diagnostics } from '@/lib/api';
import { Button, Dialog, bytes, duration } from './ui';

type PlayerElement = HTMLElement & { events: unknown[]; diagnostics: Diagnostics | null; autoplay: boolean; locale: string };

/** The SDK's <pitwall-player>, the same one customers use to review before sending. */
function Player({ events, diagnostics }: { events: unknown[]; diagnostics: Diagnostics | null }) {
  const ref = React.useRef<PlayerElement>(null);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => { void import('@pitwall/sdk/player').then(() => setReady(true)); }, []);
  React.useEffect(() => {
    const el = ref.current;
    if (!ready || !el) return;
    el.locale = 'pt';
    el.autoplay = true;
    el.diagnostics = diagnostics;
    el.events = events;
  }, [ready, events, diagnostics]);
  return React.createElement('pitwall-player', { ref, style: { height: '72vh', display: 'flex' } });
}

async function unpack(blob: Blob, contentType: string): Promise<unknown[]> {
  const text = contentType.includes('gzip')
    ? await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : await blob.text();
  return JSON.parse(text) as unknown[];
}

export function RecordingCard({ ticketId, attachment, fallback }: { ticketId: string; attachment: Attachment; fallback: Diagnostics | null }) {
  const [open, setOpen] = React.useState(false);
  const [events, setEvents] = React.useState<unknown[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const meta = attachment.meta ?? {};

  React.useEffect(() => {
    if (!open || events) return;
    fetchBlob(`/staff/tickets/${ticketId}/attachments/${attachment.id}`)
      .then(({ blob, contentType }) => unpack(blob, contentType || attachment.contentType))
      .then(setEvents)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [open, events, ticketId, attachment]);

  return (
    <>
      <div className="flex items-center gap-3 rounded-md border border-border bg-bg px-3 py-2">
        <span className="text-accent-fg">▶</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px]">{meta.mode === 'procedure' ? 'Gravação dos passos' : 'Gravação do que aconteceu antes'}</div>
          <div className="font-mono text-[11px] text-fg-subtle">
            {meta.durationMs != null && `${duration(meta.durationMs)} · `}{meta.eventCount != null && `${meta.eventCount} eventos · `}{bytes(attachment.sizeBytes)}
            {meta.masked === false && <span className="text-warning"> · dados visíveis</span>}
          </div>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>Assistir</Button>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Gravação${meta.startedAt ? ` · ${new Date(meta.startedAt).toLocaleString('pt-BR')}` : ''}`} wide>
        {error ? <p className="text-[13px] text-danger">{error}</p>
          : events ? <Player events={events} diagnostics={meta.diagnostics ?? fallback} />
          : <div className="grid h-[40vh] place-items-center text-[13px] text-fg-muted">Carregando gravação…</div>}
      </Dialog>
    </>
  );
}

export function ImageThumb({ ticketId, attachment }: { ticketId: string; attachment: Attachment }) {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    let objectUrl: string | null = null;
    fetchBlob(`/staff/tickets/${ticketId}/attachments/${attachment.id}`).then(({ blob }) => { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }).catch(() => {});
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [ticketId, attachment.id]);
  return (
    <a href={url ?? '#'} target="_blank" rel="noopener" className="block overflow-hidden rounded-md border border-border bg-bg" title={attachment.name}>
      {url ? <img src={url} alt={attachment.name} className="h-24 w-36 object-cover" /> : <div className="grid h-24 w-36 place-items-center text-[11px] text-fg-subtle">{attachment.name}</div>}
    </a>
  );
}

export function FileChip({ ticketId, attachment }: { ticketId: string; attachment: Attachment }) {
  return (
    <a href={`/v1/staff/tickets/${ticketId}/attachments/${attachment.id}?download=true`} className="flex items-center gap-2 rounded-md border border-border bg-bg px-2.5 py-1.5 text-[12px] hover:bg-hover">
      <span className="max-w-48 truncate">{attachment.name}</span><span className="font-mono text-fg-subtle">{bytes(attachment.sizeBytes)}</span>
    </a>
  );
}

export function AttachmentList({ ticketId, list, fallback }: { ticketId: string; list: Attachment[]; fallback: Diagnostics | null }) {
  if (!list.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {list.filter((a) => a.kind === 'recording').map((a) => <RecordingCard key={a.id} ticketId={ticketId} attachment={a} fallback={fallback} />)}
      <div className="flex flex-wrap gap-2">
        {list.filter((a) => a.kind === 'image').map((a) => <ImageThumb key={a.id} ticketId={ticketId} attachment={a} />)}
        {list.filter((a) => a.kind === 'file').map((a) => <FileChip key={a.id} ticketId={ticketId} attachment={a} />)}
      </div>
    </div>
  );
}
