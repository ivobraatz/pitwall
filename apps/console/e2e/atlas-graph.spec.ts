import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Engine } from '../lib/atlas-graph';
import { GROUP_LABEL_H, layoutEngines, planCompanyRoutes } from '../lib/atlas-layout';

/*
 * The Atlas map in a real browser, desktop and phone: company, product, filters, selection, modes and
 * size. Every name is made up (Acme, Globex, Stripe as a stand-in); the answers are fixed here.
 */

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const ACME = '11111111-1111-4111-8111-111111111111';
const GLOBEX = '22222222-2222-4222-8222-222222222222';
const SYNTH = '33333333-3333-4333-8333-333333333333';
const ref = { id: ACME, slug: 'acme', name: 'Acme', color: null };

const ENGINES: Engine[] = ['code', 'delivery', 'infra', 'app', 'automation', 'business', 'marketing', 'monitoring', 'security'];
const ZERO = { failure: 0, security: 0, task: 0, improvement: 0, config: 0, unverified: 0 };

type Overrides = Record<string, unknown>;
const gnode = (id: string, name: string, engine: Engine, over: Overrides = {}) => ({
  id, key: `acme:any:${id}`, type: 'service', name, kind: 'api', engine, group: null,
  productId: ACME, environmentId: null, environment: null, shared: false, provider: null, url: null, signature: null,
  state: 'up', condition: 'ok', origin: 'declared', verification: 'verified', codeScope: null,
  verifiedAt: ago(3), verifiedBy: 'railway', checkedAt: ago(3), attention: { ...ZERO }, activity: { running: false, kind: null, since: null },
  lastEvent: null, retiredAt: null, removalReportedAt: null, missingSince: null, createdAt: ago(900), updatedAt: ago(10),
  ...over,
});
const edge = (id: string, from: string, to: string, relation: string, category: string, over: Overrides = {}) => ({
  id, from, to, relation, category, label: null, planned: false, origin: 'declared', verifiedAt: null, retiredAt: null, ...over,
});
const sources = [{ name: 'railway', connected: true, lastRunAt: ago(4), lastOkAt: ago(4), lastError: null, itemsSeen: 3, stale: false }];
const coverage = { percent: 60, checks: [{ key: 'repo_linked', ok: true, applicable: true, label: 'Repositório ligado' }] };

const ACME_NODES = [
  gnode('repo-rockets', 'acme-inc/rockets', 'code', { type: 'repo', kind: 'repo', codeScope: 'pushed', verification: 'found_in_code', productId: ACME }),
  gnode('domain', 'acme.example', 'infra', { kind: 'domain', provider: 'cloudflare' }),
  gnode('api', 'API', 'app', { group: 'Núcleo', provider: 'railway', lastEvent: { type: 'deploy.succeeded', at: ago(5), status: 'succeeded', title: 'Deploy da API' } }),
  gnode('worker', 'Worker', 'app', { group: 'Núcleo', kind: 'worker', state: 'degraded', attention: { ...ZERO, failure: 1 } }),
  gnode('db', 'Banco', 'app', { kind: 'database', group: 'Dados' }),
  gnode('agent', 'Agente de triagem', 'automation', { kind: 'agent', state: 'unknown', verification: 'reported', productId: ACME }),
  gnode('pay', 'Pagamentos', 'business', { kind: 'payment' }),
  gnode('stripe', 'Stripe', 'business', { kind: 'payment', shared: true, productId: null, provider: 'stripe' }),
  gnode('monitor', 'Monitor', 'monitoring', { kind: 'monitor' }),
  gnode('vault', 'Cofre', 'security', { kind: 'vault', state: 'unknown', verification: 'not_found', condition: 'gap' }),
  gnode('blog', 'Blog', 'marketing', { kind: 'site' }),
];
const ACME_EDGES = [
  edge('e-deploy', 'repo-rockets', 'api', 'deploys_to', 'infra'),
  edge('e-dns', 'domain', 'api', 'resolves_dns', 'infra'),
  edge('e-writes', 'api', 'db', 'writes_to', 'data'),
  edge('e-reads', 'worker', 'db', 'reads_from', 'data'),
  edge('e-calls', 'agent', 'api', 'calls', 'data'),
  edge('e-billed', 'pay', 'stripe', 'billed_through', 'business'),
  edge('e-planned', 'api', 'pay', 'depends_on', 'infra', { planned: true }),
  edge('e-triggers', 'worker', 'agent', 'triggers', 'trigger'),
  edge('e-monitor', 'monitor', 'api', 'monitored_by', 'operational'),
  edge('e-vault', 'vault', 'api', 'protected_by', 'security'),
];
const ACME_GRAPH = {
  serverTime: ago(0), scope: { system: ref, environment: null },
  engines: ENGINES.map((key, position) => ({ key, name: key, position })),
  nodes: ACME_NODES, edges: ACME_EDGES, sources, coverage,
};

