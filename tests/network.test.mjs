import test from 'node:test';
import assert from 'node:assert/strict';
import {createNetworkState,applyNetworkAction as act,diagnoseNetwork as diag,getNetworkStatus as status,executeNetworkCommand as command,NETWORK_CATALOG} from '../src/network/index.mjs';

function fixture() {
  let n=createNetworkState();
  const apply=a=>{n=act(n,a);};
  const config=(id,c)=>apply({type:'configureDevice',deviceId:id,config:c});
  const port=(id,p,c)=>apply({type:'configurePort',deviceId:id,portId:p,config:c});
  const connect=(id,a,p,b,q)=>apply({type:'connect',link:{id,from:{deviceId:a,portId:p},to:{deviceId:b,portId:q}}});
  for(const [i,id] of ['matriz','filial-norte','filial-sul'].entries()) {
    const x=i+1;
    apply({type:'addSite',site:{id,name:id}});
    for(const [suffix,type] of [['fw','fortigate'],['sw','switch'],['pc','client'],['srv','server'],['ap','ap'],['wifi','client'],['isp1','provider'],['isp2','provider']])apply({type:'addDevice',device:{id:id+'-'+suffix,type,siteId:id}});
    const dev=s=>id+'-'+s;
    for(const p of ['p1','p2','p3','p4'])port(dev('sw'),p,{mode:p==='p1'?'trunk':'access',vlanId:10,allowedVlans:[10,20]});
    port(dev('fw'),'lan',{mode:'trunk',vlanId:10,allowedVlans:[10,20],cidr:'10.'+x+'.0.1/24'});
    for(const s of ['pc','srv','ap'])port(dev(s),'eth0',{vlanId:10});
    connect(id+'-uplink',dev('sw'),'p1',dev('fw'),'lan');
    connect(id+'-client',dev('sw'),'p2',dev('pc'),'eth0');
    connect(id+'-server',dev('sw'),'p3',dev('srv'),'eth0');
    connect(id+'-radio',dev('sw'),'p4',dev('ap'),'eth0');
    config(dev('pc'),{cidr:'10.'+x+'.0.10/24',gateway:'10.'+x+'.0.1',dns:'10.'+x+'.0.2',vlanId:10});
    config(dev('srv'),{cidr:'10.'+x+'.0.2/24',gateway:'10.'+x+'.0.1',vlanId:10,pools:[{id:'office',network:'10.'+x+'.0.0/24',start:'10.'+x+'.0.100',end:'10.'+x+'.0.110',gateway:'10.'+x+'.0.1',dns:'10.'+x+'.0.2',vlanId:10}],records:[{id:'portal',name:'portal.lab',address:'10.'+x+'.0.2'}]});
    config(dev('ap'),{wifi:{enabled:true,ssid:'Equipe',password:'senha-lab',vlanId:10}});
    config(dev('wifi'),{dhcp:true,vlanId:10,wifi:{ssid:'Equipe',password:'senha-lab',vlanId:10}});
    for(const k of [1,2]) {
      port(dev('fw'),'wan'+k,{cidr:'172.'+x+'.'+k+'.2/30'});
      port(dev('isp'+k),'eth0',{cidr:'172.'+x+'.'+k+'.1/30'});
      connect(id+'-wan'+k,dev('fw'),'wan'+k,dev('isp'+k),'eth0');
    }
    config(dev('fw'),{
      wans:[1,2].map(k=>({id:'wan'+k,portId:'wan'+k,providerId:dev('isp'+k),gateway:'172.'+x+'.'+k+'.1',priority:k})),
      routes:[1,2].map(k=>({id:'default'+k,destination:'0.0.0.0/0',via:'wan'+k,metric:k})),
      policies:[{id:'allow',source:'10.'+x+'.0.0/24',destination:'any',service:'any',action:'accept',nat:true}]
    });
  }
  return n;
}
const change=(n,id,config)=>act(n,{type:'configureDevice',deviceId:id,config});
const ping=(n,id='matriz-pc',target='internet')=>diag(n,{sourceId:id,target});
function vpn(n,a,b,ax,bx) {
  for(const [local,remote,x,y] of [[a,b,ax,bx],[b,a,bx,ax]]) {
    const fw=n.devices.find(d=>d.id===local+'-fw');
    n=change(n,fw.id,{tunnels:[...(fw.config.tunnels||[]),{id:'to-'+remote,peerType:'site',peerId:remote,localCidr:'10.'+x+'.0.0/24',remoteCidr:'10.'+y+'.0.0/24',profile:'lab-ipsec',enabled:true}],routes:[...fw.config.routes,{id:'route-'+remote,destination:'10.'+y+'.0.0/24',via:'to-'+remote}]});
  }
  return n;
}

