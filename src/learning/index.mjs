import { catalog } from './catalog.mjs';
import { validateState } from '../core/index.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
const find = id => catalog.find(m => m.id === id);
const valid = root => validateState(root).ok;
const unlocked = (root, mission) => mission.prerequisites.every(id => root.learning.completed.includes(id));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ready = (root,id) => valid(root) && !!find(id) && unlocked(root,find(id));

export function getMissionCatalog() { return copy(catalog); }

export function getCampaignProgress(root) {
  if (!valid(root)) return [];
  return ['network','cloud'].map(campaign => {
    const missions = catalog.filter(m => m.campaign === campaign);
    const completed = missions.filter(m => root.learning.completed.includes(m.id)).map(m=>m.id);
    return {campaign,total:missions.length,completed,completedCount:completed.length,available:missions.filter(m=>unlocked(root,m)&&!completed.includes(m.id)).map(m=>m.id)};
  });
}

export function getActiveMission(root,campaign) {
  if (!valid(root)) return null;
  const active = find(root.learning.activeMission);
  if (active && (!campaign || active.campaign === campaign) && unlocked(root,active)) return copy(active);
  const next = catalog.find(m=>(!campaign||m.campaign===campaign)&&unlocked(root,m)&&!root.learning.completed.includes(m.id));
  return next ? copy(next) : null;
}

export function selectMission(root,missionId) {
  if (!ready(root,missionId)) return {state:root,ok:false,message:'Missão inválida ou pré-requisitos ainda pendentes.'};
  return {state:{...root,learning:{...root.learning,activeMission:missionId}},ok:true,message:'Missão selecionada. Construa e verifique o resultado solicitado.'};
}

function structure(root) {
  const {sites,devices,links} = root.network;
  return sites.some(site => plain(site)&&typeof site.id==='string'&&site.id.trim()&&typeof site.name==='string'&&site.name.trim()&&links.some(link=>{
    if (!plain(link)||!plain(link.from)||!plain(link.to)||link.from.deviceId===link.to.deviceId) return false;
    return [link.from,link.to].every(end=>typeof end.portId==='string'&&end.portId.trim()&&devices.some(d=>plain(d)&&d.siteId===site.id&&d.id===end.deviceId&&Array.isArray(d.ports)&&d.ports.some(p=>plain(p)&&p.id===end.portId)));
  }));
}

function objectivePassed(root,objective,context) {
  if (objective.fact === 'structure') return structure(root);
  const report = context[objective.source === 'network' ? 'networkStatus' : 'cloudStatus'];
  if (!plain(report)) return false;
  if (objective.fact === 'cost') return Number.isFinite(report.estimatedCost)&&report.estimatedCost>0&&plain(report.costs)&&report.costs.total===report.estimatedCost&&report.costs.illustrative===true&&Array.isArray(report.costs.items)&&report.costs.items.length>0;
  const source = objective.source === 'network' ? report.facts : report;
  return plain(source) && source[objective.fact] === true;
}

export function evaluateMission(root,context={}) {
  if (!plain(context)) context={};
  const missionId=context.missionId ?? root?.learning?.activeMission;
  const mission=find(missionId);
  if (!ready(root,missionId)) return {missionId:missionId??null,passed:false,objectives:[],feedback:'Missão inválida ou pré-requisitos ainda pendentes.'};
  const objectives=mission.objectives.map(objective=>({id:objective.id,label:objective.label,passed:objectivePassed(root,objective,context)}));
  const passed=objectives.every(o=>o.passed);
  return {missionId,passed,objectives,feedback:passed ? 'Resultado observado: os objetivos desta missão foram atendidos.' : 'Ainda pendente: '+objectives.filter(o=>!o.passed).map(o=>o.label).join('; ')+'. Observe o caminho afetado e compare com as necessidades da empresa.'};
}

export function recordAttempt(root,missionId,context={}) {
  if (!ready(root,missionId)) return {state:root,...evaluateMission(root,{missionId})};
  const result=evaluateMission(root,{...(plain(context)?context:{}),missionId});
  const previous=root.learning.attempts[missionId]??0;
  if (previous===Number.MAX_SAFE_INTEGER) return {state:root,...result,feedback:'O limite de tentativas foi atingido; o histórico foi preservado.'};
  const attempts={...root.learning.attempts,[missionId]:previous+1};
  const completed=[...root.learning.completed];
  if (result.passed&&!completed.includes(missionId)) completed.push(missionId);
  const next=catalog.find(m=>m.campaign===find(missionId).campaign&&!completed.includes(m.id)&&m.prerequisites.every(id=>completed.includes(id)));
  const state={...root,learning:{...root.learning,attempts,completed,activeMission:result.passed?(next?.id??missionId):missionId}};
  return {state,...result,feedback:result.feedback+(!result.passed&&attempts[missionId]>=3?' Uma pista investigativa está disponível quando você quiser.':'')};
}

export function requestHint(root,missionId,context={}) {
  if (!ready(root,missionId)) return {state:root,hint:'Conclua os pré-requisitos para investigar esta missão.',level:0};
  const mission=find(missionId);
  const level=Math.min((root.learning.hints[missionId]??0)+1,mission.hints.length);
  const result=evaluateMission(root,{...(plain(context)?context:{}),missionId});
  const pending=result.objectives.find(o=>!o.passed);
  return {state:{...root,learning:{...root.learning,hints:{...root.learning.hints,[missionId]:level}}},hint:mission.hints[level-1]+(pending?' Foco: '+pending.label+'.':''),level};
}
