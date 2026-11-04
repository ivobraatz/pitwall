// Cloudflare Worker que avisa se a VM Oracle ou o Uptime Kuma pararem de dar sinal de vida. Fica fora da
// VM de propósito: se ela cair, o Kuma cai junto e nenhum alerta dele sai.
//
//   POST /beat    sinal da VM a cada 5 minutos, com o cabeçalho x-beat-key
//   POST /teste   manda um e-mail agora, com o cabeçalho x-beat-key
//   GET  /status  mostra o estado, sem nenhum segredo
//
// O plano gratuito do KV aceita 1.000 gravações por dia: o sinal e a agenda usam 576. Não reduza os 5 minutos.

const LIMITE_MS = 15 * 60 * 1000;

const minutosDesde = (valor) => (valor ? Math.round((Date.now() - Number(valor)) / 60000) : null);

async function enviar(env, assunto, texto) {
  try {
    const resposta = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Monitor Braatz <monitor@braatz.com.br>',
        to: ['suporte@braatz.com.br'],
        subject: assunto,
        text: texto,
      }),
    });
    if (resposta.ok) {
      await env.STATE.delete('erro');
      return null;
    }
    const erro = `Resend respondeu ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`;
    await env.STATE.put('erro', erro);
    return erro;
  } catch (falha) {
    const erro = `Falha ao chamar o Resend: ${falha.message}`;
    await env.STATE.put('erro', erro);
    return erro;
  }
}

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);

    if (req.method === 'GET' && pathname === '/status') {
      const [sinal, agenda, alertado, erro] = await Promise.all(
        ['last', 'cron', 'alerted', 'erro'].map((chave) => env.STATE.get(chave)),
      );
      return Response.json({
        minutosDesdeOUltimoSinal: minutosDesde(sinal),
        minutosDesdeAUltimaAgenda: minutosDesde(agenda),
        alertaAtivo: Boolean(alertado),
        erroDoEmail: erro,
        segredos: { BEAT_KEY: Boolean(env.BEAT_KEY), RESEND_API_KEY: Boolean(env.RESEND_API_KEY) },
      });
    }

    if (req.method !== 'POST' || !['/beat', '/teste'].includes(pathname)) {
      return new Response('not found', { status: 404 });
    }
    if (!env.BEAT_KEY || req.headers.get('x-beat-key') !== env.BEAT_KEY) {
      return new Response('forbidden', { status: 403 });
    }

    if (pathname === '/teste') {
      const erro = await enviar(env, 'Teste do vigia do monitor', 'Se este e-mail chegou, o Worker consegue avisar.');
      return new Response(erro ?? 'ok', { status: erro ? 502 : 200 });
    }

    await env.STATE.put('last', String(Date.now()));
    return new Response('ok');
  },

  async scheduled(_evento, env) {
    await env.STATE.put('cron', String(Date.now()));

    // Sem nenhum sinal ainda, a contagem começa aqui. Assim um sinal que nunca chega também vira alerta.
    const sinal = await env.STATE.get('last');
    if (!sinal) {
      await env.STATE.put('last', String(Date.now()));
      return;
    }

    const parado = Date.now() - Number(sinal) > LIMITE_MS;
    const alertado = await env.STATE.get('alerted');

    if (parado && !alertado) {
      const erro = await enviar(
        env,
        'ALERTA: VM Oracle ou Uptime Kuma sem sinal',
        'O monitor parou de mandar sinal de vida há mais de 15 minutos. Enquanto isso, nenhum alerta do Kuma sai. Confira a VM.',
      );
      if (!erro) await env.STATE.put('alerted', '1');
    }

    if (!parado && alertado) {
      const erro = await enviar(env, 'Resolvido: VM Oracle e Uptime Kuma voltaram', 'O monitor voltou a mandar sinal de vida.');
      if (!erro) await env.STATE.delete('alerted');
    }
  },
};