test('Construção começa vazia; portas e endereços inválidos são rejeitados atomicamente',()=>{
  let n=createNetworkState();
  assert.deepEqual(n,{sites:[],devices:[],links:[]});
  assert.ok(Object.values(status(n).facts).every(x=>x===false));
  n=act(n,{type:'addSite',site:{id:'matriz',name:'Matriz'}});
  n=act(n,{type:'addDevice',device:{id:'pc',type:'client',siteId:'matriz'}});
  const before=JSON.stringify(n);
  for(const a of [
    {type:'addDevice',device:{id:'pc',type:'client',siteId:'matriz'}},
    {type:'configureDevice',deviceId:'pc',config:{cidr:'256.1.1.1/24'}},
    {type:'configureDevice',deviceId:'pc',config:{cidr:'1.1.1.1/33'}},
    {type:'configurePort',deviceId:'pc',portId:'eth0',config:{vlanId:4095}},
    {type:'configurePort',deviceId:'pc',portId:'eth0',config:{id:'changed'}},
    {type:'configureDevice',deviceId:'pc',config:{cid:'10.1.0.1/24'}},
    {type:'connect',link:{id:'bad',from:{deviceId:'pc',portId:'invalid'},to:{deviceId:'ghost',portId:'eth0'}}}
  ]) {assert.throws(()=>act(n,a));assert.equal(JSON.stringify(n),before);}
  assert.ok(NETWORK_CATALOG.collections.policies.ordered);
  assert.ok(NETWORK_CATALOG.collections.routes.fields.some(f=>f.name==='via'));
});

test('Matriz e duas filiais exigem caminho físico/VLAN, sem WAN para serviços locais',()=>{
  let n=fixture();
  assert.equal(n.sites.length,3);
  for(const id of ['matriz','filial-norte','filial-sul'])assert.ok(ping(n,id+'-pc',id+'-srv').ok);
  const disabled=act(n,{type:'setLinkState',linkId:'matriz-server',enabled:false});
  assert.equal(ping(disabled,'matriz-pc','matriz-srv').ok,false);
  assert.equal(ping(disabled,'filial-norte-pc','filial-norte-srv').ok,true);
  n=act(n,{type:'configurePort',deviceId:'matriz-sw',portId:'p1',config:{allowedVlans:[20]}});
  assert.equal(ping(n).ok,false);
  assert.ok(ping(n,'matriz-pc','matriz-srv').ok);
  let local=fixture();
  for(const linkId of ['matriz-wan1','matriz-wan2'])local=act(local,{type:'setLinkState',linkId,enabled:false});
  assert.ok(status(local).sites.find(s=>s.id==='matriz').lanReady);
  assert.ok(status(local).facts.dnsReady);
  assert.ok(status(local).facts.dhcpReady);
  assert.ok(status(local).facts.wifiReady);
  assert.equal(status(local).sites.find(s=>s.id==='matriz').internetReady,false);
});

