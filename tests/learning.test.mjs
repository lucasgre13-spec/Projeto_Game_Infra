import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialState,serializeState,deserializeState} from '../src/core/index.mjs';
import {getMissionCatalog,getCampaignProgress,getActiveMission,selectMission,evaluateMission,requestHint,recordAttempt} from '../src/learning/index.mjs';
import {createCloudState,applyCloudAction,inspectCloud} from '../src/cloud/index.mjs';

const catalog=getMissionCatalog();
const fixture=id=>{
  const mission=catalog.find(m=>m.id===id);
  const root=createInitialState();
  root.learning.completed=catalog.filter(m=>m.campaign===mission.campaign&&catalog.indexOf(m)<catalog.indexOf(mission)).map(m=>m.id);
  root.learning.activeMission=id;
  return root;
};
const report=mission=>({missionId:mission.id,networkStatus:{facts:Object.fromEntries(mission.objectives.map(o=>[o.fact,true]))},cloudStatus:{...Object.fromEntries(mission.objectives.map(o=>[o.fact,true])),estimatedCost:4,costs:{total:4,illustrative:true,items:[{id:'service',cost:4}]}}});
const built=()=>{
  const root=createInitialState();
  root.network={sites:[{id:'local',name:'Empresa'}],devices:[{id:'a',siteId:'local',ports:[{id:'one'}]},{id:'b',siteId:'local',ports:[{id:'one'}]}],links:[{id:'wire',from:{deviceId:'a',portId:'one'},to:{deviceId:'b',portId:'one'}}]};
  return root;
};

