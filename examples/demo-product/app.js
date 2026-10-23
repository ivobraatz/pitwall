// The browser side of the pretend product: one init call, a button, and two elements.
import { Pitwall } from '@pitwall/sdk';

const pitwall = Pitwall.init({
  endpoint: '/api/support',
  app: { version: '1.0.0', commit: 'demo', channel: 'local' },
  locale: () => (document.documentElement.lang.startsWith('en') ? 'en' : 'pt'),
  ticketHref: (id) => `#/support/${id}`,
  navigate: (href) => { location.hash = href.slice(1); },
});

const view = document.querySelector('#view');

function route() {
  const [, section, id] = location.hash.replace(/^#\/?/, '/').split('/');
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#/${section ?? ''}`));
  if (section === 'support' && id) view.innerHTML = `<pitwall-ticket ticket-id="${encodeURIComponent(id)}"></pitwall-ticket>`;
  else if (section === 'support') view.innerHTML = '<pitwall-tickets></pitwall-tickets>';
  else if (section === 'webhooks') renderWebhooks();
  else view.innerHTML = document.querySelector('#home').innerHTML;
}

async function renderWebhooks() {
  const events = await (await fetch('/api/webhook-log')).json();
  view.innerHTML = `<h1>Webhooks recebidos</h1><p class="muted">O que o Pitwall avisou a este produto (assinatura verificada).</p>
    <pre>${events.map((e) => `${e.at}  ${e.type}\n  ${JSON.stringify(e.data)}`).join('\n\n') || '(nenhum ainda)'}</pre>`;
}

document.addEventListener('click', async (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  if (target.dataset.action === 'report') pitwall.openNewTicket();
  if (target.dataset.action === 'run') {
    console.info('running report', { reportId: 42, token: 'should-be-redacted' });
    const res = await fetch('/api/reports/run', { method: 'POST' });
    document.querySelector('#result').textContent = res.ok ? 'ok' : `Falhou (${res.status})`;
  }
});

document.querySelector('#who').addEventListener('change', (e) => {
  document.cookie = `demo_user=${e.target.value}; path=/`;
  location.reload();
});
const current = /(?:^|;\s*)demo_user=(\w+)/.exec(document.cookie)?.[1] ?? 'ana';
document.querySelector('#who').value = current;

window.addEventListener('hashchange', route);
route();