test('DHCP depende de pool e caminho; Wi-Fi depende de SSID, senha e VLAN; DNS exige registro e alcance',()=>{
  let n=fixture();
  assert.ok(diag(n,{type:'dhcp',deviceId:'matriz-wifi'}).ok);
  assert.equal(diag(n,{type:'dns',sourceId:'matriz-pc',name:'portal.lab'}).answer,'10.1.0.2');
  assert.equal(diag(n,{type:'dns',sourceId:'matriz-pc',name:'inexistente.lab'}).ok,false);
  const badWifi=change(n,'matriz-wifi',{wifi:{ssid:'Equipe',password:'outra',vlanId:10}});
  assert.equal(ping(badWifi,'matriz-wifi','matriz-srv').ok,false);
  assert.ok(ping(badWifi,'matriz-pc','matriz-srv').ok);
  const badVlan=change(n,'matriz-ap',{wifi:{ssid:'Equipe',password:'senha-lab',vlanId:20}});
  assert.equal(diag(badVlan,{type:'dhcp',deviceId:'matriz-wifi'}).ok,false);
  const noPool=change(n,'matriz-srv',{pools:[]});
  assert.equal(diag(noPool,{type:'dhcp',deviceId:'matriz-wifi'}).ok,false);
  assert.throws(()=>change(n,'matriz-srv',{pools:[{id:'bad',network:'10.1.0.0/24',start:'10.9.0.1',end:'10.9.0.2'}]}));
  n=act(n,{type:'setLinkState',linkId:'matriz-server',enabled:false});
  assert.equal(diag(n,{type:'dns',sourceId:'matriz-pc',name:'portal.lab'}).ok,false);
  assert.equal(diag(n,{type:'dhcp',deviceId:'matriz-wifi'}).ok,false);
});

test('Internet exige gateway, rota, política ordenada e NAT',()=>{
  const n=fixture();
  assert.equal(ping(n).activeWanId,'wan1');
  assert.equal(ping(change(n,'matriz-pc',{gateway:'10.1.0.254'})).ok,false);
  assert.equal(ping(change(n,'matriz-fw',{routes:[]})).ok,false);
  assert.equal(ping(change(n,'matriz-fw',{policies:[]})).stage,'firewall');
  assert.equal(ping(change(n,'matriz-fw',{policies:[{id:'allow',action:'accept',source:'any',destination:'any',nat:false}]})).stage,'nat');
  const deny={id:'deny-first',source:'any',destination:'any',action:'deny'};
  const allow=n.devices.find(d=>d.id==='matriz-fw').config.policies[0];
  assert.equal(ping(change(n,'matriz-fw',{policies:[deny,allow]})).ok,false);
  assert.equal(ping(change(n,'matriz-fw',{policies:[allow,deny]})).ok,true);
});

test('Roteamento entre VLANs exige interfaces, trunks e política',()=>{
  let n=fixture();
  n=act(n,{type:'addDevice',device:{id:'isolado',type:'server',siteId:'matriz'}});
  n=change(n,'isolado',{cidr:'10.1.20.2/24',gateway:'10.1.20.1',vlanId:20});
  n=act(n,{type:'configurePort',deviceId:'isolado',portId:'eth0',config:{vlanId:20}});
  n=act(n,{type:'configurePort',deviceId:'matriz-sw',portId:'p5',config:{vlanId:20}});
  n=act(n,{type:'connect',link:{id:'isolado-link',from:{deviceId:'matriz-sw',portId:'p5'},to:{deviceId:'isolado',portId:'eth0'}}});
  n=change(n,'matriz-fw',{interfaces:[{id:'vlan20',portId:'lan',vlanId:20,cidr:'10.1.20.1/24'}]});
  assert.equal(ping(n,'matriz-pc','isolado').ok,true);
  assert.equal(ping(change(n,'matriz-fw',{policies:[]}),'matriz-pc','isolado').ok,false);
  n=act(n,{type:'configurePort',deviceId:'matriz-sw',portId:'p1',config:{allowedVlans:[10]}});
  assert.equal(ping(n,'matriz-pc','isolado').ok,false);
});

