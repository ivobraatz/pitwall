'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type StaffMember } from '@/lib/api';
import { Avatar, Button, Card, Dialog, Field, Input, PageHeader, Pill, Select, rel, useToast } from '@/components/ui';
import { useMe } from '@/components/shell';
import { PersonalTokens } from '@/components/settings/tokens';

function Password() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api('/staff/auth/password', { method: 'POST', json: { current, next } });
      toast('ok', 'Senha trocada. As outras sessões foram encerradas.');
      setCurrent(''); setNext('');
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    } catch (e) { toast('error', e instanceof Error ? e.message : 'Erro.'); } finally { setBusy(false); }
  };
  return (
    <Card title="Senha" subtitle="Troque a sua senha. As outras sessões são encerradas.">
      <div className="flex flex-col gap-4 px-5 pt-1">
        <Field label="Senha atual"><Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
        <Field label="Nova senha" hint="Pelo menos 12 caracteres."><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2 px-5 pt-5 pb-5">
        <Button variant="primary" loading={busy} onClick={submit} disabled={!current || next.length < 12}>Trocar senha</Button>
      </div>
    </Card>
  );
}

function Totp() {
  const me = useMe();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [enroll, setEnroll] = React.useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = React.useState('');
  const [password, setPassword] = React.useState('');
  const start = async () => { try { setEnroll(await api('/staff/auth/totp/enroll', { method: 'POST' })); } catch (e) { toast('error', e instanceof Error ? e.message : 'Erro.'); } };
  const confirm = async () => {
    try { await api('/staff/auth/totp/confirm', { method: 'POST', json: { code } }); setEnroll(null); toast('ok', 'Autenticador ativo.'); void queryClient.invalidateQueries({ queryKey: ['me'] }); }
    catch (e) { toast('error', e instanceof Error ? e.message : 'Erro.'); }
  };
  const disable = async () => {
    try { await api('/staff/auth/totp/disable', { method: 'POST', json: { password } }); toast('ok', 'Autenticador desligado.'); void queryClient.invalidateQueries({ queryKey: ['me'] }); }
    catch (e) { toast('error', e instanceof Error ? e.message : 'Erro.'); }
  };
  return (
    <Card title="Autenticador (2FA)" subtitle="Um segundo fator para entrar no console." actions={me?.totpEnabled ? <Pill tone="ok">Ativo</Pill> : <Pill tone="warn">Desligado</Pill>}>
      <div className="flex flex-col gap-4 px-5 pt-1 pb-5 text-[14px]">
        <p className="max-w-lg leading-[1.5] text-fg-secondary">O console reúne dados de clientes de todos os sistemas. Um segundo fator fecha a porta para uma senha vazada.</p>
        {me?.totpEnabled ? (
          <div className="flex items-end gap-2"><Field label="Senha para desligar" className="flex-1"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Button variant="danger" onClick={disable} disabled={!password}>Desligar</Button></div>
        ) : enroll ? (
          <>
            <p>Adicione no app autenticador (Google Authenticator, 1Password, Authy…) com a chave abaixo ou abrindo o link no celular:</p>
            <Input readOnly code value={enroll.secret} onFocus={(e) => e.target.select()} />
            <a className="truncate text-accent-fg hover:underline" href={enroll.uri}><code>{enroll.uri}</code></a>
            <div className="flex items-end gap-2"><Field label="Código de 6 dígitos" className="flex-1"><Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
              <Button variant="primary" onClick={confirm} disabled={code.length < 6}>Confirmar</Button></div>
          </>
        ) : <div><Button variant="primary" onClick={start}>Ativar autenticador</Button></div>}
      </div>
    </Card>
  );
}

function Team() {
  const me = useMe();
  const toast = useToast();
  const team = useQuery({ queryKey: ['team'], queryFn: () => api<StaffMember[]>('/staff/team') });
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState({ name: '', email: '', role: 'agent' });
  const [created, setCreated] = React.useState<{ email: string; temporaryPassword: string } | null>(null);
  const admin = me?.role === 'admin';
  const add = async () => {
    try { setCreated(await api('/staff/team', { method: 'POST', json: form })); setOpen(false); setForm({ name: '', email: '', role: 'agent' }); void team.refetch(); }
    catch (e) { toast('error', e instanceof Error ? e.message : 'Erro.'); }
  };
  const update = async (id: string, patch: Record<string, unknown>) => {
    try { await api(`/staff/team/${id}`, { method: 'PATCH', json: patch }); void team.refetch(); }
    catch (e) { toast('error', e instanceof Error ? e.message : 'Erro.'); }
  };
  return (
    <Card title="Equipe" subtitle="Quem responde chamados e quem gerencia sistemas e equipe." actions={admin && <Button size="sm" onClick={() => setOpen(true)}>Adicionar pessoa</Button>}>
      <div className="flex flex-col divide-y divide-border-subtle px-3 pb-3">
        {team.data?.map((m) => (
          <div key={m.id} className="-mx-2 flex min-h-[56px] items-center gap-3 rounded-tile px-2 py-3 transition-colors duration-150 hover:bg-hover">
            <Avatar name={m.name} size={32} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2 text-[14px]">
                <span className="truncate font-medium text-fg">{m.name}</span>
                {m.disabled && <Pill tone="error">desativado</Pill>}
              </div>
              <div className="mt-0.5 truncate text-[13px] text-fg-muted">{m.email} · último acesso {rel(m.lastLoginAt)}</div>
            </div>
            {m.totpEnabled ? <Pill tone="ok">2FA</Pill> : <Pill tone="warn">sem 2FA</Pill>}
            {admin && m.id !== me?.id ? (
              <>
                <Select className="w-36" value={m.role} onChange={(e) => update(m.id, { role: e.target.value })} options={[{ value: 'agent', label: 'Atendente' }, { value: 'admin', label: 'Admin' }]} />
                <Button size="sm" variant={m.disabled ? 'secondary' : 'danger'} onClick={() => update(m.id, { disabled: !m.disabled })}>{m.disabled ? 'Reativar' : 'Desativar'}</Button>
              </>
            ) : <Pill tone={m.role === 'admin' ? 'ink' : 'idle'}>{m.role === 'admin' ? 'Admin' : 'Atendente'}</Pill>}
          </div>
        ))}
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="Adicionar pessoa">
        <div className="flex flex-col gap-4">
          <Field label="Nome"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="E-mail"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Papel"><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={[{ value: 'agent', label: 'Atendente: responde chamados' }, { value: 'admin', label: 'Admin: também gerencia sistemas e equipe' }]} /></Field>
          <div className="mt-2 flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button variant="primary" onClick={add}>Adicionar</Button></div>
        </div>
      </Dialog>
      <Dialog open={!!created} onClose={() => setCreated(null)} title="Senha temporária">
        <p className="mb-4 text-[14px] leading-[1.5] text-fg-secondary">Entregue por um canal seguro. {created?.email} troca no primeiro acesso.</p>
        <Input readOnly code value={created?.temporaryPassword ?? ''} onFocus={(e) => e.target.select()} />
      </Dialog>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Conta e equipe" subtitle="A sua senha, o segundo fator e os tokens do MCP, e quem mais está no muro." />
      <div className="grid items-start gap-3 xl:grid-cols-2">
        <div className="flex flex-col gap-3"><Password /><Totp /></div>
        <div className="flex flex-col gap-3"><Team /><PersonalTokens /></div>
      </div>
    </>
  );
}
