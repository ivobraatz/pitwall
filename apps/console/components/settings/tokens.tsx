'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type StaffTokenInfo } from '@/lib/api';
import { Button, Card, Field, Input, Pill, Select, dateTime, rel, useToast } from '@/components/ui';

type Created = { id: string; name: string; prefix: string; expiresAt: string | null; token: string };

function state(t: StaffTokenInfo): { tone: string; label: string } {
  if (t.revokedAt) return { tone: 'idle', label: 'revogado' };
  if (t.expiresAt && new Date(t.expiresAt) <= new Date()) return { tone: 'warn', label: 'expirado' };
  return { tone: 'ok', label: 'ativo' };
}

function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [done, setDone] = React.useState(false);
  const toast = useToast();
  return (
    <Button size="sm" variant={done ? 'secondary' : 'primary'} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1800); }
      catch { toast('error', 'Não consegui copiar. Selecione o texto e copie à mão.'); }
    }}>{done ? 'Copiado' : label}</Button>
  );
}

/** The command that connects Claude Code to this installation's board, filled with this console's address. */
function mcpCommand(token: string): string {
  const origin = typeof window === 'undefined' ? 'https://<seu-dominio>' : window.location.origin;
  return `claude mcp add pitwall --scope user \\\n  --env PITWALL_URL=${origin} \\\n  --env PITWALL_TOKEN=${token} \\\n  -- npx -y pitwall-mcp`;
}

/**
 * Personal tokens: what the Pitwall MCP uses to work the task board as you. Shown once; listed
 * by prefix; good for the board only (not tickets, products or the team).
 */
export function PersonalTokens({ style }: { style?: React.CSSProperties }) {
  const toast = useToast();
  const tokens = useQuery({ queryKey: ['me', 'tokens'], queryFn: () => api<StaffTokenInfo[]>('/staff/me/tokens') });
  const [name, setName] = React.useState('');
  const [days, setDays] = React.useState('90');
  const [busy, setBusy] = React.useState(false);
  const [created, setCreated] = React.useState<Created | null>(null);
  const [confirming, setConfirming] = React.useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const res = await api<Created>('/staff/me/tokens', { method: 'POST', json: { name, expiresInDays: days === 'never' ? null : Number(days) } });
      setCreated(res); setName('');
      void tokens.refetch();
    } catch (e) { toast('error', e instanceof Error ? e.message : 'Erro.'); } finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    try { await api(`/staff/me/tokens/${id}`, { method: 'DELETE' }); setConfirming(null); toast('ok', 'Token revogado.'); void tokens.refetch(); }
    catch (e) { toast('error', e instanceof Error ? e.message : 'Erro.'); }
  };

  const active = tokens.data?.filter((t) => state(t).label === 'ativo').length ?? 0;
  return (
    <Card title="Tokens pessoais" className="rise" style={style} actions={<Pill tone="idle">{active}/10 ativos</Pill>}>
      <div className="flex flex-col gap-4 px-5 pt-2 pb-6 text-[14px]">
        <p className="max-w-xl leading-[1.5] text-fg-secondary">
          Para o Claude Code ler e atualizar o quadro de <strong className="font-semibold text-fg">Tarefas</strong> em seu nome, pelo MCP do Pitwall.
          O token só alcança as tarefas: não lê chamados, sistemas nem a equipe.
        </p>

        {created ? (
          <div className="flex flex-col gap-3 bg-accent-bg p-4">
            <p className="font-semibold text-fg">Copie agora: o token não aparece de novo.</p>
            <div className="flex gap-2"><Input readOnly code value={created.token} onFocus={(e) => e.target.select()} aria-label="Token" /><CopyButton text={created.token} /></div>
            <p className="text-[13px] text-fg-secondary">No terminal, conecte o Claude Code a esta instalação:</p>
            <pre className="overflow-x-auto bg-well p-3 leading-[1.6] text-fg">{mcpCommand(created.token)}</pre>
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton text={mcpCommand(created.token)} label="Copiar comando" />
              <span className="text-[13px] text-fg-muted">Depois, no Claude Code, <code>/mcp</code> mostra o pitwall com 8 tools.</span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setCreated(null)}>Pronto</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Nome" className="min-w-56 flex-1"><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Claude Code no notebook" /></Field>
            <Field label="Validade">
              <Select value={days} onChange={(e) => setDays(e.target.value)}
                options={[{ value: '30', label: '30 dias' }, { value: '90', label: '90 dias' }, { value: '365', label: '1 ano' }, { value: 'never', label: 'Sem expiração' }]} />
            </Field>
            <Button variant="primary" loading={busy} disabled={!name.trim() || active >= 10} onClick={create}>Novo token</Button>
          </div>
        )}

        {(tokens.data?.length ?? 0) > 0 && (
          <div className="flex flex-col gap-1">
            {tokens.data!.map((t) => {
              const s = state(t);
              return (
                <div key={t.id} className="flex flex-wrap items-center gap-3 bg-well px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-semibold text-fg"><span className="truncate">{t.name}</span><Pill tone={s.tone}>{s.label}</Pill></div>
                    <div className="mt-0.5 text-[13px] text-fg-muted">
                      <code>{t.prefix}…</code> · criado {rel(t.createdAt)} · último uso {t.lastUsedAt ? rel(t.lastUsedAt) : 'nunca'}
                      {' · '}{t.revokedAt ? `revogado ${rel(t.revokedAt)}` : t.expiresAt ? <span title={dateTime(t.expiresAt)}>expira {rel(t.expiresAt)}</span> : 'sem expiração'}
                    </div>
                  </div>
                  {!t.revokedAt && (confirming === t.id ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-[13px] text-fg-secondary">Revogar? O MCP para de funcionar.</span>
                      <Button size="sm" variant="danger" onClick={() => revoke(t.id)}>Revogar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancelar</Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(t.id)}>Revogar</Button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
