
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudState,applyCloudAction as apply,inspectCloud as inspect,runCloudCommand as command,CLOUD_CATALOG} from '../src/cloud/index.mjs';
const create=(s,r)=>{const result=apply(s,{type:'create',resource:r});assert.equal(result.ok,true,result.message);return result.state;};
const act=(s,a)=>{const result=apply(s,a);assert.equal(result.ok,true,result.message);return result.state;};
const ingress=(port,sourceGroupId)=>({protocol:'tcp',port,...(sourceGroupId?{sourceGroupId}:{cidr:'0.0.0.0/0'})});
const allOut=[{protocol:'all',cidr:'0.0.0.0/0'}];
function architecture({redundant=true}={}){
 let s=createCloudState();
 for(const r of [
 {id:'identity',type:'iam',mfa:true,permissions:['network','ec2','rds','s3','dns','vpn','backup','monitor']},
 {id:'vpc',type:'vpc',cidr:'10.0.0.0/16'},
 {id:'pub-a',type:'subnet',vpcId:'vpc',cidr:'10.0.1.0/24',zone:'a'},
 {id:'pub-b',type:'subnet',vpcId:'vpc',cidr:'10.0.2.0/24',zone:'b'},
 {id:'private-a',type:'subnet',vpcId:'vpc',cidr:'10.0.3.0/24',zone:'a'},
 {id:'private-b',type:'subnet',vpcId:'vpc',cidr:'10.0.4.0/24',zone:'b'},
 {id:'internet',type:'igw',vpcId:'vpc'},
 {id:'public-routes',type:'routeTable',vpcId:'vpc',subnetIds:['pub-a','pub-b'],routes:[{destination:'0.0.0.0/0',targetId:'internet'}]},
 {id:'nat',type:'nat',vpcId:'vpc',subnetId:'pub-a'},
 {id:'nat-b',type:'nat',vpcId:'vpc',subnetId:'pub-b'},
 {id:'private-routes',type:'routeTable',vpcId:'vpc',subnetIds:['private-a'],routes:[{destination:'0.0.0.0/0',targetId:'nat'}]},
 {id:'private-routes-b',type:'routeTable',vpcId:'vpc',subnetIds:['private-b'],routes:[{destination:'0.0.0.0/0',targetId:'nat-b'}]},
 {id:'web-sg',type:'securityGroup',vpcId:'vpc',ingress:[ingress(80)],egress:allOut},
 {id:'app-sg',type:'securityGroup',vpcId:'vpc',ingress:[ingress(80,'web-sg')],egress:allOut},
 {id:'db-sg',type:'securityGroup',vpcId:'vpc',ingress:[ingress(5432,'app-sg')],egress:[]},
 {id:'ec-a',type:'ec2',subnetId:'private-a',securityGroupId:'app-sg',capacity:2,port:80},
 ...(redundant?[{id:'ec-b',type:'ec2',subnetId:'private-b',securityGroupId:'app-sg',capacity:2,port:80}]:[]),
 {id:'lb',type:'alb',vpcId:'vpc',subnetIds:['pub-a','pub-b'],securityGroupId:'web-sg',targetIds:redundant?['ec-a','ec-b']:['ec-a']},
 {id:'db',type:'rds',subnetId:'private-a',securityGroupId:'db-sg',multiAz:true,standbySubnetId:'private-b',publiclyAccessible:false},
 {id:'bucket',type:'s3',private:true,versioning:true},
 {id:'dns',type:'dns',hostname:'app.lab',targetId:'lb'}
 ])s=create(s,r);return s;
}
test('começa vazio e catálogo descreve referências e linhas para formulários',()=>{
 const s=createCloudState();assert.deepEqual(s.resources,[]);const r=inspect(s);
 for(const key of ['identityReady','networkReady','computeReady','databaseReady','loadBalancerReady','appReady','secure','storageReady','dnsReady','hybridReady','backupReady','highAvailabilityReady'])assert.equal(r[key],false,key);
 assert.equal(r.estimatedCost,0);assert.ok(CLOUD_CATALOG.find(c=>c.type==='securityGroup').fields.find(f=>f.key==='ingress').fields.some(f=>f.key==='sourceGroupId'));
});
test('arquitetura explícita atende aplicação, banco, DNS e segurança',()=>{
 const s=architecture(),r=inspect(s);
 for(const key of ['identityReady','networkReady','computeReady','databaseReady','loadBalancerReady','appReady','secure','storageReady','dnsReady','highAvailabilityReady'])assert.equal(r[key],true,key);
 assert.equal(r.educational,true);assert.ok(r.costs.illustrative);assert.ok(r.estimatedCost>0);
});
test('CIDR, sobreposição, referência cruzada e números inválidos recusam atomicamente',()=>{
 const s=architecture(),raw=JSON.stringify(s);
 for(const resource of [
 {id:'bad',type:'vpc',cidr:'300.0.0.0/16'},
 {id:'bad',type:'vpc',cidr:'10.0.0.1/24'},
 {id:'bad',type:'subnet',vpcId:'vpc',cidr:'10.0.1.128/25',zone:'c'},
 {id:'bad',type:'subnet',vpcId:'vpc',cidr:'172.16.0.0/24',zone:'c'},
 {id:'bad',type:'ec2',subnetId:'absent',securityGroupId:'app-sg',capacity:1},
 {id:'bad',type:'ec2',subnetId:'pub-a',securityGroupId:'app-sg',capacity:0},
 {id:'bad',type:'routeTable',vpcId:'vpc',subnetIds:['pub-a'],routes:[{destination:'0.0.0.0/0',targetId:'absent'}]}
 ]){const r=apply(s,{type:'create',resource});assert.equal(r.ok,false);assert.equal(r.state,s);}
 assert.equal(JSON.stringify(s),raw);
 let other=create(s,{id:'other',type:'vpc',cidr:'172.16.0.0/16'});
 other=create(other,{id:'other-sg',type:'securityGroup',vpcId:'other',ingress:[],egress:[]});
 assert.equal(apply(other,{type:'update',id:'ec-a',patch:{securityGroupId:'other-sg'}}).ok,false);
 assert.equal(apply(s,{type:'create',resource:s.resources[0]}).ok,false);
 assert.equal(apply(s,{type:'update',id:'ec-a',patch:{id:'renamed'}}).ok,false);
 assert.equal(apply(s,{type:'update',id:'app-sg',patch:{ingress:[{protocol:'deny',cidr:'0.0.0.0/0'}]}}).ok,false);
});
test('EC2 independente não requer ALB ou banco; NAT não permite ingresso',()=>{
 let s=architecture();s=act(s,{type:'delete',id:'lb'});s=act(s,{type:'delete',id:'db'});
 s=act(s,{type:'update',id:'ec-a',patch:{subnetId:'pub-a',publicIp:true,securityGroupId:'web-sg'}});
 assert.equal(inspect(s).computeReady,true);assert.equal(inspect(s).appReady,false);
 s=act(s,{type:'update',id:'ec-a',patch:{subnetId:'private-a'}});
 assert.equal(inspect(s).computeReady,false);
});
test('contraprova: sem rota não existe disponibilidade e consultas não corrigem',()=>{
 const original=architecture();const s=act(original,{type:'delete',id:'public-routes'}),raw=JSON.stringify(s);
 assert.equal(inspect(s).networkReady,false);assert.equal(inspect(s).appReady,false);
 for(const text of ['list','show ec-a','diagnose','logs','help']){const r=command(s,text);assert.equal(r.mutated,false);assert.equal(r.state,s);}
 assert.equal(JSON.stringify(s),raw);
});
test('contraprova: banco público, IAM amplo e bucket público falham segurança',()=>{
 const s=architecture();
 for(const [id,patch] of [['db',{publiclyAccessible:true}],['identity',{permissions:['*']}],['bucket',{private:false}],['db-sg',{ingress:[ingress(5432)]}]]){
  const unsafe=act(s,{type:'update',id,patch});assert.equal(inspect(unsafe).secure,false,id);
 }
});
test('SG permite regras aditivas; remover saída bloqueia dependência',()=>{
 let s=architecture();s=act(s,{type:'update',id:'app-sg',patch:{ingress:[ingress(81),ingress(80,'web-sg')]}});
 assert.equal(inspect(s).appReady,true);
 s=act(s,{type:'update',id:'app-sg',patch:{egress:[ingress(443)]}});
 assert.equal(inspect(s).databaseReady,false);assert.equal(inspect(s).appReady,false);
});
test('ALB exige duas zonas, alvos na VPC e zona habilitada',()=>{
 let s=architecture();
 s=act(s,{type:'update',id:'lb',patch:{subnetIds:['pub-a']}});
 assert.equal(inspect(s).loadBalancerReady,false);
 s=act(s,{type:'update',id:'lb',patch:{subnetIds:['pub-a','pub-b'],targetIds:['ec-a']}});
 assert.equal(inspect(s).appReady,true);assert.equal(inspect(s).highAvailabilityReady,false);
});
test('capacidade, monitoramento e custo mudam com operações explícitas',()=>{
 let s=architecture();const initial=inspect(s).estimatedCost;
 s=act(s,{type:'demand',value:8});assert.equal(inspect(s).appReady,false);
 s=act(s,{type:'scale',id:'ec-a',capacity:8});assert.equal(inspect(s).appReady,true);assert.equal(inspect(s).scaleReady,true);
 assert.ok(inspect(s).estimatedCost>initial);assert.equal(inspect(s).observabilityReady,false);
 s=act(s,{type:'monitor',enabled:true});assert.equal(inspect(s).observabilityReady,true);assert.ok(s.events.length>0);
});
test('contraprova: falha de instância sem reserva derruba serviço',()=>{
 let s=architecture({redundant:false});s=act(s,{type:'incident',kind:'instance',targetId:'ec-a'});
 assert.equal(inspect(s).appReady,false);const i=s.incidents[0];
 assert.equal(inspect(s).incidentRecovered,false);
 s=act(s,{type:'recover',id:i.id});assert.equal(inspect(s).appReady,true);assert.equal(inspect(s).incidentRecovered,true);
});
test('instância redundante preserva aplicação e zona exige mitigação',()=>{
 let s=architecture();s=act(s,{type:'incident',kind:'instance',targetId:'ec-a'});
 assert.equal(inspect(s).appReady,true);assert.equal(inspect(s).highAvailabilityReady,false);
 let z=architecture();z=act(z,{type:'incident',kind:'zone',targetId:'b'});
 assert.equal(inspect(z).appReady,true);assert.equal(inspect(z).incidentRecovered,true);
 assert.equal(inspect(z).highAvailabilityReady,false);assert.equal(apply(z,{type:'recover',id:z.incidents[0].id}).ok,false);
});
test('contraprova: backup ausente não restaura; snapshot restaura configuração sem recursão',()=>{
 let s=architecture();assert.equal(apply(s,{type:'restore',id:'missing'}).ok,false);
 s=act(s,{type:'backup',id:'ec-a',backupId:'saved'});assert.equal(inspect(s).backupReady,true);
 assert.deepEqual(Object.keys(s.backups[0]).sort(),['id','resource']);
 s=act(s,{type:'incident',kind:'instance',targetId:'ec-a'});assert.equal(apply(s,{type:'backup',id:'ec-a'}).ok,false);
 s=act(s,{type:'scale',id:'ec-a',capacity:20});s=act(s,{type:'restore',id:'saved'});
 assert.equal(s.resources.find(r=>r.id==='ec-a').capacity,2);assert.equal(inspect(s).restoreRecovered,true);
});
test('VPN exige rota AWS, recurso e contexto local online compatível',()=>{
 let s=architecture();s=create(s,{id:'tunnel',type:'vpn',vpcId:'vpc',peerSiteId:'office',localCidr:'192.168.1.0/24',remoteCidr:'10.0.0.0/16',profile:'lab-ipsec',enabled:true});
 const context={networkStatus:{vpnReady:true,onlineSites:['office'],sites:[{id:'office',lanReady:true,internetReady:true,vpnReady:true,activeWanId:'wan',vpnPeers:[{peerType:'aws',peerId:'tunnel',localCidr:'192.168.1.0/24',remoteCidr:'10.0.0.0/16',profile:'lab-ipsec'}]}]}};
 assert.equal(inspect(s,context).hybridReady,false);
 s=act(s,{type:'update',id:'private-routes',patch:{routes:[{destination:'0.0.0.0/0',targetId:'nat'},{destination:'192.168.1.0/24',targetId:'tunnel'}]}});
 assert.equal(inspect(s).hybridReady,false);assert.equal(inspect(s,context).hybridReady,true);
 assert.equal(inspect(s,{networkStatus:{...context.networkStatus,sites:[]}}).hybridReady,false);
 assert.equal(inspect(s,{networkStatus:{...context.networkStatus,sites:[{...context.networkStatus.sites[0],internetReady:false}]}}).hybridReady,false);
});
test('terminal reutiliza ações e rejeita texto externo ou JSON inválido',()=>{
 const s=createCloudState();
 assert.equal(command(s,'create vpc net {"cidr":"10.0.0.0/16"}').ok,true);
 for(const text of ['aws ec2 terminate-instances','fetch https://aws.amazon.com','scale a NaN','monitor yes','create vpc net {','update missing null','delete','unknown']){
  const r=command(s,text);assert.equal(r.ok,false,text);assert.equal(r.state,s);assert.equal(r.mutated,false);
 }
});

