import { expect, test, type Page } from '@playwright/test';

/*
 * The Atlas in a real browser, desktop and phone. Every name is made up (Acme, Globex): the
 * screen ships empty and an installation's own map lives in its database.
 */

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const ACME = '11111111-1111-4111-8111-111111111111';
const GLOBEX = '22222222-2222-4222-8222-222222222222';
const STAGING = 'e0000000-0000-4000-8000-000000000001';
const PRODUCTION = 'e0000000-0000-4000-8000-000000000002';
const service = (n: number) => `50000000-0000-4000-8000-00000000000${n}`;

const EMPTY = { serverTime: ago(0), systems: [], environments: [], services: [], links: [], repos: [], now: [], discoveries: [],
  collectors: ['railway', 'github', 'kuma', 'vercel'].map((name) => ({ name, connected: false, lastRunAt: null, error: null })) };

const svc = (n: number, productId: string | null, environmentId: string | null, name: string, state: string, over = {}) => ({
  id: service(n), productId, environmentId, name, kind: productId ? 'api' : 'external', provider: productId ? 'railway' : 'cdn', externalRef: null,
  url: null, monitor: null, notes: null, state, monitorStatus: state === 'down' ? 'down' : null, deployStatus: 'success',
  lastDeployAt: ago(90), commitSha: 'abc1234def5678', checkedAt: ago(4),
  group: null, condition: 'ok', facts: [], items: [], impact: null, owner: null, task: null, ...over,
});

const FULL = {
  serverTime: ago(0),
  systems: [
    { id: ACME, slug: 'acme', name: 'Acme', color: '#5eb0ff', description: 'Foguetes sob medida', websiteUrl: null,
      health: { total: 3, up: 3, down: 0, degraded: 0, deploying: 0, unknown: 0 }, pending: { tasks: 2, tickets: 0, errors: 0, alerts: 0 }, attention: { gaps: 1, warnings: 1 } },
    { id: GLOBEX, slug: 'globex', name: 'Globex', color: '#34d08c', description: 'Energia limpa', websiteUrl: null,
      health: { total: 2, up: 1, down: 1, degraded: 0, deploying: 0, unknown: 0 }, pending: { tasks: 1, tickets: 3, errors: 5, alerts: null }, attention: { gaps: 0, warnings: 0 } },
  ],
  environments: [{ id: STAGING, slug: 'staging', name: 'Staging' }, { id: PRODUCTION, slug: 'production', name: 'Produção' }],
  services: [
    svc(1, ACME, PRODUCTION, 'API', 'up', { group: 'Núcleo', facts: [{ key: 'Health', value: '/health' }, { key: 'Memória', value: '1 GB' }], items: ['Pagamentos', 'Pedidos'] }),
    svc(2, ACME, PRODUCTION, 'Worker', 'up', { group: 'Núcleo', condition: 'warn', impact: 'medium', owner: 'agent' }),
    svc(3, ACME, STAGING, 'API', 'up'),
    svc(7, ACME, PRODUCTION, 'App', 'unknown', { kind: 'app', provider: 'store', group: 'Na loja', condition: 'gap', impact: 'high', owner: 'person', task: 'T-7K2QM', notes: 'Ainda não publicado.', deployStatus: null, lastDeployAt: null, commitSha: null }),
    svc(4, GLOBEX, PRODUCTION, 'Portal', 'down'), svc(5, GLOBEX, PRODUCTION, 'Banco', 'up', { kind: 'database' }),
    svc(6, null, null, 'CDN', 'unknown', { deployStatus: null, lastDeployAt: null, commitSha: null }),
  ],
  links: [{ id: 'l1', from: service(1), to: service(6), label: null, kind: 'host', planned: false }, { id: 'l2', from: service(4), to: service(6), label: null, kind: null, planned: false },
    { id: 'l3', from: service(1), to: service(7), label: null, kind: 'deploy', planned: true }],
  repos: [
    { id: 'r1', productId: ACME, fullName: 'acme-inc/rockets', lastRunName: 'CI', lastRunStatus: 'success', lastRunAt: ago(50), lastRunUrl: null, lastRunSha: 'abc1234', commits7d: 14, runs7d: 20, failedRuns7d: 0, openAlerts: 0, checkedAt: ago(5) },
    { id: 'r2', productId: GLOBEX, fullName: 'globex-corp/portal', lastRunName: 'CI', lastRunStatus: 'failure', lastRunAt: ago(30), lastRunUrl: null, lastRunSha: 'fff9999', commits7d: 3, runs7d: 6, failedRuns7d: 2, openAlerts: null, checkedAt: ago(5) },
  ],
  collectors: [
    { name: 'railway', connected: true, lastRunAt: ago(4), error: null }, { name: 'github', connected: true, lastRunAt: ago(4), error: null },
    { name: 'kuma', connected: true, lastRunAt: ago(4), error: null }, { name: 'vercel', connected: false, lastRunAt: null, error: null },
  ],
  now: [
    { kind: 'activity', id: 'a1', productId: ACME, serviceId: service(1), title: 'Corrigindo o cálculo de frete', detail: 'api', actor: 'Ana (Claude)', since: ago(12) },
    { kind: 'down', id: service(4), productId: GLOBEX, serviceId: service(4), title: 'Portal', detail: 'Globex Portal', actor: null, since: ago(3) },
  ],
  discoveries: [{ id: 'd1', source: 'railway', kind: 'service', externalRef: 'globex/worker@production', name: 'globex/worker', environment: 'production', url: null, firstSeenAt: ago(60) }],
};

