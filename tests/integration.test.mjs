import test from 'node:test';
import assert from 'node:assert/strict';
import {createController} from '../src/ui/controller.mjs';
import {serializeState,deserializeState} from '../src/core/index.mjs';
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};};
const ok=r=>assert.equal(r.ok,true,r.message||r.output);
const net=(c,a)=>ok(c.network(a));
const cfg=(c,id,config)=>net(c,{type:'configureDevice',deviceId:id,config});
const port=(c,id,portId,config)=>net(c,{type:'configurePort',deviceId:id,portId,config});
const wire=(c,id,a,p,b,q)=>net(c,{type:'connect',link:{id,from:{deviceId:a,portId:p},to:{deviceId:b,portId:q}}});
const add=(c,id,type,siteId)=>net(c,{type:'addDevice',device:{id,type,siteId}});
const cloud=(c,a)=>ok(c.cloud(a));
const resource=(c,r)=>cloud(c,{type:'create',resource:r});
const update=(c,id,patch)=>cloud(c,{type:'update',id,patch});
const ingress=(port,sourceGroupId)=>({protocol:'tcp',port,...(sourceGroupId?{sourceGroupId}:{cidr:'0.0.0.0/0'})});
const out=[{protocol:'all',cidr:'0.0.0.0/0'}];
function goal(c,id,passed){assert.equal(c.snapshot().mission.id,id);assert.equal(c.snapshot().evaluation.passed,passed,id+': avaliação');}
function finish(c,id){goal(c,id,true);assert.equal(c.attempt().passed,true,id+': conclusão');assert.ok(c.snapshot().state.learning.completed.includes(id));}
function wan(c,site,x,k){
 const fw=site+'-fw',isp=site+'-isp'+k;add(c,isp,'provider',site);
 port(c,fw,'wan'+k,{cidr:`172.${x}.${k}.2/30`});port(c,isp,'eth0',{cidr:`172.${x}.${k}.1/30`});wire(c,site+'-wan'+k,fw,'wan'+k,isp,'eth0');
 const old=c.snapshot().state.network.devices.find(d=>d.id===fw).config;
 cfg(c,fw,{wans:[...(old.wans||[]),{id:'wan'+k,portId:'wan'+k,providerId:isp,gateway:`172.${x}.${k}.1`,priority:k}],routes:[...(old.routes||[]),{id:'default'+k,destination:'0.0.0.0/0',via:'wan'+k,metric:k}]});
}
function branch(c,site,x){
 net(c,{type:'addSite',site:{id:site,name:site}});
 for(const [suffix,type] of [['fw','fortigate'],['sw','switch'],['pc','client'],['srv','server']])add(c,site+'-'+suffix,type,site);
 for(const [p,s,q] of [['p1','fw','lan'],['p2','pc','eth0'],['p3','srv','eth0']])wire(c,site+'-'+s,site+'-sw',p,site+'-'+s,q);
 port(c,site+'-fw','lan',{cidr:`10.${x}.0.1/24`});
 cfg(c,site+'-pc',{cidr:`10.${x}.0.10/24`,gateway:`10.${x}.0.1`});cfg(c,site+'-srv',{cidr:`10.${x}.0.2/24`});
 wan(c,site,x,1);cfg(c,site+'-fw',{policies:[{id:'business',source:'any',destination:'any',action:'accept',nat:true}]});
}
function tunnel(c,a,b,x,y){
 for(const [local,remote,l,r] of [[a,b,x,y],[b,a,y,x]]){
 const id=local+'-fw',old=c.snapshot().state.network.devices.find(d=>d.id===id).config;
 cfg(c,id,{tunnels:[...(old.tunnels||[]),{id:'to-'+remote,peerType:'site',peerId:remote,localCidr:`10.${l}.0.0/24`,remoteCidr:`10.${r}.0.0/24`,profile:'lab-ipsec',enabled:true}],routes:[...old.routes,{id:'to-'+remote,destination:`10.${r}.0.0/24`,via:'to-'+remote}]});
 }
}
function networkJourney(c){
 goal(c,'network-workspace',false);assert.equal(c.mission('network-incident').ok,false);
 net(c,{type:'addSite',site:{id:'hq',name:'Matriz'}});add(c,'hq-pc','client','hq');add(c,'hq-srv','server','hq');
 goal(c,'network-workspace',false);wire(c,'first','hq-pc','eth0','hq-srv','eth0');finish(c,'network-workspace');finish(c,'network-physical');
 goal(c,'network-addressing',false);cfg(c,'hq-srv',{cidr:'10.1.0.2/24'});ok(c.command('set address 10.1.0.10/24','hq-pc'));finish(c,'network-addressing');
 assert.equal(c.snapshot().state.cloud.resources.length,0);assert.equal(c.snapshot().state.network.devices.length,2);
 goal(c,'network-vlan',false);net(c,{type:'disconnect',linkId:'first'});add(c,'hq-sw','switch','hq');add(c,'hq-fw','fortigate','hq');
 for(const [p,s,q] of [['p1','fw','lan'],['p2','pc','eth0'],['p3','srv','eth0']]){port(c,'hq-sw',p,{vlanId:10});port(c,'hq-'+s,q,{vlanId:10});wire(c,'hq-'+s,'hq-sw',p,'hq-'+s,q);}
 cfg(c,'hq-pc',{vlanId:10,gateway:'10.1.0.1',dns:'10.1.0.2'});cfg(c,'hq-srv',{vlanId:10});port(c,'hq-fw','lan',{cidr:'10.1.0.1/24'});finish(c,'network-vlan');
 goal(c,'network-dhcp',false);add(c,'hq-new','client','hq');port(c,'hq-new','eth0',{vlanId:10});port(c,'hq-sw','p4',{vlanId:10});wire(c,'hq-new','hq-new','eth0','hq-sw','p4');cfg(c,'hq-new',{dhcp:true,vlanId:10});
 assert.equal(c.diagnose({type:'dhcp',deviceId:'hq-new'}).ok,false);
 cfg(c,'hq-srv',{pools:[{id:'office',network:'10.1.0.0/24',start:'10.1.0.100',end:'10.1.0.110',gateway:'10.1.0.1',dns:'10.1.0.2',vlanId:10}]});assert.equal(c.diagnose({type:'dhcp',deviceId:'hq-new'}).ok,true);finish(c,'network-dhcp');
 goal(c,'network-dns',false);cfg(c,'hq-srv',{records:[{id:'portal',name:'portal.lab',address:'10.1.0.2'}]});assert.equal(c.diagnose({type:'dns',sourceId:'hq-pc',name:'portal.lab'}).ok,true);finish(c,'network-dns');
 goal(c,'network-wifi',false);add(c,'hq-ap','ap','hq');add(c,'hq-mobile','client','hq');port(c,'hq-ap','eth0',{vlanId:10});port(c,'hq-sw','p5',{vlanId:10});wire(c,'radio','hq-ap','eth0','hq-sw','p5');
 cfg(c,'hq-ap',{wifi:{enabled:true,ssid:'Equipe',auth:'psk',password:'senha-lab',vlanId:10}});cfg(c,'hq-mobile',{dhcp:true,vlanId:10,wifi:{ssid:'Equipe',auth:'psk',password:'senha-lab',vlanId:10}});finish(c,'network-wifi');
 goal(c,'network-routing',false);wan(c,'hq',1,1);assert.equal(c.diagnose({sourceId:'hq-pc',target:'internet'}).ok,false);
 cfg(c,'hq-fw',{policies:[{id:'business',source:'any',destination:'any',action:'accept',nat:true}]});finish(c,'network-routing');finish(c,'network-firewall');finish(c,'network-nat');
 const routes=c.snapshot().state.network.devices.find(d=>d.id==='hq-fw').config.routes;
 cfg(c,'hq-fw',{routes:[]});assert.equal(c.diagnose({sourceId:'hq-pc',target:'internet'}).ok,false);cfg(c,'hq-fw',{routes});
 goal(c,'network-redundancy',false);net(c,{type:'setLinkState',linkId:'hq-wan1',enabled:false});assert.equal(c.diagnose({sourceId:'hq-pc',target:'internet'}).ok,false);
 wan(c,'hq',1,2);assert.equal(c.diagnose({sourceId:'hq-pc',target:'internet'}).activeWanId,'wan2');net(c,{type:'setLinkState',linkId:'hq-wan1',enabled:true});finish(c,'network-redundancy');
 goal(c,'network-failover',false);net(c,{type:'injectIncident',id:'wan-loss',query:{sourceId:'hq-pc',target:'internet'},change:{type:'setLinkState',linkId:'hq-wan1',enabled:false}});finish(c,'network-failover');
 net(c,{type:'setLinkState',linkId:'hq-wan2',enabled:false});assert.equal(c.diagnose({sourceId:'hq-pc',target:'internet'}).ok,false);net(c,{type:'setLinkState',linkId:'hq-wan1',enabled:true});net(c,{type:'setLinkState',linkId:'hq-wan2',enabled:true});
 goal(c,'network-vpn',false);branch(c,'north',2);branch(c,'south',3);tunnel(c,'hq','north',1,2);tunnel(c,'hq','south',1,3);
 for(const site of ['north','south'])assert.equal(c.diagnose({sourceId:'hq-pc',target:site+'-pc'}).ok,true);finish(c,'network-vpn');
 const north=c.snapshot().state.network.devices.find(d=>d.id==='north-fw').config.tunnels;
 cfg(c,'north-fw',{tunnels:north.map(t=>({...t,profile:'incompatible'}))});assert.equal(c.diagnose({sourceId:'hq-pc',target:'north-pc'}).ok,false);cfg(c,'north-fw',{tunnels:north});
 net(c,{type:'injectIncident',id:'office-loss',query:{sourceId:'hq-pc',target:'north-pc'},change:{type:'setLinkState',linkId:'north-pc',enabled:false}});
 net(c,{type:'setLinkState',linkId:'hq-srv',enabled:false});goal(c,'network-incident',false);net(c,{type:'setLinkState',linkId:'north-pc',enabled:true});goal(c,'network-incident',false);net(c,{type:'setLinkState',linkId:'hq-srv',enabled:true});finish(c,'network-incident');
}
function cloudJourney(c){
 c.setCampaign('cloud');goal(c,'cloud-identity',false);resource(c,{id:'iam',type:'iam',mfa:true,permissions:['ec2','rds','s3','vpn','network']});finish(c,'cloud-identity');
 goal(c,'cloud-network',false);resource(c,{id:'vpc',type:'vpc',cidr:'10.90.0.0/16'});resource(c,{id:'pub-a',type:'subnet',vpcId:'vpc',cidr:'10.90.1.0/24',zone:'a'});resource(c,{id:'igw',type:'igw',vpcId:'vpc'});goal(c,'cloud-network',false);
 resource(c,{id:'public-routes',type:'routeTable',vpcId:'vpc',subnetIds:['pub-a'],routes:[{destination:'0.0.0.0/0',targetId:'igw'}]});finish(c,'cloud-network');
 goal(c,'cloud-compute',false);resource(c,{id:'web',type:'securityGroup',vpcId:'vpc',ingress:[ingress(80)],egress:out});resource(c,{id:'app',type:'ec2',subnetId:'pub-a',securityGroupId:'web',publicIp:true,capacity:2});finish(c,'cloud-compute');assert.equal(c.snapshot().cloudStatus.appReady,false);assert.ok(!c.snapshot().state.cloud.resources.some(r=>['alb','rds'].includes(r.type)));
 goal(c,'cloud-database',false);resource(c,{id:'private-a',type:'subnet',vpcId:'vpc',cidr:'10.90.3.0/24',zone:'a'});resource(c,{id:'db-policy',type:'securityGroup',vpcId:'vpc',ingress:[ingress(5432,'web')],egress:[]});resource(c,{id:'db',type:'rds',subnetId:'private-a',securityGroupId:'db-policy',publiclyAccessible:false});finish(c,'cloud-database');
 goal(c,'cloud-load-balancer',false);resource(c,{id:'pub-b',type:'subnet',vpcId:'vpc',cidr:'10.90.2.0/24',zone:'b'});update(c,'public-routes',{subnetIds:['pub-a','pub-b']});resource(c,{id:'entry',type:'securityGroup',vpcId:'vpc',ingress:[ingress(80)],egress:out});update(c,'web',{ingress:[ingress(80,'entry')]});resource(c,{id:'lb',type:'alb',vpcId:'vpc',subnetIds:['pub-a','pub-b'],securityGroupId:'entry',targetIds:['app']});finish(c,'cloud-load-balancer');finish(c,'cloud-application');
 update(c,'db',{publiclyAccessible:true});goal(c,'cloud-security',false);update(c,'db',{publiclyAccessible:false});finish(c,'cloud-security');
 goal(c,'cloud-storage',false);resource(c,{id:'files',type:'s3',private:true,versioning:true});finish(c,'cloud-storage');
 goal(c,'cloud-dns',false);resource(c,{id:'dns',type:'dns',hostname:'app.lab',targetId:'lb'});finish(c,'cloud-dns');
 cloud(c,{type:'delete',id:'public-routes'});assert.equal(c.snapshot().cloudStatus.appReady,false);resource(c,{id:'public-routes',type:'routeTable',vpcId:'vpc',subnetIds:['pub-a','pub-b'],routes:[{destination:'0.0.0.0/0',targetId:'igw'}]});
 goal(c,'cloud-observability',false);ok(c.command('monitor on'));finish(c,'cloud-observability');
 goal(c,'cloud-scale',false);cloud(c,{type:'demand',value:8});assert.equal(c.snapshot().cloudStatus.appReady,false);cloud(c,{type:'scale',id:'app',capacity:8});finish(c,'cloud-scale');
 goal(c,'cloud-backup',false);cloud(c,{type:'backup',id:'db',backupId:'data-copy'});finish(c,'cloud-backup');
 goal(c,'cloud-restore',false);assert.equal(c.cloud({type:'restore',id:'absent'}).ok,false);cloud(c,{type:'restore',id:'data-copy'});finish(c,'cloud-restore');
 goal(c,'cloud-availability',false);resource(c,{id:'private-b',type:'subnet',vpcId:'vpc',cidr:'10.90.4.0/24',zone:'b'});update(c,'app',{subnetId:'private-a',publicIp:false});resource(c,{id:'app-b',type:'ec2',subnetId:'private-b',securityGroupId:'web',capacity:8});update(c,'lb',{targetIds:['app','app-b']});update(c,'db',{multiAz:true,standbySubnetId:'private-b'});finish(c,'cloud-availability');finish(c,'cloud-cost');assert.equal(c.snapshot().cloudStatus.costs.illustrative,true);
 goal(c,'cloud-hybrid',false);resource(c,{id:'vpn',type:'vpn',vpcId:'vpc',peerSiteId:'hq',localCidr:'10.1.0.0/24',remoteCidr:'10.90.0.0/16',profile:'lab-ipsec',enabled:true});
 resource(c,{id:'hybrid-routes',type:'routeTable',vpcId:'vpc',subnetIds:['private-a','private-b'],routes:[{destination:'10.1.0.0/24',targetId:'vpn'}]});goal(c,'cloud-hybrid',false);
 const fw=c.snapshot().state.network.devices.find(d=>d.id==='hq-fw').config;
 cfg(c,'hq-fw',{tunnels:[...fw.tunnels,{id:'cloud',peerType:'aws',peerId:'vpn',localCidr:'10.1.0.0/24',remoteCidr:'10.90.0.0/16',profile:'lab-ipsec',enabled:true}],routes:[...fw.routes,{id:'cloud',destination:'10.90.0.0/16',via:'cloud'}]});finish(c,'cloud-hybrid');
 cloud(c,{type:'incident',kind:'instance',targetId:'app'});cloud(c,{type:'incident',kind:'instance',targetId:'app-b'});goal(c,'cloud-incident',false);
 update(c,'db',{publiclyAccessible:true});const incidents=c.snapshot().state.cloud.incidents;cloud(c,{type:'recover',id:incidents.at(-1).id});goal(c,'cloud-incident',false);cloud(c,{type:'recover',id:incidents[0].id});goal(c,'cloud-incident',false);update(c,'db',{publiclyAccessible:false});finish(c,'cloud-incident');
}
test('31 missões alcançáveis: construção gradual, dependências, falhas e recuperação pelo controlador público',()=>{
 const storage=memory(),c=createController({storage});assert.deepEqual(c.snapshot().state.learning.completed,[]);networkJourney(c);cloudJourney(c);
 assert.equal(c.snapshot().state.learning.completed.length,31);assert.deepEqual(new Set(c.snapshot().state.learning.completed),new Set(c.snapshot().catalog.map(m=>m.id)));
 const before=c.snapshot().state,restored=createController({storage});assert.deepEqual(restored.snapshot().state,before);assert.equal(restored.snapshot().campaign,'cloud');assert.equal(deserializeState(serializeState(before)).ok,true);
});
test('pistas e tentativas repetidas preservam infraestrutura e bloqueiam conclusão sem resultado',()=>{
 const c=createController();for(const campaign of ['network','cloud']){c.setCampaign(campaign);const before=c.snapshot().state;for(let i=0;i<8;i++){const h=c.hint();assert.ok(h.level<=3);assert.doesNotMatch(h.hint,/\b(?:\d{1,3}\.){3}\d{1,3}\b|VLAN\s+\d|```|set address|create vpc/i);assert.equal(c.attempt().passed,false);}const after=c.snapshot().state;assert.deepEqual(after.network,before.network);assert.deepEqual(after.cloud,before.cloud);assert.deepEqual(after.learning.completed,before.learning.completed);}
});
test('save versão 1 anterior e saves inválidos retomam com tratamento seguro',()=>{
 const storage=memory(),c=createController({storage});net(c,{type:'addSite',site:{id:'old-office',name:'Escritório'}});add(c,'old-pc','client','old-office');c.reducedMotion(true);const saved=c.snapshot().state;assert.equal(saved.schemaVersion,1);assert.deepEqual(createController({storage}).snapshot().state,saved);
 for(const raw of ['{broken',JSON.stringify({...saved,schemaVersion:99}),JSON.stringify({...saved,network:{sites:[],devices:[{id:'bad'}],links:[]}})]){const x=createController({storage:{getItem:()=>raw,setItem:()=>{}}});assert.equal(x.snapshot().state.network.devices.length,0);assert.ok(x.snapshot().message);assert.equal(x.snapshot().state.learning.completed.length,0);}
});


