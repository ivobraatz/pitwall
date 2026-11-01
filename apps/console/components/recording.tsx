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
      <div className="flex items-center gap-3 bg-surface py-2 pr-2 pl-3">
        <span className="grid size-9 shrink-0 place-items-center bg-accent text-on-accent" aria-hidden><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 4v16l13-8Z" /></svg></span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-fg">{meta.mode === 'procedure' ? 'Gravação dos passos' : 'Gravação do que aconteceu antes'}</div>
          <div className="text-[13px] tabular-nums text-fg-muted">
            {meta.durationMs != null && `${duration(meta.durationMs)} · `}{meta.eventCount != null && `${meta.eventCount} eventos · `}{bytes(attachment.sizeBytes)}
            {meta.masked === false && <span className="text-warning"> · dados visíveis</span>}
          </div>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>Assistir</Button>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Gravação${meta.startedAt ? ` · ${new Date(meta.startedAt).toLocaleString('pt-BR')}` : ''}`} wide>
        {error ? <p className="text-[13px] text-danger">{error}</p>
          : events ? <Player events={events} diagnostics={meta.diagnostics ?? fallback} />
          : <div className="grid h-[40vh] place-items-center text-[14px] text-fg-muted">Carregando a câmera onboard…</div>}
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
    <a href={url ?? '#'} target="_blank" rel="noopener" className="block overflow-hidden bg-surface transition-opacity hover:opacity-85" title={attachment.name}>
      {url ? <img src={url} alt={attachment.name} className="h-24 w-36 object-cover" /> : <div className="grid h-24 w-36 place-items-center px-2 text-center text-[13px] text-fg-muted">{attachment.name}</div>}
    </a>
  );
}

/** A video someone attached. Fetched only when asked for: it can be 90 MB. */
export function VideoCard({ ticketId, attachment }: { ticketId: string; attachment: Attachment }) {
  const [state, setState] = React.useState<'idle' | 'loading' | 'error'>('idle');
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const load = () => {
    setState('loading');
    fetchBlob(`/staff/tickets/${ticketId}/attachments/${attachment.id}`)
      .then(({ blob }) => setUrl(URL.createObjectURL(blob)))
      .catch(() => setState('error'));
  };
  if (url) return <video src={url} controls autoPlay className="max-h-[60vh] w-full max-w-2xl bg-fg" title={attachment.name} />;
  return (
    <div className="flex items-center gap-3 bg-surface py-2 pr-2 pl-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-fg">{attachment.name}</div>
        <div className="text-[13px] tabular-nums text-fg-muted">{state === 'error' ? 'Não foi possível carregar o vídeo.' : `Vídeo · ${bytes(attachment.sizeBytes)}`}</div>
      </div>
      <Button size="sm" loading={state === 'loading'} onClick={load}>Assistir</Button>
    </div>
  );
}

export function FileChip({ ticketId, attachment }: { ticketId: string; attachment: Attachment }) {
  return (
    <a href={`/v1/staff/tickets/${ticketId}/attachments/${attachment.id}?download=true`} className="flex h-9 items-center gap-2 bg-surface px-3 text-[13px] transition-colors hover:bg-hover">
      <span className="max-w-48 truncate">{attachment.name}</span><span className="tabular-nums text-fg-muted">{bytes(attachment.sizeBytes)}</span>
    </a>
  );
}

export function AttachmentList({ ticketId, list, fallback }: { ticketId: string; list: Attachment[]; fallback: Diagnostics | null }) {
  if (!list.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {list.filter((a) => a.kind === 'recording').map((a) => <RecordingCard key={a.id} ticketId={ticketId} attachment={a} fallback={fallback} />)}
      {list.filter((a) => a.contentType.startsWith('video/')).map((a) => <VideoCard key={a.id} ticketId={ticketId} attachment={a} />)}
      <div className="flex flex-wrap gap-2">
        {list.filter((a) => a.kind === 'image').map((a) => <ImageThumb key={a.id} ticketId={ticketId} attachment={a} />)}
        {list.filter((a) => a.kind === 'file' && !a.contentType.startsWith('video/')).map((a) => <FileChip key={a.id} ticketId={ticketId} attachment={a} />)}
      </div>
    </div>
  );
}