const card = (id: string, slug: string, name: string, state: string, up: number, total: number) => ({
  id, slug, name, color: null, description: null, state, shared: false, nodeCount: total,
  health: { total, up, down: total - up, degraded: 0, deploying: 0, unknown: 0 }, attention: { ...ZERO },
  running: { deploys: 0, ci: 0, agents: 0, routines: 0 }, pending: { tasks: 0, tickets: 0, errors: 0, alerts: null }, coverage,
});
const COMPANY = {
  serverTime: ago(0),
  systems: [card(ACME, 'acme', 'Acme', 'up', 3, 3), card(GLOBEX, 'globex', 'Globex', 'down', 1, 2)],
  shared: [gnode('stripe', 'Stripe', 'business', { kind: 'payment', shared: true, productId: null, provider: 'stripe' })],
  edges: [{ from: ACME, to: 'stripe', count: 2, relations: ['billed_through', 'calls'] }],
  sources,
};

// A map of 400 made-up nodes in every engine, linked in a chain of chords, for the size test.
const SYNTHETIC_NODES = Array.from({ length: 400 }, (_, i) => gnode(`n${i}`, `Serviço ${i}`, ENGINES[i % 9], {
  kind: 'worker', productId: SYNTH, group: i % 4 === 0 ? null : `grupo ${i % 6}`,
}));
const SYNTHETIC_EDGES = Array.from({ length: 400 }, (_, i) => edge(`s-${i}`, `n${i}`, `n${(i * 7 + 3) % 400}`, 'calls', 'data'));
const SYNTHETIC_GRAPH = { ...ACME_GRAPH, scope: { system: { id: SYNTH, slug: 'synthetic', name: 'Sintético', color: null }, environment: null }, nodes: SYNTHETIC_NODES, edges: SYNTHETIC_EDGES };

const EVENTS = [{ id: 'ev1', at: ago(5), source: 'railway', type: 'deploy.succeeded', status: 'succeeded', title: 'Deploy da API', url: null, commitSha: null, detail: null, productId: ACME, serviceId: 'api', repoId: null }];
const INSIGHTS = [{ id: 'i1', rule: 'no-backup', severity: 'check', title: 'Banco sem backup', detail: 'O banco não tem ligação de backup.', nodeIds: ['db'], system: ref }];

const ATLAS = {
  serverTime: ago(0),
  systems: [
    { id: ACME, slug: 'acme', name: 'Acme', color: null, description: 'Foguetes sob medida', websiteUrl: null,
      health: { total: 3, up: 3, down: 0, degraded: 0, deploying: 0, unknown: 0 }, pending: { tasks: 0, tickets: 0, errors: 0, alerts: 0 }, attention: { gaps: 0, warnings: 0 } },
    { id: GLOBEX, slug: 'globex', name: 'Globex', color: null, description: null, websiteUrl: null,
      health: { total: 2, up: 1, down: 1, degraded: 0, deploying: 0, unknown: 0 }, pending: { tasks: 0, tickets: 0, errors: 0, alerts: null }, attention: { gaps: 0, warnings: 0 } },
    { id: SYNTH, slug: 'synthetic', name: 'Sintético', color: null, description: null, websiteUrl: null,
      health: { total: 400, up: 400, down: 0, degraded: 0, deploying: 0, unknown: 0 }, pending: { tasks: 0, tickets: 0, errors: 0, alerts: null }, attention: { gaps: 0, warnings: 0 } },
  ],
  environments: [{ id: 'e1', slug: 'production', name: 'Produção' }],
  services: [], links: [], repos: [], now: [], discoveries: [],
  collectors: [{ name: 'railway', connected: true, lastRunAt: ago(4), error: null }],
};

