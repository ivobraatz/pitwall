import { expect, test, type Page } from '@playwright/test';

/*
 * The node drawer, the evolution panel and the integration, in a real browser, desktop and phone.
 * Every name is made up (Acme, Globex). The API is answered by the test; the writes are recorded
 * so the test can check the endpoint and the body of each one.
 */

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const ACME = '11111111-1111-4111-8111-111111111111';
const GLOBEX = '22222222-2222-4222-8222-222222222222';
const STAGING = 'e0000000-0000-4000-8000-000000000001';
const PRODUCTION = 'e0000000-0000-4000-8000-000000000002';
const id = (n: number) => `50000000-0000-4000-8000-00000000000${n}`;
const API = id(1);
const WEB = id(2);
const BANCO = id(3);
const LEGADO = id(4);
const PORTAL = id(5);
const SEGREDO = id(6);
const FILA = id(8);

const ref = { id: ACME, slug: 'acme', name: 'Acme', color: '#5eb0ff' };
const refG = { id: GLOBEX, slug: 'globex', name: 'Globex', color: '#34d08c' };
const counts = { failure: 0, security: 0, task: 0, improvement: 0, config: 0, unverified: 0 };

/** A node as the graph carries it: defaults for an Acme service, overridden per case. */
function node(nodeId: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id: nodeId, key: `acme:production:${name.toLowerCase()}`, type: 'service', name, kind: 'api', engine: 'app', group: 'Núcleo',
    productId: ACME, environmentId: PRODUCTION, environment: 'production', shared: false, provider: 'railway', url: null, signature: null,
    state: 'up', condition: 'ok', origin: 'discovered', verification: 'declared', codeScope: null, verifiedAt: null, verifiedBy: null,
    checkedAt: ago(4), attention: counts, activity: { running: false, kind: null, since: null }, lastEvent: null,
    retiredAt: null, removalReportedAt: null, missingSince: null, createdAt: ago(9000), updatedAt: ago(10), ...over,
  };
}
const NODES = [
  node(API, 'API', { verification: 'verified', verifiedBy: 'railway', verifiedAt: ago(12), codeScope: 'deployed', attention: { ...counts, task: 1 } }),
  node(WEB, 'Web', { kind: 'web', origin: 'reported', verification: 'found_in_code', codeScope: 'local', state: 'down' }),
  node(BANCO, 'Banco', { kind: 'database', removalReportedAt: ago(30), verification: 'not_found' }),
  node(LEGADO, 'Legado', { kind: 'worker', retiredAt: ago(200), state: 'unknown' }),
  node(SEGREDO, 'STRIPE_SECRET_KEY', { kind: 'credential', engine: 'security', environmentId: null, environment: null, origin: 'declared', verification: 'declared' }),
  node(PORTAL, 'Portal', { productId: GLOBEX, environmentId: null, environment: null, origin: 'declared', verification: 'declared', state: 'down' }),
  node(FILA, 'Fila de pedidos', { kind: 'queue', engine: 'app', origin: 'discovered', verification: 'declared' }),
];

const refOf = (n: { id: string; name: string; kind: string; engine: string; productId: string | null; state: string }) => ({
  id: n.id, key: `k:${n.name}`, name: n.name, kind: n.kind, engine: n.engine, productId: n.productId, state: n.state,
});
const edge = (eid: string, from: string, to: string, relation: string, planned = false) => ({
  id: eid, from, to, relation, category: 'infra', label: null, planned, origin: 'declared', verifiedAt: null, retiredAt: null,
});