const run = { id: 'run1', status: 'ok', startedAt: ago(300), finishedAt: ago(295), summary: '2 erros novos', actorName: 'Rotinas (Claude)', stale: false,
  links: [{ kind: 'pr', label: 'Corrige o frete', url: 'https://git.example.com/acme-inc/rockets/pull/7' }] };
const ROUTINES = [
  { id: 'ro1', slug: 'triagem', name: 'Triagem de erros', frequency: 'daily', description: 'Lê os erros novos e abre PR quando a causa é clara', prompt: 'Leia os erros.', enabled: true, updatedAt: ago(900), system: null, lastRun: run },
  { id: 'ro2', slug: 'resumo', name: 'Resumo da semana', frequency: 'weekly', description: null, prompt: '', enabled: true, updatedAt: ago(900), system: { id: ACME, slug: 'acme', name: 'Acme', color: '#5eb0ff' }, lastRun: null },
];
const step = (key: string, value: number | null, detail: string | null = null) => ({ key, value, detail });
const flowsOf = (id: string, slug: string, name: string) => ({
  system: { id, slug, name, color: null },
  flows: [
    { key: 'code', steps: [step('commit', 14), step('ci', 20, '2'), step('deploy', 3), step('production', 3, '3')] },
    { key: 'errors', steps: [step('error', 5), step('ticket', 1), step('task', 2), step('fix', 1)] },
    { key: 'content', steps: [step('release', 2), step('draft', 0), step('published', 2), step('social', null)] },
  ],
});
const ref = { id: ACME, slug: 'acme', name: 'Acme', color: '#5eb0ff' };
const refG = { id: GLOBEX, slug: 'globex', name: 'Globex', color: '#34d08c' };
const pstep = (n: number, name: string, status: string, over = {}) => ({
  id: `60000000-0000-4000-8000-00000000000${n}`, slug: `s${n}`, name, status, stage: null, owner: null, today: null, ideal: null, next: null, task: null,
  impact: null, services: [], position: n, updatedAt: ago(100), system: null, ...over,
});
const PROCESSES = [
  { id: 'p1', slug: 'suporte', name: 'Suporte', description: 'Do chamado à resposta', updatedAt: ago(100), system: ref, stages: [],
    steps: [pstep(1, 'Receber', 'ok'), pstep(2, 'Triar', 'warn'), pstep(3, 'Responder', 'gap', { today: 'Manual.', ideal: 'Resposta assistida.', next: 'Ligar o assistente.', owner: 'together', impact: 'high', task: 'T-AAAAA', services: [service(1), service(6)] }),
      pstep(4, 'Medir', 'next'), pstep(5, 'Pesquisa', 'idea')] },
  { id: 'p2', slug: 'funil', name: 'Funil', description: null, updatedAt: ago(100), system: null,
    stages: [{ key: 'oferta', name: 'Oferta', description: null }, { key: 'receita', name: 'Receita', description: null }],
    steps: [pstep(6, 'Planos', 'ok', { stage: 'oferta', system: ref }), pstep(7, 'Cobrança', 'gap', { stage: 'receita', system: ref, impact: 'medium' }),
      pstep(8, 'Catálogo', 'warn', { stage: 'oferta', system: refG })] },
];
const ATTENTION = [
  { source: 'service', id: service(7), status: 'gap', title: 'App', detail: 'Ainda não publicado.', next: null, impact: 'high', owner: 'person', task: 'T-7K2QM', system: ref, where: 'Na loja', processId: null, serviceId: service(7) },
  { source: 'step', id: PROCESSES[0].steps[2].id, status: 'gap', title: 'Responder', detail: 'Manual.', next: 'Ligar o assistente.', impact: 'high', owner: 'together', task: 'T-AAAAA', system: ref, where: 'Suporte', processId: 'p1', serviceId: null },
  { source: 'step', id: PROCESSES[1].steps[1].id, status: 'gap', title: 'Cobrança', detail: null, next: null, impact: 'medium', owner: null, task: null, system: ref, where: 'Funil', processId: 'p2', serviceId: null },
  { source: 'service', id: service(2), status: 'warn', title: 'Worker', detail: null, next: null, impact: 'medium', owner: 'agent', task: null, system: ref, where: 'Núcleo', processId: null, serviceId: service(2) },
  { source: 'step', id: PROCESSES[0].steps[1].id, status: 'warn', title: 'Triar', detail: null, next: null, impact: null, owner: null, task: null, system: ref, where: 'Suporte', processId: 'p1', serviceId: null },
];
const FLOWS = [flowsOf(ACME, 'acme', 'Acme'), flowsOf(GLOBEX, 'globex', 'Globex')];