/** A node as the drawer reads it (the NodeDetail of the contract, section 9), made from the fixtures above. */
function nodeDetail(nodeId: string) {
  const n = ACME_NODES.find((x) => x.id === nodeId);
  if (!n) return null;
  const ref = (id: string) => {
    const x = ACME_NODES.find((y) => y.id === id)!;
    return { id: x.id, key: x.key, name: x.name, kind: x.kind, engine: x.engine, productId: x.productId, state: x.state };
  };
  return {
    node: {
      ...n, notes: null, facts: [{ key: 'Health', value: '/health' }], items: [], externalRef: null, monitor: null, aliases: [], owner: null,
      impact: null, deployStatus: null, monitorStatus: null, lastDeployAt: null, commitSha: null, stack: [],
    },
    system: { id: ACME, slug: 'acme', name: 'Acme', color: null },
    incoming: ACME_EDGES.filter((e) => e.to === nodeId).map((e) => ({ edge: e, node: ref(e.from) })),
    outgoing: ACME_EDGES.filter((e) => e.from === nodeId).map((e) => ({ edge: e, node: ref(e.to) })),
    impact: { direct: [], indirect: [], systems: [] },
    evidence: [], refs: [], events: [], changes: [], repos: [], processes: [], changeSets: [], providerUrl: null,
  };
}

/** What a test can replace in the fixtures: the company, the Atlas, or the Acme map. */
type Over = { company?: unknown; atlas?: unknown; graph?: unknown };

/** Every /v1 call the map's screens make, answered from the fixtures above. Writes are accepted and ignored. */
async function serve(page: Page, over: Over = {}) {
  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/v1/staff', '');
    if (request.method() !== 'GET') return route.fulfill({ json: { ok: true } });
    if (path.startsWith('/atlas/nodes/')) {
      const detail = nodeDetail(path.slice('/atlas/nodes/'.length));
      return detail ? route.fulfill({ json: detail }) : route.fulfill({ status: 404, json: { message: 'not mocked' } });
    }
    if (path === '/atlas/graph') {
      const body = url.searchParams.get('system') === 'synthetic' ? SYNTHETIC_GRAPH : (over.graph ?? ACME_GRAPH);
      return route.fulfill({ json: body });
    }
    if (path === '/atlas/graph/company') return route.fulfill({ json: over.company ?? COMPANY });
    if (path === '/atlas/events') return route.fulfill({ json: EVENTS });
    if (path === '/atlas/insights') return route.fulfill({ json: INSIGHTS });
    if (path === '/atlas/changes') return route.fulfill({ json: [] });
    if (path === '/atlas/changesets') return route.fulfill({ json: [] });
    if (path === '/atlas/processes') return route.fulfill({ json: [] });
    if (path === '/atlas/diff') return route.fulfill({ json: { from: { at: null, snapshotId: null }, to: { at: ago(0), snapshotId: null }, nodes: { added: [], removed: [], changed: [] }, edges: { added: [], removed: [] } } });
    if (path === '/atlas/attention') return route.fulfill({ json: [] });
    if (path === '/atlas/flows') return route.fulfill({ json: [] });
    if (path === '/atlas/routines') return route.fulfill({ json: [] });
    if (path === '/atlas') return route.fulfill({ json: over.atlas ?? ATLAS });
    if (path === '/auth/me') return route.fulfill({ json: { id: 's1', name: 'Ana Souza', email: 'ana@pitwall.test', role: 'admin', totpEnabled: true, mustChangePassword: false, totpRequired: false } });
    if (path === '/products') return route.fulfill({ json: [] });
    if (path === '/summary') return route.fulfill({ json: { byStatus: {}, open: 0, unanswered: 0, openedThisWeek: 0, medianFirstResponseMinutes: null, topSignatures: [], products: [], series: [] } });
    return route.fulfill({ status: 404, json: { message: 'not mocked' } });
  });
}

/** The page itself never scrolls sideways: the canvas and the tabs scroll inside their own box. */
async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return 0;
    return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, main.scrollWidth - main.clientWidth);
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

const nodeCard = (page: Page, id: string) => page.locator(`[data-testid="atlas-graph-node"][data-node-id="${id}"]`);

/** On a phone the map is wider than the screen: drag it sideways until the card is inside the canvas. */
async function bringIntoView(page: Page, id: string | Locator) {
  const card = typeof id === 'string' ? nodeCard(page, id) : id;
  const canvas = page.getByTestId('atlas-graph-canvas');
  for (let i = 0; i < 10; i++) {
    const c = await card.boundingBox();
    const k = await canvas.boundingBox();
    if (c && k && c.x >= k.x && c.x + c.width <= k.x + k.width) return;
    const pane = await page.locator('.react-flow__pane').boundingBox();
    if (!pane) return;
    const y = pane.y + pane.height / 2;
    await page.mouse.move(pane.x + pane.width * 0.9, y);
    await page.mouse.down();
    await page.mouse.move(pane.x + pane.width * 0.1, y, { steps: 8 });
    await page.mouse.up();
  }
}