function detail(nodeId: string) {
  const n = NODES.find((x) => x.id === nodeId);
  if (!n) return null;
  const base = {
    node: {
      ...n, notes: nodeId === API ? 'Serviço principal da operação.' : null,
      facts: nodeId === SEGREDO ? [{ key: 'Valor', value: 'nunca guardado no Atlas' }] : [{ key: 'Health', value: '/health' }],
      items: nodeId === API ? ['Pagamentos'] : [], externalRef: null, monitor: null, aliases: [], owner: null, impact: null,
      deployStatus: 'success', monitorStatus: null, lastDeployAt: ago(90), commitSha: 'abc1234def5678', stack: nodeId === API ? [{ key: 'runtime', value: 'Node 22' }] : [],
    },
    system: n.productId === ACME ? ref : refG,
    incoming: nodeId === API ? [{ edge: edge('e1', WEB, API, 'calls'), node: refOf(NODES[1]) }] : [],
    outgoing: nodeId === API ? [
      { edge: edge('e2', API, BANCO, 'writes_to'), node: refOf(NODES[2]) },
      { edge: edge('e3', API, SEGREDO, 'uses_credential_ref'), node: refOf(NODES[4]) },
    ] : [],
    impact: nodeId === API ? { direct: [refOf(NODES[1])], indirect: [refOf(NODES[5])], systems: [refG] } : { direct: [], indirect: [], systems: [] },
    evidence: nodeId === API ? [
      { id: 'ev1', source: 'repo:acme-inc/rockets', method: 'manifest', ref: 'package.json#dependencies.stripe', detail: null, relation: 'calls', scope: 'pushed', commitSha: 'abc1234', firstSeenAt: ago(900), lastSeenAt: ago(5), goneAt: null },
      { id: 'ev2', source: 'collector:railway', method: 'api', ref: 'railway:acme/api@production', detail: null, relation: null, scope: 'runtime', commitSha: null, firstSeenAt: ago(900), lastSeenAt: ago(12), goneAt: null },
      { id: 'ev3', source: 'repo:acme-inc/rockets', method: 'env-example', ref: '.env.example#WEBHOOK_SECRET', detail: null, relation: null, scope: 'local', commitSha: null, firstSeenAt: ago(900), lastSeenAt: ago(300), goneAt: ago(60) },
    ] : [],
    refs: nodeId === API ? [
      { id: 'rf1', kind: 'task', code: 'T-7K2QM', note: null, title: 'Revisar o cálculo do frete', status: 'doing', class: 'failure', via: 'ref' },
      { id: null, kind: 'task', code: 'T-AAAAA', note: null, title: 'Dashboard de pedidos', status: 'todo', class: 'improvement', via: 'label' },
    ] : [],
    events: nodeId === API ? [{ id: 'evt1', at: ago(40), source: 'railway', type: 'deploy.succeeded', status: 'succeeded', title: 'Deploy em produção', url: null, commitSha: null, detail: null, productId: ACME, serviceId: API, repoId: null }] : [],
    changes: nodeId === API ? [{ id: 'chg1', at: ago(50), actor: 'Ana (Claude)', source: 'mcp', changeSetId: null, entityType: 'service', entityId: API, productId: ACME, op: 'updated', fields: [{ field: 'condition', before: 'ok', after: 'warn' }], summary: null }] : [],
    repos: nodeId === API ? [{ id: 'r1', fullName: 'acme-inc/rockets', role: 'backend', lastRunStatus: 'success', lastRunAt: ago(50), lastRunUrl: null, lastSyncAt: ago(20) }] : [],
    processes: [],
    changeSets: [],
    providerUrl: nodeId === API ? 'https://railway.com/dashboard' : null,
  };
  return base;
}