const product = (id: string, slug: string, name: string, color: string) => ({
  id, slug, name, description: null, websiteUrl: null, color, logoUrl: null, owner: null, webhookUrl: null, hasWebhookSecret: false,
  settings: { teamName: null, ownFramePrefixes: [], autoPublishReleases: true, locales: ['pt', 'en'], retroactiveRecording: true, customerTicketUrl: null },
  createdAt: ago(9000), updatedAt: ago(9000), disabledAt: null,
});

async function serve(page: Page, atlas: typeof EMPTY | typeof FULL) {
  const posts: Array<{ path: string; body: unknown }> = [];
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/v1/staff', '');
    if (request.method() !== 'GET') {
      posts.push({ path, body: request.postDataJSON() });
      return route.fulfill({ json: { id: 'new', slug: 'initech', name: 'Initech', created: true } });
    }
    const answers: Record<string, unknown> = {
      '/auth/me': { id: 's1', name: 'Ana Souza', email: 'ana@pitwall.test', role: 'admin', totpEnabled: true, mustChangePassword: false, totpRequired: false },
      '/summary': { byStatus: {}, open: 0, unanswered: 0, openedThisWeek: 0, medianFirstResponseMinutes: null, topSignatures: [], products: [], series: [] },
      '/products': atlas.systems.length ? [product(ACME, 'acme', 'Acme', '#5eb0ff'), product(GLOBEX, 'globex', 'Globex', '#34d08c')] : [],
      '/atlas': atlas,
      '/atlas/routines': atlas.systems.length ? ROUTINES : [],
      '/atlas/flows': atlas.systems.length ? FLOWS : [],
      '/atlas/processes': atlas.systems.length ? PROCESSES : [],
      '/atlas/attention': atlas.systems.length ? ATTENTION : [],
      '/atlas/routines/triagem/runs': [run],
    };
    return path in answers ? route.fulfill({ json: answers[path] }) : route.fulfill({ status: 404, json: { message: 'not mocked' } });
  });
  return posts;
}

/** The page itself never scrolls sideways: wide things (the grid, the tabs) scroll inside their own box. */
async function expectNoSidewaysScroll(page: Page) {
  const report = await page.evaluate(() => {
    const main = document.querySelector('main')!;
    const overflow = Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, main.scrollWidth - main.clientWidth);
    // For the failure message: what reaches past the right edge.
    const edge = main.getBoundingClientRect().right;
    const past = overflow <= 1 ? [] : [...document.querySelectorAll('main *')].filter((el) => el.getBoundingClientRect().right > edge + 1)
      .slice(-4).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
    return { overflow, past };
  });
  expect(report.overflow, `the page scrolls sideways; past the edge: ${report.past.join(' | ')}`).toBeLessThanOrEqual(1);
}