test('the company shows the systems and the shared services, and a system opens its map', async ({ page }) => {
  await serve(page);
  await page.goto('/atlas');
  const map = page.getByTestId('atlas-company-map');
  await expect(map.getByTestId('atlas-company-system')).toHaveCount(2);
  await expect(map.getByTestId('atlas-company-shared')).toContainText('Stripe');
  await expect(map.getByTestId('atlas-company-edge').first()).toHaveAttribute('data-count', '2');
  await expectNoSidewaysScroll(page);

  await map.locator('[data-slug="acme"] button').click();
  await expect(page).toHaveURL(/system=acme/);
  await expect(page.getByTestId('atlas-product-map')).toBeVisible();
  await expect(page.getByTestId('atlas-graph-node').first()).toBeVisible();
});

test('the product map draws the engine columns in the order of the Atlas', async ({ page }) => {
  await serve(page);
  await page.goto('/atlas?system=acme');
  const lanes = page.locator('[data-testid="atlas-graph-lane"]');
  await expect(lanes).toHaveCount(8);
  const order = await lanes.evaluateAll((els) => [...els]
    .sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x)
    .map((e) => e.getAttribute('data-engine')));
  expect(order).toEqual(['code', 'infra', 'app', 'automation', 'business', 'marketing', 'monitoring', 'security']);
  await expectNoSidewaysScroll(page);
});

test('the search highlights what matches and the slash key goes to it', async ({ page }) => {
  await serve(page);
  await page.goto('/atlas?system=acme');
  await expect(nodeCard(page, 'api')).toBeVisible();
  await page.locator('body').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('/');
  const search = page.getByLabel('Buscar serviço ou repositório');
  await expect(search).toBeFocused();
  await search.fill('worker');
  await expect(page.getByTestId('atlas-graph-results')).toContainText('1 encontrados');
  await expect(nodeCard(page, 'api')).toHaveAttribute('data-dim');
  await expect(nodeCard(page, 'worker')).not.toHaveAttribute('data-dim');
  await expectNoSidewaysScroll(page);
});

test('turning a link kind off hides its edges and leaves the others', async ({ page }) => {
  await serve(page);
  await page.goto('/atlas?system=acme');
  const writes = page.locator('.react-flow__edge[data-id*="e-writes"]');
  await expect(writes).toHaveCount(1);
  await expect(page.locator('.react-flow__edge[data-id*="e-deploy"]')).toHaveCount(1);
  await page.getByRole('button', { name: /Ligações/ }).click();
  await page.locator('label', { hasText: 'Dados' }).click();
  await expect(page.getByRole('button', { name: /Ligações/ })).toContainText('2/6');
  await expect(writes).toHaveCount(0);
  await expect(page.locator('.react-flow__edge[data-id*="e-deploy"]')).toHaveCount(1);
  await expectNoSidewaysScroll(page);
});

test('selecting a node opens its drawer and dims what is not related to it', async ({ page }) => {
  await serve(page);
  await page.goto('/atlas?system=acme');
  await bringIntoView(page, 'api');
  await nodeCard(page, 'api').click();
  await expect(page.getByTestId('atlas-node-drawer')).toContainText('api');
  // Direct neighbours and the ones two steps away stay; the blog has no link and fades.
  await expect(nodeCard(page, 'db')).not.toHaveAttribute('data-dim');
  await expect(nodeCard(page, 'worker')).not.toHaveAttribute('data-dim');
  await expect(nodeCard(page, 'blog')).toHaveAttribute('data-dim');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('atlas-node-drawer')).toHaveCount(0);
  await expect(nodeCard(page, 'blog')).not.toHaveAttribute('data-dim');
});