const SYNC = { changeSetId: 'cs1', status: 'applied', replayed: false, created: ['Fila de pedidos', 'Cache'], updated: ['API'], unchanged: 4, gone: [], removalsReported: [], rejected: [], attention: [] };
const GITHUB = [
  { fullName: 'acme-inc/rockets', private: true, archived: false, defaultBranch: 'main', url: 'https://git.example.com/acme-inc/rockets', registered: false, repoId: null, system: null, role: null },
  { fullName: 'globex-corp/portal', private: false, archived: false, defaultBranch: 'main', url: 'https://git.example.com/globex-corp/portal', registered: true, repoId: 'r2', system: refG, role: 'frontend' },
];
const SOURCES = [
  { name: 'railway', connected: true, lastRunAt: ago(4), lastOkAt: ago(4), lastError: null, itemsSeen: 3, stale: false },
  { name: 'github', connected: true, lastRunAt: ago(4), lastOkAt: ago(4), lastError: null, itemsSeen: 2, stale: false },
];
const GRAPH = {
  serverTime: ago(0), scope: { system: ref, environment: null }, engines: [],
  nodes: NODES.filter((n) => n.productId === ACME || n.id === PORTAL), edges: [edge('e1', WEB, API, 'calls'), edge('e2', API, BANCO, 'writes_to')],
  sources: SOURCES, coverage: {
    percent: 57, checks: [
      { key: 'repo_linked', ok: true, applicable: true, label: '' }, { key: 'repo_synced', ok: true, applicable: true, label: '' },
      { key: 'hosting_verified', ok: true, applicable: true, label: '' }, { key: 'monitoring', ok: false, applicable: true, label: '' },
      { key: 'backup', ok: false, applicable: false, label: '' }, { key: 'domain', ok: false, applicable: true, label: '' },
      { key: 'engines', ok: false, applicable: true, label: '' },
    ],
  },
};
const DIFF = {
  from: { at: ago(10080), snapshotId: 's1' }, to: { at: ago(0), snapshotId: null },
  nodes: {
    added: [refOf(NODES[6])],
    removed: [refOf(NODES[3])],
    changed: [{ node: refOf(NODES[1]), fields: [{ field: 'state', before: 'up', after: 'down' }] }],
  },
  edges: { added: [{ from: API, to: WEB, relation: 'calls' }], removed: [{ from: BANCO, to: LEGADO, relation: 'depends_on' }] },
};
const CHANGES = [
  { id: 'c1', at: ago(20), actor: 'Ana (Claude)', source: 'mcp', changeSetId: null, entityType: 'service', entityId: WEB, productId: ACME, op: 'updated', fields: [{ field: 'state', before: 'up', after: 'down' }], summary: 'Web caiu' },
  { id: 'c2', at: ago(300), actor: 'Sistema', source: 'collector', changeSetId: null, entityType: 'service', entityId: FILA, productId: ACME, op: 'created', fields: [], summary: 'Fila de pedidos encontrada' },
];
const ATLAS = {
  serverTime: ago(0),
  systems: [
    { id: ACME, slug: 'acme', name: 'Acme', color: '#5eb0ff', description: null, websiteUrl: null, health: { total: 3, up: 2, down: 1, degraded: 0, deploying: 0, unknown: 0 }, pending: { tasks: 0, tickets: 0, errors: 0, alerts: 0 }, attention: { gaps: 0, warnings: 0 } },
    { id: GLOBEX, slug: 'globex', name: 'Globex', color: '#34d08c', description: null, websiteUrl: null, health: { total: 1, up: 0, down: 1, degraded: 0, deploying: 0, unknown: 0 }, pending: { tasks: 0, tickets: 0, errors: 0, alerts: null }, attention: { gaps: 0, warnings: 0 } },
  ],
  environments: [{ id: STAGING, slug: 'staging', name: 'Staging' }, { id: PRODUCTION, slug: 'production', name: 'Produção' }],
  services: [],
  links: [],
  repos: [
    { id: 'r1', productId: ACME, fullName: 'acme-inc/rockets', lastRunName: 'CI', lastRunStatus: 'success', lastRunAt: ago(50), lastRunUrl: null, lastRunSha: 'abc1234', commits7d: 14, runs7d: 20, failedRuns7d: 0, openAlerts: 0, checkedAt: ago(5) },
    { id: 'r2', productId: GLOBEX, fullName: 'globex-corp/portal', lastRunName: 'CI', lastRunStatus: 'failure', lastRunAt: ago(30), lastRunUrl: null, lastRunSha: 'fff9999', commits7d: 3, runs7d: 6, failedRuns7d: 2, openAlerts: null, checkedAt: ago(5) },
  ],
  collectors: [{ name: 'railway', connected: true, lastRunAt: ago(4), error: null }],
  now: [],
  discoveries: [],
};
const product = (pid: string, slug: string, name: string, color: string) => ({
  id: pid, slug, name, description: null, websiteUrl: null, color, logoUrl: null, owner: null, webhookUrl: null, hasWebhookSecret: false,
  settings: { teamName: null, ownFramePrefixes: [], autoPublishReleases: true, locales: ['pt', 'en'], retroactiveRecording: true, customerTicketUrl: null },
  createdAt: ago(9000), updatedAt: ago(9000), disabledAt: null,
});

type Write = { method: string; path: string; body: unknown };