test('VPN entre locais depende das duas pontas, redes, perfil, políticas e rotas',()=>{
  let n=vpn(vpn(fixture(),'matriz','filial-norte',1,2),'matriz','filial-sul',1,3);
  assert.ok(ping(n,'matriz-pc','filial-norte-pc').ok);
  assert.ok(ping(n,'matriz-pc','filial-sul-pc').ok);
  assert.ok(status(n).vpnReady);
  const remote=n.devices.find(d=>d.id==='filial-norte-fw');
  assert.equal(ping(change(n,remote.id,{routes:remote.config.routes.filter(r=>r.via!=='to-matriz')}),'matriz-pc','filial-norte-pc').ok,false);
  assert.equal(ping(change(n,remote.id,{policies:[]}),'matriz-pc','filial-norte-pc').ok,false);
  const invalidPeer=remote.config.tunnels.map(t=>({...t,peerId:'inexistente'}));
  assert.equal(ping(change(n,remote.id,{tunnels:invalidPeer}),'matriz-pc','filial-norte-pc').ok,false);
  const wrong=remote.config.tunnels.map(t=>({...t,profile:'outro'}));
  assert.equal(ping(change(n,remote.id,{tunnels:wrong}),'matriz-pc','filial-norte-pc').ok,false);
  const main=n.devices.find(d=>d.id==='matriz-fw');
  const bad=main.config.tunnels.map(t=>t.peerId==='filial-norte'?{...t,remoteCidr:'10.8.0.0/24'}:t);
  assert.equal(ping(change(n,main.id,{tunnels:bad}),'matriz-pc','filial-norte-pc').ok,false);
  const aws={id:'hybrid',peerType:'aws',peerId:'cloud-vpn',localCidr:'10.1.0.0/24',remoteCidr:'10.90.0.0/16',profile:'lab-ipsec'};
  n=change(n,main.id,{tunnels:[...main.config.tunnels,aws],routes:[...main.config.routes,{id:'cloud-route',destination:aws.remoteCidr,via:aws.id}]});
  const peers=status(n).sites.find(s=>s.id==='matriz').vpnPeers;
  assert.ok(peers.some(p=>p.peerType==='aws'&&p.peerId==='cloud-vpn'&&p.remoteCidr==='10.90.0.0/16'));
  assert.doesNotThrow(()=>JSON.stringify(status(n)));
});

test('Redundância escolhe somente caminhos completos e recuperação decorre de reparos reais',()=>{
  const n=fixture();
  assert.ok(status(n).facts.redundancyReady);
  const incident=act(n,{type:'injectIncident',id:'provider-outage',query:{sourceId:'matriz-pc',target:'internet'},change:{type:'setLinkState',linkId:'matriz-wan1',enabled:false}});
  assert.equal(ping(incident).activeWanId,'wan2');
  assert.ok(status(incident).facts.failoverRecovered);
  const noBackup=act(incident,{type:'setLinkState',linkId:'matriz-wan2',enabled:false});
  assert.equal(ping(noBackup).ok,false);
  const fw=incident.devices.find(d=>d.id==='matriz-fw');
  assert.equal(ping(change(incident,fw.id,{routes:fw.config.routes.filter(r=>r.via!=='wan2')})).ok,false);
  const badGateway=fw.config.wans.map(w=>w.id==='wan2'?{...w,gateway:'172.1.2.3'}:w);
  assert.equal(ping(change(incident,fw.id,{wans:badGateway})).ok,false);
  const repaired=act(noBackup,{type:'setLinkState',linkId:'matriz-wan1',enabled:true});
  assert.equal(ping(repaired).activeWanId,'wan1');
  let service=act(n,{type:'injectIncident',query:{sourceId:'matriz-pc',target:'matriz-srv'},change:{type:'setLinkState',linkId:'matriz-server',enabled:false}});
  assert.equal(status(service).facts.incidentRecovered,false);
  service=act(service,{type:'setLinkState',linkId:'matriz-server',enabled:true});
  assert.equal(status(service).facts.incidentRecovered,true);
});