test('the product map opens at a readable zoom, with the first card in view and no page scroll', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the 1440 by 900 view');
  await serve(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/atlas?system=acme');
  const card = nodeCard(page, 'repo-rockets');
  await expect(card).toBeVisible();
  // The zoom the picture opens at, read from the viewport's transform.
  const zoom = await page.locator('.react-flow__viewport').evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
  expect(zoom).toBeGreaterThanOrEqual(0.75);
  const name = card.getByText('acme-inc/rockets', { exact: true });
  const font = await name.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(font).toBeGreaterThanOrEqual(12);
  const box = await name.boundingBox();
  const cardBox = await card.boundingBox();
  expect(box && box.y >= 0 && box.y + box.height <= 900).toBe(true);
  expect(cardBox && cardBox.x >= 0 && cardBox.x + cardBox.width <= 1440 && cardBox.y + cardBox.height <= 900).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('with the drawer open beside the map, another node opens in its place, and nothing is modal', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the drawer is a side panel on a desktop');
  await serve(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/atlas?system=acme&node=domain');
  await expect(page.getByTestId('atlas-node-drawer')).toContainText('acme.example');
  // No scrim: the map's own node takes the click, so nothing covers the map.
  await expect(page.locator('.bg-scrim:visible')).toHaveCount(0);
  await nodeCard(page, 'repo-rockets').click();
  await expect(page.getByTestId('atlas-node-drawer')).toContainText('acme-inc/rockets');
  await expect(page).toHaveURL(/node=repo-rockets/);
  await expectNoSidewaysScroll(page);
});

test('the drawer opens from the link with its node, and selecting replaces the history entry', async ({ page }, testInfo) => {
  await serve(page);
  await page.goto('/atlas?system=acme&node=api');
  await expect(page.getByTestId('atlas-node-drawer')).toContainText('API');
  const before = await page.evaluate(() => history.length);
  // On a phone the open sheet covers the map: close it, then pick the next node from the map.
  if (testInfo.project.name === 'mobile') {
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('atlas-node-drawer')).toHaveCount(0);
  }
  await bringIntoView(page, 'domain');
  await nodeCard(page, 'domain').click();
  await expect(page).toHaveURL(/node=domain/);
  await expect(page.getByTestId('atlas-node-drawer')).toContainText('acme.example');
  expect(await page.evaluate(() => history.length)).toBe(before);
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/node=/);
});

test('Filtros narrows the nodes and shows how many filters are on', async ({ page }) => {
  await serve(page);
  await page.goto('/atlas?system=acme');
  const filters = page.getByRole('button', { name: /Filtros/ });
  await expect(filters).not.toContainText('1');
  await filters.click();
  await page.getByLabel('Tipo', { exact: true }).selectOption('worker');
  await expect(filters).toContainText('1');
  await expect(nodeCard(page, 'api')).toHaveCount(0);
  await expect(nodeCard(page, 'worker')).toHaveCount(1);
});

test('Legenda opens the legend of the map', async ({ page }) => {
  await serve(page);
  await page.goto('/atlas?system=acme');
  await page.getByRole('button', { name: 'Legenda', exact: true }).click();
  await expect(page.getByTestId('atlas-graph-legend')).toContainText('Infraestrutura');
  await expect(page.getByTestId('atlas-graph-legend')).toContainText('Planejada');
});

test('the company bands do not overlap: systems, shared, and each engine with its own title', async ({ page }) => {
  await serve(page);
  await page.goto('/atlas');
  const bands = page.locator('.react-flow__node-band');
  await expect(bands).toHaveCount(3);
  const boxes = await bands.evaluateAll((els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return { text: e.textContent ?? '', x1: r.left, y1: r.top, x2: r.right, y2: r.bottom };
  }));
  expect(boxes.map((b) => b.text)).toEqual(expect.arrayContaining(['Sistemas', 'Compartilhados', 'Financeiro']));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap = a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
      expect(overlap, `${a.text} x ${b.text}`).toBe(false);
    }
  }
});

test('a collapsed engine becomes one summary node with its count', async ({ page }) => {
  await serve(page);
  await page.goto('/atlas?system=acme');
  const lane = page.locator('[data-testid="atlas-graph-lane"][data-engine="app"]');
  const collapse = lane.getByRole('button', { name: 'Recolher motor' });
  await bringIntoView(page, collapse);
  await collapse.click();
  const summary = page.locator('[data-testid="atlas-graph-summary"][data-engine="app"]');
  await expect(summary).toContainText('3 itens');
  await expect(page.locator('[data-testid="atlas-graph-node"][data-engine="app"]')).toHaveCount(0);
  await expect(lane.getByRole('button', { name: 'Expandir motor' })).toBeVisible();
  await expectNoSidewaysScroll(page);
});

test('the attention mode shows the insights and dims the nodes without attention', async ({ page }) => {
  await serve(page);
  await page.goto('/atlas?system=acme');
  await page.getByRole('tab', { name: 'Atenção', exact: true }).click();
  const insights = page.getByTestId('atlas-graph-insights');
  await expect(insights).toContainText('Banco sem backup');
  // The insight points to its node by name, never by an internal id.
  await expect(insights.getByRole('button', { name: 'Banco', exact: true })).toBeVisible();
  await expect(nodeCard(page, 'blog')).toHaveAttribute('data-dim');
  await expect(nodeCard(page, 'worker')).not.toHaveAttribute('data-dim');
  await expectNoSidewaysScroll(page);
});