/** Answers the API by path. Writes are recorded; a 409 from GitHub is the "not connected" answer. */
async function serve(page: Page, opts: { github?: 'on' | 'off' } = {}) {
  const writes: Write[] = [];
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/v1/staff', '');
    if (request.method() !== 'GET') {
      writes.push({ method: request.method(), path, body: request.postDataJSON() });
      return route.fulfill({ json: /\/repos\/[^/]+\/scan$/.test(path) ? SYNC : {} });
    }
    const nodeMatch = path.match(/^\/atlas\/nodes\/(.+)$/);
    if (nodeMatch) {
      const d = detail(nodeMatch[1]);
      return d ? route.fulfill({ json: d }) : route.fulfill({ status: 404, json: { message: 'not mocked' } });
    }
    if (path === '/atlas/github/repos') {
      if (opts.github === 'off') return route.fulfill({ status: 409, json: { message: 'Conecte o GitHub para listar os repositórios (veja Integração).' } });
      return route.fulfill({ json: GITHUB });
    }
    const answers: Record<string, unknown> = {
      '/auth/me': { id: 's1', name: 'Ana Souza', email: 'ana@pitwall.test', role: 'admin', totpEnabled: true, mustChangePassword: false, totpRequired: false },
      '/summary': { byStatus: {}, open: 0, unanswered: 0, openedThisWeek: 0, medianFirstResponseMinutes: null, topSignatures: [], products: [], series: [] },
      '/products': [product(ACME, 'acme', 'Acme', '#5eb0ff'), product(GLOBEX, 'globex', 'Globex', '#34d08c')],
      '/atlas': ATLAS,
      '/atlas/graph': GRAPH,
      '/atlas/sources': SOURCES,
      '/atlas/diff': DIFF,
      '/atlas/changes': CHANGES,
      '/atlas/routines': [],
      '/atlas/flows': [],
      '/atlas/processes': [],
      '/atlas/attention': [],
    };
    return path in answers ? route.fulfill({ json: answers[path] }) : route.fulfill({ status: 404, json: { message: 'not mocked' } });
  });
  return writes;
}

/** The page never scrolls sideways: wide things scroll inside their own box. */
async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => Math.max(
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    (document.querySelector('main') ?? document.body).scrollWidth - (document.querySelector('main') ?? document.body).clientWidth,
  ));
  expect(overflow).toBeLessThanOrEqual(1);
}

/** The drawer sits at the right on a desktop and as a sheet from the bottom on a phone. */
async function expectDrawerShape(page: Page) {
  const box = await page.getByTestId('atlas-node-drawer').boundingBox();
  const view = page.viewportSize()!;
  expect(box).not.toBeNull();
  if (test.info().project.name === 'mobile') {
    expect(box!.width).toBeGreaterThan(view.width - 2);
    expect(box!.y + box!.height).toBeGreaterThan(view.height - 2);
  } else {
    expect(box!.x + box!.width).toBeGreaterThan(view.width - 40);
    expect(box!.width).toBeLessThan(view.width / 2);
  }
}

/** Opens the drawer of one node from the validation step, the way a person does. */
async function openNode(page: Page, name: string) {
  await page.goto('/atlas/onboarding?step=6&system=acme');
  await page.getByTestId('onboarding-node').filter({ hasText: name }).first().click();
  await expect(page.getByTestId('atlas-node-drawer')).toBeVisible();
}

