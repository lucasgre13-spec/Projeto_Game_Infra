
const copy = value => JSON.parse(JSON.stringify(value));
const field = (key,label,type='text',extra={}) => ({key,label,type,...extra});
const ref = (key,label,reference,required=true) => field(key,label,'reference',{reference,required});
const num = (key,label,min,max,required=false) => field(key,label,'number',{min,max,required});
const rules = key => field(key,key==='ingress'?'Entrada permitida':'Saída permitida','rows',{fields:[field('protocol','Protocolo','select',{options:['tcp','all'],required:true}),num('port','Porta',1,65535),field('cidr','Origem/destino CIDR','cidr'),ref('sourceGroupId',key==='ingress'?'Grupo de origem':'Grupo de destino','securityGroup',false)]});
const vpc = () => ref('vpcId','VPC','vpc');
export const CLOUD_CATALOG = [
 {type:'iam',label:'Identidade IAM',fields:[field('mfa','MFA ativo','boolean',{required:true}),field('permissions','Permissões','multiselect',{options:['network','ec2','rds','s3','dns','vpn','monitor','backup','*'],required:true})]},
 {type:'vpc',label:'VPC',fields:[field('cidr','Bloco IPv4','cidr',{required:true})]},
 {type:'subnet',label:'Sub-rede',fields:[vpc(),field('cidr','Bloco IPv4','cidr',{required:true}),field('zone','Zona','text',{required:true})]},
 {type:'igw',label:'Internet Gateway',fields:[vpc()]},
 {type:'nat',label:'NAT Gateway',fields:[vpc(),ref('subnetId','Sub-rede pública','subnet')]},
 {type:'routeTable',label:'Tabela de rotas',fields:[vpc(),field('subnetIds','Sub-redes','references',{reference:'subnet',required:true}),field('routes','Rotas','rows',{required:true,fields:[field('destination','Destino CIDR','cidr',{required:true}),ref('targetId','Gateway de destino',['igw','nat','vpn'])]})]},
 {type:'securityGroup',label:'Grupo de segurança',fields:[vpc(),rules('ingress'),rules('egress')]},
 {type:'ec2',label:'Instância EC2',fields:[ref('subnetId','Sub-rede','subnet'),ref('securityGroupId','Grupo de segurança','securityGroup'),field('publicIp','IP público','boolean'),num('capacity','Capacidade',1,1000,true),num('port','Porta da aplicação',1,65535),field('running','Em execução','boolean')]},
 {type:'alb',label:'Balanceador ALB',fields:[vpc(),field('subnetIds','Sub-redes em duas zonas','references',{reference:'subnet',required:true}),ref('securityGroupId','Grupo de segurança','securityGroup'),field('targetIds','Instâncias alvo','references',{reference:'ec2',required:true}),num('port','Porta pública',1,65535)]},
 {type:'rds',label:'Banco RDS',fields:[ref('subnetId','Sub-rede','subnet'),ref('securityGroupId','Grupo de segurança','securityGroup'),field('publiclyAccessible','Exposição pública','boolean'),field('multiAz','Reserva em outra zona','boolean'),ref('standbySubnetId','Sub-rede da reserva','subnet',false),num('port','Porta do banco',1,65535)]},
 {type:'s3',label:'Bucket S3',fields:[field('private','Acesso privado','boolean',{required:true}),field('versioning','Versionamento','boolean')]},
 {type:'dns',label:'DNS',fields:[field('hostname','Nome DNS','text',{required:true}),ref('targetId','Destino',['alb','ec2'])]},
 {type:'vpn',label:'VPN híbrida',fields:[vpc(),field('peerSiteId','ID do site local','text',{required:true}),field('localCidr','CIDR local','cidr',{required:true}),field('remoteCidr','CIDR da nuvem','cidr',{required:true}),field('profile','Perfil do túnel','select',{options:['lab-ipsec'],required:true}),field('enabled','Túnel ativo','boolean',{required:true})]}
];
export const cloudCatalog = CLOUD_CATALOG;
export function createCloudState(){return {resources:[],events:[],incidents:[],backups:[],monitoring:false,demand:1};}
function normalize(cloud){return {...createCloudState(),...copy(cloud||{}),resources:copy(cloud?.resources||[])};}
function cidr(value){
 if(typeof value!=='string'||!/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(value))throw Error('Informe um CIDR IPv4 válido.');
 const [address,prefixText]=value.split('/'),parts=address.split('.').map(Number),prefix=Number(prefixText);
 if(parts.some(n=>n>255)||prefix>32)throw Error('Informe um CIDR IPv4 válido.');
 const ip=parts.reduce((n,p)=>n*256+p,0),size=2**(32-prefix),start=Math.floor(ip/size)*size;
 if(ip!==start)throw Error('O CIDR deve começar no endereço da rede.');
 return {start,end:start+size-1,prefix};
}
const contains=(a,b)=>{a=cidr(a);b=cidr(b);return a.start<=b.start&&a.end>=b.end;};
function validateResource(r,all){
 if(!r||typeof r!=='object'||Array.isArray(r))throw Error('Recurso inválido.');
 if(typeof r.id!=='string'||! /^[a-zA-Z0-9_-]{1,64}$/.test(r.id))throw Error('ID deve conter letras, números, hífen ou sublinhado.');
 const schema=CLOUD_CATALOG.find(s=>s.type===r.type);if(!schema)throw Error('Tipo de recurso desconhecido.');
 const allowed=new Set(['id','type','name',...schema.fields.map(f=>f.key)]);
 if(Object.keys(r).some(k=>!allowed.has(k)))throw Error('Campo de configuração desconhecido.');
 function check(f,value){
  if(value===undefined){if(f.required)throw Error('Preencha '+f.label+'.');return;}
  if(f.type==='boolean'&&typeof value!=='boolean')throw Error(f.label+' deve ser verdadeiro ou falso.');
  if(['text','cidr','reference'].includes(f.type)&& (typeof value!=='string'||!value.trim()))throw Error('Preencha '+f.label+'.');
  if(f.type==='cidr')cidr(value);
  if(f.type==='number'&&(!Number.isInteger(value)||value<f.min||value>f.max))throw Error(f.label+' fora dos limites.');
  if(f.type==='select'&&!f.options.includes(value))throw Error('Opção inválida em '+f.label+'.');
  if(['references','rows','multiselect'].includes(f.type)){
   if(!Array.isArray(value)||value.length>100)throw Error(f.label+' deve ser uma lista de até 100 itens.');
   if(f.required&&value.length===0)throw Error('Preencha '+f.label+'.');
   if(f.type==='multiselect'&&value.some(v=>!f.options.includes(v)))throw Error('Permissão desconhecida.');
   if(f.type==='references'){if(new Set(value).size!==value.length)throw Error('Referência repetida.');value.forEach(v=>check({...f,type:'reference'},v));}
   if(f.type==='rows')value.forEach(row=>{if(!row||typeof row!=='object'||Object.keys(row).some(k=>!f.fields.some(c=>c.key===k)))throw Error('Linha inválida.');f.fields.forEach(c=>check(c,row[c.key]));if(f.key!=='routes'){if((!row.cidr&&!row.sourceGroupId)||(row.cidr&&row.sourceGroupId))throw Error('Regra requer exatamente um CIDR ou grupo.');if(row.protocol==='tcp'&&row.port===undefined)throw Error('Regra TCP requer uma porta.');}});
  }
  if(f.type==='reference'){
   const target=all.find(t=>t.id===value),types=Array.isArray(f.reference)?f.reference:[f.reference];
   if(!target||!types.includes(target.type))throw Error('Referência inexistente ou incompatível: '+value+'.');
  }
 }
 schema.fields.forEach(f=>check(f,r[f.key]));
 const find=id=>all.find(x=>x.id===id),vpcOf=x=>x?.type==='vpc'?x.id:x?.vpcId||find(x?.subnetId)?.vpcId;
 const own=vpcOf(r);
 for(const f of schema.fields.filter(f=>['reference','references'].includes(f.type))){
  if(r.type==='dns')continue;
  for(const id of (f.type==='references'?r[f.key]||[]:[r[f.key]]).filter(Boolean)){
   const target=find(id),other=vpcOf(target);
   if(own&&other&&own!==other)throw Error('As referências devem pertencer à mesma VPC.');
  }
 }
 if(r.type==='routeTable')for(const route of r.routes){
  const target=find(route.targetId);
  if(target.vpcId!==r.vpcId)throw Error('O destino da rota deve pertencer à mesma VPC da tabela para manter o caminho de rede válido.');
 }
 if(r.type==='routeTable'&&all.some(t=>t.id!==r.id&&t.type==='routeTable'&&t.subnetIds?.some(id=>r.subnetIds.includes(id))))throw Error('Cada sub-rede pode usar somente uma tabela de rotas.');
 if(r.type==='dns'&&!/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(r.hostname))throw Error('Informe um nome DNS válido.');
 if(r.type==='subnet'){
  if(!contains(find(r.vpcId).cidr,r.cidr))throw Error('A sub-rede deve estar dentro da VPC.');
  const c=cidr(r.cidr);
  if(all.some(x=>x.id!==r.id&&x.type==='subnet'&&x.vpcId===r.vpcId&&(()=>{const o=cidr(x.cidr);return c.start<=o.end&&o.start<=c.end;})()))throw Error('Sub-redes da mesma VPC não podem se sobrepor.');
 }
 if(r.type==='vpc'&&all.some(x=>x.type==='subnet'&&x.vpcId===r.id&&!contains(r.cidr,x.cidr)))throw Error('A VPC deve conter suas sub-redes.');
 for(const key of ['ingress','egress'])for(const rule of r[key]||[]){if(rule.sourceGroupId&&find(rule.sourceGroupId)?.vpcId!==r.vpcId)throw Error('Grupo de origem deve estar na mesma VPC.');}
 if(r.type==='rds'&&r.standbySubnetId&&find(r.standbySubnetId).zone===find(r.subnetId).zone)throw Error('Reserva deve usar outra zona.');
 if(r.type==='vpn'&&!contains(find(r.vpcId).cidr,r.remoteCidr))throw Error('CIDR da nuvem deve pertencer à VPC.');
}
function event(s,message){s.events.push({sequence:(s.eventSequence||0)+1,message});s.eventSequence=(s.eventSequence||0)+1;s.events=s.events.slice(-100);}
export function applyCloudAction(cloud,action){
 try{
  if(!action||typeof action!=='object')throw Error('Ação inválida.');
  const s=normalize(cloud),find=id=>s.resources.find(r=>r.id===id);
  switch(action.type){
   case 'create':{
    const r=copy(action.resource);if(find(r?.id))throw Error('ID já utilizado.');
    validateResource(r,[...s.resources,r]);s.resources.push(r);event(s,'Recurso criado: '+r.id+'.');break;
   }
   case 'update':{
    const old=find(action.id);if(!old)throw Error('Recurso não encontrado.');
    if(!action.patch||typeof action.patch!=='object'||Array.isArray(action.patch)||'id'in action.patch||'type'in action.patch)throw Error('Atualização inválida.');
    const updated={...old,...copy(action.patch)},all=s.resources.map(r=>r.id===old.id?updated:r);
    validateResource(updated,all);
    // Mudanças em redes também precisam preservar os limites dos recursos existentes.
    for(const r of all)if(r.id!==updated.id){let validBefore=true;try{validateResource(find(r.id),s.resources);}catch{validBefore=false;}if(validBefore)validateResource(r,all);}
    s.resources=all;event(s,'Configuração atualizada: '+old.id+'.');break;
   }
   case 'delete':if(!find(action.id))throw Error('Recurso não encontrado.');s.resources=s.resources.filter(r=>r.id!==action.id);event(s,'Recurso removido: '+action.id+'. Dependências são reavaliadas.');break;
   case 'monitor':if(typeof action.enabled!=='boolean')throw Error('Monitoramento requer um valor booleano.');s.monitoring=action.enabled;event(s,'Monitoramento '+(action.enabled?'ativado.':'desativado.'));break;
   case 'demand':if(!Number.isInteger(action.value)||action.value<1||action.value>10000)throw Error('Demanda fora dos limites.');s.demand=action.value;event(s,'Demanda atual: '+action.value+'.');break;
   case 'scale':{
    const r=find(action.id);if(r?.type!=='ec2'||!Number.isInteger(action.capacity)||action.capacity<1||action.capacity>1000)throw Error('Escala requer EC2 e capacidade de 1 a 1000.');
    r.capacity=action.capacity;s.scaled=true;event(s,'Capacidade alterada: '+r.id+'.');break;
   }
   case 'incident':{
    if(!['instance','zone'].includes(action.kind))throw Error('Incidente deve afetar instância ou zona.');
    if(action.kind==='instance'&&find(action.targetId)?.type!=='ec2')throw Error('Selecione uma instância existente.');
    if(action.kind==='zone'&&!s.resources.some(r=>r.type==='subnet'&&r.zone===action.targetId))throw Error('Zona inexistente.');
    if(s.incidents.some(i=>i.active&&i.kind===action.kind&&i.targetId===action.targetId))throw Error('Incidente já ativo.');
    if(s.incidents.filter(i=>i.active).length>=50)throw Error('Resolva um incidente ativo antes de simular outra falha.');
    s.recovered=false;s.restored=false;
    const id='incident-'+((s.incidentSequence||0)+1);s.incidentSequence=(s.incidentSequence||0)+1;
    s.incidents.push({id,kind:action.kind,targetId:action.targetId,active:true});s.incidents=[...s.incidents.filter(i=>i.active),...s.incidents.filter(i=>!i.active).slice(-50)];event(s,'Falha registrada: '+action.targetId+'.');break;
   }
   case 'recover':{
    const i=s.incidents.find(i=>i.id===action.id&&i.active);if(!i)throw Error('Incidente ativo não encontrado.');
    if(i.kind!=='instance')throw Error('Falha de zona exige recursos saudáveis em outra zona; a aplicação não pode reiniciar uma zona.');
    i.active=false;s.recovered=true;event(s,'Instância reiniciada: '+i.targetId+'.');break;
   }
   case 'provider-recover':{
    const i=s.incidents.find(i=>i.id===action.id&&i.active&&i.kind==='zone');if(!i)throw Error('Falha de zona ativa não encontrada.');
    i.active=false;event(s,'Controle da simulação: zona voltou a ficar disponível.');break;
   }
   case 'backup':{
    const r=find(action.id);if(!r||!['ec2','rds','s3'].includes(r.type))throw Error('Backup requer EC2, RDS ou S3.');
    const status=inspectCloud(s).resources.find(x=>x.id===r.id);if(!status?.available)throw Error('Recurso indisponível não pode gerar backup válido.');
    s.backupSequence=(s.backupSequence||0)+1;const id=action.backupId||'backup-'+s.backupSequence;
    if(typeof id!=='string'||! /^[a-zA-Z0-9_-]{1,64}$/.test(id)||s.backups.some(b=>b.id===id))throw Error('ID de backup inválido ou repetido.');
    s.backups.push({id,resource:copy(r)});s.backups=s.backups.slice(-20);event(s,'Backup criado: '+id+'.');break;
   }
   case 'restore':{
    const b=s.backups.find(b=>b.id===action.id);if(!b?.resource)throw Error('Backup válido não encontrado.');
    const all=s.resources.filter(r=>r.id!==b.resource.id);validateResource(b.resource,[...all,b.resource]);
    s.resources=[...all,copy(b.resource)];s.incidents=s.incidents.map(i=>i.kind==='instance'&&i.targetId===b.resource.id?{...i,active:false}:i);
    s.restored=true;s.restoredResourceId=b.resource.id;event(s,'Recurso restaurado do backup: '+b.id+'.');break;
   }
   default:throw Error('Ação desconhecida.');
  }
  return {state:s,ok:true,message:s.events.at(-1)?.message||'Ação aplicada.'};
 }catch(error){return {state:cloud,ok:false,message:error.message};}
}
function permit(group,direction,port,sourceId,sourceCidr='0.0.0.0/0'){
 return !!group?.[direction]?.some(rule=>(rule.protocol==='all'||rule.protocol==='tcp'&&rule.port===port)&&
  (rule.sourceGroupId&&rule.sourceGroupId===sourceId||rule.cidr&&contains(rule.cidr,sourceCidr)));
}
export function inspectCloud(cloud,context={}){
 const s=normalize(cloud),all=s.resources,find=id=>all.find(r=>r.id===id),of=t=>all.filter(r=>r.type===t),active=s.incidents.filter(i=>i.active);
 const subnet=r=>find(r?.subnetId),vpcId=r=>r?.vpcId||subnet(r)?.vpcId;
 const failed=r=>!r||active.some(i=>i.kind==='instance'&&i.targetId===r.id||i.kind==='zone'&&i.targetId===subnet(r)?.zone);
 const route=(sub,destination='0.0.0.0/0',targetType='igw')=>!!sub&&of('routeTable').some(t=>t.vpcId===sub.vpcId&&t.subnetIds?.includes(sub.id)&&t.routes?.some(rt=>rt.destination===destination&&find(rt.targetId)?.type===targetType&&find(rt.targetId)?.vpcId===sub.vpcId));
 const publicSubnet=sub=>route(sub);
 const egress=sub=>publicSubnet(sub)||!!sub&&of('routeTable').some(t=>t.subnetIds?.includes(sub.id)&&t.vpcId===sub.vpcId&&t.routes?.some(rt=>{const nat=find(rt.targetId);return rt.destination==='0.0.0.0/0'&&nat?.type==='nat'&&!failed(nat)&&nat.vpcId===sub.vpcId&&publicSubnet(find(nat.subnetId));}));
 const identities=of('iam'),identityReady=identities.some(r=>r.mfa===true&&r.permissions?.includes('ec2')&&!r.permissions.includes('*'));
 const sg=r=>{const g=find(r.securityGroupId);return g?.type==='securityGroup'&&g.vpcId===vpcId(r)?g:null;};
 const validEC2=r=>identityReady&&r.running!==false&&!failed(r)&&!!subnet(r)&&!!find(vpcId(r))&&!!sg(r);
 const reachableEC2=r=>validEC2(r)&&r.publicIp===true&&publicSubnet(subnet(r))&&permit(sg(r),'ingress',r.port||80,null);
 const albTargets=new Map();
 const validAlb=r=>{
  const subs=(r.subnetIds||[]).map(find),g=sg(r),zones=new Set(subs.filter(Boolean).map(x=>x.zone));
  const base=subs.length>=2&&subs.every(x=>x?.type==='subnet'&&x.vpcId===r.vpcId&&publicSubnet(x))&&zones.size>=2&&!!g&&permit(g,'ingress',r.port||80,null);
  const targets=(r.targetIds||[]).map(find).filter(t=>t?.type==='ec2'&&vpcId(t)===r.vpcId&&subs.some(x=>x.zone===subnet(t)?.zone)&&validEC2(t)&&permit(sg(t),'ingress',t.port||80,r.securityGroupId)&&permit(g,'egress',t.port||80,t.securityGroupId));
  albTargets.set(r.id,base?targets:[]);return base&&targets.length>0;
 };
 const albs=of('alb').filter(validAlb),publicInstances=of('ec2').filter(reachableEC2),serving=new Map(publicInstances.map(r=>[r.id,r]));
 albs.forEach(r=>albTargets.get(r.id).forEach(t=>serving.set(t.id,t)));
 const computeReady=serving.size>0,loadBalancerReady=albs.length>0;
 const egressReady=of('ec2').some(r=>validEC2(r)&&egress(subnet(r))&&permit(sg(r),'egress',443,null));
 const dbAvailable=r=>{
  if(!subnet(r)||!find(vpcId(r))||!sg(r))return false;
  if(!failed(r))return true;
  const standby=find(r.standbySubnetId);return r.multiAz===true&&standby?.type==='subnet'&&standby.vpcId===vpcId(r)&&standby.zone!==subnet(r)?.zone&&!active.some(i=>i.kind==='zone'&&i.targetId===standby.zone);
 };
 const dbLinked=r=>dbAvailable(r)&&[...serving.values()].some(ec=>vpcId(ec)===vpcId(r)&&permit(sg(r),'ingress',r.port||5432,ec.securityGroupId)&&permit(sg(ec),'egress',r.port||5432,r.securityGroupId));
 const databaseReady=of('rds').some(dbLinked),capacity=[...serving.values()].reduce((n,r)=>n+r.capacity,0),demand=s.demand;
 const networkReady=of('subnet').some(sub=>!!find(sub.vpcId)&&publicSubnet(sub));
 const appReady=computeReady&&databaseReady&&loadBalancerReady&&capacity>=demand;
 const storageReady=of('s3').some(r=>r.private===true);
 const dnsReady=of('dns').some(r=>{const target=find(r.targetId);return target?.type==='alb'?albs.includes(target):target?.type==='ec2'&&publicInstances.includes(target);});
 const insecure=of('rds').some(r=>r.publiclyAccessible===true||sg(r)?.ingress?.some(rule=>rule.cidr==='0.0.0.0/0'))||identities.some(r=>!r.mfa||r.permissions?.includes('*'))||of('s3').some(r=>r.private!==true)||of('securityGroup').some(g=>g.ingress?.some(r=>r.cidr==='0.0.0.0/0'&&(r.protocol==='all'||[22,3389,5432,3306].includes(r.port))));
 const secure=identityReady&&networkReady&&!insecure;
 const redundant=appReady&&albs.some(r=>new Set(albTargets.get(r.id).map(t=>subnet(t)?.zone)).size>=2&&albTargets.get(r.id).length>=2)&&of('rds').some(r=>dbLinked(r)&&r.multiAz&&!failed(r)&&find(r.standbySubnetId)?.zone!==subnet(r)?.zone&&!!find(r.standbySubnetId)&&!active.some(i=>i.kind==='zone'&&i.targetId===find(r.standbySubnetId)?.zone));
 const zones=[...new Set(of('subnet').map(r=>r.zone))];
 const highAvailabilityReady=!context._haProbe&&redundant&&zones.every(zone=>inspectCloud({...s,incidents:[...s.incidents,{kind:'zone',targetId:zone,active:true}]},{...context,_haProbe:true}).appReady);
 const validVpn=v=>{
  const site=context.networkStatus?.sites?.find(x=>x.id===v.peerSiteId);
  const peer=site?.vpnPeers?.find(p=>p.peerType==='aws'&&p.peerId===v.id&&p.localCidr===v.localCidr&&p.remoteCidr===v.remoteCidr&&p.profile===v.profile);
  return !!peer&&v.enabled===true&&!!find(v.vpcId)&&site?.vpnReady===true&&site.internetReady===true&&site.lanReady===true&&context.networkStatus.vpnReady===true&&contains(find(v.vpcId).cidr,v.remoteCidr)&&of('routeTable').some(t=>t.vpcId===v.vpcId&&t.routes?.some(rt=>rt.targetId===v.id&&rt.destination===v.localCidr));
 };
 const hybridReady=of('vpn').some(validVpn);
 const costs={illustrative:true,unit:'unidades didáticas/mês',items:all.map(r=>({id:r.id,cost:({iam:0,vpc:0,subnet:0,igw:0,nat:8,routeTable:0,securityGroup:0,ec2:2*(r.capacity||1),alb:6,rds:r.multiAz?16:8,s3:1,dns:1,vpn:5})[r.type]||0}))};costs.total=costs.items.reduce((n,r)=>n+r.cost,0);
 const flags={identityReady,networkReady,egressReady,computeReady,databaseReady,loadBalancerReady,appReady,secure,storageReady,dnsReady,hybridReady,highAvailabilityReady,observabilityReady:s.monitoring&&s.events.length>0,backupReady:s.backups.length>0,scaleReady:s.scaled===true&&computeReady&&capacity>=demand,restoreRecovered:s.restored===true&&(serving.has(s.restoredResourceId)||of('rds').some(r=>r.id===s.restoredResourceId&&dbLinked(r))||of('s3').some(r=>r.id===s.restoredResourceId)),incidentRecovered:(s.recovered===true&&active.length===0&&computeReady)||(active.length>0&&active.every(i=>i.kind==='zone')&&appReady)};
 const labels={egressReady:'Saída HTTPS disponível',identityReady:'IAM com MFA e permissões limitadas',networkReady:'Rota pública válida',computeReady:'EC2 alcançável',databaseReady:'Aplicação alcança o banco',loadBalancerReady:'ALB com alvos saudáveis',appReady:'Aplicação atende a demanda',secure:'Sem exposição insegura',storageReady:'Bucket privado',dnsReady:'DNS aponta para serviço disponível',hybridReady:'VPN com rede local disponível',highAvailabilityReady:'Aplicação e banco com reserva entre zonas',observabilityReady:'Monitoramento e eventos disponíveis',backupReady:'Backup válido criado',scaleReady:'Capacidade ajustada atende a demanda',restoreRecovered:'Serviço recuperado por restauração',incidentRecovered:'Incidente corrigido e serviço disponível'};
 const available=r=>({ec2:()=>validEC2(r),alb:()=>albs.includes(r),rds:()=>dbAvailable(r),s3:()=>true,dns:()=>{const t=find(r.targetId);return albs.includes(t)||publicInstances.includes(t);},subnet:()=>!!find(r.vpcId),nat:()=>!failed(r)&&publicSubnet(subnet(r)),vpn:()=>validVpn(r),routeTable:()=>!!find(r.vpcId)&&r.routes?.every(rt=>!!find(rt.targetId)),securityGroup:()=>!!find(r.vpcId),igw:()=>!!find(r.vpcId),iam:()=>r.mfa===true,vpc:()=>true}[r.type]?.()||false);
 const requirements={egressReady:'Saída HTTPS exige rota para IGW ou NAT disponível e regra de saída; o ALB acessa alvos privados sem usar NAT.',identityReady:'Ative MFA e limite as permissões da identidade que opera EC2.',networkReady:'Uma sub-rede precisa de rota padrão para um Internet Gateway da mesma VPC.',computeReady:'Uma EC2 ativa precisa de ingresso público por IGW ou de ingresso privado autorizado pelo ALB; saída por NAT é avaliada separadamente.',databaseReady:'O banco deve estar ativo e permitir a porta do banco ao grupo da aplicação; a saída da aplicação também precisa permitir essa conexão.',loadBalancerReady:'O ALB precisa de duas zonas públicas, entrada autorizada e pelo menos um alvo saudável em zona habilitada.',appReady:'ALB, aplicação e banco devem estar disponíveis, com capacidade igual ou maior que a demanda.',secure:'MFA, permissões limitadas e rede válida são exigidos; banco, bucket e portas administrativas não podem ficar expostos.',storageReady:'Pelo menos um bucket deve impedir acesso público.',dnsReady:'O destino DNS deve existir e estar alcançável.',hybridReady:'Túnel, rota AWS e peer local precisam corresponder em identidade, CIDRs e perfil; a rede local deve estar disponível.',highAvailabilityReady:'A aplicação precisa continuar disponível quando qualquer uma de suas zonas falha, incluindo entrada pelo ALB e acesso privado ao banco. Saída para internet é avaliada separadamente.',observabilityReady:'Ative monitoramento para acompanhar os eventos de operações.',backupReady:'Crie um snapshot de um recurso disponível antes de precisar restaurá-lo.',scaleReady:'A capacidade ajustada deve atender a demanda de um serviço alcançável.',restoreRecovered:'O recurso restaurado de um snapshot deve voltar a ficar disponível.',incidentRecovered:'Uma instância reiniciada deve voltar a atender; falhas de zona exigem atendimento por outra zona.'};
 return {...flags,checks:Object.entries(flags).map(([id,ok])=>({id,label:labels[id],ok:!!ok,detail:ok?'Condição atendida.':requirements[id]})),resources:all.map(r=>({id:r.id,type:r.type,available:available(r),status:available(r)?'available':'unavailable',detail:available(r)?'Recurso disponível.':'Uma dependência, regra de tráfego ou falha impede a disponibilidade.'})),statuses:Object.fromEntries(all.map(r=>[r.id,available(r)?'available':'unavailable'])),capacity,demand,costs,estimatedCost:costs.total,events:copy(s.events),incidents:copy(s.incidents),backups:s.backups.map(b=>({id:b.id,resourceId:b.resource.id})),educational:true};
}
export const CLOUD_COMMANDS=['help','list','show <id>','diagnose','logs','create <tipo> <id> <JSON de configuração>','update <id> <JSON de campos>','delete <id>','monitor on|off','demand <n>','scale <id> <capacidade>','incident instance|zone <alvo>','recover <incidente>','backup <recurso>','restore <backup>'];
export function runCloudCommand(cloud,command,context={}){
 const read=output=>({state:cloud,ok:true,output,mutated:false}),fail=output=>({state:cloud,ok:false,output,mutated:false});
 if(typeof command!=='string'||command.length>20000)return fail('Comando inválido.');
 const match=command.trim().match(/^(\S+)(?:\s+(.*))?$/);if(!match)return fail('Informe um comando; help lista as opções.');
 const [,verb,rest='']=match,parts=rest.split(/\s+/);
 try{
  if(verb==='help')return read('Terminal educativo Nexo Lab. Nenhuma chamada AWS real.\n'+CLOUD_COMMANDS.join('\n'));
  if(verb==='list')return read((cloud?.resources||[]).map(r=>r.id+' '+r.type).join('\n')||'Nenhum recurso criado.');
  if(verb==='show'){const r=cloud?.resources?.find(r=>r.id===rest);return r?read(JSON.stringify(r,null,2)):fail('Recurso não encontrado.');}
  if(verb==='diagnose'){const report=inspectCloud(cloud,context);return read(report.checks.map(c=>(c.ok?'OK ':'PENDENTE ')+c.label+(c.ok?'':': '+c.detail)).join('\n')+'\nCusto ilustrativo: '+report.estimatedCost+' unidades didáticas/mês.');}
  if(verb==='logs')return read((cloud.events||[]).map(e=>e.sequence+' '+e.message).join('\n')||'Nenhum evento.');
  let action;
  if(verb==='create'){const m=rest.match(/^(\S+)\s+(\S+)\s+(.+)$/s);if(!m)throw Error('Use create <tipo> <id> <JSON>.');action={type:'create',resource:{...JSON.parse(m[3]),type:m[1],id:m[2]}};}
  else if(verb==='update'){const m=rest.match(/^(\S+)\s+(.+)$/s);if(!m)throw Error('Use update <id> <JSON>.');action={type:'update',id:m[1],patch:JSON.parse(m[2])};}
  else if(['delete','backup','restore','recover'].includes(verb)&&parts.length===1&&rest)action={type:verb,id:rest};
  else if(verb==='monitor'&&['on','off'].includes(rest))action={type:'monitor',enabled:rest==='on'};
  else if(verb==='demand'&&/^\d+$/.test(rest))action={type:'demand',value:Number(rest)};
  else if(verb==='scale'&&parts.length===2&&/^\d+$/.test(parts[1]))action={type:'scale',id:parts[0],capacity:Number(parts[1])};
  else if(verb==='incident'&&parts.length===2)action={type:'incident',kind:parts[0],targetId:parts[1]};
  else return fail('Comando desconhecido ou argumentos inválidos. Consulte help.');
  const result=applyCloudAction(cloud,action);return {...result,output:result.message,mutated:result.ok};
 }catch(error){return fail('Comando inválido: '+error.message);}
}