test('the operation mode shows when each node was last seen, and an unread node is not called up', async ({ page }) => {
  await serve(page);
  await page.goto('/atlas?system=acme');
  await page.getByRole('tab', { name: 'Operação', exact: true }).click();
  await expect(nodeCard(page, 'api')).toContainText('observado');
  // A node that was never read says so in its own words, without the state word repeated on every card.
  const agent = nodeCard(page, 'agent');
  await expect(agent).toContainText('sem evento lido');
  await expect(agent).not.toContainText('Sem leitura');
  await expect(page.getByTestId('atlas-graph-operation')).toContainText('Deploy da API');
  await expectNoSidewaysScroll(page);
});

test('a system whose services are not read says so, and is not called down', async ({ page }) => {
  const unread = { ...card(ACME, 'acme', 'Acme', 'unknown', 0, 15), health: { total: 15, up: 0, down: 0, degraded: 0, deploying: 0, unknown: 15 } };
  await serve(page, { company: { ...COMPANY, systems: [unread, card(GLOBEX, 'globex', 'Globex', 'up', 3, 3)] } });
  await page.goto('/atlas');
  const acme = page.getByTestId('atlas-company-system').filter({ hasText: 'Acme' });
  await expect(acme.getByTestId('atlas-company-health')).toHaveText('15 serviços · sem leitura');
  await expect(acme.getByTestId('atlas-company-health')).not.toHaveClass(/text-danger/);
  await expectNoSidewaysScroll(page);
});

test('a system with some services read counts only those, and the unread ones are named apart', async ({ page }) => {
  // Three up, two down, ten never read: "3 de 5 no ar", the two down in red, the ten named as not read.
  const mixed = { ...card(ACME, 'acme', 'Acme', 'down', 3, 5), health: { total: 15, up: 3, down: 2, degraded: 0, deploying: 0, unknown: 10 } };
  await serve(page, { company: { ...COMPANY, systems: [mixed, card(GLOBEX, 'globex', 'Globex', 'up', 3, 3)] } });
  await page.goto('/atlas');
  const health = page.getByTestId('atlas-company-system').filter({ hasText: 'Acme' }).getByTestId('atlas-company-health');
  await expect(health).toHaveText('3 de 5 no ar · 10 sem leitura');
  await expect(health).toHaveClass(/text-danger/);
});

test('a card names its environment when all environments show and the system has more than one', async ({ page }) => {
  const twoEnvs = { ...ATLAS, environments: [{ id: 'e1', slug: 'production', name: 'Produção' }, { id: 'e2', slug: 'staging', name: 'Homologação' }] };
  const graph = {
    ...ACME_GRAPH,
    nodes: ACME_NODES.map((n) => (n.id === 'api' ? { ...n, environment: 'Produção' } : n.id === 'db' ? { ...n, environment: 'Homologação' } : n)),
  };
  await serve(page, { atlas: twoEnvs, graph });
  await page.goto('/atlas?system=acme');
  await expect(nodeCard(page, 'api')).toContainText('Produção · railway');
  await expect(nodeCard(page, 'db')).toContainText('Homologação · database');
  // The state word is not repeated on a card that is only unread.
  await expect(nodeCard(page, 'api')).not.toContainText('Sem leitura');
  await expectNoSidewaysScroll(page);
});

test('with one environment, or one picked, a card does not repeat its environment', async ({ page }) => {
  const graph = { ...ACME_GRAPH, nodes: ACME_NODES.map((n) => (n.id === 'api' ? { ...n, environment: 'Produção' } : n)) };
  await serve(page, { graph });
  await page.goto('/atlas?system=acme');
  await expect(nodeCard(page, 'api')).toContainText('railway');
  await expect(nodeCard(page, 'api')).not.toContainText('Produção');
});

test('the drawer gives no "All good" to a node that was not read, and shows a condition only when it is one', async ({ page }) => {
  await serve(page);
  await page.goto('/atlas?system=acme&node=agent');
  const drawer = page.getByTestId('atlas-node-drawer');
  await expect(drawer).toContainText('Relatado por agente; não verificado');
  await expect(drawer).toContainText('Sem leitura');
  await expect(drawer).not.toContainText('Em ordem');
});