test('the drawer shows verification, dependencies, impact, scoped evidence, linked tasks and history', async ({ page }) => {
  await serve(page);
  await openNode(page, 'API');
  const drawer = page.getByTestId('atlas-node-drawer');
  await expect(drawer.getByRole('heading', { level: 2 })).toHaveText('API');
  await expect(page.getByTestId('atlas-node-verification')).toContainText('Verificado pela railway');
  await expect(page.getByTestId('atlas-node-verification')).toHaveText(/Verificado pela railway há \d+ minutos/);
  await expect(drawer.getByTestId('atlas-deps-in')).toContainText('Web');
  await expect(drawer.getByTestId('atlas-deps-out')).toContainText('Banco');
  await expect(drawer.getByTestId('atlas-deps-out')).toContainText('STRIPE_SECRET_KEY');
  await expect(drawer.getByTestId('atlas-impact')).toContainText('Diretos');
  await expect(drawer.getByTestId('atlas-impact')).toContainText('Globex');

  const evidence = drawer.getByTestId('atlas-evidence').locator('li');
  await expect(evidence).toHaveCount(3);
  await expect(evidence.nth(0)).toHaveAttribute('data-scope', 'pushed');
  await expect(evidence.nth(0)).toContainText('No remoto');
  await expect(evidence.nth(1)).toContainText('Visto pelo provedor');
  await expect(evidence.nth(2)).toHaveAttribute('data-gone', 'true');
  await expect(evidence.nth(2)).toContainText('sumiu em');

  const refs = drawer.getByTestId('atlas-refs').locator('li');
  await expect(refs.nth(0)).toHaveAttribute('data-class', 'failure');
  await expect(refs.nth(0)).toContainText('Falha');
  await expect(refs.nth(0).getByRole('link', { name: 'T-7K2QM' })).toHaveAttribute('href', '/tasks?task=T-7K2QM');
  await expect(refs.nth(1)).toHaveAttribute('data-class', 'improvement');
  await expect(refs.nth(1)).toContainText('pela etiqueta');

  await drawer.getByTestId('atlas-node-sec-changes').locator('summary').click();
  await expect(drawer.getByTestId('atlas-changes')).toContainText('Alterado');
  await expect(drawer.getByTestId('atlas-changes')).toContainText('warn');
  await expectDrawerShape(page);
  await expectNoSidewaysScroll(page);
});

test('a dependency opens its own node, and a credential shows only that it is not stored', async ({ page }) => {
  await serve(page);
  await openNode(page, 'API');
  const drawer = page.getByTestId('atlas-node-drawer');
  await drawer.getByTestId('atlas-deps-out').getByRole('button', { name: /Banco/ }).click();
  await expect(drawer.getByRole('heading', { level: 2 })).toHaveText('Banco');
  await expect(drawer.getByTestId('atlas-node-verification')).toContainText('Remoção relatada');
  await openNode(page, 'API');
  await drawer.getByTestId('atlas-deps-out').getByRole('button', { name: /STRIPE_SECRET_KEY/ }).click();
  await expect(drawer.getByRole('heading', { level: 2 })).toHaveText('STRIPE_SECRET_KEY');
  await expect(drawer.getByTestId('atlas-node-facts')).toContainText('nunca guardado no Atlas');
  await expect(page.locator('body')).not.toContainText(/sk_live_/);
  await expectNoSidewaysScroll(page);
});

