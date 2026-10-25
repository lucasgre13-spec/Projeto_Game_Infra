const SECTIONS = ['network', 'cloud', 'learning', 'settings'];
const DEFAULT_KEY = 'nexo-lab.save.v1';
const plain = value => value !== null && typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const clone = value => JSON.parse(JSON.stringify(value));

export function createInitialState() {
  return {
    schemaVersion: 1,
    network: { sites: [], devices: [], links: [] },
    cloud: { resources: [] },
    learning: { completed: [], attempts: {}, hints: {}, activeMission: null },
    settings: { reducedMotion: false },
  };
}

function inspectJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || (!Array.isArray(value) && !plain(value))) {
    throw new Error('O progresso deve conter somente dados JSON válidos para poder ser retomado.');
  }
  if (ancestors.has(value)) throw new Error('O progresso contém uma referência circular e não pode ser salvo.');
  ancestors.add(value);
  if (Object.getOwnPropertySymbols(value).length) throw new Error('O progresso contém propriedades não serializáveis.');
  const keys = Object.keys(value);
  if (Array.isArray(value) && (keys.length !== value.length || keys.some((key, i) => key !== String(i)))) {
    throw new Error('As listas do progresso devem conter todos os elementos, sem propriedades extras.');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('O progresso contém propriedades não serializáveis.');
    inspectJson(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}

export function validateState(candidate) {
  const errors = [];
  try {
    inspectJson(candidate);
    if (!plain(candidate)) throw new Error('O progresso deve ser um objeto.');
    if (candidate.schemaVersion !== 1) errors.push('Versão do progresso incompatível.');
    for (const section of SECTIONS) if (!plain(candidate[section])) errors.push(`A seção ${section} deve ser um objeto.`);
    if (errors.length) return { ok: false, errors };
    for (const field of ['sites', 'devices', 'links']) {
      if (!Array.isArray(candidate.network[field])) errors.push(`network.${field} deve ser uma lista.`);
    }
    if (!Array.isArray(candidate.cloud.resources)) errors.push('cloud.resources deve ser uma lista.');
    const learning = candidate.learning;
    if (!Array.isArray(learning.completed) || !learning.completed.every(id => typeof id === 'string' && id.trim().length)) {
      errors.push('As missões concluídas devem conter identificadores de texto.');
    }
    for (const field of ['attempts', 'hints']) {
      if (!plain(learning[field]) || !Object.values(learning[field]).every(n => Number.isSafeInteger(n) && n >= 0)) {
        errors.push(`Os contadores de ${field} devem ser inteiros não negativos.`);
      }
    }
    if (learning.activeMission !== null && (typeof learning.activeMission !== 'string' || !learning.activeMission.trim())) {
      errors.push('A missão ativa deve ser um identificador de texto ou nulo.');
    }
    if (typeof candidate.settings.reducedMotion !== 'boolean') errors.push('A preferência de movimento reduzido deve ser booleana.');
  } catch (error) { errors.push(error.message || 'Não foi possível validar o progresso.'); }
  return { ok: errors.length === 0, errors };
}

export function serializeState(state) {
  const result = validateState(state);
  if (!result.ok) throw new Error(result.errors.join(' '));
  return JSON.stringify(state);
}

export function deserializeState(raw) {
  try {
    if (typeof raw !== 'string') throw new Error('O progresso salvo deve ser um texto JSON.');
    const state = JSON.parse(raw);
    const result = validateState(state);
    if (!result.ok) throw new Error(result.errors.join(' '));
    return { ok: true, state };
  } catch (error) { return { ok: false, state: createInitialState(), error: error.message }; }
}

export function loadState(storage, key = DEFAULT_KEY) {
  try {
    const raw = storage.getItem(key);
    return raw === null ? { ok: true, state: createInitialState() } : deserializeState(raw);
  } catch { return { ok: false, state: createInitialState(), error: 'Não foi possível ler o progresso salvo. Você pode iniciar uma nova sessão.' }; }
}

export function saveState(storage, state, key = DEFAULT_KEY) {
  try {
    const raw = serializeState(state);
    storage.setItem(key, raw);
    return { ok: true };
  } catch (error) { return { ok: false, error: error.message || 'Não foi possível salvar o progresso.' }; }
}

export function updateSection(state, section, nextValue) {
  if (!SECTIONS.includes(section)) throw new Error('Somente rede, nuvem, aprendizado e preferências podem ser atualizados.');
  const previous = validateState(state);
  if (!previous.ok) throw new Error(previous.errors.join(' '));
  const next = { ...state, [section]: nextValue };
  serializeState(next);
  return clone(next);
}

