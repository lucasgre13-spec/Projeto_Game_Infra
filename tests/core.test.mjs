import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInitialState, validateState, serializeState, deserializeState, loadState, saveState, updateSection } from '../src/core/index.mjs';
import { createAppServer, startServer } from '../server.mjs';

const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const request = (server, url, method = 'GET') => new Promise((resolve, reject) => {
  http.request({ hostname: '127.0.0.1', port: server.address().port, path: url, method }, res => {
    let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  }).on('error', reject).end();
});

test('A empresa começa vazia para que a infraestrutura dependa das ações do aluno', () => {
  const state = createInitialState();
  assert.deepEqual(state.network, { sites: [], devices: [], links: [] });
  assert.deepEqual(state.cloud, { resources: [] });
  assert.deepEqual(state.learning, { completed: [], attempts: {}, hints: {}, activeMission: null });
  assert.deepEqual(state.settings, { reducedMotion: false });
  assert.equal(validateState(state).ok, true);
  const another = createInitialState(); another.network.sites.push({ id: 'matriz' });
  assert.equal(state.network.sites.length, 0);
});

test('Atualizações explícitas preservam outras seções e não alteram o estado anterior', () => {
  const before = createInitialState();
  const next = updateSection(before, 'network', { ...before.network, sites: [{ id: 'matriz' }] });
  assert.deepEqual(next.cloud, before.cloud);
  assert.deepEqual(next.learning, before.learning);
  assert.equal(before.network.sites.length, 0);
  next.cloud.resources.push({ id: 'adicionado' });
  assert.equal(before.cloud.resources.length, 0);
  assert.throws(() => updateSection(before, '__proto__', {}));
  assert.throws(() => updateSection(before, 'schemaVersion', 2));
  assert.throws(() => updateSection(before, 'learning', { ...before.learning, hints: { m1: -1 } }));
  assert.equal(before.schemaVersion, 1);
  assert.deepEqual(before.learning.hints, {});
});

test('Sessões novas e progresso existente preservam extensões e preferências ao retomar', () => {
  const saved = storage();
  assert.deepEqual(loadState(saved), { ok: true, state: createInitialState() });
  const state = createInitialState();
  state.learning = { ...state.learning, completed: ['inicio'], activeMission: 'rede', attempts: { rede: 3 }, hints: { rede: 2 }, history: [{ valid: true }] };
  state.settings.reducedMotion = true;
  state.network.sites.push({ id: 'matriz', label: 'Matriz' });
  state.cloud.events = [{ type: 'backup', data: null }];
  assert.equal(saveState(saved, state).ok, true);
  assert.deepEqual(loadState(saved).state, state);
  assert.deepEqual(deserializeState(serializeState(state)).state, state);
  assert.equal(saveState(saved, state, 'alternativo').ok, true);
  assert.deepEqual(loadState(saved, 'alternativo').state, state);
});

test('Dados inválidos não substituem o último progresso válido', () => {
  const saved = storage(); const previous = createInitialState();
  previous.learning.completed.push('inicio');
  saveState(saved, previous);
  const mutations = [
    s => { s.schemaVersion = 2; },
    s => { s.network = []; },
    s => { s.cloud.resources = {}; },
    s => { s.learning.completed = [2]; },
    s => { s.learning.attempts = { rede: -1 }; },
    s => { s.learning.hints = { rede: 1.5 }; },
    s => { s.learning.activeMission = {}; },
    s => { s.settings.reducedMotion = 'sim'; },
    s => { s.cloud.extra = NaN; },
    s => { s.cloud.extra = Infinity; },
    s => { s.cloud.extra = undefined; },
    s => { s.cloud.extra = new Date(); },
    s => { s.cloud.extra = 1n; },
    s => { s.cloud.extra = () => 1; },
    s => { s.cloud.extra = s; },
    s => { s.cloud.extra = Array(2); },
    s => { s.cloud[Symbol('oculto')] = 1; },
    s => { Object.defineProperty(s.cloud, 'extra', { enumerable: true, get() { throw new Error('inacessível'); } }); },
  ];
  for (const mutate of mutations) {
    const state = createInitialState(); mutate(state);
    assert.equal(saveState(saved, state).ok, false);
    assert.deepEqual(loadState(saved).state, previous);
  }
});