test('the drawer is closed by Escape and by its button, and Escape leaves a dialog first', async ({ page }) => {
  await serve(page);
  await openNode(page, 'API');
  await page.getByRole('button', { name: 'Renomear' }).click();
  await expect(page.getByRole('dialog', { name: 'Renomear o nó' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Renomear o nó' })).toHaveCount(0);
  await expect(page.getByTestId('atlas-node-drawer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('atlas-node-drawer')).toHaveCount(0);

  await openNode(page, 'API');
  await page.getByRole('button', { name: 'Fechar' }).click();
  await expect(page.getByTestId('atlas-node-drawer')).toHaveCount(0);
});

test('renaming calls the rename endpoint with the new name, not the browser prompt', async ({ page }) => {
  const writes = await serve(page);
  await openNode(page, 'API');
  await page.getByRole('button', { name: 'Renomear' }).click();
  const dialog = page.getByRole('dialog', { name: 'Renomear o nó' });
  await dialog.getByLabel('Novo nome').fill('Gateway');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect.poll(() => writes.find((w) => w.path === `/atlas/services/${API}/rename`)?.body).toEqual({ name: 'Gateway' });
  await expect(dialog).toHaveCount(0);
});

test('a node with a reported removal asks for confirmation, and a retired one can be restored', async ({ page }) => {
  const writes = await serve(page);
  await openNode(page, 'Banco');
  const drawer = page.getByTestId('atlas-node-drawer');
  await expect(drawer).toContainText('Relatado como removido');
  await drawer.getByRole('button', { name: 'Confirmar remoção' }).click();
  await expect.poll(() => writes.find((w) => w.path === `/atlas/services/${BANCO}/confirm-removal`)).toBeDefined();

  await openNode(page, 'Legado');
  await expect(page.getByTestId('atlas-node-drawer')).toContainText('Retirado');
  await expect(page.getByTestId('atlas-node-drawer').getByRole('button', { name: 'Restaurar' })).toBeVisible();
  await expect(page.getByTestId('atlas-node-drawer').getByRole('button', { name: 'Renomear' })).toHaveCount(0);
  await page.getByTestId('atlas-node-drawer').getByRole('button', { name: 'Restaurar' }).click();
  await expect.poll(() => writes.find((w) => w.path === `/atlas/services/${LEGADO}/restore`)).toBeDefined();
});

test('retiring asks in its own dialog and deletes the node', async ({ page }) => {
  const writes = await serve(page);
  await openNode(page, 'API');
  await page.getByTestId('atlas-node-drawer').getByRole('button', { name: 'Retirar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Retirar este nó?' });
  await expect(dialog).toContainText('O histórico fica');
  await dialog.getByRole('button', { name: 'Retirar' }).click();
  await expect.poll(() => writes.find((w) => w.method === 'DELETE' && w.path === `/atlas/services/${API}`)).toBeDefined();
});

test('linking a task takes a T-XXXXX code and posts it as a task reference', async ({ page }) => {
  const writes = await serve(page);
  await openNode(page, 'Web');
  await page.getByRole('button', { name: 'Vincular tarefa' }).click();
  const dialog = page.getByRole('dialog', { name: 'Vincular tarefa' });
  await dialog.getByLabel('Código da tarefa').fill('nope');
  await expect(dialog.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  await dialog.getByLabel('Código da tarefa').fill('t-9xq4m');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect.poll(() => writes.find((w) => w.path === `/atlas/services/${WEB}/refs`)?.body).toEqual({ kind: 'task', code: 'T-9XQ4M' });
});

test('the evolution lists what was added, changed and removed, and each name opens its node', async ({ page }) => {
  await serve(page);
  await page.goto('/atlas/onboarding?step=7&system=acme');
  await expect(page.getByTestId('onboarding-coverage-checks')).toContainText('Repositório associado');
  const evolution = page.getByTestId('atlas-evolution');
  await expect(evolution.getByTestId('atlas-evolution-added')).toContainText('Fila de pedidos');
  await expect(evolution.getByTestId('atlas-evolution-changed')).toContainText('Web');
  await expect(evolution.getByTestId('atlas-evolution-changed')).toContainText('up');
  await expect(evolution.getByTestId('atlas-evolution-changed')).toContainText('down');
  await expect(evolution.getByTestId('atlas-evolution-removed')).toContainText('Legado');
  await expect(evolution.getByTestId('atlas-evolution-edges-added')).toContainText('API');
  await expect(evolution.getByTestId('atlas-evolution-timeline').locator('li')).toHaveCount(2);
  await expect(evolution.getByTestId('atlas-evolution-timeline')).toContainText('por Ana (Claude)');
  await expect(evolution.getByTestId('atlas-evolution-timeline')).toContainText('fonte: agente (MCP)');
  await expectNoSidewaysScroll(page);

  await evolution.getByTestId('atlas-evolution-changed').getByRole('button', { name: /Web/ }).click();
  await expect(page.getByTestId('atlas-node-drawer').getByRole('heading', { level: 2 })).toHaveText('Web');
});

test('when nothing changed, the evolution says so in words', async ({ page }) => {
  await serve(page);
  await page.route('**/v1/staff/atlas/diff*', (r) => r.fulfill({ json: { ...DIFF, nodes: { added: [], removed: [], changed: [] }, edges: { added: [], removed: [] } } }));
  await page.route('**/v1/staff/atlas/changes*', (r) => r.fulfill({ json: [] }));
  await page.goto('/atlas/onboarding?step=7&system=acme');
  await expect(page.getByTestId('atlas-evolution-empty')).toContainText('Nada mudou desde');
});

test('the onboarding walks through the eight steps with GitHub connected', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const writes = await serve(page);
  await page.goto('/atlas/onboarding');
  await expect(page.getByTestId('onboarding-stepper').getByRole('button')).toHaveCount(8);

  // 1 · the system
  await expect(page.getByTestId('onboarding-system')).toHaveCount(2);
  await page.locator('[data-testid="onboarding-system"][data-slug="acme"]').click();
  await expect(page).toHaveURL(/system=acme/);
  await page.getByRole('button', { name: 'Próximo passo' }).click();

  // 2 · the repositories
  await expect(page).toHaveURL(/step=2/);
  await page.locator('[data-full-name="acme-inc/rockets"]').getByRole('button', { name: 'Associar ao sistema' }).click();
  await expect.poll(() => writes.find((w) => w.path === '/atlas/repos')?.body).toEqual({ fullName: 'acme-inc/rockets', system: 'acme' });
  await expect(page.getByTestId('onboarding-repo').filter({ hasText: 'globex-corp/portal' })).toContainText('Já associado');
  await page.getByRole('button', { name: 'Próximo passo' }).click();

  // 3 · the environments
  await expect(page.getByTestId('onboarding-envs')).toContainText('Produção');
  await page.getByRole('button', { name: 'Próximo passo' }).click();

  // 4 · the sources
  await expect(page.locator('[data-source="railway"]')).toHaveAttribute('data-connected', 'true');
  await expect(page.locator('[data-source="kuma"]')).toHaveAttribute('data-connected', 'false');
  await expect(page.locator('[data-source="kuma"]')).toContainText('Como conectar');
  await page.getByRole('button', { name: 'Próximo passo' }).click();

  // 5 · the discovery
  await page.locator('[data-repo="acme-inc/rockets"]').getByRole('button', { name: 'Escanear' }).click();
  await expect(page.getByTestId('onboarding-scan-result')).toContainText('Pronto: 2 criados, 1 atualizados, 0 sumiram do código.');
  await expect.poll(() => writes.some((w) => w.path === '/atlas/repos/r1/scan')).toBe(true);
  await page.getByRole('button', { name: 'Próximo passo' }).click();

  // 6 · the validation: confirm what is real
  const api = page.locator(`[data-node-id="${API}"]`);
  await expect(api).toBeVisible();
  await expect(page.locator(`[data-node-id="${LEGADO}"]`)).toContainText('Retirado');
  await api.getByRole('button', { name: 'Confirmar' }).click();
  await expect.poll(() => writes.find((w) => w.path === '/atlas/services')?.body).toEqual(
    { system: 'acme', environment: 'production', name: 'API', kind: 'api', origin: 'declared' },
  );
  await page.getByRole('button', { name: 'Próximo passo' }).click();

  // 7 · the map and the coverage
  await expect(page.getByTestId('onboarding-coverage').first()).toContainText('57%');
  await expect(page.getByTestId('onboarding-coverage-checks')).toContainText('Monitoramento');
  await page.getByRole('button', { name: 'Próximo passo' }).click();

  // 8 · the agents: commands with placeholders only, and a copy button
  await expect(page.getByTestId('onboarding-current')).toHaveAttribute('data-step', '8');
  await expect(page.getByRole('button', { name: 'Próximo passo' })).toHaveCount(0);
  await expect(page.locator('pre').first()).toContainText('npx -y -p pitwall-mcp pitwall-atlas login');
  await expect(page.locator('pre').first()).toContainText('<token-de-pessoa>');
  await expect(page.locator('pre').nth(2)).toContainText('system: acme');
  await expect(page.locator('pre').nth(2)).toContainText('${{ secrets.PITWALL_ATLAS_TOKEN }}');
  await expect(page.locator('body')).not.toContainText(/sk_live_|ghp_|pwt_/);
  await page.locator('pre').first().locator('xpath=..').getByRole('button', { name: 'Copiar' }).click();
  await expect(page.locator('pre').first().locator('xpath=..').getByRole('button', { name: 'Copiado' })).toBeVisible();
  await expectNoSidewaysScroll(page);
});

test('without GitHub connected, the repositories step says how to connect it', async ({ page }) => {
  await serve(page, { github: 'off' });
  await page.goto('/atlas/onboarding?step=2&system=acme');
  const notice = page.getByTestId('onboarding-github-off');
  await expect(notice).toContainText('Conecte o GitHub');
  await expect(page.getByTestId('onboarding')).toContainText('ATLAS_GITHUB_TOKEN');
  await expectNoSidewaysScroll(page);
});