test('a new installation opens an empty atlas with the invitation to register', async ({ page }) => {
  const posts = await serve(page, EMPTY);
  await page.goto('/atlas');
  await expect(page.getByTestId('atlas-empty')).toContainText('O Atlas está vazio.');
  await expect(page.getByTestId('atlas-now')).toHaveCount(0);
  await expectNoSidewaysScroll(page);

  await page.getByRole('button', { name: 'Cadastrar o primeiro sistema' }).click();
  await page.getByLabel('Nome').fill('Initech Labs');
  await expect(page.getByLabel('Identificador')).toHaveValue('initech-labs');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect.poll(() => posts.find((p) => p.path === '/atlas/systems')?.body).toMatchObject({ slug: 'initech-labs', name: 'Initech Labs' });
});

test('the overview says what is down, what is running now and which system needs someone', async ({ page }) => {
  await serve(page, FULL);
  await page.goto('/atlas');

  const now = page.getByTestId('atlas-now');
  await expect(now).toContainText('Fora do ar');
  await expect(now).toContainText('Portal');
  await expect(now).toContainText('Corrigindo o cálculo de frete');

  // The system with something down comes first, and says so in its block.
  const rows = page.getByTestId('atlas-system');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Globex');
  await expect(rows.first()).toHaveAttribute('data-verdict', 'down');
  await expect(rows.first()).toContainText('1 fora do ar');
  await expect(rows.nth(1)).toHaveAttribute('data-verdict', 'ok');
  await expect(rows.nth(1)).toContainText('3 de 3 no ar');
  await expect(rows.nth(1)).toContainText('Corrigindo o cálculo de frete');
  await expect(rows.nth(1).getByTestId('atlas-gaps')).toContainText('1 lacunas');
  await expect(rows.nth(1).getByTestId('atlas-warnings')).toContainText('1 avisos');
  await expect(rows.first().getByTestId('atlas-gaps')).toHaveCount(0);
  await expectNoSidewaysScroll(page);

  await rows.first().click();
  await expect(page).toHaveURL(/system=globex/);
  const detail = page.getByTestId('atlas-system-detail');
  await expect(detail.getByTestId('atlas-service')).toHaveCount(2);
  await expect(detail.locator('[data-testid="atlas-service"][data-state="down"]')).toContainText('Portal');
  await expect(detail.getByTestId('atlas-repo')).toContainText('globex-corp/portal');
  await expect(detail.getByTestId('atlas-external')).toContainText('CDN');
  await expect(detail.getByTestId('atlas-flows')).toBeVisible();
  await expectNoSidewaysScroll(page);
});

test('the engine marks the environments that do not exist and the collectors that are not connected', async ({ page }) => {
  await serve(page, FULL);
  await page.goto('/atlas?view=engine');
  const engine = page.getByTestId('atlas-engine');
  await expect(engine.getByTestId('atlas-cell')).toHaveCount(4);
  await expect(engine.getByTestId('atlas-group').first()).toBeVisible();
  await expect(engine.locator('[data-testid="atlas-service"][data-condition="gap"]')).toContainText('Falta');
  await expect(engine.locator('[data-testid="atlas-service"][data-condition="gap"]')).toHaveClass(/atlas-hatch-loud/);
  const missing = engine.locator('[data-testid="atlas-cell"][data-empty]');
  await expect(missing).toHaveCount(1); // Globex has no staging
  await expect(missing).toContainText('Não existe');
  await expect(engine.getByTestId('atlas-service').first()).toContainText('abc1234');
  await expect(engine.locator('[data-testid="atlas-collector"][data-connected="false"]')).toContainText('não conectado');
  await expect(engine.getByTestId('atlas-external')).toContainText('Usado por: Acme · API, Globex · Portal');
  await expect(engine.getByLabel('Legenda')).toContainText('Fora do ar');
  await expectNoSidewaysScroll(page);
});

test('the map draws one node per system and opens them into services up close', async ({ page }) => {
  await serve(page, FULL);
  await page.goto('/atlas?view=map');
  const map = page.getByTestId('atlas-map');
  await expect(map.getByTestId('atlas-node-system')).toHaveCount(2);
  await expect(map.locator('.react-flow__edge').first()).toBeAttached();
  await expectNoSidewaysScroll(page);

  const zoomIn = map.getByRole('button', { name: /zoom in/i });
  for (let i = 0; i < 6 && (await map.getByTestId('atlas-node-service').count()) < 7; i++) await zoomIn.click();
  await expect(map.getByTestId('atlas-node-service')).toHaveCount(7);
  // The service an agent is working on pulses; so does the edge that leaves it.
  // What something is happening to pulses: the service an agent works on, and the one that is down.
  await expect(map.locator('[data-testid="atlas-node-service"].atlas-live')).toHaveCount(2);
  // An edge moves only where work is passing: the ones leaving the service being worked on.
  await expect(map.locator('.react-flow__edge.animated')).toHaveCount(2); // both links leaving that service
});