test('the drawer names a condition that is a gap', async ({ page }) => {
  await serve(page);
  await page.goto('/atlas?system=acme&node=vault');
  await expect(page.getByTestId('atlas-node-drawer')).toContainText('Falta');
});

test('the minimap shows the services, in their state colours', async ({ page }) => {
  await serve(page);
  await page.goto('/atlas?system=acme');
  await expect(nodeCard(page, 'api')).toBeVisible();
  // Every service is a small rectangle in the minimap (the lanes and group names are drawn there too, in no colour).
  const drawn = await page.locator('.react-flow__minimap .react-flow__minimap-node').count();
  expect(drawn).toBeGreaterThanOrEqual(ACME_NODES.length);
  const filled = await page.locator('.react-flow__minimap .react-flow__minimap-node').evaluateAll((els) => els.filter((e) => (e as SVGElement).style.fill !== '' && (e as SVGElement).style.fill !== 'transparent').length);
  expect(filled).toBeGreaterThanOrEqual(ACME_NODES.length);
});

test('the group names sit above their cards, with no card under them', async ({ page }) => {
  await serve(page);
  await page.goto('/atlas?system=acme');
  const labels = page.locator('.react-flow__node-groupLabel p');
  await expect(labels).toHaveCount(2);
  const boxes = await labels.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  const cards = await page.locator('[data-testid="atlas-graph-node"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  for (const b of boxes) {
    for (const c of cards) {
      const overlap = b.left < c.right && c.left < b.right && b.top < c.bottom && c.top < b.bottom;
      expect(overlap).toBe(false);
    }
  }
});

test('a map of 400 nodes loads and shows in under five seconds', async ({ page }) => {
  await serve(page);
  // The first visit compiles the page in development; the measured one is the next visit.
  await page.goto('/atlas?system=acme');
  await expect(nodeCard(page, 'api')).toBeVisible();

  // The clock starts when the 400 nodes leave the API: what the map itself takes, not the dev bundle.
  let served = 0;
  await page.route('**/v1/staff/atlas/graph?system=synthetic*', (r) => { served = Date.now(); return r.fulfill({ json: SYNTHETIC_GRAPH }); });
  await page.goto('/atlas?system=synthetic');
  await expect(page.locator('[data-testid="atlas-graph-node"]').first()).toBeVisible();
  expect(served).toBeGreaterThan(0);
  expect(Date.now() - served).toBeLessThan(5000);
  await expect(page.getByTestId('atlas-graph-lane')).toHaveCount(9);
});

test('the layout is deterministic, orders the columns, and places 600 nodes in under 200 ms', async ({}, testInfo) => {
  // A pure function: one run is enough, and a second browser competing for the CPU would only slow the timing.
  test.skip(testInfo.project.name !== 'desktop', 'pure layout test, run once');
  const nodes = [
    { id: 'b', engine: 'app' as Engine, group: 'Núcleo', name: 'Banco' },
    { id: 'a', engine: 'code' as Engine, group: null, name: 'repo' },
    { id: 'c', engine: 'infra' as Engine, group: null, name: 'dns' },
    { id: 'd', engine: 'app' as Engine, group: null, name: 'API' },
  ];
  const input = { nodes, edges: [{ from: 'a', to: 'd' }, { from: 'd', to: 'c' }], collapsed: new Set<Engine>() };
  const first = layoutEngines(input);
  expect(layoutEngines(input)).toEqual(first);
  expect(first.lanes.map((l) => l.engine)).toEqual(['code', 'infra', 'app']);
  expect(first.lanes[0].x).toBeLessThan(first.lanes[1].x);
  expect(first.lanes[1].x).toBeLessThan(first.lanes[2].x);
  // Grouped nodes come before the ungrouped ones in their column.
  expect(first.positions.b.y).toBeLessThan(first.positions.d.y);

  const collapsed = layoutEngines({ ...input, collapsed: new Set<Engine>(['app']) });
  expect(collapsed.summaries).toEqual([expect.objectContaining({ id: 'summary:app', engine: 'app', count: 2 })]);
  expect(collapsed.positions.b).toBeUndefined();

  const big = Array.from({ length: 600 }, (_, i) => ({
    id: `n${i}`, engine: ENGINES[i % 9] as Engine, group: i % 3 === 0 ? null : `g${i % 5}`, name: `nó ${i}`,
  }));
  const bigEdges = big.map((_, i) => ({ from: `n${i}`, to: `n${(i * 7 + 3) % 600}` }));
  const bigInput = { nodes: big, edges: bigEdges, collapsed: new Set<Engine>() };
  layoutEngines(bigInput); // warm the JIT before timing
  const t0 = performance.now();
  const out = layoutEngines(bigInput);
  const ms = performance.now() - t0;
  expect(Object.keys(out.positions)).toHaveLength(600);
  expect(ms).toBeLessThan(200);
  expect(layoutEngines(bigInput)).toEqual(out);
});