test('contraprova: falha de NAT afeta saída, sem interromper entrada privada pelo ALB',()=>{
 let s=architecture();
 s=act(s,{type:'update',id:'private-routes-b',patch:{routes:[{destination:'0.0.0.0/0',targetId:'nat'}]}});
 assert.equal(inspect(s).appReady,true);assert.equal(inspect(s).highAvailabilityReady,true);
 s=act(s,{type:'incident',kind:'zone',targetId:'a'});
 assert.equal(inspect(s).appReady,true);assert.equal(inspect(s).egressReady,false);assert.equal(inspect(s).incidentRecovered,true);assert.equal(inspect(s).statuses.nat,'unavailable');
});
test('contraprova: VPN local para outro peer/perfil/CIDR não aprova híbrida',()=>{
 let s=architecture();
 s=create(s,{id:'vpn',type:'vpn',vpcId:'vpc',peerSiteId:'office',localCidr:'192.168.1.0/24',remoteCidr:'10.0.0.0/16',profile:'lab-ipsec',enabled:true});
 s=act(s,{type:'update',id:'private-routes',patch:{routes:[{destination:'0.0.0.0/0',targetId:'nat'},{destination:'192.168.1.0/24',targetId:'vpn'}]}});
 const site={id:'office',lanReady:true,internetReady:true,vpnReady:true};
 for(const peer of [
 {peerType:'aws',peerId:'other',localCidr:'192.168.1.0/24',remoteCidr:'10.0.0.0/16',profile:'lab-ipsec'},
 {peerType:'aws',peerId:'vpn',localCidr:'192.168.2.0/24',remoteCidr:'10.0.0.0/16',profile:'lab-ipsec'},
 {peerType:'aws',peerId:'vpn',localCidr:'192.168.1.0/24',remoteCidr:'10.0.0.0/16',profile:'different'}]){
 assert.equal(inspect(s,{networkStatus:{vpnReady:true,sites:[{...site,vpnPeers:[peer]}]}}).hybridReady,false);
 }
});