test('flows show a number at each step and a gap where there is none', async ({ page }) => {
  await serve(page, FULL);
  await page.goto('/atlas?view=flows');
  const flows = page.getByTestId('atlas-flows');
  await expect(flows.getByTestId('atlas-step')).toHaveCount(24);
  const gaps = flows.locator('[data-testid="atlas-step"][data-gap]');
  await expect(gaps).toHaveCount(2);
  await expect(gaps.first()).toContainText('Rede social');
  await expect(gaps.first()).toContainText('Lacuna');
  await expect(flows).toContainText('2 com falha');
  await expectNoSidewaysScroll(page);
});

test('routines list what ran and what it produced, and discovery offers to register', async ({ page }) => {
  const posts = await serve(page, FULL);
  await page.goto('/atlas?view=routines');
  const routines = page.getByTestId('atlas-routine');
  await expect(routines).toHaveCount(2);
  await expect(routines.first()).toContainText('Triagem de erros');
  await expect(routines.first()).toContainText('Concluída');
  await expect(routines.first().getByRole('link', { name: 'Corrige o frete' })).toBeVisible();
  await expect(routines.nth(1)).toContainText('Nunca rodou');
  await routines.first().getByRole('button', { name: 'Histórico' }).click();
  await expect(routines.first()).toContainText('2 erros novos');
  await expectNoSidewaysScroll(page);

  await page.getByRole('button', { name: /Descoberta/ }).click();
  const found = page.getByTestId('atlas-discovery');
  await expect(found).toContainText('globex/worker');
  await found.getByRole('button', { name: 'Cadastrar' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Nome')).toHaveValue('worker');
  await dialog.getByLabel('Sistema').selectOption('globex');
  await dialog.getByRole('button', { name: 'Cadastrar' }).click();
  await expect.poll(() => posts.find((p) => p.path === '/atlas/discoveries/d1/register')?.body)
    .toMatchObject({ system: 'globex', environment: 'production', name: 'worker' });
});

test('the screen reads in English when asked', async ({ page }) => {
  await serve(page, FULL);
  await page.goto('/atlas');
  await expect(page.getByTestId('atlas-now')).toContainText('Agora');
  await page.getByRole('button', { name: 'en', exact: true }).click();
  await expect(page.getByTestId('atlas-now')).toContainText('Now');
  await expect(page.getByTestId('atlas-system').first()).toContainText('1 down');
  await expect(page.getByRole('button', { name: 'Engine' })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('atlas-system').first()).toContainText('1 down'); // the choice is kept
});

test('Pede atenção lists gaps and warnings by impact, with owner and task', async ({ page }) => {
  await serve(page, FULL);
  await page.goto('/atlas?view=attention');
  const list = page.getByTestId('atlas-attention');
  const groups = list.locator('section[data-impact]');
  await expect(groups).toHaveCount(3);
  expect(await groups.evaluateAll((els) => els.map((e) => e.getAttribute('data-impact')))).toEqual(['high', 'medium', 'none']);
  const items = list.getByTestId('atlas-attention-item');
  await expect(items).toHaveCount(5);
  await expect(items.first()).toContainText('Lacuna');
  await expect(items.first()).toContainText('App');
  await expect(items.first()).toContainText('Acme');
  await expect(items.first()).toContainText('Na loja');
  await expect(items.first()).toContainText('Você');
  await expect(items.first().getByRole('link', { name: /T-7K2QM/ })).toHaveAttribute('href', '/tasks?task=T-7K2QM');
  await expect(items.nth(1)).toContainText('Próximo passo: Ligar o assistente.');
  await expect(items.nth(1)).toContainText('Juntos');
  await expect(items.nth(3)).toContainText('Aviso');
  await expect(page.getByRole('button', { name: /Pede atenção/ })).toContainText('5');
  await expectNoSidewaysScroll(page);
  await items.first().getByRole('button', { name: 'App' }).click();
  await expect(page.getByTestId('atlas-service-drawer')).toContainText('Ainda não publicado.');
});

test('Pede atenção says so when nothing is declared', async ({ page }) => {
  await serve(page, FULL);
  await page.route('**/v1/staff/atlas/attention', (r) => r.fulfill({ json: [] }));
  await page.goto('/atlas?view=attention');
  await expect(page.getByTestId('atlas-attention-empty')).toContainText('Nada declarado como lacuna.');
});

test('processes show a row of steps, or a system by stage matrix, and a step opens its drawer', async ({ page }) => {
  await serve(page, FULL);
  await page.goto('/atlas?view=processes');
  const row = page.locator('[data-testid="atlas-process"][data-layout="row"]');
  await expect(row.getByTestId('atlas-process-step')).toHaveCount(5);
  expect(await row.getByTestId('atlas-process-step').evaluateAll((els) => els.map((e) => e.getAttribute('data-status')))).toEqual(['ok', 'warn', 'gap', 'next', 'idea']);
  const matrix = page.locator('[data-testid="atlas-process"][data-layout="matrix"]');
  await expect(matrix.getByTestId('atlas-process-cell')).toHaveCount(4);
  await expect(matrix.locator('[data-testid="atlas-process-cell"][data-empty]')).toHaveCount(1); // Globex has no revenue step
  await expectNoSidewaysScroll(page);

  await page.getByLabel('Filtrar por sistema').selectOption('globex');
  await expect(page.getByTestId('atlas-process')).toHaveCount(1);
  await expect(matrix.getByTestId('atlas-process-step')).toHaveCount(1);
  await page.getByLabel('Filtrar por sistema').selectOption('');

  await row.getByTestId('atlas-process-step').nth(2).click();
  const drawer = page.getByTestId('atlas-step-drawer');
  await expect(drawer).toContainText('Responder');
  await expect(drawer).toContainText('Manual.');
  await expect(drawer).toContainText('Resposta assistida.');
  await expect(drawer).toContainText('Ligar o assistente.');
  await expect(drawer).toContainText('Juntos');
  await expect(drawer).toContainText('Impacto alto');
  await expect(drawer.getByRole('link', { name: /T-AAAAA/ })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /API/ })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /CDN/ })).toBeVisible();
  await expectNoSidewaysScroll(page);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});