test('a group name never sits on a card: its line is kept free above the first card', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'pure layout test, run once');
  // Groups of every size, in every engine, with the cards of each group above and below the others.
  const nodes = Array.from({ length: 240 }, (_, i) => ({
    id: `n${i}`, engine: ENGINES[i % 9] as Engine, group: i % 4 === 0 ? null : `grupo ${i % 7}`, name: `nó ${String(i).padStart(3, '0')}`,
  }));
  const edges = nodes.map((_, i) => ({ from: `n${i}`, to: `n${(i * 5 + 1) % 240}` }));
  const out = layoutEngines({ nodes, edges, collapsed: new Set<Engine>() });
  expect(out.groups.length).toBeGreaterThan(0);

  // The cards as the map draws them: 212 px wide, 54 px tall, at the positions the layout gives.
  const cards = Object.values(out.positions).map((p) => ({ x: p.x, y: p.y, w: 212, h: 54 }));
  for (const g of out.groups) {
    expect(g.height).toBe(GROUP_LABEL_H);
    for (const c of cards) {
      const hit = g.x < c.x + c.w && c.x < g.x + g.width && g.y < c.y + c.h && c.y < g.y + g.height;
      expect(hit, `${g.label} x card at ${c.x},${c.y}`).toBe(false);
    }
    // And the label is above its own group's first card, with a gap before it.
    const first = Math.min(...nodes.filter((n) => n.group === g.label && n.engine === g.engine).map((n) => out.positions[n.id].y));
    expect(first).toBeGreaterThanOrEqual(g.y + g.height);
  }
});

test('the company links leave the base of the higher card and enter the top of the lower one, with no loop over a card', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'pure geometry test, run once');
  const boxes = new Map([
    ['acme', { x: 0, y: 28, w: 260, h: 124 }],
    ['globex', { x: 284, y: 28, w: 260, h: 124 }],
    ['stripe', { x: 40, y: 230, w: 212, h: 54 }],
    ['sentry', { x: 40, y: 330, w: 212, h: 54 }],
  ]);
  const routes = planCompanyRoutes(boxes, [
    { id: 'down', from: 'acme', to: 'stripe' },
    { id: 'up', from: 'sentry', to: 'acme' },     // a shared service that is used by a system: the link still starts at the system's base
    { id: 'row', from: 'acme', to: 'globex' },
  ]);
  const down = routes.get('down')!;
  expect(down.start.y).toBe(28 + 124);     // base of Acme
  expect(down.end.y).toBe(230);            // top of Stripe
  expect(down.toAtEnd).toBe(true);
  expect(down.label.y).toBeLessThan(230);  // the count sits in the gap above the destination, not on a title below

  const up = routes.get('up')!;
  expect(up.start.y).toBe(28 + 124);       // base of Acme, not the top
  expect(up.end.y).toBe(330);              // top of Sentry
  expect(up.toAtEnd).toBe(false);          // the arrow points at Acme, which is the start

  const row = routes.get('row')!;
  expect(row.start.y).toBe(28 + 124);
  expect(row.end.y).toBe(28 + 124);        // both cards in one row: a shallow U under both, from base to base
  expect(row.label.y).toBeGreaterThan(28 + 124);
});

test('two links that leave the same side of a card do not share a point', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'pure geometry test, run once');
  const boxes = new Map([
    ['acme', { x: 0, y: 28, w: 260, h: 124 }],
    ['a', { x: 0, y: 230, w: 212, h: 54 }],
    ['b', { x: 240, y: 230, w: 212, h: 54 }],
    ['c', { x: 480, y: 230, w: 212, h: 54 }],
  ]);
  const routes = planCompanyRoutes(boxes, [
    { id: 'l1', from: 'acme', to: 'a' }, { id: 'l2', from: 'acme', to: 'b' }, { id: 'l3', from: 'acme', to: 'c' },
  ]);
  const xs = ['l1', 'l2', 'l3'].map((id) => routes.get(id)!.start.x);
  expect(new Set(xs).size).toBe(3);
});