test('rotas rejeitam gateway de outra VPC atomicamente na criação e atualização',()=>{
 let s=createCloudState();
 for(const resource of [
 {id:'vpc-a',type:'vpc',cidr:'10.0.0.0/16'},
 {id:'vpc-b',type:'vpc',cidr:'172.16.0.0/16'},
 {id:'sub-a',type:'subnet',vpcId:'vpc-a',cidr:'10.0.1.0/24',zone:'a'},
 {id:'sub-b',type:'subnet',vpcId:'vpc-b',cidr:'172.16.1.0/24',zone:'b'},
 {id:'igw-a',type:'igw',vpcId:'vpc-a'},
 {id:'igw-b',type:'igw',vpcId:'vpc-b'},
 {id:'nat-a',type:'nat',vpcId:'vpc-a',subnetId:'sub-a'},
 {id:'nat-b',type:'nat',vpcId:'vpc-b',subnetId:'sub-b'}
 ])s=create(s,resource);
 const table={id:'routes-a',type:'routeTable',vpcId:'vpc-a',subnetIds:['sub-a'],routes:[]};
 const original=JSON.stringify(s);
 for(const targetId of ['igw-b','nat-b']){
  const rejected=apply(s,{type:'create',resource:{...table,routes:[{destination:'0.0.0.0/0',targetId}]}});
  assert.equal(rejected.ok,false,targetId);assert.match(rejected.message,/mesma VPC/);assert.equal(rejected.state,s);assert.equal(JSON.stringify(s),original);
 }
 s=create(s,{...table,routes:[{destination:'0.0.0.0/0',targetId:'igw-a'}]});
 for(const targetId of ['igw-b','nat-b']){
  const before=JSON.stringify(s),rejected=apply(s,{type:'update',id:'routes-a',patch:{routes:[{destination:'0.0.0.0/0',targetId}]}});
  assert.equal(rejected.ok,false,targetId);assert.match(rejected.message,/mesma VPC/);assert.equal(rejected.state,s);assert.equal(JSON.stringify(s),before);
 }
 s=act(s,{type:'update',id:'routes-a',patch:{routes:[{destination:'0.0.0.0/0',targetId:'nat-a'}]}});
 assert.equal(s.resources.find(r=>r.id==='routes-a').routes[0].targetId,'nat-a');
 s=act(s,{type:'delete',id:'routes-a'});
 s=create(s,{...table,routes:[{destination:'0.0.0.0/0',targetId:'nat-a'}]});
 assert.equal(s.resources.find(r=>r.id==='routes-a').routes[0].targetId,'nat-a');
});