test('Porta ocupada, consultas imutáveis, terminal limitado e paridade com formulários',()=>{
  const n=fixture(),before=JSON.stringify(n);
  assert.throws(()=>act(n,{type:'connect',link:{id:'duplicate',from:{deviceId:'matriz-pc',portId:'eth0'},to:{deviceId:'matriz-sw',portId:'p8'}}}));
  for(let i=0;i<3;i++) {status(n);diag(n,{type:'interfaces',deviceId:'matriz-fw'});command(n,'matriz-pc','ping internet');}
  assert.equal(JSON.stringify(n),before);
  const expected=change(n,'matriz-pc',{cidr:'10.1.0.20/24',gateway:'10.1.0.1',dns:'10.1.0.2',dhcp:false});
  const executed=command(n,'matriz-pc','set address 10.1.0.20/24 10.1.0.1 10.1.0.2');
  assert.ok(executed.ok);assert.deepEqual(executed.network,expected);
  assert.equal(command(n,'matriz-pc','set address 999.0.0.1/24').ok,false);
  assert.equal(command(n,'matriz-pc','rm -rf /').ok,false);
  assert.equal(command(n,'matriz-pc','set dhcp perhaps').network,n);
  assert.match(command(n,'matriz-pc','help').output,/educativo/);
  assert.ok(command(n,'matriz-fw','show routes').ok);
  assert.equal(JSON.stringify(n),before);
});

test('Contraprovas de caminhos alternativos: política por interface, endereço público e destino privado desconhecido',()=>{
  let n=fixture();
  n=change(n,'matriz-fw',{policies:[
    {id:'primary-only',source:'any',destination:'any',action:'accept',nat:true,outInterface:'wan1'},
    {id:'backup-only',source:'any',destination:'any',action:'accept',nat:true,outInterface:'wan2'}
  ]});
  n=act(n,{type:'setLinkState',linkId:'matriz-wan1',enabled:false});
  assert.equal(ping(n).activeWanId,'wan2');
  n=change(n,'matriz-fw',{policies:[{id:'deny-backup',source:'any',destination:'any',action:'deny',outInterface:'wan2'},...n.devices.find(d=>d.id==='matriz-fw').config.policies]});
  assert.equal(ping(n).ok,false);
  assert.equal(ping(fixture(),'matriz-pc','10.77.0.1').ok,false);
  let publicNet=fixture();
  publicNet=change(publicNet,'matriz-pc',{cidr:'203.0.113.10/24',gateway:'203.0.113.1'});
  publicNet=act(publicNet,{type:'configurePort',deviceId:'matriz-fw',portId:'lan',config:{cidr:'203.0.113.1/24'}});
  publicNet=change(publicNet,'matriz-fw',{policies:[{id:'routed-public',source:'203.0.113.0/24',destination:'any',action:'accept',nat:false}]});
  assert.ok(ping(publicNet).ok);
});

test('DHCP aloca leases distintos com endereço estático dentro do pool; configurações incompatíveis são atômicas',()=>{
  let n=fixture();
  n=change(n,'matriz-pc',{cidr:'10.1.0.100/24'});
  n=act(n,{type:'addDevice',device:{id:'matriz-wireless-extra',siteId:'matriz',type:'client',config:{dhcp:true,vlanId:10,wifi:{ssid:'Equipe',password:'senha-lab',vlanId:10}}}});
  const a=diag(n,{type:'dhcp',deviceId:'matriz-wifi'}).address;
  const b=diag(n,{type:'dhcp',deviceId:'matriz-wireless-extra'}).address;
  assert.ok(a&&b);assert.notEqual(a.ip,b.ip);assert.notEqual(a.ip,'10.1.0.100');assert.notEqual(b.ip,'10.1.0.100');
  const before=JSON.stringify(n);
  for(const [id,config] of [['matriz-pc',{dhcp:'yes'}],['matriz-pc',{pools:[{id:'invalid',network:'10.1.0.0/24',start:'10.1.0.10',end:'10.1.0.20'}]}],['matriz-sw',{wifi:{ssid:'fake'}}]])assert.throws(()=>change(n,id,config));
  assert.equal(JSON.stringify(n),before);
});