test('Falhas de leitura, JSON truncado e versões incompatíveis permitem sessão segura', () => {
  for (const raw of ['{', '{"schemaVersion":99}', 'null', '[]', '0']) {
    const result = deserializeState(raw);
    assert.equal(result.ok, false); assert.deepEqual(result.state, createInitialState()); assert.ok(result.error);
  }
  const broken = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('sem espaço'); } };
  assert.equal(loadState(broken).ok, false);
  assert.deepEqual(loadState(broken).state, createInitialState());
  assert.equal(saveState(broken, createInitialState()).ok, false);
});

test('Servidor serve apenas conteúdo público em loopback e bloqueia travessia e arquivos privados', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'nexo-lab-'));
  const root = path.join(temp, 'app'); const outside = path.join(temp, 'outside');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'public'), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(root, 'index.html'), '<h1>Laboratório</h1>');
  await writeFile(path.join(root, 'src', 'demo.mjs'), 'export const ready = true;');
  await writeFile(path.join(root, 'public', 'map.svg'), '<svg/>');
  await writeFile(path.join(root, 'package.json'), 'PRIVADO');
  await writeFile(path.join(root, 'src', '.env'), 'PRIVADO');
  await writeFile(path.join(outside, 'secret.txt'), 'PRIVADO');
  await symlink(outside, path.join(root, 'public', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await mkdir(path.join(root, 'public', '.private'));
  await writeFile(path.join(root, 'public', '.private', 'secret.txt'), 'PRIVADO');
  await symlink(path.join(root, 'public', '.private'), path.join(root, 'public', 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(root, path.join(root, 'public', 'root-alias'), process.platform === 'win32' ? 'junction' : 'dir');
  const unstarted = createAppServer({ rootDir: root }); assert.equal(unstarted.listening, false);
  const server = await startServer({ rootDir: root, port: 0 });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(temp, { recursive: true, force: true }); });
  assert.equal(server.address().address, '127.0.0.1');
  const index = await request(server, '/'); assert.equal(index.status, 200); assert.match(index.body, /Laboratório/);
  assert.match(index.headers['content-type'], /text\/html/);
  const asset = await request(server, '/src/demo.mjs'); assert.equal(asset.status, 200); assert.match(asset.headers['content-type'], /javascript/);
  const head = await request(server, '/public/map.svg', 'HEAD'); assert.equal(head.status, 200); assert.equal(head.body, ''); assert.equal(head.headers['content-length'], '6');
  for (const url of ['/../outside/secret.txt', '/public/%2e%2e/%2e%2e/outside/secret.txt', '/src/%2e%2e/package.json', '/src/.env', '/.git/config', '/package.json', '/server.mjs', '/public/escape/secret.txt', '/public/%5c..%5cpackage.json', '/public/%00', '/public/%E0%A4%A']) {
    const response = await request(server, url);
    assert.ok([400, 403, 404].includes(response.status), `${url}: ${response.status}`);
    assert.doesNotMatch(response.body, /PRIVADO/);
  }
  for (const url of ['/public/alias/secret.txt', '/public/root-alias/package.json']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await request(server, url, method);
      assert.equal(response.status, 403, `${method} ${url}`);
      assert.doesNotMatch(response.body, /PRIVADO/);
    }
  }
  assert.equal((await request(server, '/', 'POST')).status, 405);
  assert.equal((await request(server, '/src/missing.mjs')).status, 404);
});

test('Importar o servidor não abre porta e portas inválidas não iniciam o laboratório', async () => {
  const serverFile = fileURLToPath(new URL('../server.mjs', import.meta.url));
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('../server.mjs', import.meta.url).href)})`], { encoding: 'utf8', timeout: 5000 });
  assert.equal(imported.status, 0); assert.equal(imported.stdout, '');
  for (const port of [-1, 65536, '4173', 1.5, NaN]) await assert.rejects(startServer({ port }));
  const invalid = spawnSync(process.execPath, [serverFile, 'abc'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(invalid.status, 1); assert.match(invalid.stderr, /porta inteira/);
});