test('a service opens with its facts, items and links', async ({ page }) => {
  await serve(page, FULL);
  await page.goto('/atlas?view=engine');
  await page.getByTestId('atlas-engine').getByRole('button', { name: /Detalhes do serviço: API/ }).nth(1).click();
  const drawer = page.getByTestId('atlas-service-drawer');
  await expect(drawer.getByTestId('atlas-facts')).toContainText('Health');
  await expect(drawer.getByTestId('atlas-facts')).toContainText('/health');
  await expect(drawer.getByTestId('atlas-facts')).toContainText('1 GB');
  await expect(drawer.getByTestId('atlas-items')).toContainText('Pagamentos');
  await expect(drawer.getByTestId('atlas-links-out')).toContainText('CDN');
  await expect(drawer.getByTestId('atlas-links-out')).toContainText('Hospedagem');
  await expect(drawer.getByTestId('atlas-links-out')).toContainText('planejada');
  await expectNoSidewaysScroll(page);
});

test('suppliers cross provider and system, shared services in their own column', async ({ page }) => {
  await serve(page, FULL);
  await page.goto('/atlas?view=suppliers');
  const grid = page.getByTestId('atlas-suppliers');
  const railway = grid.locator('[data-provider="railway"]');
  await expect(railway.getByTestId('atlas-supplier-cell')).toHaveCount(3); 
  await expect(railway.getByTestId('atlas-supplier-cell').first()).toHaveAttribute('data-count', '3');
  await expect(railway.getByTestId('atlas-supplier-cell').first()).toContainText('3 serviços');
  await expect(grid.locator('[data-provider="cdn"] [data-count="1"]')).toContainText('CDN');
  await expect(grid).toContainText('Compartilhado');
  await expectNoSidewaysScroll(page);
});

test('the map has a legend for the link kinds', async ({ page }) => {
  await serve(page, FULL);
  await page.goto('/atlas?view=map');
  await expect(page.getByTestId('atlas-map-legend')).toContainText('Hospedagem');
  await expect(page.getByTestId('atlas-map-legend')).toContainText('Planejada');
  await expectNoSidewaysScroll(page);
});
