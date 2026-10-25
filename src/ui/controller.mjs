import { createInitialState, loadState, saveState } from '../core/index.mjs';
import { applyNetworkAction, getNetworkStatus, diagnoseNetwork, executeNetworkCommand, NETWORK_COMMANDS, NETWORK_CATALOG } from '../network/index.mjs';
import { createCloudState, applyCloudAction, inspectCloud, runCloudCommand, CLOUD_CATALOG } from '../cloud/index.mjs';
import * as learning from '../learning/index.mjs';
export { NETWORK_CATALOG, CLOUD_CATALOG };
const copy = v => structuredClone(v);
export function createController({storage={getItem:()=>null,setItem:()=>{}},view=()=>{}}={}) {
  const loaded=loadState(storage); let state=loaded.state, message=loaded.error||'', campaign='network', selection=null, hint=null, diagnostic=null, diagnosticQuery=null;
  let history=[]; const listeners=new Set([view]);
  try { state={...state,cloud:{...createCloudState(),...state.cloud}}; getNetworkStatus(state.network); inspectCloud(state.cloud); }
  catch {state={...createInitialState(),cloud:createCloudState()};message='O progresso contém configurações incompatíveis. Uma sessão vazia está disponível.';}
  campaign=learning.getMissionCatalog().find(m=>m.id===state.learning.activeMission)?.campaign||'network';
  const context=()=>{const networkStatus=getNetworkStatus(state.network);return {networkStatus,cloudStatus:inspectCloud(state.cloud,{networkStatus})};};
  if(!state.learning.activeMission) state=learning.selectMission(state,learning.getActiveMission(state,campaign).id).state;
  const snapshot=()=>{const ctx=context(),mission=learning.getActiveMission(state,campaign);return copy({state,campaign,selection,hint,diagnostic,message,history,mission,catalog:learning.getMissionCatalog(),progress:learning.getCampaignProgress(state),...ctx,evaluation:learning.evaluateMission(state,{...ctx,missionId:mission?.id})});};
  const emit=()=>{const snap=snapshot();for(const render of listeners)render(snap);return snap;};
  const persist=()=>{const result=saveState(storage,state);if(!result.ok)message='Alteração mantida nesta sessão. Não foi possível salvar: '+result.error;};
  function commit(next,text){if(next.network!==state.network){diagnostic=diagnosticQuery?diagnoseNetwork(next.network,diagnosticQuery):null;}state=next;message=text||'Alteração aplicada. Observe o resultado no diagnóstico.';persist();emit();return {ok:true,state:copy(state),message};}
  function error(e){message=e.message||String(e);emit();return {ok:false,message,state:copy(state)};}
  const api={snapshot,subscribe(fn){listeners.add(fn);fn(snapshot());return ()=>listeners.delete(fn);},
    select(id){selection=id;emit();},
    setCampaign(value){if(!['network','cloud'].includes(value))return error(Error('Campanha inválida.'));campaign=value;selection=null;hint=null;const m=learning.getActiveMission(state,campaign);if(m)state=learning.selectMission(state,m.id).state;persist();emit();},
    mission(id){const result=learning.selectMission(state,id);if(!result.ok)return error(Error(result.message));hint=null;return commit(result.state,result.message);},
    network(action){try{return commit({...state,network:applyNetworkAction(state.network,action)});}catch(e){return error(e);}},
    cloud(action){const r=applyCloudAction(state.cloud,action);return r.ok?commit({...state,cloud:r.state},r.message):error(Error(r.message));},
    diagnose(query){try{diagnosticQuery=campaign==='network'?copy(query):null;diagnostic=campaign==='network'?diagnoseNetwork(state.network,query):context().cloudStatus;message='Diagnóstico recalculado a partir da configuração atual.';emit();return copy(diagnostic);}catch(e){return error(e);}},
    command(command,deviceId=selection){let r;if(campaign==='network'&&command.trim()==='help')r={ok:true,state:state.network,output:NETWORK_CATALOG.help+'\n'+NETWORK_COMMANDS.join('\n')};else r=campaign==='network'?executeNetworkCommand(state.network,deviceId,command):runCloudCommand(state.cloud,command,context());history=[...history,{command,output:r.output,ok:r.ok}].slice(-40);if(r.diagnostic){diagnosticQuery=null;diagnostic=r.diagnostic;}if(r.ok&&r.state!==state[campaign])return commit({...state,[campaign]:r.state},'Comando executado.');message=r.ok?'Consulta concluída.':r.output;emit();return r;},
    attempt(){const mission=learning.getActiveMission(state,campaign);if(!mission)return error(Error('Nenhuma missão ativa.'));const r=learning.recordAttempt(state,mission.id,context());hint=null;commit(r.state,r.feedback);return r;},
    hint(){const m=learning.getActiveMission(state,campaign);if(!m)return error(Error('Nenhuma missão ativa.'));const r=learning.requestHint(state,m.id,context());hint={text:r.hint,level:r.level};commit(r.state,'Pista investigativa disponível. A configuração continua sob seu controle.');return r;},
    reducedMotion(value){return commit({...state,settings:{...state.settings,reducedMotion:!!value}},'Preferência de movimento salva.');}
  };emit();return api;
}
