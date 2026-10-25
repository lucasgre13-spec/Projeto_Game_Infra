const clone = value => JSON.parse(JSON.stringify(value));
const fail = message => { throw new Error(message); };
const known = (items, id, label) => items.find(item => item.id === id) || fail(label + ' inexistente: ' + id);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' && value.trim().length > 0;
const types = ['fortigate', 'switch', 'ap', 'client', 'server', 'provider'];
const fields = (names) => names.split(' ').map(name => ({name, type: ['enabled','online','dhcp','nat'].includes(name)?'boolean':['vlanId','priority','metric'].includes(name)?'number':'text', label: ({cidr:'IPv4/prefixo',vlanId:'VLAN',portId:'Porta',destination:'Destino',source:'Origem',action:'Ação',nat:'Traduzir endereço',priority:'Prioridade'})[name] || name}));
export const NETWORK_CATALOG = {
  title: 'Nexo Lab — rede educativa',
  deviceTypes: types.map(type => ({type, label: ({fortigate:'FortiGate educativo',switch:'Switch',ap:'Ponto de acesso',client:'Cliente',server:'Servidor',provider:'Provedor'})[type], ports: type === 'fortigate' ? ['lan','wan1','wan2'] : type === 'switch' ? ['p1','p2','p3','p4','p5','p6','p7','p8'] : ['eth0']})),
  siteFields: fields('id name'),
  deviceFields: fields('id name type siteId'),
  portFields: fields('enabled cidr mode vlanId allowedVlans').map(f=>f.name==='mode'?{...f,type:'select',options:['access','trunk']}:f.name==='allowedVlans'?{...f,type:'number-list'}:f),
  configFields: {
    client: [...fields('cidr gateway dns dhcp vlanId'),{name:'wifi',type:'object',fields:fields('enabled ssid auth password vlanId').map(f=>f.name==='auth'?{...f,label:'Autenticação',type:'select',options:['psk','open'],default:'psk'}:f)}], server: fields('cidr gateway dns vlanId'),
    ap: [{name:'wifi', type:'object', fields:fields('enabled ssid auth password vlanId').map(f=>f.name==='auth'?{...f,label:'Autenticação',type:'select',options:['psk','open'],default:'psk'}:f)}],
    fortigate: [], switch: [], provider: fields('online')
  },
  collections: {
    interfaces: {deviceTypes:['fortigate'],fields:fields('id portId cidr vlanId'), references:{portId:'device.ports'}},
    routes: {deviceTypes:['fortigate'],fields:fields('id destination via metric'), references:{via:'device.config.wans|device.config.tunnels|device.ports'}},
    policies: {deviceTypes:['fortigate'],fields:fields('id source destination service action nat outInterface').map(f=>f.name==='action'?{...f,type:'select',options:['accept','deny']}:f.name==='service'?{...f,type:'select',options:['any','icmp','dns','dhcp','https']}:f), ordered:true},
    wans: {deviceTypes:['fortigate'],fields:fields('id portId providerId gateway priority'), references:{portId:'device.ports',providerId:'devices:provider'}},
    tunnels: {deviceTypes:['fortigate'],fields:fields('id peerType peerId localCidr remoteCidr profile enabled').map(f=>f.name==='peerType'?{...f,type:'select',options:['site','aws']}:f), references:{peerId:'sites|cloud.vpn'}},
    pools: {deviceTypes:['server','fortigate'],fields:fields('id network start end gateway dns vlanId enabled')},
    records: {deviceTypes:['server'],fields:fields('id name address')}
  },
  actions:['addSite','removeSite','addDevice','removeDevice','connect','disconnect','configureDevice','configurePort','setRecord','removeRecord','moveRecord','setLinkState','setDeviceState','injectIncident'],
  defaults:{port:{enabled:true,mode:'access',vlanId:1,allowedVlans:[1],cidr:''},client:{dhcp:false,cidr:'',gateway:'',dns:'',vlanId:1}},
  help:'Modelo educativo: Ethernet sem STP ou desempenho, IPv4, VLAN, DHCP sem temporização, DNS A, políticas em ordem, NAT de saída, seleção WAN por prioridade e VPN por perfil compartilhado. Não emula a CLI FortiOS completa. Wi-Fi exige SSID; psk usa senha compartilhada e open representa uma rede explicitamente aberta. Nenhum comando acessa a rede ou o sistema operacional.'
};
export const networkCatalog = NETWORK_CATALOG;
export const NETWORK_HELP = NETWORK_CATALOG.help;
export function createNetworkState() { return {sites:[],devices:[],links:[]}; }
function ipNumber(ip) {
  if (typeof ip !== 'string' || !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(ip) || ip.split('.').some(x => +x > 255)) fail('IPv4 inválido.');
  return ip.split('.').reduce((n,x) => n * 256 + +x, 0);
}
export function parseCIDR(cidr) {
  if (typeof cidr !== 'string' || !/^.+\/(0|[1-9]|[12]\d|3[0-2])$/.test(cidr)) fail('CIDR inválido: use IPv4/prefixo.');
  const [ip,p] = cidr.split('/'), prefix = +p, value=ipNumber(ip), size=2 ** (32-prefix), network=Math.floor(value/size)*size;
  return {ip,prefix,value,network,broadcast:network+size-1};
}
const privateIp = ip => ['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16'].some(c=>contains(c,ip));
const contains = (cidr, ip) => { const c=parseCIDR(cidr), n=ipNumber(ip); return n>=c.network && n<=c.broadcast; };
const sameNetwork = (a,b) => {const x=parseCIDR(a),y=parseCIDR(b);return x.prefix===y.prefix && x.network===y.network;};
const vlanValid = n => Number.isInteger(n) && n>=1 && n<=4094;
const getDevice = (n,id) => known(n.devices,id,'Equipamento');
const getPort = (d,id) => known(d.ports,id,'Porta');
const enabled = d => d.enabled !== false;
const allInterfaces = d => [...d.ports.filter(p=>p.cidr).map(p=>({id:p.id,portId:p.id,cidr:p.cidr,vlanId:p.vlanId})),...list(d.config.interfaces)].filter(i=>enabled(getPort(d,i.portId)));
const endpointKey = e => e.deviceId + ':' + e.portId;
function validateWifi(w) {
  if(!w || typeof w!=='object' || Array.isArray(w))fail('Wi-Fi deve conter uma configuração válida.');
  if(!text(w.ssid))fail('SSID Wi-Fi deve ser um nome não vazio.');
  const auth=w.auth===undefined?'psk':w.auth;
  if(!['psk','open'].includes(auth))fail('Autenticação Wi-Fi deve ser psk ou open.');
  if(auth==='psk'&&!text(w.password))fail('Autenticação Wi-Fi psk exige uma senha compartilhada.');
  if(auth==='open'&&w.password!==undefined&&w.password!=='')fail('Rede Wi-Fi aberta não usa senha.');
}
function validateConfig(d) {
  const c=d.config;
  const configKeys=['cidr','gateway','dns','dhcp','vlanId','wifi','online',...Object.keys(NETWORK_CATALOG.collections)];
  if(Object.keys(c).some(k=>!configKeys.includes(k)))fail('Campo de configuração desconhecido.');
  const portIds=new Set(); for(const p of d.ports) {if(!text(p.id)||portIds.has(p.id))fail('Identificador de porta inválido ou repetido.');portIds.add(p.id);}
  for(const key of ['dhcp','online']) if(c[key]!==undefined && typeof c[key]!=='boolean')fail('Estado de serviço deve ser booleano.');
  if(typeof d.enabled!=='boolean')fail('Estado do equipamento inválido.');
  for(const key of ['cidr']) if(c[key]) parseCIDR(c[key]);
  for(const key of ['gateway','dns']) if(c[key]) ipNumber(c[key]);
  if(c.vlanId !== undefined && !vlanValid(c.vlanId)) fail('VLAN deve estar entre 1 e 4094.');
  if(c.wifi) { if(!['client','ap'].includes(d.type))fail('Associação Wi-Fi exige cliente ou AP.'); validateWifi(c.wifi); if(c.wifi.enabled!==undefined&&typeof c.wifi.enabled!=='boolean')fail('Estado Wi-Fi inválido.'); if(c.wifi.vlanId !== undefined && !vlanValid(c.wifi.vlanId)) fail('VLAN Wi-Fi inválida.'); }
  for(const p of d.ports) {
    if(!['access','trunk'].includes(p.mode) || !vlanValid(p.vlanId) || !Array.isArray(p.allowedVlans) || p.allowedVlans.some(v=>!vlanValid(v))) fail('Configuração VLAN inválida.');
    if(p.cidr) parseCIDR(p.cidr);
    if(typeof p.enabled !== 'boolean') fail('Estado da porta inválido.');
  }
  for(const [collection,schema] of Object.entries(NETWORK_CATALOG.collections)) {
    if(list(c[collection]).length && ((['routes','policies','wans','tunnels','interfaces'].includes(collection)&&d.type!=='fortigate')||(collection==='pools'&&!['server','fortigate'].includes(d.type))||(collection==='records'&&d.type!=='server')))fail('Serviço incompatível com o tipo do equipamento.');
    if(c[collection] !== undefined && !Array.isArray(c[collection])) fail('Coleção inválida: ' + collection);
    const ids = new Set();
    for(const r of list(c[collection])) {
      if(!text(r.id) || ids.has(r.id)) fail('Identificador de registro inválido ou repetido.'); ids.add(r.id);
      for(const k of ['cidr','network','destination','localCidr','remoteCidr']) if(r[k] && r[k]!=='any') parseCIDR(r[k]);
      for(const k of ['gateway','dns','start','end','address']) if(r[k]) ipNumber(r[k]);
      if(r.enabled!==undefined&&typeof r.enabled!=='boolean')fail('Estado do registro inválido.');
      for(const key of ['metric','priority'])if(r[key]!==undefined&&(!Number.isFinite(r[key])||r[key]<0))fail('Prioridade inválida.');
      if(r.vlanId!==undefined && !vlanValid(r.vlanId)) fail('VLAN do registro inválida.');
      if(collection==='policies') {
        if(!['accept','deny'].includes(r.action)) fail('Política exige accept ou deny.');
        if(r.source && r.source!=='any') parseCIDR(r.source);
        if(r.nat!==undefined && typeof r.nat!=='boolean') fail('NAT deve ser booleano.');
      }
      if(collection==='interfaces' || collection==='wans') getPort(d,r.portId);
      if(collection==='interfaces'&&!r.cidr)fail('Interface exige IPv4/prefixo.');
      if(collection==='routes'&&(!r.destination||!text(r.via)))fail('Rota exige destino e próximo caminho.');
      if(collection==='wans'&&(!text(r.providerId)||!r.gateway))fail('WAN exige provedor e gateway.');
      if(collection==='records'&&(!text(r.name)||!r.address))fail('Registro DNS exige nome e IPv4.');
      if(collection==='pools') {
        if(!r.network || !r.start || !r.end || !contains(r.network,r.start) || !contains(r.network,r.end) || ipNumber(r.start)>ipNumber(r.end)) fail('Pool DHCP incoerente.');
        if(r.gateway && !contains(r.network,r.gateway)) fail('Gateway DHCP fora da sub-rede.');
      }
      if(collection==='tunnels' && (!['site','aws'].includes(r.peerType) || !text(r.peerId) || !r.localCidr || !r.remoteCidr || !text(r.profile))) fail('Perfil ou redes do túnel inválidos.');
    }
  }
}
function validateNetwork(n) {
  if(!n || !['sites','devices','links'].every(k=>Array.isArray(n[k]))) fail('Estado da rede inválido.');
  for(const items of [n.sites,n.devices,n.links]) { const ids=new Set(); for(const item of items) {if(!text(item.id)||ids.has(item.id)) fail('Identificador inválido ou repetido.');ids.add(item.id);} }
  for(const d of n.devices) { known(n.sites,d.siteId,'Local');if(!types.includes(d.type)) fail('Tipo de equipamento inválido.');validateConfig(d); }
  const occupied=new Set();
  for(const l of n.links) {
    if(typeof l.enabled!=='boolean')fail('Estado do enlace inválido.');
    for(const e of [l.from,l.to]) {getPort(getDevice(n,e.deviceId),e.portId); const key=endpointKey(e);if(occupied.has(key))fail('Porta ocupada.');occupied.add(key);}
    if(l.from.deviceId===l.to.deviceId) fail('Enlace deve unir equipamentos diferentes.');
    if(getDevice(n,l.from.deviceId).siteId!==getDevice(n,l.to.deviceId).siteId) fail('Enlaces físicos devem permanecer no mesmo local.');
  }
  for(const d of n.devices) for(const w of list(d.config.wans)) if(getDevice(n,w.providerId).type!=='provider') fail('WAN exige um provedor existente.');
}
function makeDevice(input) {
  const type=input.type;
  if(!types.includes(type)) fail('Tipo de equipamento inválido.');
  const ports=NETWORK_CATALOG.deviceTypes.find(d=>d.type===type).ports.map(id=>({id,...clone(NETWORK_CATALOG.defaults.port)}));
  return {id:input.id,name:input.name||input.id,type,siteId:input.siteId,enabled:true,ports,config:{...(type==='client'?clone(NETWORK_CATALOG.defaults.client):{}),...clone(input.config||{})}};
}
export function applyNetworkAction(network, action) {
  validateNetwork(network);
  if(!action || !text(action.type)) fail('Ação de rede inválida.');
  const n=clone(network), a=action;
  if(a.type==='addSite') n.sites.push({...clone(a.site||{id:a.id,name:a.name}),name:(a.site||a).name||(a.site||a).id});
  else if(a.type==='removeSite') {known(n.sites,a.siteId,'Local');if(n.devices.some(d=>d.siteId===a.siteId)) fail('Remova os equipamentos antes do local.');n.sites=n.sites.filter(s=>s.id!==a.siteId);}
  else if(a.type==='addDevice') n.devices.push(makeDevice(a.device||a));
  else if(a.type==='removeDevice') {getDevice(n,a.deviceId);n.devices=n.devices.filter(d=>d.id!==a.deviceId);n.links=n.links.filter(l=>![l.from.deviceId,l.to.deviceId].includes(a.deviceId)); for(const d of n.devices)d.config.wans=list(d.config.wans).filter(w=>w.providerId!==a.deviceId);}
  else if(a.type==='connect') n.links.push({enabled:true,...clone(a.link||{id:a.id,from:a.from,to:a.to})});
  else if(a.type==='disconnect') {known(n.links,a.linkId,'Enlace');n.links=n.links.filter(l=>l.id!==a.linkId);}
  else if(a.type==='configureDevice') Object.assign(getDevice(n,a.deviceId).config,clone(a.config||{}));
  else if(a.type==='configurePort') { if(Object.keys(a.config||{}).some(k=>!['enabled','cidr','mode','vlanId','allowedVlans'].includes(k)))fail('Campo de porta desconhecido.'); Object.assign(getPort(getDevice(n,a.deviceId),a.portId),clone(a.config||{})); }
  else if(a.type==='setRecord') {
    if(!own(NETWORK_CATALOG.collections,a.collection)) fail('Coleção desconhecida.');
    const c=getDevice(n,a.deviceId).config, rows=c[a.collection] ||= [], record=clone({...a.record,id:a.id||a.record?.id}), idx=rows.findIndex(r=>r.id===record.id);
    if(idx<0)rows.push(record);else rows[idx]=record;
  } else if(a.type==='removeRecord' || a.type==='moveRecord') {
    if(!own(NETWORK_CATALOG.collections,a.collection)) fail('Coleção desconhecida.');
    const rows=getDevice(n,a.deviceId).config[a.collection]||[],idx=rows.findIndex(r=>r.id===a.id);
    if(idx<0)fail('Registro inexistente.');
    const [r]=rows.splice(idx,1);
    if(a.type==='moveRecord') {if(!Number.isInteger(a.index)||a.index<0||a.index>rows.length)fail('Posição inválida.'); rows.splice(a.index,0,r);}
  } else if(a.type==='setLinkState') {if(typeof a.enabled!=='boolean')fail('Estado inválido.');known(n.links,a.linkId,'Enlace').enabled=a.enabled;}
  else if(a.type==='setDeviceState') {if(typeof a.enabled!=='boolean')fail('Estado inválido.');getDevice(n,a.deviceId).enabled=a.enabled;}
  else if(a.type==='injectIncident') {
    if(!a.change || a.change.type==='injectIncident') fail('Incidente exige uma alteração observável.');
    const before=a.query ? diagnoseNetwork(n,a.query) : null;
    if(!before?.ok) fail('O incidente exige uma consulta que funciona antes da falha.');
    const changed=applyNetworkAction(n,a.change), after=diagnoseNetwork(changed,a.query);
    if(after.ok && (!before.activeWanId || after.activeWanId===before.activeWanId)) fail('A alteração não muda a disponibilidade nem o caminho observado.');
    changed.incidents ||= [];
    changed.incidents.push({id:a.id||'incident-'+changed.incidents.length,query:clone(a.query),change:clone(a.change),previousWanId:before.activeWanId||null});
    return changed;
  } else fail('Ação desconhecida: ' + a.type);
  validateNetwork(n);
  return n;
}
function portAllows(p,vlan) {return enabled(p) && (p.mode==='trunk'?p.allowedVlans.includes(vlan):p.vlanId===vlan);}
function wifiAP(n,d) {
  const w=d.config.wifi;
  if(!w || w.enabled===false || !text(w.ssid)) return null;
  return n.devices.find(ap=>ap.siteId===d.siteId && ap.type==='ap' && enabled(ap) && ap.config.wifi?.enabled!==false && text(ap.config.wifi?.ssid) && ap.config.wifi.ssid===w.ssid && (ap.config.wifi.auth||'psk')===(w.auth||'psk') && ((w.auth||'psk')==='open' || (text(w.password) && ap.config.wifi.password===w.password)) && (ap.config.wifi.vlanId||1)===(w.vlanId||d.config.vlanId||1));
}
function l2Path(n,source,target,vlan) {
  if(!enabled(source)||!enabled(target))return null;
  const start=source.type==='client'&&source.config.wifi ? wifiAP(n,source) : source;
  if(!start)return null;
  const queue=[{id:start.id,path:source.id===start.id?[source.id]:[source.id,start.id]}],seen=new Set();
  while(queue.length) {
    const item=queue.shift(),d=getDevice(n,item.id);
    if(d.id===target.id)return item.path;
    if(seen.has(d.id))continue;seen.add(d.id);
    if(d.id!==start.id && !['switch','ap'].includes(d.type))continue;
    for(const l of n.links.filter(enabled)) {
      const from=l.from.deviceId===d.id?l.from:l.to.deviceId===d.id?l.to:null;
      if(!from)continue;
      const to=from===l.from?l.to:l.from,other=getDevice(n,to.deviceId);
      if(!enabled(other))continue;
      const p=getPort(d,from.portId),q=getPort(other,to.portId);
      if(portAllows(p,vlan)&&portAllows(q,vlan))queue.push({id:other.id,path:[...item.path,l.id,other.id]});
    }
  }
  return null;
}
function pathToInterface(n,source,device,iface,vlan) {
  if(iface.vlanId!==vlan)return null;
  const lastLinks=n.links.filter(l=>enabled(l) && ((l.from.deviceId===device.id&&l.from.portId===iface.portId)||(l.to.deviceId===device.id&&l.to.portId===iface.portId)));
  if(!lastLinks.length)return null;
  // The target interface must be the actual last hop, so an unrelated router port cannot satisfy reachability.
  const reduced={...n,links:n.links.filter(l=>![l.from,l.to].some(e=>e.deviceId===device.id&&e.portId!==iface.portId))};
  return l2Path(reduced,source,device,vlan);
}
function staticAddress(d) {
  const cidr=d.config.cidr;
  if(!cidr)return null;
  return {cidr,ip:parseCIDR(cidr).ip,gateway:d.config.gateway||'',dns:d.config.dns||'',vlanId:d.config.wifi?.vlanId||d.config.vlanId||1,source:'static'};
}
function address(n,d) {
  if(!enabled(d))return null;
  if(!d.config.dhcp)return staticAddress(d);
  const vlan=d.config.wifi?.vlanId||d.config.vlanId||1;
  for(const server of n.devices.filter(x=>x.siteId===d.siteId&&enabled(x))) {
    const sa=staticAddress(server) || (allInterfaces(server)[0] ? {cidr:allInterfaces(server)[0].cidr,vlanId:allInterfaces(server)[0].vlanId} : null);
    if(!sa || sa.vlanId!==vlan || !l2Path(n,d,server,vlan))continue;
    for(const p of list(server.config.pools)) {
      if(p.enabled===false || (p.vlanId||1)!==vlan || !sameNetwork(sa.cidr,p.network))continue;
      const peers=n.devices.filter(x=>x.siteId===d.siteId&&x.config.dhcp&&(x.config.vlanId||1)===vlan).sort((a,b)=>a.id.localeCompare(b.id));
      let value=ipNumber(p.start), remaining=peers.findIndex(x=>x.id===d.id);
      const excluded=new Set(n.devices.map(staticAddress).filter(Boolean).map(a=>ipNumber(a.ip)));
      if(p.gateway)excluded.add(ipNumber(p.gateway));
      while(remaining >= 0) { while(excluded.has(value))value++; if(remaining===0)break; remaining--; value++; }
      const subnet=parseCIDR(p.network);
      if(value>ipNumber(p.end)||value<=subnet.network||value>=subnet.broadcast)continue;
      const ip=[24,16,8,0].map(shift=>Math.floor(value/2**shift)%256).join('.');
      return {cidr:ip+'/'+subnet.prefix,ip,gateway:p.gateway||'',dns:p.dns||'',vlanId:vlan,source:'dhcp',serverId:server.id,poolId:p.id};
    }
  }
  return null;
}
function policy(fw,src,dst,service,out) {
  return list(fw.config.policies).find(p=>(!p.source||p.source==='any'||contains(p.source,src))&&(!p.destination||p.destination==='any'||contains(p.destination,dst))&&(!p.service||p.service==='any'||p.service===service)&&(!p.outInterface||p.outInterface==='any'||p.outInterface===out));
}
function routes(fw,dest) {return list(fw.config.routes).filter(r=>contains(r.destination,dest)).sort((a,b)=>parseCIDR(b.destination).prefix-parseCIDR(a.destination).prefix||(a.metric||0)-(b.metric||0));}
function eligibleWans(n,fw) {
  if(!enabled(fw))return [];
  return list(fw.config.wans).filter(w=>{
    const p=getPort(fw,w.portId),provider=n.devices.find(d=>d.id===w.providerId);
    if(!provider||provider.type!=='provider'||!enabled(provider)||provider.config.online===false||!enabled(p)||!p.cidr||!w.gateway||!contains(p.cidr,w.gateway))return false;
    const providerInterface=allInterfaces(provider).find(i=>parseCIDR(i.cidr).ip===w.gateway);
    return !!providerInterface && !!pathToInterface(n,fw,provider,providerInterface,p.vlanId) && list(fw.config.routes).some(r=>r.destination==='0.0.0.0/0'&&r.via===w.id);
  }).sort((a,b)=>(a.priority||0)-(b.priority||0));
}
function gateway(n,d,a) {
  if(!a.gateway||!contains(a.cidr,a.gateway))return null;
  for(const fw of n.devices.filter(x=>x.siteId===d.siteId&&x.type==='fortigate'&&enabled(x)))for(const i of allInterfaces(fw))if(parseCIDR(i.cidr).ip===a.gateway&&pathToInterface(n,d,fw,i,a.vlanId))return {fw,iface:i};
  return null;
}
function tunnelState(n,fw,t) {
  if(t.enabled===false||!eligibleWans(n,fw).length)return false;
  const local=allInterfaces(fw).some(i=>sameNetwork(i.cidr,t.localCidr));
  const route=list(fw.config.routes).some(r=>sameNetwork(r.destination,t.remoteCidr)&&r.via===t.id);
  const permit=policy(fw,parseCIDR(t.localCidr).ip,parseCIDR(t.remoteCidr).ip,'icmp',t.id);
  if(!local||!route||permit?.action!=='accept')return false;
  if(t.peerType==='aws')return true;
  const remote=n.devices.find(d=>d.type==='fortigate'&&d.siteId===t.peerId&&enabled(d));
  if(!remote||!eligibleWans(n,remote).length)return false;
  const reciprocal=list(remote.config.tunnels).find(p=>p.enabled!==false&&p.peerType==='site'&&p.peerId===fw.siteId&&p.profile===t.profile&&sameNetwork(p.localCidr,t.remoteCidr)&&sameNetwork(p.remoteCidr,t.localCidr));
  if(!reciprocal||!allInterfaces(remote).some(i=>sameNetwork(i.cidr,reciprocal.localCidr)))return false;
  return list(remote.config.routes).some(r=>sameNetwork(r.destination,t.localCidr)&&r.via===reciprocal.id)&&policy(remote,parseCIDR(t.remoteCidr).ip,parseCIDR(t.localCidr).ip,'icmp',reciprocal.id)?.action==='accept';
}
function result(ok,stage,observations,extra={}) {return {ok,stage,symptom:ok?'Tráfego alcançou o destino.':observations,observations:[observations],path:[],...extra};}
function traffic(n,sourceId,destination,service='icmp') {
  const d=getDevice(n,sourceId),a=address(n,d);
  if(!enabled(d))return result(false,'physical','Equipamento desligado.');
  if(d.config.wifi&&!wifiAP(n,d))return result(false,'wifi','Nenhum AP compatível com a associação Wi-Fi.');
  if(!a)return result(false,'addressing','Cliente sem endereço utilizável.');
  let target=n.devices.find(x=>x.id===destination),dest;
  if(target) {const ta=address(n,target);dest=ta?.ip||allInterfaces(target)[0]?.cidr.split('/')[0];if(!dest)return result(false,'addressing','Destino sem IPv4.');}
  else { dest=destination==='internet'?'1.1.1.1':destination;ipNumber(dest); target=n.devices.find(x=>address(n,x)?.ip===dest||allInterfaces(x).some(i=>parseCIDR(i.cidr).ip===dest)); }
  if(target?.id===d.id)return result(true,'local','Endereço do próprio equipamento.',{address:a,path:[d.id]});
  if(contains(a.cidr,dest)) {
    let path=target&&l2Path(n,d,target,a.vlanId);
    if(target?.type==='fortigate') {const i=allInterfaces(target).find(x=>parseCIDR(x.cidr).ip===dest);path=i&&pathToInterface(n,d,target,i,a.vlanId);}
    return path?result(true,'lan','Destino acessível na mesma sub-rede.',{path,address:a}):result(false,'physical','Sem caminho Ethernet/VLAN até o destino.',{address:a});
  }
  const gw=gateway(n,d,a);
  if(!gw)return result(false,'gateway','Gateway não está alcançável na sub-rede do cliente.',{address:a});
  const fw=gw.fw, route=routes(fw,dest)[0], direct=allInterfaces(fw).filter(i=>contains(i.cidr,dest)).sort((a,b)=>parseCIDR(b.cidr).prefix-parseCIDR(a.cidr).prefix)[0], connected=direct&&(!route||parseCIDR(direct.cidr).prefix>=parseCIDR(route.destination).prefix)?direct:null,out=connected?.id||route?.via;
  if(!out)return result(false,'routing','Nenhuma rota corresponde ao destino.');
  const rule=policy(fw,a.ip,dest,service,out);
  if((connected||list(fw.config.tunnels).some(t=>t.id===out))&&rule?.action!=='accept')return result(false,'firewall',rule?'A primeira política correspondente bloqueia o tráfego.':'Bloqueio padrão: nenhuma política corresponde.',{policyId:rule?.id||null});
  const tunnel=list(fw.config.tunnels).find(t=>t.id===out);
  if(tunnel) {
    if(!contains(tunnel.localCidr,a.ip)||!contains(tunnel.remoteCidr,dest)||!tunnelState(n,fw,tunnel))return result(false,'vpn','Túnel sem pares, redes ou caminho compatíveis.');
    if(target) {
      const ta=address(n,target),remote=n.devices.find(x=>x.siteId===target.siteId&&x.type==='fortigate'),ri=remote&&allInterfaces(remote).find(i=>contains(i.cidr,dest));
      if(!ta||!ri||!pathToInterface(n,target,remote,ri,ta.vlanId)||ta.gateway!==parseCIDR(ri.cidr).ip)return result(false,'vpn','Caminho LAN remoto ou gateway de retorno indisponível.');
    }
    return result(true,'vpn','Tráfego atravessou o túnel educativo.',{tunnelId:tunnel.id,path:[d.id,fw.id,tunnel.id,target?.id||dest]});
  }
  if(connected) {
    const ta=target&&address(n,target);
    if(!target||!ta||!pathToInterface(n,target,fw,connected,ta.vlanId)||ta.gateway!==parseCIDR(connected.cidr).ip)return result(false,'routing','Destino conectado sem caminho ou gateway de retorno.');
    return result(true,'routing','Política permitiu o tráfego entre sub-redes.',{path:[d.id,fw.id,target.id],policyId:rule.id});
  }
  const candidates=eligibleWans(n,fw).filter(w=>routes(fw,dest).some(r=>r.via===w.id));
  // Every alternate path must independently pass its ordered policy and NAT checks.
  const usable=candidates.filter(w=>{const p=policy(fw,a.ip,dest,service,w.id);return p?.action==='accept'&&(!privateIp(a.ip)||p.nat===true);});
  if(!usable.length) {
    const hasAccept=candidates.some(w=>policy(fw,a.ip,dest,service,w.id)?.action==='accept');
    return result(false,hasAccept?'nat':candidates.length?'firewall':'wan',hasAccept?'Saída privada sem NAT.':candidates.length?'A primeira política correspondente ou o bloqueio padrão impede o tráfego.':'Nenhum caminho WAN completo permite este tráfego.');
  }
  if(privateIp(dest) || (target && target.siteId!==d.siteId))return result(false,'vpn','Destino privado remoto exige um túnel compatível.');
  const wan=usable[0];
  return result(true,'internet','Saída por provedor disponível com política e NAT.',{activeWanId:wan.id,path:[d.id,fw.id,wan.id,wan.providerId,dest],policyId:policy(fw,a.ip,dest,service,wan.id).id});
}
export function diagnoseNetwork(network, query={}) {
  validateNetwork(network);
  try {
    const q=query,type=q.type||'ping';
    if(type==='interfaces') {const d=getDevice(network,q.deviceId);return result(true,'inspection','Interfaces observadas.',{device:clone(d),interfaces:allInterfaces(d),address:address(network,d)});}
    if(type==='routes') {const d=getDevice(network,q.deviceId);return result(true,'inspection','Rotas configuradas.',{routes:clone(list(d.config.routes)),wans:clone(eligibleWans(network,d))});}
    if(type==='dns'||type==='nslookup') {
      const d=getDevice(network,q.sourceId||q.deviceId),a=address(network,d);
      if(!a?.dns)return result(false,'dns','Cliente sem servidor DNS.');
      const reach=traffic(network,d.id,a.dns,'dns');
      if(!reach.ok)return {...reach,stage:'dns',observations:[...reach.observations,'Servidor DNS inacessível.']};
      const server=network.devices.find(x=>address(network,x)?.ip===a.dns),record=list(server?.config.records).find(r=>r.name===q.name);
      return record?result(true,'dns','Registro A encontrado.',{answer:record.address,path:reach.path}):result(false,'dns','Servidor acessível, registro não encontrado.');
    }
    if(type==='dhcp') {const d=getDevice(network,q.sourceId||q.deviceId),a=address(network,d);return result(a?.source==='dhcp','dhcp',a?.source==='dhcp'?'Lease calculado a partir do pool e caminho.':'Nenhum lease DHCP utilizável.',{address:a});}
    if(type==='ping'||type==='traceroute')return traffic(network,q.sourceId||q.deviceId,q.target||q.destination||'internet',q.service||'icmp');
    return result(false,'command','Consulta educativa desconhecida.');
  } catch(error) {return result(false,'input',error.message);}
}
export function getNetworkStatus(n) {
  validateNetwork(n);
  const clients=n.devices.filter(d=>d.type==='client');
  const observations=clients.map(d=>({deviceId:d.id,address:address(n,d),internet:diagnoseNetwork(n,{sourceId:d.id,target:'internet'})}));
  const sites=n.sites.map(s=>{
    const cs=clients.filter(d=>d.siteId===s.id),fws=n.devices.filter(d=>d.siteId===s.id&&d.type==='fortigate'),internet=cs.map(d=>diagnoseNetwork(n,{sourceId:d.id,target:'internet'})).find(r=>r.ok);
    const lanReady=cs.some(d=>{const a=address(n,d);return a&&n.devices.some(t=>t.id!==d.id&&t.siteId===s.id&&diagnoseNetwork(n,{sourceId:d.id,target:t.id}).ok);});
    const vpnPeers=fws.flatMap(f=>list(f.config.tunnels).filter(t=>tunnelState(n,f,t)).map(t=>({tunnelId:t.id,peerType:t.peerType,peerId:t.peerId,localCidr:t.localCidr,remoteCidr:t.remoteCidr,profile:t.profile}))); return {id:s.id,lanReady,internetReady:!!internet,activeWanId:internet?.activeWanId||null,vpnReady:vpnPeers.length>0,vpnPeers};
  });
  const physicalReady=clients.some(d=>n.devices.some(t=>t.siteId===d.siteId&&t.id!==d.id&&['server','fortigate'].includes(t.type)&&l2Path(n,d,t,d.config.vlanId||1)));
  const facts={
    physicalReady,
    addressingReady:sites.some(s=>s.lanReady),
    vlanReady:clients.some(d=>{const a=address(n,d);return a?.vlanId>1&&n.devices.some(t=>t.id!==d.id&&t.siteId===d.siteId&&diagnoseNetwork(n,{sourceId:d.id,target:t.id}).ok);}),
    dhcpReady:observations.some(o=>o.address?.source==='dhcp'&&sites.find(s=>s.id===getDevice(n,o.deviceId).siteId)?.lanReady),
    dnsReady:clients.some(d=>n.devices.some(s=>list(s.config.records).some(r=>diagnoseNetwork(n,{type:'dns',sourceId:d.id,name:r.name}).ok))),
    wifiReady:clients.some(d=>d.config.wifi&&wifiAP(n,d)&&sites.find(s=>s.id===d.siteId)?.lanReady&&n.devices.some(t=>t.id!==d.id&&t.siteId===d.siteId&&diagnoseNetwork(n,{sourceId:d.id,target:t.id}).ok)),
    routingReady:clients.some(d=>n.devices.some(t=>t.id!==d.id&&diagnoseNetwork(n,{sourceId:d.id,target:t.id}).stage==='routing'&&diagnoseNetwork(n,{sourceId:d.id,target:t.id}).ok))||sites.some(s=>s.internetReady),
    firewallReady:observations.some(o=>o.internet.ok)||clients.some(d=>n.devices.some(t=>diagnoseNetwork(n,{sourceId:d.id,target:t.id}).ok&&['routing','vpn'].includes(diagnoseNetwork(n,{sourceId:d.id,target:t.id}).stage))),
    natReady:sites.some(s=>s.internetReady),
    redundancyReady:n.devices.some(f=>f.type==='fortigate'&&eligibleWans(n,f).filter(w=>clients.some(d=>{const a=address(n,d);const p=a&&policy(f,a.ip,'1.1.1.1','icmp',w.id);return d.siteId===f.siteId&&gateway(n,d,a)?.fw.id===f.id&&p?.action==='accept'&&p.nat===true;})).length>=2),
    failoverRecovered:list(n.incidents).some(i=>{const r=diagnoseNetwork(n,i.query);return i.previousWanId&&r.ok&&r.activeWanId&&r.activeWanId!==i.previousWanId;}),
    vpnReady:sites.some(s=>s.vpnReady),
    incidentRecovered:list(n.incidents).some(i=>diagnoseNetwork(n,i.query).ok)
  };
  return {sites,onlineSites:sites.filter(s=>s.internetReady).map(s=>s.id),vpnReady:facts.vpnReady,facts,observations};
}
export const NETWORK_COMMANDS = [
  'help','show interfaces','show config','show routes','ping <IPv4|equipamento|internet>','traceroute <destino>','nslookup <nome>','dhcp',
  'set address <IPv4/prefixo> [gateway] [dns]','set dhcp <on|off>','set port <porta> <access|trunk> <VLAN|VLANs separadas por vírgula>',
  'set link <enlace> <up|down>','set device <up|down>'
];
function tokenize(command) {
  if(typeof command!=='string')fail('Comando deve ser texto.');
  const tokens=command.match(/"[^"]*"|'[^']*'|\S+/g)||[];
  if(tokens.some(t=>(t.startsWith('"')&&!t.endsWith('"'))||(t.startsWith("'")&&!t.endsWith("'"))))fail('Aspas incompletas.');
  return tokens.map(t=>/^["']/.test(t)?t.slice(1,-1):t);
}
export function executeNetworkCommand(network,deviceId,command) {
  try {
    getDevice(network,deviceId);
    const t=tokenize(command),cmd=t.join(' ');
    if(cmd==='help')return {ok:true,network,state:network,output:NETWORK_HELP+'\n'+NETWORK_COMMANDS.join('\n')};
    let query;
    if(cmd==='show interfaces')query={type:'interfaces',deviceId};
    else if(cmd==='show routes')query={type:'routes',deviceId};
    else if(cmd==='show config')return {ok:true,network,state:network,output:JSON.stringify(getDevice(network,deviceId).config,null,2)};
    else if(['ping','traceroute'].includes(t[0])&&t.length===2)query={type:t[0],sourceId:deviceId,target:t[1]};
    else if(t[0]==='nslookup'&&t.length===2)query={type:'dns',sourceId:deviceId,name:t[1]};
    else if(cmd==='dhcp')query={type:'dhcp',deviceId};
    if(query) {const diagnostic=diagnoseNetwork(network,query);return {ok:diagnostic.ok,network,state:network,diagnostic,output:JSON.stringify(diagnostic,null,2)};}
    let action;
    if(t[0]==='set'&&t[1]==='address'&&t.length>=3&&t.length<=5)action={type:'configureDevice',deviceId,config:{cidr:t[2],gateway:t[3]||'',dns:t[4]||'',dhcp:false}};
    else if(t[0]==='set'&&t[1]==='dhcp'&&t.length===3&&['on','off'].includes(t[2]))action={type:'configureDevice',deviceId,config:{dhcp:t[2]==='on'}};
    else if(t[0]==='set'&&t[1]==='port'&&t.length===5&&['access','trunk'].includes(t[3])) {
      const vlans=t[4].split(',').map(Number);if(t[3]==='access'&&vlans.length!==1)fail('Porta access exige uma VLAN.');action={type:'configurePort',deviceId,portId:t[2],config:{mode:t[3],...(t[3]==='access'?{vlanId:vlans[0]}:{allowedVlans:vlans})}};
    } else if(t[0]==='set'&&t[1]==='link'&&t.length===4&&['up','down'].includes(t[3]))action={type:'setLinkState',linkId:t[2],enabled:t[3]==='up'};
    else if(t[0]==='set'&&t[1]==='device'&&t.length===3&&['up','down'].includes(t[2]))action={type:'setDeviceState',deviceId,enabled:t[2]==='up'};
    if(!action)fail('Comando desconhecido ou argumentos inválidos. Use help.');
    const next=applyNetworkAction(network,action);
    return {ok:true,network:next,state:next,action,output:'Configuração aplicada ao modelo educativo.'};
  } catch(error) {return {ok:false,network,state:network,output:error.message};}
}

