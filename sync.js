/* Sincronização pública do Memorial LABRIGA com Supabase.
 * O HTML original continua disponível como demonstração se config.js estiver vazio.
 * Em modo online, a fonte verdadeira passa a ser o Supabase.
 */
(() => {
  'use strict';
  const cfg=window.LABRIGA_CONFIG || {};
  const el=document.getElementById('liveStatus');
  const refresh=document.getElementById('refreshLive');
  let busy=false,loaded=false,last=0;
  const status=(msg,kind='neutral')=>{
    if(el){el.textContent=msg;el.dataset.kind=kind;}
  };
  const url=(cfg.url||'').replace(/\/+$/,'');
  const key=cfg.publishableKey || cfg.anonKey || '';
  if(!url || !key){status('📦 Modo local: dados incorporados no HTML · configure config.js para ativar o banco.','neutral');if(refresh)refresh.hidden=true;return;}
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)){
    status('⚠️ URL do Supabase inválida em config.js.','error');return;
  }
  async function getPage(table,cols,order,offset){
    const qs=new URLSearchParams({select:cols,order,limit:'1000',offset:String(offset)});
    const resp=await fetch(`${url}/rest/v1/${table}?${qs}`,{
      headers:{apikey:key},cache:'no-store'
    });
    if(!resp.ok)throw new Error(`${table}: HTTP ${resp.status} — ${(await resp.text()).slice(0,140)}`);
    const data=await resp.json();
    if(!Array.isArray(data))throw new Error(`${table}: formato de resposta inválido`);
    return data;
  }
  async function all(table,cols,order){
    const result=[];
    for(let i=0;i<300;i++){
      const part=await getPage(table,cols,order,i*1000);
      result.push(...part);
      if(part.length<1000)return result;
    }
    throw new Error('Limite de paginação atingido; a sincronização foi interrompida para evitar dados incompletos.');
  }
  async function sync(){
    if(busy)return;
    busy=true;
    if(refresh)refresh.disabled=true;
    status('⏳ Carregando histórico oficial do Supabase…');
    try{
      const [records,competitions,matches]=await Promise.all([
        all('players','name','name.asc'),
        all('competitions','id,name,family,format,champion_player,champion_club,runner_up_player,third_player','id.asc'),
        all('matches','source_key,competition_id,phase,round_name,home_player,away_player,home_goals,away_goals,status','source_key.asc')
      ]);
      if(records.length<256 || competitions.length<84 || matches.length<7112)
        throw new Error('Importação incompleta: banco ainda vazio. Execute tools/import_seed.py.');
      // O site antigo referencia o campeonato como C[n-1]; IDs devem ser sequenciais.
      if(competitions.some((c,i)=>c.id !== i+1))
        throw new Error('Os IDs dos campeonatos não são sequenciais a partir de 1. Corrija a tabela competitions.');
      const names=new Set(records.map(r=>r.name));
      for(const c of competitions)for(const k of ['champion_player','runner_up_player','third_player'])if(c[k])names.add(c[k]);
      const clean=[];
      const ids=new Set(competitions.map(c=>c.id));
      let missingPlayers=0;
      for(const m of matches){
        if(!ids.has(m.competition_id))throw new Error('Uma partida possui campeonato inexistente.');
        if(!m.home_player || !m.away_player || m.home_goals===null || m.away_goals===null)continue;
        if(/pendente|n[aã]o realizada|w\.?o\.?/i.test(m.status||''))continue;
        if(!Number.isInteger(m.home_goals) || !Number.isInteger(m.away_goals))continue;
        names.add(m.home_player);names.add(m.away_player);
        clean.push(m);
      }
      const newP=[...names].sort((a,b)=>a.localeCompare(b,'pt-BR'));
      const ix=new Map(newP.map((p,i)=>[p,i]));
      const newC=competitions.map(c=>({
        n:c.id,nm:c.name,fam:c.family||'Outros',c:c.champion_player||null,
        cc:c.champion_club||null,v:c.runner_up_player||null,t:c.third_player||null,
        fmt:c.format||null
      }));
      const newM=clean.map(m=>[
        m.competition_id,m.phase||'',m.round_name||'',ix.get(m.home_player),ix.get(m.away_player),m.home_goals,m.away_goals
      ]);
      // Trocar conteúdo dos arrays sem modificar as referências usadas pelo site do Claude.
      P.splice(0,P.length,...newP);
      C.splice(0,C.length,...newC);
      M.splice(0,M.length,...newM);
      const fams=[...new Set(newC.map(c=>c.fam))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
      D.F.splice(0,D.F.length,...fams);
      Object.keys(BC).forEach(k=>delete BC[k]);
      for(const m of M)(BC[m[0]]=BC[m[0]]||[]).push(m);
      S.a=1;S.b=C.length;S.f=new Set(D.F);
      document.getElementById('meta').textContent=`${C.length} campeonatos · ${M.length} partidas válidas · ${P.length} jogadores`;
      draw();
      loaded=true;last=Date.now();
      status(`🟢 Online · ${C.length} campeonatos · ${M.length.toLocaleString('pt-BR')} jogos com placar e adversários · ${P.length} jogadores`,'ok');
    }catch(e){
      console.error('[Memorial LABRIGA] Falha na sincronização:',e);
      status(`🔴 Sem sincronização: ${e.message}. ${loaded?'Mantidos os últimos dados carregados.':'Mostrando a cópia local.'}`,'error');
    }finally{busy=false;if(refresh)refresh.disabled=false;}
  }
  if(refresh)refresh.addEventListener('click',sync);
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden && loaded && Date.now()-last>60_000)sync();
  });
  sync();
})();