test('currículo cobre temas com dependências acíclicas, dificuldade crescente e pistas investigativas',()=>{
  assert.equal(catalog.length,31);
  for(const campaign of ['network','cloud']){
    const rows=catalog.filter(m=>m.campaign===campaign);
    assert.equal(rows[0].difficulty,1);assert.equal(rows.at(-1).difficulty,5);
    rows.forEach((m,i)=>{assert.ok(m.brief.length>70);assert.ok(m.requirements.length);assert.ok(m.hints.length>=3);assert.ok(m.difficulty>=(rows[i-1]?.difficulty??1));m.prerequisites.forEach(id=>assert.ok(rows.slice(0,i).some(p=>p.id===id)));});
  }
  const net=catalog.filter(m=>m.campaign==='network').flatMap(m=>m.objectives.map(o=>o.fact));
  for(const name of ['physicalReady','addressingReady','vlanReady','dhcpReady','dnsReady','wifiReady','routingReady','firewallReady','natReady','redundancyReady','failoverRecovered','vpnReady','incidentRecovered']) assert.ok(net.includes(name));
  const cloud=catalog.filter(m=>m.campaign==='cloud').flatMap(m=>m.objectives.map(o=>o.fact));
  for(const name of ['identityReady','networkReady','computeReady','databaseReady','loadBalancerReady','appReady','secure','storageReady','dnsReady','observabilityReady','backupReady','scaleReady','restoreRecovered','incidentRecovered','highAvailabilityReady','hybridReady','cost']) assert.ok(cloud.includes(name));
  assert.ok(!/\b(?:\d{1,3}\.){3}\d{1,3}\b|revelar resposta|aplicar correção|VLAN\s+\d|```|aws\s+ec2/i.test(catalog.flatMap(m=>m.hints).join(' ')));
  const cloned=getMissionCatalog();cloned[0].hints[0]='alterado';assert.notEqual(getMissionCatalog()[0].hints[0],'alterado');
});

test('construção inicial exige enlace real, comunicação local não exige internet',()=>{
  const root=built();
  assert.equal(evaluateMission(root,{missionId:'network-workspace'}).passed,true);
  root.network.links[0].to.portId='missing';assert.equal(evaluateMission(root,{missionId:'network-workspace'}).passed,false);
  const local=fixture('network-addressing');
  assert.equal(evaluateMission(local,{missionId:'network-addressing',networkStatus:{facts:{addressingReady:true,natReady:false,vpnReady:false}}}).passed,true);
  assert.equal(evaluateMission(local,{missionId:'network-addressing'}).passed,false);
});

test('todos os serviços falham fechado e usam cada observação estritamente booleana',()=>{
  for(const mission of catalog.filter(m=>m.id!=='network-workspace')){
    const root=fixture(mission.id),before=JSON.stringify(root);
    assert.equal(evaluateMission(root,report(mission)).passed,true,mission.id);
    assert.equal(evaluateMission(root,{missionId:mission.id}).passed,false,mission.id);
    for(const objective of mission.objectives){
      const context=report(mission);
      const source=objective.source==='network'?context.networkStatus.facts:context.cloudStatus;
      if(objective.fact==='cost')source.estimatedCost=NaN;else source[objective.fact]='true';
      assert.equal(evaluateMission(root,context).passed,false,mission.id+':'+objective.fact);
    }
    assert.equal(JSON.stringify(root),before);
  }
});

test('cliques e pré-requisitos ausentes não concluem nem incrementam tentativas',()=>{
  const root=createInitialState(),before=JSON.stringify(root);
  for(const id of ['unknown','network-incident','cloud-incident']){
    assert.equal(selectMission(root,id).ok,false);
    assert.equal(recordAttempt(root,id,report(catalog.at(-1))).passed,false);
    assert.equal(requestHint(root,id).level,0);
  }
  assert.equal(JSON.stringify(root),before);
  const selected=selectMission(root,'cloud-identity');assert.equal(selected.ok,true);
  assert.equal(recordAttempt(selected.state,'cloud-identity').passed,false);
  assert.deepEqual(selected.state.learning.completed,[]);
});

test('histórico persiste, conclusão é idempotente e falha posterior não apaga aprendizado',()=>{
  const root=built();
  let state=recordAttempt(root,'network-workspace').state;
  assert.equal(state.learning.activeMission,'network-physical');
  state=recordAttempt(state,'network-workspace').state;
  assert.deepEqual(state.learning.completed,['network-workspace']);
  assert.equal(state.learning.attempts['network-workspace'],2);
  state.network.links=[];
  const failed=recordAttempt(state,'network-workspace');assert.equal(failed.passed,false);
  assert.deepEqual(failed.state.learning.completed,['network-workspace']);
  const hinted=requestHint(failed.state,'network-physical').state;
  const restored=deserializeState(serializeState(hinted));assert.equal(restored.ok,true);assert.deepEqual(restored.state,hinted);
  const progress=getCampaignProgress(restored.state).find(c=>c.campaign==='network');assert.equal(progress.completedCount,1);assert.deepEqual(progress.available,['network-physical']);
  assert.equal(getActiveMission(restored.state,'cloud').id,'cloud-identity');
});

test('recuperação exige observação de transição; só configuração não basta',()=>{
  for(const id of ['network-failover','network-incident','cloud-scale','cloud-restore','cloud-incident']){
    const mission=catalog.find(m=>m.id===id),root=fixture(id),context=report(mission);
    const objective=mission.objectives[0];
    const source=objective.source==='network'?context.networkStatus.facts:context.cloudStatus;
    source[objective.fact]=false;
    assert.equal(recordAttempt(root,id,context).passed,false,id);
    source[objective.fact]=true;
    assert.equal(recordAttempt(root,id,context).passed,true,id);
  }
});

test('contraprova: muitas pistas e tentativas não alteram infraestrutura nem desbloqueiam',()=>{
  let state=fixture('network-dns');
  const infrastructure=JSON.stringify([state.network,state.cloud,state.settings]);
  const completed=[...state.learning.completed];
  for(let i=0;i<20;i++){
    const hint=requestHint(state,'network-dns',{networkStatus:{facts:{dnsReady:false}}});
    assert.ok(hint.level<=3);assert.equal('answer' in hint,false);state=hint.state;
    const attempt=recordAttempt(state,'network-dns');assert.equal(attempt.passed,false);state=attempt.state;
    assert.equal(evaluateMission(state,{missionId:'network-incident',networkStatus:{facts:{incidentRecovered:true}}}).passed,false);
  }
  assert.equal(state.learning.hints['network-dns'],3);assert.equal(state.learning.attempts['network-dns'],20);
  assert.deepEqual(state.learning.completed,completed);
  assert.equal(JSON.stringify([state.network,state.cloud,state.settings]),infrastructure);
  const before=JSON.stringify(state.learning.hints);
  assert.match(recordAttempt(state,'network-dns').feedback,/pista investigativa/);
  assert.equal(JSON.stringify(state.learning.hints),before);
});

test('raízes e contexto malformados não geram sucesso',()=>{
  for(const root of [null,{},createInitialState()]) assert.equal(evaluateMission(root,{missionId:'network-incident'}).passed,false);
  assert.equal(getActiveMission(null),null);assert.deepEqual(getCampaignProgress({}),[]);
  const root=fixture('cloud-identity');
  for(const value of [null,[],true,'true'])assert.equal(evaluateMission(root,{missionId:'cloud-identity',cloudStatus:value}).passed,false);
});

test('armazenamento exige bucket privado, IAM limitado e aplicação operacional observados pelo simulador real',()=>{
  const create=(cloud,resource)=>{const result=applyCloudAction(cloud,{type:'create',resource});assert.equal(result.ok,true,result.message);return result.state;};
  const update=(cloud,id,patch)=>{const result=applyCloudAction(cloud,{type:'update',id,patch});assert.equal(result.ok,true,result.message);return result.state;};
  const root=fixture('cloud-storage');
  root.cloud=create(createCloudState(),{id:'objects',type:'s3',private:true});
  const isolated=inspectCloud(root.cloud);
  assert.equal(isolated.storageReady,true);assert.equal(isolated.identityReady,false);assert.equal(isolated.appReady,false);
  const rejected=recordAttempt(root,'cloud-storage',{cloudStatus:isolated});
  assert.equal(rejected.passed,false);assert.ok(!rejected.state.learning.completed.includes('cloud-storage'));
  assert.equal(selectMission(rejected.state,'cloud-dns').ok,false);
  assert.equal(evaluateMission(root,{missionId:'cloud-storage',cloudStatus:isolated}).objectives.find(o=>o.id==='appReady').passed,false);
  let cloud=root.cloud;
  const ingress=(port,sourceGroupId)=>({protocol:'tcp',port,...(sourceGroupId?{sourceGroupId}:{cidr:'0.0.0.0/0'})});
  for(const resource of [
    {id:'operator',type:'iam',mfa:true,permissions:['ec2','s3']},
    {id:'network',type:'vpc',cidr:'10.0.0.0/16'},
    {id:'zone-a',type:'subnet',vpcId:'network',cidr:'10.0.1.0/24',zone:'a'},
    {id:'zone-b',type:'subnet',vpcId:'network',cidr:'10.0.2.0/24',zone:'b'},
    {id:'internet',type:'igw',vpcId:'network'},
    {id:'routes',type:'routeTable',vpcId:'network',subnetIds:['zone-a','zone-b'],routes:[{destination:'0.0.0.0/0',targetId:'internet'}]},
    {id:'entry-policy',type:'securityGroup',vpcId:'network',ingress:[ingress(80)],egress:[{protocol:'all',cidr:'0.0.0.0/0'}]},
    {id:'application-policy',type:'securityGroup',vpcId:'network',ingress:[ingress(80,'entry-policy')],egress:[{protocol:'all',cidr:'0.0.0.0/0'}]},
    {id:'data-policy',type:'securityGroup',vpcId:'network',ingress:[ingress(5432,'application-policy')],egress:[]},
    {id:'application',type:'ec2',subnetId:'zone-a',securityGroupId:'application-policy',capacity:2},
    {id:'entry',type:'alb',vpcId:'network',subnetIds:['zone-a','zone-b'],securityGroupId:'entry-policy',targetIds:['application']},
    {id:'data',type:'rds',subnetId:'zone-a',securityGroupId:'data-policy',publiclyAccessible:false}
  ])cloud=create(cloud,resource);
  const healthy=inspectCloud(cloud);
  for(const key of ['storageReady','identityReady','appReady','secure'])assert.equal(healthy[key],true,key);
  root.cloud=cloud;
  const accepted=recordAttempt(root,'cloud-storage',{cloudStatus:healthy});assert.equal(accepted.passed,true);assert.equal(selectMission(accepted.state,'cloud-dns').ok,true);
  for(const [id,patch] of [['objects',{private:false}],['operator',{permissions:['*']}],['application',{running:false}]]){
    const altered=update(cloud,id,patch),report=inspectCloud(altered),before=JSON.stringify(altered);
    assert.equal(recordAttempt({...root,cloud:altered},'cloud-storage',{cloudStatus:report}).passed,false,id);
    assert.equal(JSON.stringify(altered),before);
  }
  assert.match(catalog.find(m=>m.id==='cloud-storage').brief,/provisionar/);
  const firewall=catalog.find(m=>m.id==='network-firewall');
  assert.match(firewall.brief,/caminho funcional/);
  assert.ok(!/negar|proibido/.test([firewall.brief,...firewall.hints].join(' ')));
});
