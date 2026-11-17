'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type StaffTokenInfo } from '@/lib/api';
import { Button, Card, Check, Field, Input, Pill, Select, dateTime, rel, useToast } from '@/components/ui';

type Created = { id: string; name: string; prefix: string; expiresAt: string | null; token: string };

function state(t: StaffTokenInfo): { tone: string; label: string } {
  if (t.revokedAt) return { tone: 'idle', label: 'revogado' };
  if (t.expiresAt && new Date(t.expiresAt) <= new Date()) return { tone: 'warn', label: 'expirado' };
  return { tone: 'ok', label: 'ativo' };
}

/** What a token reaches, in the order the API stores them (Domain/StaffToken.cs). */
const SCOPES = [
  { id: 'tasks', label: 'Tarefas', hint: 'ler e atualizar o quadro' },
  { id: 'atlas', label: 'Atlas', hint: 'sistemas, rotinas e atividade' },
  { id: 'errors', label: 'Erros', hint: 'ler os erros do servidor' },
  { id: 'notes', label: 'Anotações', hint: 'ler e escrever as anotações' },
] as const;
const DEFAULT_SCOPES = ['tasks', 'atlas', 'notes'];

function scopeLabel(scopes: string[]): string {
  return SCOPES.filter((s) => scopes.includes(s.id)).map((s) => s.label).join(' + ') || 'sem escopo';
}

function ScopePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Escopos">
      {SCOPES.map((sc) => (
        <span key={sc.id} title={sc.hint}>
          <Check checked={value.includes(sc.id)}
            onChange={(on) => onChange(on ? SCOPES.map((s) => s.id).filter((id) => id === sc.id || value.includes(id)) : value.filter((x) => x !== sc.id))}>
            {sc.label}
          </Check>
        </span>
      ))}
    </div>
  );
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
 * Personal tokens: what the Pitwall MCP uses to work the task board and report to the Atlas as
 * you. Shown once; listed by prefix; good for those two only (not tickets or the team).
 */
