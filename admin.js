/* Painel administrativo sem framework; Auth REST + PostgreSQL REST protegidos por RLS. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const config=window.LABRIGA_CONFIG||{};
const base=(config.url||'').replace(/\/+$/,'');
const key=config.publishableKey||config.anonKey||'';
let session=null,players=[],camps=[],editing=null;
function msg(text,kind=''){const box=$('alert');box.textContent=text;box.className=kind;}
function clean(v){return v.trim()||null;}
function score(id){const v=$(id).value.trim();if(v==='')return null;const n=Number(v);if(!Number.isInteger(n)||n<0)throw Error('Informe um placar inteiro não negativo.');return n;}
function header(authorized=true){return {'apikey':key,'Content-Type':'application/json',...(authorized&&session?{'Authorization':'Bearer '+session.access_token}:{})};}
async function api(endpoint,{method='GET',body,auth=true,extra={}}={}){
 let r=await fetch(base+endpoint,{method,headers:{...header(auth),...extra},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
 if(r.status===401 && auth && session?.refresh_token){
   try{await refreshToken();r=await fetch(base+endpoint,{method,headers:{...header(auth),...extra},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});}catch(e){throw new Error('Sessão expirada: entre novamente.');}
 }
 if(!r.ok){let error='';try{const b=await r.json();error=b.message||b.error_description||b.error||b.hint||JSON.stringify(b)}catch(e){error=(await r.text()).slice(0,180)}throw new Error(`HTTP ${r.status}: ${error}`);}
 if(r.status===204)return null;
 const t=await r.text();return t?JSON.parse(t):null;
}
async function refreshToken(){
 const s=await api('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token},auth:false});
 session={access_token:s.access_token,refresh_token:s.refresh_token,user:s.user};
 sessionStorage.setItem('labriga_auth',JSON.stringify(session));
}
async function page(table,opts=''){
 const result=[];
 for(let i=0;i<50;i++){
  const add=opts?opts+'&':'';
  const part=await api(`/rest/v1/${table}?${add}limit=1000&offset=${i*1000}`);
  result.push(...part);if(part.length<1000)return result;
 }
 throw new Error('Consulta excedeu 50.000 registros; verificar paginação.');
}
function fill(select,items,emptyLabel=null,chosen=null){
 const el=$(select);el.replaceChildren();
 if(emptyLabel!==null){const opt=new Option(emptyLabel,'');el.append(opt);}
 for(const it of items){const op=new Option(it.label,it.value);el.append(op);}
 if(chosen!==null)el.value=chosen;
}
function plOpts(){return players.map(x=>({value:x.name,label:x.name}));}
function cpOpts(){return camps.map(c=>({value:String(c.id),label:`#${c.id} · ${c.name}`}));}
async function data(){
 [players,camps]=await Promise.all([
  page('players','select=name&order=name.asc'),
  page('competitions','select=*&order=id.asc')
 ]);
 const names=plOpts(),comp=cpOpts();
 fill('matchHome',names,'Escolha o mandante');fill('matchAway',names,'Escolha o visitante');
 fill('matchCamp',comp,'Escolha o campeonato');fill('champCamp',comp,'Escolha o campeonato');
 fill('champPlayer',names,'Não definido');fill('vicePlayer',names,'Não definido');
}
async function verifyAdmin(){
 const id=session?.user?.id;
 if(!id)return false;
 const res=await api(`/rest/v1/admin_users?select=user_id&user_id=eq.${encodeURIComponent(id)}&limit=1`);
 return res.length===1;
}
async function loggedIn(){
 if(!await verifyAdmin())throw new Error('A conta não está autorizada como administrador. Execute o INSERT em admin_users no SQL Editor.');
 $('loginSection').classList.add('hide');$('appSection').classList.remove('hide');
 $('who').textContent=`Administrador: ${session.user.email}`;
 await data();msg(`✅ Autenticado. ${players.length} jogadores e ${camps.length} campeonatos disponíveis.`, 'ok');
}
async function login(email,password){
 const s=await api('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},auth:false});
 session={access_token:s.access_token,refresh_token:s.refresh_token,user:s.user};
 sessionStorage.setItem('labriga_auth',JSON.stringify(session));
 await loggedIn();
}
$('loginForm').addEventListener('submit',async e=>{
 e.preventDefault();const btn=e.submitter;btn.disabled=true;
 try{await login($('loginEmail').value,$('loginPass').value);$('loginPass').value='';}
 catch(err){session=null;sessionStorage.removeItem('labriga_auth');msg('❌ '+err.message,'bad');}
 finally{btn.disabled=false;}
});
$('logout').addEventListener('click',()=>{session=null;sessionStorage.removeItem('labriga_auth');$('appSection').classList.add('hide');$('loginSection').classList.remove('hide');msg('Sessão encerrada.');});
function clearMatch(){editing=null;$('matchForm').reset();$('matchId').value='';$('matchStatus').value='Concluído';msg('Novo resultado: escolha o campeonato e jogadores.');}
$('clearMatch').addEventListener('click',clearMatch);
$('loadMatch').addEventListener('click',async()=>{
 const id=$('matchId').value.trim();if(!id){msg('Informe o ID da partida a corrigir.','bad');return;}
 try{
  const qs=new URLSearchParams({select:'*',source_key:'eq.'+id,limit:'1'});
  const r=await api('/rest/v1/matches?'+qs);
  if(!r.length)throw new Error('Partida não localizada.');
  editing=r[0].source_key;
  const m=r[0];
  for(const [field,val] of Object.entries({matchCamp:m.competition_id,matchPhase:m.phase,matchRound:m.round_name,matchHome:m.home_player,matchAway:m.away_player,homeClub:m.home_club,awayClub:m.away_club,homeGoals:m.home_goals,awayGoals:m.away_goals,homePens:m.home_penalties,awayPens:m.away_penalties,matchStatus:m.status})){
   if($(field))$(field).value=val??'';
  }
  msg(`✏️ Editando ${editing}. Salvar substituirá o registro anterior e registrará a alteração na auditoria.`,'ok');
 }catch(err){msg('❌ '+err.message,'bad');}
});
$('matchForm').addEventListener('submit',async e=>{
 e.preventDefault();const btn=e.submitter;btn.disabled=true;
 try{
  const home=$('matchHome').value,away=$('matchAway').value;
  if(!home||!away||home===away)throw new Error('Selecione dois jogadores diferentes.');
  const a=score('homeGoals'),b=score('awayGoals'),pa=score('homePens'),pb=score('awayPens');
  if((a===null)!==(b===null))throw new Error('Preencha os dois placares ou deixe ambos vazios.');
  if((pa===null)!==(pb===null))throw new Error('Preencha os dois resultados dos pênaltis ou deixe ambos vazios.');
  if(a===null && $('matchStatus').value==='Concluído')throw new Error('Para jogo sem placar, selecione status Pendente ou W.O.');
  if(pa!==null && (a===null || a!==b))throw new Error('Só registre pênaltis após empate com placar informado.');
  const winner=a===null?null:a>b?home:b>a?away:pa!==null&&pa!==pb?(pa>pb?home:away):null;
  const obj={competition_id:Number($('matchCamp').value),phase:clean($('matchPhase').value),round_name:clean($('matchRound').value),home_player:home,away_player:away,home_club:clean($('homeClub').value),away_club:clean($('awayClub').value),home_goals:a,away_goals:b,home_penalties:pa,away_penalties:pb,status:$('matchStatus').value,winner_player:winner,winner_club:winner===home?clean($('homeClub').value):winner===away?clean($('awayClub').value):null};
  if(!obj.competition_id)throw new Error('Selecione o campeonato.');
  const path=editing?'/rest/v1/matches?'+new URLSearchParams({source_key:'eq.'+editing}):'/rest/v1/matches';
  const method=editing?'PATCH':'POST';
  const r=await api(path,{method,body:obj,extra:{Prefer:'return=representation'}});
  if(editing && (!r||!r.length))throw new Error('A atualização não afetou nenhum registro.');
  const id=r?.[0]?.source_key||editing||'novo';
  msg(`✅ Partida ${id} salva. O ranking público será recalculado quando os visitantes atualizarem a página.`,'ok');
  $('matchId').value=id;editing=id;
 }catch(err){msg('❌ '+err.message,'bad');}
 finally{btn.disabled=false;}
});
$('campForm').addEventListener('submit',async e=>{
 e.preventDefault();const btn=e.submitter;btn.disabled=true;
 try{
  const id=Math.max(0,...camps.map(c=>c.id))+1;
  const obj={id,source_id:'WEB_CAMP_'+id,name:clean($('campName').value),family:$('campFamily').value,format:$('campFormat').value,tier:$('campTier').value,source_status:'Em andamento'};
  if(!obj.name)throw new Error('Preencha o nome do campeonato.');
  await api('/rest/v1/competitions',{method:'POST',body:obj,extra:{Prefer:'return=minimal'}});
  await data();$('campName').value='';$('matchCamp').value=String(id);
  msg(`✅ Campeonato #${id} criado! Você já pode cadastrar os resultados.`,'ok');
 }catch(err){msg('❌ '+err.message,'bad');}
 finally{btn.disabled=false;}
});
$('champCamp').addEventListener('change',()=>{
 const c=camps.find(x=>x.id===Number($('champCamp').value));if(!c)return;
 $('champPlayer').value=c.champion_player||'';$('champClub').value=c.champion_club||'';
 $('vicePlayer').value=c.runner_up_player||'';$('viceClub').value=c.runner_up_club||'';
});
$('champForm').addEventListener('submit',async e=>{
 e.preventDefault();const btn=e.submitter;btn.disabled=true;
 try{
  const id=Number($('champCamp').value);if(!id)throw new Error('Selecione um campeonato.');
  const champion=$('champPlayer').value||null,vice=$('vicePlayer').value||null;
  if(champion && vice && champion===vice)throw new Error('Campeão e vice precisam ser diferentes.');
  const body={champion_player:champion,champion_club:clean($('champClub').value),runner_up_player:vice,runner_up_club:clean($('viceClub').value)};
  const qs=new URLSearchParams({id:'eq.'+id});
  const r=await api('/rest/v1/competitions?'+qs,{method:'PATCH',body,extra:{Prefer:'return=representation'}});
  if(!r.length)throw new Error('Nenhum campeonato atualizado.');
  await data();msg(`✅ Títulos e vice-campeonato do #${id} atualizados.`,'ok');
 }catch(err){msg('❌ '+err.message,'bad');}
 finally{btn.disabled=false;}
});
$('playerForm').addEventListener('submit',async e=>{
 e.preventDefault();const btn=e.submitter;btn.disabled=true;
 try{
  const name=clean($('newPlayer').value)?.toLocaleUpperCase('pt-BR');if(!name)throw new Error('Nome inválido.');
  await api('/rest/v1/players',{method:'POST',body:{name},extra:{Prefer:'return=minimal'}});
  await data();$('newPlayer').value='';msg(`✅ Jogador ${name} cadastrado.`,'ok');
 }catch(err){msg('❌ '+err.message,'bad');}
 finally{btn.disabled=false;}
});
$('loadAudit').addEventListener('click',async()=>{
 try{
  const r=await api('/rest/v1/audit_log?select=table_name,row_id,operation,changed_at&order=changed_at.desc&limit=30');
  const el=$('auditList');el.replaceChildren();
  if(!r.length){el.textContent='Nenhuma alteração administrativa registrada ainda.';return;}
  for(const x of r){const p=document.createElement('p');p.textContent=`${new Date(x.changed_at).toLocaleString('pt-BR')} · ${x.operation} · ${x.table_name} · ${x.row_id}`;el.append(p);}
 }catch(err){msg('❌ '+err.message,'bad');}
});
if(!base||!key){msg('Configure config.js com a URL e a chave publishable do Supabase.','bad');$('loginForm').querySelector('button').disabled=true;return;}
try{
 const old=JSON.parse(sessionStorage.getItem('labriga_auth')||'null');
 if(old?.access_token&&old?.user?.id){session=old;loggedIn().catch(async err=>{
  try{await refreshToken();await loggedIn();}catch(e){session=null;sessionStorage.removeItem('labriga_auth');msg('Faça login novamente: '+err.message,'bad');}
 });}
 else msg('Pronto para autenticar. Insira seu e-mail e senha do Supabase.');
}catch(err){msg('Faça login para administrar o Memorial.');}
})();