test('Wi-Fi exige SSID e autenticação coerentes; configurações incompletas não alteram a rede',()=>{
  const full=fixture();
  let n={sites:full.sites.filter(s=>s.id==='matriz'),devices:full.devices.filter(d=>d.siteId==='matriz'),links:full.links.filter(l=>l.id.startsWith('matriz-'))};
  assert.ok(diag(n,{type:'dhcp',deviceId:'matriz-wifi'}).ok);
  assert.ok(ping(n,'matriz-wifi','matriz-srv').ok);
  assert.equal(status(n).facts.wifiReady,true);
  const before=JSON.stringify(n);
  for(const [id,wifi] of [
    ['matriz-ap',{enabled:true,vlanId:10}],
    ['matriz-wifi',{vlanId:10}],
    ['matriz-ap',{ssid:'   ',password:'senha-lab',vlanId:10}],
    ['matriz-wifi',{ssid:'Equipe',vlanId:10}],
    ['matriz-ap',{ssid:'Equipe',auth:'unknown',password:'senha-lab',vlanId:10}],
    ['matriz-ap',{ssid:'Equipe',auth:'open',password:'senha-lab',vlanId:10}]
  ]) {
    assert.throws(()=>change(n,id,{wifi}));
    assert.equal(JSON.stringify(n),before);
  }
  n=act(n,{type:'removeDevice',deviceId:'matriz-ap'});
  n=act(n,{type:'addDevice',device:{id:'matriz-ap',type:'ap',siteId:'matriz'}});
  n=act(n,{type:'configurePort',deviceId:'matriz-ap',portId:'eth0',config:{vlanId:10}});
  n=act(n,{type:'connect',link:{id:'matriz-radio',from:{deviceId:'matriz-sw',portId:'p4'},to:{deviceId:'matriz-ap',portId:'eth0'}}});
  assert.equal(diag(n,{type:'dhcp',deviceId:'matriz-wifi'}).ok,false);
  assert.equal(ping(n,'matriz-wifi','matriz-srv').ok,false);
  assert.equal(status(n).facts.wifiReady,false);
  assert.ok(ping(n,'matriz-pc','matriz-srv').ok);
});

test('Rede Wi-Fi explicitamente aberta funciona sem senha; autenticações distintas não associam',()=>{
  const full=fixture();
  let n={sites:full.sites.filter(s=>s.id==='matriz'),devices:full.devices.filter(d=>d.siteId==='matriz'),links:full.links.filter(l=>l.id.startsWith('matriz-'))};
  n=change(n,'matriz-ap',{wifi:{enabled:true,ssid:'Visitantes',auth:'open',vlanId:10}});
  n=change(n,'matriz-wifi',{wifi:{ssid:'Visitantes',password:'senha-lab',vlanId:10}});
  assert.equal(diag(n,{type:'dhcp',deviceId:'matriz-wifi'}).ok,false);
  assert.equal(status(n).facts.wifiReady,false);
  n=change(n,'matriz-wifi',{wifi:{ssid:'Visitantes',auth:'open',vlanId:10}});
  assert.ok(diag(n,{type:'dhcp',deviceId:'matriz-wifi'}).ok);
  assert.ok(ping(n,'matriz-wifi','matriz-srv').ok);
  assert.equal(status(n).facts.wifiReady,true);
  assert.equal(ping(change(n,'matriz-wifi',{wifi:{ssid:'Outro',auth:'open',vlanId:10}}),'matriz-wifi','matriz-srv').ok,false);
});