export function PersonalTokens() {
  const toast = useToast();
  const tokens = useQuery({ queryKey: ['me', 'tokens'], queryFn: () => api<StaffTokenInfo[]>('/staff/me/tokens') });
  const [name, setName] = React.useState('');
  const [days, setDays] = React.useState('90');
  const [scopes, setScopes] = React.useState<string[]>(DEFAULT_SCOPES);
  const [busy, setBusy] = React.useState(false);
  const [created, setCreated] = React.useState<Created | null>(null);
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ id: string; scopes: string[] } | null>(null);
  const [saving, setSaving] = React.useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const res = await api<Created>('/staff/me/tokens', { method: 'POST', json: { name, expiresInDays: days === 'never' ? null : Number(days), scopes } });
      setCreated(res); setName(''); setScopes(DEFAULT_SCOPES);
      void tokens.refetch();
    } catch (e) { toast('error', e instanceof Error ? e.message : 'Erro.'); } finally { setBusy(false); }
  };
  const saveScopes = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api(`/staff/me/tokens/${editing.id}`, { method: 'PATCH', json: { scopes: editing.scopes } });
      setEditing(null); toast('ok', 'Escopos salvos. O token já vale com eles, sem trocar nada no MCP.'); void tokens.refetch();
    } catch (e) { toast('error', e instanceof Error ? e.message : 'Erro.'); } finally { setSaving(false); }
  };
  const revoke = async (id: string) => {
    try { await api(`/staff/me/tokens/${id}`, { method: 'DELETE' }); setConfirming(null); toast('ok', 'Token revogado.'); void tokens.refetch(); }
    catch (e) { toast('error', e instanceof Error ? e.message : 'Erro.'); }
  };

  const active = tokens.data?.filter((t) => state(t).label === 'ativo').length ?? 0;
  return (
    <Card title="Tokens pessoais" subtitle="Para o Claude Code, pelo MCP do Pitwall." actions={<Pill tone="idle">{active}/10 ativos</Pill>}>
      <div className="flex flex-col gap-4 px-5 pt-1 pb-5 text-[14px]">
        <p className="max-w-xl leading-[1.5] text-fg-secondary">
          O que o Claude Code faz em seu nome, pelo MCP do Pitwall, depende dos escopos: <strong className="font-semibold text-fg">Tarefas</strong> lê e atualiza o quadro,
          {' '}<strong className="font-semibold text-fg">Atlas</strong> registra sistemas, rotinas e atividade, e <strong className="font-semibold text-fg">Erros</strong> lê
          os erros do servidor (para a triagem diária), e <strong className="font-semibold text-fg">Anotações</strong> lê e escreve as notas da equipe.
          Dá para mudar os escopos depois, sem trocar o token. Nenhum token lê chamados nem a equipe.
        </p>

        {created ? (
          <div className="flex flex-col gap-3 rounded-tile bg-accent-bg p-4">
            <p className="font-semibold text-fg">Copie agora: o token não aparece de novo.</p>
            <div className="flex flex-wrap items-center gap-2">
              <code aria-label="Token" className="min-w-0 flex-1 rounded-lg bg-surface px-3 py-2 break-all text-fg">{created.token}</code>
              <CopyButton text={created.token} />
            </div>
            <p className="text-[13px] text-fg-secondary">No terminal, conecte o Claude Code a esta instalação:</p>
            <pre className="overflow-x-auto rounded-tile bg-well p-4 text-[12.5px] leading-[1.6] text-fg">{mcpCommand(created.token)}</pre>
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton text={mcpCommand(created.token)} label="Copiar comando" />
              <span className="text-[13px] text-fg-muted">Depois, no Claude Code, <code>/mcp</code> mostra o pitwall conectado.</span>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setCreated(null)}>Pronto</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Nome" className="min-w-56 flex-1"><Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Claude Code no notebook" /></Field>
              <Field label="Validade">
                <Select value={days} onChange={(e) => setDays(e.target.value)}
                  options={[{ value: '30', label: '30 dias' }, { value: '90', label: '90 dias' }, { value: '365', label: '1 ano' }, { value: 'never', label: 'Sem expiração' }]} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ScopePicker value={scopes} onChange={setScopes} />
              <Button variant="primary" className="ml-auto" loading={busy} disabled={!name.trim() || scopes.length === 0 || active >= 10} onClick={create}>Novo token</Button>
            </div>
          </div>
        )}

        {(tokens.data?.length ?? 0) > 0 && (
          <div className="flex flex-col divide-y divide-border-subtle">
            {tokens.data!.map((t) => {
              const s = state(t);
              return (
                <div key={t.id} className="-mx-2 flex min-h-[56px] flex-wrap items-center gap-3 rounded-tile px-2 py-3 transition-colors duration-150 hover:bg-hover">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2 text-[14px]"><span className="truncate font-medium text-fg">{t.name}</span><Pill tone={s.tone}>{s.label}</Pill></div>
                    <div className="mt-0.5 text-[13px] text-fg-muted">
                      <code>{t.prefix}…</code> · <span data-scopes={t.scopes.join(' ')}>{scopeLabel(t.scopes)}</span> · criado {rel(t.createdAt)} · último uso {t.lastUsedAt ? rel(t.lastUsedAt) : 'nunca'}
                      {' · '}{t.revokedAt ? `revogado ${rel(t.revokedAt)}` : t.expiresAt ? <span title={dateTime(t.expiresAt)}>expira {rel(t.expiresAt)}</span> : 'sem expiração'}
                    </div>
                  </div>
                  {s.label === 'ativo' && editing?.id === t.id ? (
                    <span className="flex w-full flex-wrap items-center gap-2">
                      <ScopePicker value={editing.scopes} onChange={(v) => setEditing({ id: t.id, scopes: v })} />
                      <span className="ml-auto flex items-center gap-1.5">
                        <Button size="sm" variant="primary" loading={saving} disabled={editing.scopes.length === 0} onClick={saveScopes}>Salvar</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
                      </span>
                    </span>
                  ) : s.label === 'ativo' && confirming !== t.id && (
                    <Button size="sm" variant="secondary" onClick={() => { setConfirming(null); setEditing({ id: t.id, scopes: t.scopes }); }}>Escopos</Button>
                  )}
                  {!t.revokedAt && editing?.id !== t.id && (confirming === t.id ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-[13px] text-fg-secondary">Revogar? O MCP para de funcionar.</span>
                      <Button size="sm" variant="danger" onClick={() => revoke(t.id)}>Revogar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Cancelar</Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="danger" onClick={() => setConfirming(t.id)}>Revogar</Button>
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
