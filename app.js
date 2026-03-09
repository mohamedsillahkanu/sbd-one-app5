// ═══════════════════════════════════════════════════════════════
// SBD ITN SYSTEM — ICF-SL  |  app.js
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════
const CONFIG = {
  SCRIPT_URL: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec',
  CSV_FILE: 'cascading_data.csv'
};

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
let S = {
  role: null,
  user: null,
  currentDispatch: {},
  activeScanner: null,
  activeScannerId: null,
};

let LOCATION_DATA = {};
let distFormStep = 1;   // distributor add-school wizard step
let distFormData = {};  // distributor add-school form data

// ─── STORAGE ───
function ls(k,v){if(v===undefined){try{return JSON.parse(localStorage.getItem(k)||'null')}catch{return null}}localStorage.setItem(k,JSON.stringify(v))}
function loadState(k,def){return ls(k)||def;}
function saveState(k,v){ls(k,v);}

// ─── DATA STORES ───
let districtStock = loadState('itn_dstock',{pbo:2000,ig2:1500,ledger:[]});
let phuStock      = loadState('itn_pstock',{pbo:0,ig2:0,ledger:[]});
let dispatches    = loadState('itn_dispatches',[]);
let phuDispatches = loadState('itn_phu_dispatches',[]);
let distributions = loadState('itn_distributions',{});  // key → {schools:[...]}

// ─── DEMO USERS ───
const USERS = {
  dhmt1:  {pass:'1234',role:'dhmt',name:'Mohamed Koroma',district:'Kono District',phone:'076-111111',code:'DHMT001'},
  phu1:   {pass:'1234',role:'phu',name:'Mariama Conteh',facility:'Koidu Govt Hospital',district:'Kono District',phone:'077-222222',code:'PHU001'},
  driver1:{pass:'1234',role:'driver',name:'Ibrahim Kamara',vehicle:'SLE-KNO-1234',phone:'078-333333',code:'DRV001'},
  dist1:  {pass:'1234',role:'distributor',name:'Aminata Turay',phone:'079-444444',code:'DIST001',district:'Kono District'},
  dist2:  {pass:'1234',role:'distributor',name:'Sorie Bangura',phone:'078-555555',code:'DIST002',district:'Kono District'}
};
const PHUS = ['Koidu Govt Hospital','Tombu CHC','Nimikoro CHC','Wona CHC','Soa CHC'];

// ═══════════════════════════════════════════
// LOCATION DATA (CSV — distributor form)
// ═══════════════════════════════════════════
function loadLocationData(){
  return new Promise((resolve, reject)=>{
    if(typeof Papa === 'undefined'){resolve();return;}
    Papa.parse(CONFIG.CSV_FILE,{
      download:true, header:true, skipEmptyLines:true,
      complete(results){
        LOCATION_DATA = {};
        results.data.forEach(row=>{
          const dist=(row.adm1||'').trim(), chf=(row.adm2||'').trim(),
                sec=(row.adm3||'').trim(), fac=(row.hf||'').trim(),
                com=(row.community||'').trim(), sch=(row.school_name||'').trim();
          if(!dist) return;
          if(!LOCATION_DATA[dist]) LOCATION_DATA[dist]={};
          if(!LOCATION_DATA[dist][chf]) LOCATION_DATA[dist][chf]={};
          if(!LOCATION_DATA[dist][chf][sec]) LOCATION_DATA[dist][chf][sec]={};
          if(!LOCATION_DATA[dist][chf][sec][fac]) LOCATION_DATA[dist][chf][sec][fac]={};
          if(com && !LOCATION_DATA[dist][chf][sec][fac][com]) LOCATION_DATA[dist][chf][sec][fac][com]=[];
          if(com && sch && !LOCATION_DATA[dist][chf][sec][fac][com].includes(sch))
            LOCATION_DATA[dist][chf][sec][fac][com].push(sch);
        });
        resolve();
      },
      error: reject
    });
  });
}

function populateDistCascade(){
  const sel = document.getElementById('ds-district');
  if(!sel) return;
  sel.innerHTML = '<option value="">Select District...</option>';
  Object.keys(LOCATION_DATA).sort().forEach(d=>{
    const o=document.createElement('option'); o.value=d; o.textContent=d; sel.appendChild(o);
  });
}

function setupDistCascade(){
  const fields = ['ds-district','ds-chiefdom','ds-section','ds-facility','ds-community','ds-school'];
  const ids    = ['district','chiefdom','section','facility','community','school_name'];
  const labels = ['Select Chiefdom...','Select Section...','Select Health Facility...','Select Community...','Select School...'];

  function resetFrom(fromIdx){
    for(let i=fromIdx; i<fields.length; i++){
      const el=document.getElementById(fields[i]);
      if(!el) continue;
      el.innerHTML=`<option value="">${i===0?'Select District...':labels[i-1]}</option>`;
      el.disabled=(i>0);
      const cnt=document.getElementById('cnt-'+ids[i]);
      if(cnt) cnt.textContent='';
    }
  }

  document.getElementById('ds-district')?.addEventListener('change',function(){
    resetFrom(1);
    const d=this.value; if(!d||!LOCATION_DATA[d]) return;
    const chf=document.getElementById('ds-chiefdom');
    chf.disabled=false;
    Object.keys(LOCATION_DATA[d]).sort().forEach(c=>{
      const o=document.createElement('option'); o.value=c; o.textContent=c; chf.appendChild(o);
    });
    const cnt=document.getElementById('cnt-chiefdom');
    if(cnt) cnt.textContent=Object.keys(LOCATION_DATA[d]).length+' options';
    distFormData.district=d;
  });

  document.getElementById('ds-chiefdom')?.addEventListener('change',function(){
    resetFrom(2);
    const d=document.getElementById('ds-district').value, c=this.value;
    if(!d||!c||!LOCATION_DATA[d]?.[c]) return;
    const sec=document.getElementById('ds-section');
    sec.disabled=false;
    Object.keys(LOCATION_DATA[d][c]).sort().forEach(s=>{
      const o=document.createElement('option'); o.value=s; o.textContent=s; sec.appendChild(o);
    });
    const cnt=document.getElementById('cnt-section'); if(cnt) cnt.textContent=Object.keys(LOCATION_DATA[d][c]).length+' options';
    distFormData.chiefdom=c;
  });

  document.getElementById('ds-section')?.addEventListener('change',function(){
    resetFrom(3);
    const d=document.getElementById('ds-district').value, c=document.getElementById('ds-chiefdom').value, s=this.value;
    if(!d||!c||!s||!LOCATION_DATA[d]?.[c]?.[s]) return;
    const fac=document.getElementById('ds-facility');
    fac.disabled=false;
    Object.keys(LOCATION_DATA[d][c][s]).sort().forEach(f=>{
      const o=document.createElement('option'); o.value=f; o.textContent=f; fac.appendChild(o);
    });
    const cnt=document.getElementById('cnt-facility'); if(cnt) cnt.textContent=Object.keys(LOCATION_DATA[d][c][s]).length+' options';
    distFormData.section=s;
  });

  document.getElementById('ds-facility')?.addEventListener('change',function(){
    resetFrom(4);
    const d=document.getElementById('ds-district').value, c=document.getElementById('ds-chiefdom').value,
          s=document.getElementById('ds-section').value, f=this.value;
    if(!d||!c||!s||!f||!LOCATION_DATA[d]?.[c]?.[s]?.[f]) return;
    const com=document.getElementById('ds-community');
    com.disabled=false;
    Object.keys(LOCATION_DATA[d][c][s][f]).sort().forEach(co=>{
      const o=document.createElement('option'); o.value=co; o.textContent=co; com.appendChild(o);
    });
    const cnt=document.getElementById('cnt-community'); if(cnt) cnt.textContent=Object.keys(LOCATION_DATA[d][c][s][f]).length+' options';
    distFormData.facility=f;
  });

  document.getElementById('ds-community')?.addEventListener('change',function(){
    resetFrom(5);
    const d=document.getElementById('ds-district').value, c=document.getElementById('ds-chiefdom').value,
          s=document.getElementById('ds-section').value, f=document.getElementById('ds-facility').value, co=this.value;
    if(!d||!c||!s||!f||!co||!LOCATION_DATA[d]?.[c]?.[s]?.[f]?.[co]) return;
    const sch=document.getElementById('ds-school');
    sch.disabled=false;
    LOCATION_DATA[d][c][s][f][co].forEach(school=>{
      const o=document.createElement('option'); o.value=school; o.textContent=school; sch.appendChild(o);
    });
    const cnt=document.getElementById('cnt-school_name'); if(cnt) cnt.textContent=LOCATION_DATA[d][c][s][f][co].length+' options';
    distFormData.community=co;
  });

  document.getElementById('ds-school')?.addEventListener('change',function(){
    distFormData.schoolName=this.value;
  });
}

// ═══════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const el=document.getElementById(id);
  if(el){el.classList.add('active');window.scrollTo(0,0);}
  if(id==='scr-dhmt')         refreshDHMTDash();
  if(id==='scr-dhmt-records') renderDHMTRecords();
  if(id==='scr-dhmt-stock')   renderDistrictStock();
  if(id==='scr-phu')          refreshPHUDash();
  if(id==='scr-phu-dispatch') refreshPHUDispatch();
  if(id==='scr-phu-return')   refreshPHUReturn();
  if(id==='scr-phu-stock')    renderPHUStock();
  if(id==='scr-distributor')  refreshDistDash();
  if(id==='scr-dist-schools') renderDistSchools();
  if(id==='scr-dist-summary') renderDistSummary();
  if(id==='scr-driver')       refreshDriverDash();
}

// ═══════════════════════════════════════════
// LOGIN / LOGOUT
// ═══════════════════════════════════════════
let selectedRole = null;
function selectRole(r){
  selectedRole = r;
  document.querySelectorAll('.role-btn').forEach(b=>b.classList.toggle('selected',b.dataset.role===r));
}

function doLogin(){
  const u=document.getElementById('loginUser').value.trim();
  const p=document.getElementById('loginPass').value.trim();
  const err=document.getElementById('splErr');
  if(!u||!p){showErr('Please enter credentials.');return;}
  const usr=USERS[u];
  if(!usr||usr.pass!==p){showErr('Invalid username or password.');return;}
  if(selectedRole&&usr.role!==selectedRole){showErr('Role mismatch. Registered as: '+usr.role.toUpperCase());return;}
  err.classList.remove('show');
  S.role=usr.role; S.user={...usr,username:u};
  initRole();
}
function showErr(m){const e=document.getElementById('splErr');if(e){e.textContent=m;e.classList.add('show');}}
function doLogout(){S.role=null;S.user=null;const pi=document.getElementById('loginPass');if(pi)pi.value='';showScreen('splash');}

document.addEventListener('DOMContentLoaded',()=>{
  const pi=document.getElementById('loginPass');
  const ui=document.getElementById('loginUser');
  if(pi) pi.addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
  if(ui) ui.addEventListener('keydown',e=>{if(e.key==='Enter')pi?.focus();});
  // init distributor cascade
  setupDistCascade();
  // load CSV
  loadLocationData().then(()=>{
    populateDistCascade();
  }).catch(()=>{});
  // init GPS listener for distributor form
  setupDistGPS();
  // init signature pad
  setupDistSignature();
});

function initRole(){
  const u=S.user;
  if(u.role==='dhmt'){
    setEl('dhmt-user-sub', u.name+' · '+u.district);
    setEl('dhmt-name', u.name);
    setEl('dhmt-loc', u.district);
    setEl('dhmt-avatar', initials(u.name));
    const sel=document.getElementById('dp-dest');
    if(sel){sel.innerHTML='<option value="">— Select PHU —</option>';PHUS.forEach(p=>{const o=document.createElement('option');o.value=p;o.textContent=p;sel.appendChild(o);});}
    const off=document.getElementById('dp-officer'); if(off) off.value=u.name;
    setNow('dp-date','dp-time');
    showScreen('scr-dhmt');
  } else if(u.role==='phu'){
    setEl('phu-user-sub', u.name+' · '+u.facility);
    setEl('phu-name', u.name);
    setEl('phu-facility', u.facility);
    setEl('phu-avatar', initials(u.name));
    ['phud-dist','ret-dist-sel'].forEach(sid=>{
      const sel=document.getElementById(sid); if(!sel) return;
      sel.innerHTML='<option value="">— Select —</option>';
      Object.entries(USERS).filter(([,v])=>v.role==='distributor').forEach(([k,v])=>{
        const o=document.createElement('option');o.value=k;o.textContent=v.name;sel.appendChild(o);
      });
    });
    showScreen('scr-phu');
  } else if(u.role==='driver'){
    setEl('driver-user-sub', u.name+' · '+u.vehicle);
    setEl('driver-name', u.name);
    setEl('driver-vehicle', 'Vehicle: '+u.vehicle);
    setEl('driver-qr-code', u.code);
    setEl('driver-qr-name', u.name);
    showScreen('scr-driver');
  } else if(u.role==='distributor'){
    setEl('dist-user-sub', u.name);
    setEl('dist-name', u.name);
    setEl('dist-area', u.district);
    showScreen('scr-distributor');
  }
}

// ═══════════════════════════════════════════
// QR SCANNER ENGINE
// ═══════════════════════════════════════════
let scanners={};
function startQR(elementId,callbackName){
  stopAllQR();
  showQRUI(elementId,true);
  if(typeof Html5Qrcode === 'undefined'){notif('QR scanner not loaded','error');return;}
  const scanner=new Html5Qrcode(elementId);
  scanners[elementId]=scanner;
  scanner.start(
    {facingMode:'environment'},{fps:10,qrbox:{width:200,height:200}},
    (decoded)=>{
      scanner.stop().catch(()=>{});
      showQRUI(elementId,false);
      delete scanners[elementId];
      if(window[callbackName]) window[callbackName](decoded);
    },
    ()=>{}
  ).catch(err=>{showQRUI(elementId,false);notif('Camera error: '+err,'error');});
}
function stopQR(elementId){
  if(scanners[elementId]){scanners[elementId].stop().catch(()=>{});delete scanners[elementId];}
  showQRUI(elementId,false);
}
function stopAllQR(){Object.keys(scanners).forEach(k=>stopQR(k));}
function showQRUI(id,show){
  const map={
    'qr-reader':  {wrap:'dp-scanner-wrap',stop:'dp-stop-btn',overlay:'dp-scan-overlay'},
    'qr-reader2': {wrap:'recv-scanner-wrap',stop:'recv-stop-btn',overlay:'recv-scan-overlay'},
    'qr-reader3': {wrap:'phud-scanner-wrap',stop:'phud-stop-btn',scan:'phud-scan-btn'},
    'qr-reader4': {}
  };
  const m=map[id]; if(!m) return;
  if(m.wrap)    setVis(m.wrap,show);
  if(m.stop)    setVis(m.stop,show);
  if(m.overlay) setVis(m.overlay,!show);
  if(m.scan)    setVis(m.scan,!show);
}
function setVis(id,v){const e=document.getElementById(id);if(e)e.style.display=v?'block':'none';}
function parseQR(txt){try{return JSON.parse(txt);}catch{return{code:txt.trim(),name:'',phone:''};}}

// ═══════════════════════════════════════════
// DHMT — DISPATCH FLOW
// ═══════════════════════════════════════════
function calcDpTotal(){
  const p=parseInt(document.getElementById('dp-pbo')?.value)||0;
  const g=parseInt(document.getElementById('dp-ig2')?.value)||0;
  setEl('dp-total',(p+g).toLocaleString());
}

function dpNext1(){
  const dest=document.getElementById('dp-dest')?.value;
  const pbo=parseInt(document.getElementById('dp-pbo')?.value)||0;
  const ig2=parseInt(document.getElementById('dp-ig2')?.value)||0;
  const vehicle=document.getElementById('dp-vehicle')?.value.trim();
  const driver=document.getElementById('dp-driver')?.value.trim();
  const driverTel=document.getElementById('dp-driver-tel')?.value.trim();
  if(!dest){notif('Select a destination PHU','error');return;}
  if(pbo+ig2===0){notif('Enter ITN quantities','error');return;}
  if(!vehicle||!driver||!driverTel){notif('Fill vehicle and driver details','error');return;}
  const errEl=document.getElementById('err-dp-stock');
  if(pbo>districtStock.pbo){if(errEl){errEl.textContent='Insufficient PBO stock (available: '+districtStock.pbo+')';errEl.style.display='block';}return;}
  if(ig2>districtStock.ig2){if(errEl){errEl.textContent='Insufficient IG2 stock (available: '+districtStock.ig2+')';errEl.style.display='block';}return;}
  if(errEl) errEl.style.display='none';
  S.currentDispatch={dest,pbo,ig2,total:pbo+ig2,vehicle,driver,driverTel,officer:S.user.name,date:new Date().toISOString()};
  setVis('dp-step1',false); setVis('dp-step2',true); setStepState(2);
  setEl('dr-dest-display',dest); setEl('dr-pbo-display',pbo);
  setEl('dr-ig2-display',ig2);   setEl('dr-total-display',(pbo+ig2)+' ITNs');
}
function dpBack1(){setVis('dp-step2',false);setVis('dp-step3',false);setVis('dp-step1',true);setStepState(1);}
function dpBack2(){setVis('dp-step3',false);setVis('dp-step2',true);setStepState(2);}

function setStepState(active){
  for(let i=1;i<=4;i++){
    const el=document.getElementById('dstep'+i); if(!el) continue;
    el.classList.remove('cur','done');
    if(i<active) el.classList.add('done');
    else if(i===active) el.classList.add('cur');
  }
}

window.onDriverScan=function(txt){
  const d=parseQR(txt);
  const driverMatch=Object.values(USERS).find(u=>u.role==='driver'&&u.code===d.code);
  if(!driverMatch&&!d.name){notif('Invalid driver ID — not recognized','error');setVis('dp-scan-overlay',true);return;}
  S.currentDispatch.driverCode=d.code||'UNKNOWN';
  S.currentDispatch.driverScanned=d.name||driverMatch?.name||S.currentDispatch.driver;
  setEl('dr-name-display',d.name||driverMatch?.name||d.code);
  setEl('dr-phone-display',d.phone||driverMatch?.phone||'—');
  setVis('dp-driver-info',true);
  notif('Driver ID verified ✓','success');
};

function driverConsent(agreed){
  S.currentDispatch.driverAgreed=agreed;
  setVis('dp-step2',false); setVis('dp-step3',true); setStepState(3);
  const agreeEl=document.getElementById('dp-consent-agree');
  const disagreeEl=document.getElementById('dp-consent-disagree');
  if(agreed){
    if(agreeEl) agreeEl.style.display='block';
    if(disagreeEl) disagreeEl.style.display='none';
    const d=S.currentDispatch;
    const sumEl=document.getElementById('dp-final-summary');
    if(sumEl) sumEl.innerHTML=`
      <div class="summ-item"><span class="summ-k">Dispatch ID</span><span class="summ-v">${genID('DSP')}</span></div>
      <div class="summ-item"><span class="summ-k">Destination</span><span class="summ-v">${d.dest}</span></div>
      <div class="summ-item"><span class="summ-k">PBO ITNs</span><span class="summ-v">${d.pbo}</span></div>
      <div class="summ-item"><span class="summ-k">IG2 ITNs</span><span class="summ-v">${d.ig2}</span></div>
      <div class="summ-item"><span class="summ-k">Total</span><span class="summ-v" style="font-size:18px;color:var(--navy);">${d.total} ITNs</span></div>
      <div class="summ-item"><span class="summ-k">Driver</span><span class="summ-v">${d.driverScanned}</span></div>
      <div class="summ-item"><span class="summ-k">Vehicle</span><span class="summ-v">${d.vehicle}</span></div>
      <div class="summ-item" style="border:none;"><span class="summ-k">Time</span><span class="summ-v">${fmtDateTime(new Date())}</span></div>
    `;
  } else {
    if(agreeEl) agreeEl.style.display='none';
    if(disagreeEl) disagreeEl.style.display='block';
  }
}

function finalizeDispatch(){
  const btn=document.getElementById('dp-finalize-btn');
  if(btn){btn.disabled=true;btn.innerHTML='<div class="spinner"></div> SUBMITTING...';}
  setTimeout(()=>{
    const d=S.currentDispatch;
    const id=genID('DSP');
    dispatches.push({id,dest:d.dest,pbo:d.pbo,ig2:d.ig2,total:d.total,vehicle:d.vehicle,driver:d.driverScanned,driverCode:d.driverCode,driverTel:d.driverTel,officer:d.officer,date:d.date,status:'dispatched',driverAgreed:true});
    saveState('itn_dispatches',dispatches);
    districtStock.pbo-=d.pbo; districtStock.ig2-=d.ig2;
    districtStock.ledger.push({type:'out',reason:'Dispatched '+id+' to '+d.dest,pbo:-d.pbo,ig2:-d.ig2,date:new Date().toISOString()});
    saveState('itn_dstock',districtStock);
    setVis('dp-step3',false); setVis('dp-step4',true); setStepState(4);
    setEl('dp-success-msg',id+' dispatched to '+d.dest+' — '+d.total+' ITNs');
    const detail=document.getElementById('dp-success-detail');
    if(detail) detail.innerHTML=`
      <div class="summ-item"><span class="summ-k">Dispatch ID</span><span class="summ-v">${id}</span></div>
      <div class="summ-item"><span class="summ-k">Destination</span><span class="summ-v">${d.dest}</span></div>
      <div class="summ-item"><span class="summ-k">PBO</span><span class="summ-v">${d.pbo}</span></div>
      <div class="summ-item"><span class="summ-k">IG2</span><span class="summ-v">${d.ig2}</span></div>
      <div class="summ-item"><span class="summ-k">Total</span><span class="summ-v">${d.total}</span></div>
      <div class="summ-item" style="border:none;"><span class="summ-k">Stock Remaining</span><span class="summ-v">${districtStock.pbo+districtStock.ig2} ITNs</span></div>
    `;
    notif('Dispatch '+id+' submitted!','success');
    S.currentDispatch={};
    resetDispatchForm();
  },800);
}

function resetDispatchForm(){
  ['dp-pbo','dp-ig2','dp-vehicle','dp-driver','dp-driver-tel'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  const destEl=document.getElementById('dp-dest'); if(destEl) destEl.value='';
  setEl('dp-total','0');
  setVis('dp-driver-info',false);
  setVis('dp-step2',false); setVis('dp-step3',false);
  setNow('dp-date','dp-time');
}

function refreshDHMTDash(){
  const total=dispatches.length;
  const recv=dispatches.filter(d=>d.status==='received').length;
  const inTransit=dispatches.filter(d=>d.status==='dispatched').length;
  setEl('dStat1',total); setEl('dStat2',recv); setEl('dStat3',inTransit);
  setEl('dStat4',(districtStock.pbo+districtStock.ig2).toLocaleString());
  setEl('dhmt-records-sub',total+' total · '+inTransit+' in transit');
}

function renderDHMTRecords(){
  const el=document.getElementById('dhmt-records-content');
  if(!el) return;
  if(!dispatches.length){el.innerHTML='<div style="text-align:center;padding:40px;color:var(--gray-d);font-size:13px;">No dispatches yet</div>';return;}
  el.innerHTML=dispatches.slice().reverse().map(d=>`
    <div class="dispatch-card ${d.status}">
      <div class="dc-top"><div class="dc-id">${d.id}</div><span class="pill ${d.status==='received'?'green':d.status==='shortage'?'red':'orange'}">${d.status.toUpperCase()}</span></div>
      <div class="dc-meta">${d.dest} · ${fmtDateTime(new Date(d.date))}</div>
      <div class="dc-meta">${d.vehicle} · ${d.driver}</div>
      <div class="dc-qty"><span class="pill navy">PBO: ${d.pbo}</span><span class="pill teal">IG2: ${d.ig2}</span><span class="pill gold">Total: ${d.total}</span>${d.receivedTotal?`<span class="pill ${d.receivedTotal===d.total?'green':'red'}">Recv: ${d.receivedTotal}</span>`:''}</div>
    </div>
  `).join('');
}

function renderDistrictStock(){
  setEl('dst-pbo',districtStock.pbo.toLocaleString());
  setEl('dst-ig2',districtStock.ig2.toLocaleString());
  setEl('dst-total',(districtStock.pbo+districtStock.ig2).toLocaleString());
  const ledger=document.getElementById('stock-ledger');
  if(!ledger) return;
  if(!districtStock.ledger.length){ledger.innerHTML='<div style="text-align:center;color:var(--gray-d);font-size:13px;padding:20px 0;">No transactions yet</div>';return;}
  ledger.innerHTML=districtStock.ledger.slice().reverse().map(t=>`
    <div class="summ-item">
      <span class="summ-k">${fmtDateTime(new Date(t.date))} — ${t.reason}</span>
      <span class="summ-v" style="color:${t.pbo<0?'var(--red)':'var(--green)'};">${t.pbo>0?'+':''}${t.pbo} PBO / ${t.ig2>0?'+':''}${t.ig2} IG2</span>
    </div>
  `).join('');
}

function addDistrictStock(){
  const pbo=parseInt(document.getElementById('add-pbo')?.value)||0;
  const ig2=parseInt(document.getElementById('add-ig2')?.value)||0;
  const src=document.getElementById('add-source')?.value.trim()||'Manual entry';
  if(pbo+ig2===0){notif('Enter quantities to add','error');return;}
  districtStock.pbo+=pbo; districtStock.ig2+=ig2;
  districtStock.ledger.push({type:'in',reason:src,pbo,ig2,date:new Date().toISOString()});
  saveState('itn_dstock',districtStock);
  ['add-pbo','add-ig2','add-source'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  renderDistrictStock();
  notif('Stock updated: +'+pbo+' PBO, +'+ig2+' IG2','success');
}

// ═══════════════════════════════════════════
// PHU — RECEIVE FROM DHMT
// ═══════════════════════════════════════════
let currentRecvDispatch=null;

window.onDriverScanRecv=function(txt){
  const d=parseQR(txt);
  const myFacility=S.user.facility;
  let match=dispatches.find(dp=>dp.status==='dispatched'&&dp.dest===myFacility&&(dp.driverCode===d.code||dp.driver.toLowerCase().includes((d.name||'').toLowerCase())));
  if(!match) match=dispatches.find(dp=>dp.status==='dispatched'&&dp.dest===myFacility);
  if(!match){notif('No active dispatch found for this driver/PHU','error');setVis('recv-scan-overlay',true);return;}
  currentRecvDispatch=match;
  const sumEl=document.getElementById('recv-dispatch-summary');
  if(sumEl) sumEl.innerHTML=`
    <div class="summ-item"><span class="summ-k">Dispatch ID</span><span class="summ-v">${match.id}</span></div>
    <div class="summ-item"><span class="summ-k">Driver</span><span class="summ-v">${d.name||match.driver}</span></div>
    <div class="summ-item"><span class="summ-k">Vehicle</span><span class="summ-v">${match.vehicle}</span></div>
    <div class="summ-item"><span class="summ-k">Dispatched</span><span class="summ-v">${fmtDateTime(new Date(match.date))}</span></div>
    <div class="summ-item"><span class="summ-k">PBO Expected</span><span class="summ-v">${match.pbo}</span></div>
    <div class="summ-item"><span class="summ-k">IG2 Expected</span><span class="summ-v">${match.ig2}</span></div>
    <div class="summ-item" style="border:none;"><span class="summ-k">Total Expected</span><span class="summ-v" style="font-size:18px;color:var(--navy);">${match.total}</span></div>
  `;
  setVis('recv-dispatch-info',true);
  notif('Dispatch loaded: '+match.id,'info');
};

function checkRecvMatch(){
  if(!currentRecvDispatch) return;
  const rpbo=parseInt(document.getElementById('recv-pbo')?.value)||0;
  const rig2=parseInt(document.getElementById('recv-ig2')?.value)||0;
  const box=document.getElementById('recv-match-box');
  const btn=document.getElementById('recv-confirm-btn');
  const shortage=document.getElementById('recv-shortage-section');
  if(!box) return;
  box.style.display='block';
  if(rpbo===currentRecvDispatch.pbo&&rig2===currentRecvDispatch.ig2){
    box.style.background='var(--green-l)';box.style.border='2px solid var(--green)';box.style.color='var(--green-d)';
    box.textContent='✓ Quantities match!  PBO: '+rpbo+' · IG2: '+rig2;
    if(btn) btn.disabled=false;
    if(shortage) shortage.style.display='none';
  } else {
    const spbo=currentRecvDispatch.pbo-rpbo, sig2=currentRecvDispatch.ig2-rig2;
    box.style.background='var(--red-l)';box.style.border='2px solid var(--red)';box.style.color='var(--red-d)';
    box.textContent='Mismatch! Expected PBO:'+currentRecvDispatch.pbo+'/IG2:'+currentRecvDispatch.ig2+' | Shortage: '+(spbo>0?spbo+' PBO ':'')+(sig2>0?sig2+' IG2':'');
    if(btn) btn.disabled=true;
    if(shortage) shortage.style.display='block';
  }
}

function scanDriverForShortage(){notif('Scan driver ID for shortage acknowledgment','info');startQR('qr-reader2','onDriverShortageAck');}

window.onDriverShortageAck=function(txt){
  const rpbo=parseInt(document.getElementById('recv-pbo')?.value)||0;
  const rig2=parseInt(document.getElementById('recv-ig2')?.value)||0;
  const note=document.getElementById('recv-shortage-note')?.value;
  const accts=loadState('itn_acct',[]);
  accts.push({type:'driver_shortage',dispatchId:currentRecvDispatch.id,expected:currentRecvDispatch.total,received:rpbo+rig2,shortage:(currentRecvDispatch.pbo-rpbo)+(currentRecvDispatch.ig2-rig2),driver:currentRecvDispatch.driver,note,date:new Date().toISOString()});
  saveState('itn_acct',accts);
  const btn=document.getElementById('recv-confirm-btn'); if(btn) btn.disabled=false;
  notif('Driver acknowledged shortage — recorded','warn');
};

function confirmPHUReceipt(){
  const rpbo=parseInt(document.getElementById('recv-pbo')?.value)||0;
  const rig2=parseInt(document.getElementById('recv-ig2')?.value)||0;
  const btn=document.getElementById('recv-confirm-btn');
  if(btn){btn.disabled=true;btn.innerHTML='<div class="spinner"></div> CONFIRMING...';}
  setTimeout(()=>{
    const idx=dispatches.findIndex(d=>d.id===currentRecvDispatch.id);
    if(idx>=0){dispatches[idx].status=rpbo+rig2<currentRecvDispatch.total?'shortage':'received';dispatches[idx].receivedTotal=rpbo+rig2;dispatches[idx].receivedDate=new Date().toISOString();}
    saveState('itn_dispatches',dispatches);
    phuStock.pbo+=rpbo; phuStock.ig2+=rig2;
    phuStock.ledger.push({type:'in',reason:'Received '+currentRecvDispatch.id+' from DHMT',pbo:rpbo,ig2:rig2,date:new Date().toISOString()});
    saveState('itn_pstock',phuStock);
    notif('Receipt confirmed! Stock updated.','success');
    currentRecvDispatch=null;
    setVis('recv-dispatch-info',false);
    setVis('recv-match-box',false);
    setVis('recv-shortage-section',false);
    ['recv-pbo','recv-ig2'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    if(btn){btn.disabled=false;btn.innerHTML='<svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2;"><polyline points="20 6 9 17 4 12"/></svg>CONFIRM RECEIPT';}
    showScreen('scr-phu');
  },700);
}

// ═══════════════════════════════════════════
// PHU — DISPATCH TO DISTRIBUTOR
// ═══════════════════════════════════════════
function refreshPHUDispatch(){
  setEl('phud-pbo-avail',phuStock.pbo);
  setEl('phud-ig2-avail',phuStock.ig2);
}

function loadDistributorSchools(){
  const key=document.getElementById('phud-dist')?.value;
  const block=document.getElementById('phud-schools-block');
  if(!key){if(block)block.style.display='none';return;}
  const usr=USERS[key];
  if(!usr){if(block)block.style.display='none';return;}
  if(block) block.style.display='block';
  // Calculate need from today's distributions for this distributor
  const distData=distributions[key];
  const totalDist=distData?.schools?.reduce((s,sc)=>s+sc.totalITN,0)||0;
  const needEl=document.getElementById('phud-auto-need');
  const schoolsList=document.getElementById('phud-schools-list');
  if(needEl) needEl.textContent='Based on distributor records';
  // Show today's distributed schools
  if(schoolsList){
    if(!distData?.schools?.length){
      schoolsList.innerHTML='<div style="color:var(--gray-d);font-size:12px;padding:8px 0;">No distribution records yet for today.</div>';
    } else {
      schoolsList.innerHTML=distData.schools.map(s=>`
        <div class="school-item">
          <div class="si-top"><span class="si-name">${s.name}</span><span class="pill green">${s.totalITN} ITNs</span></div>
        </div>
      `).join('');
    }
  }
  if(needEl) needEl.textContent=totalDist+' ITNs distributed';
  const proceedBtn=document.getElementById('phud-proceed-btn');
  if(proceedBtn){proceedBtn.dataset.distKey=key;proceedBtn.dataset.need=9999;}
}

function checkPHUDQty(){
  const pbo=parseInt(document.getElementById('phud-pbo')?.value)||0;
  const ig2=parseInt(document.getElementById('phud-ig2')?.value)||0;
  const total=pbo+ig2;
  const warn=document.getElementById('phud-qty-warn');
  const btn=document.getElementById('phud-proceed-btn');
  if(warn) warn.style.display='none';
  if(pbo>phuStock.pbo){if(warn){warn.textContent='Insufficient PBO stock (available: '+phuStock.pbo+')';warn.style.display='block';}if(btn)btn.disabled=true;return;}
  if(ig2>phuStock.ig2){if(warn){warn.textContent='Insufficient IG2 stock (available: '+phuStock.ig2+')';warn.style.display='block';}if(btn)btn.disabled=true;return;}
  if(btn) btn.disabled=(total===0);
}

function proceedToDistConsent(){
  const pbo=parseInt(document.getElementById('phud-pbo')?.value)||0;
  const ig2=parseInt(document.getElementById('phud-ig2')?.value)||0;
  if(pbo+ig2===0){notif('Enter quantities','error');return;}
  setVis('phud-consent-section',true);
  setVis('phud-proceed-btn',false);
  S.currentDispatch={distKey:document.getElementById('phud-proceed-btn')?.dataset.distKey,pbo,ig2,total:pbo+ig2};
}

window.onDistributorConsentScan=function(txt){
  const d=parseQR(txt);
  const key=S.currentDispatch.distKey;
  const usr=USERS[key];
  const recId=genID('PHD');
  const record={id:recId,distKey:key,distName:usr?.name||key,pbo:S.currentDispatch.pbo,ig2:S.currentDispatch.ig2,total:S.currentDispatch.total,consentCode:d.code||'SCANNED',date:new Date().toISOString(),status:'dispatched',returned:false};
  phuDispatches.push(record);
  saveState('itn_phu_dispatches',phuDispatches);
  phuStock.pbo-=S.currentDispatch.pbo; phuStock.ig2-=S.currentDispatch.ig2;
  phuStock.ledger.push({type:'out',reason:'Dispatched '+recId+' to '+(usr?.name||key),pbo:-S.currentDispatch.pbo,ig2:-S.currentDispatch.ig2,date:new Date().toISOString()});
  saveState('itn_pstock',phuStock);
  notif('Dispatched '+S.currentDispatch.total+' ITNs to '+(usr?.name||key),'success');
  setVis('phud-consent-section',false);
  setVis('phud-proceed-btn',true);
  const distSel=document.getElementById('phud-dist'); if(distSel) distSel.value='';
  setVis('phud-schools-block',false);
  ['phud-pbo','phud-ig2'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  S.currentDispatch={};
  showScreen('scr-phu');
};

function refreshPHUDash(){
  setEl('pStat1',phuStock.pbo); setEl('pStat2',phuStock.ig2);
  const dispatched=phuDispatches.filter(d=>!d.returned).reduce((s,d)=>s+d.total,0);
  const distributed=Object.values(distributions).reduce((s,d)=>{
    return s+(d.schools||[]).reduce((a,sc)=>a+sc.totalITN,0);
  },0);
  setEl('pStat3',dispatched); setEl('pStat4',distributed);
}

// ═══════════════════════════════════════════
// PHU — RETURNS
// ═══════════════════════════════════════════
function refreshPHUReturn(){
  const sel=document.getElementById('ret-dist-sel');
  if(!sel) return;
  sel.innerHTML='<option value="">— Select —</option>';
  Object.entries(USERS).filter(([,v])=>v.role==='distributor').forEach(([k,v])=>{
    const o=document.createElement('option');o.value=k;o.textContent=v.name;sel.appendChild(o);
  });
}

function loadReturnInfo(){
  const key=document.getElementById('ret-dist-sel')?.value;
  const block=document.getElementById('ret-info-block');
  if(!key){if(block)block.style.display='none';return;}
  const disp=phuDispatches.find(d=>d.distKey===key&&!d.returned);
  if(!disp){
    if(block){block.innerHTML='<div class="alert warn"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/></svg><div class="alert-txt"><strong>NO ACTIVE DISPATCH</strong><span>No outstanding dispatch for this distributor.</span></div></div>';block.style.display='block';}
    return;
  }
  if(block) block.style.display='block';
  const distData=distributions[key];
  const totalDist=distData?.schools?.reduce((s,sc)=>s+sc.totalITN,0)||0;
  const expectedReturn=disp.total-totalDist;
  S.currentDispatch={retDispatch:disp,expectedReturn,totalDist,key};
  const box=document.getElementById('ret-reconcile-box');
  if(box) box.innerHTML=`
    <div class="card" style="background:var(--navy-l);border:2px solid var(--navy);margin-bottom:12px;">
      <div class="card-body" style="padding:12px 16px;">
        <div class="summ-item"><span class="summ-k">Given to Distributor</span><span class="summ-v">${disp.total}</span></div>
        <div class="summ-item"><span class="summ-k">Distributed at Schools</span><span class="summ-v">${totalDist}</span></div>
        <div class="summ-item" style="border:none;"><span class="summ-k">Expected Return</span><span class="summ-v" style="font-size:18px;color:var(--navy);font-weight:700;">${expectedReturn}</span></div>
      </div>
    </div>
  `;
  ['ret-pbo','ret-ig2'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  setVis('ret-match-box',false); setVis('ret-shortage-section',false);
  const btn=document.getElementById('ret-confirm-btn'); if(btn) btn.disabled=true;
}

function checkReturnMatch(){
  if(!S.currentDispatch.retDispatch) return;
  const rpbo=parseInt(document.getElementById('ret-pbo')?.value)||0;
  const rig2=parseInt(document.getElementById('ret-ig2')?.value)||0;
  const actual=rpbo+rig2, expected=S.currentDispatch.expectedReturn;
  const box=document.getElementById('ret-match-box');
  const btn=document.getElementById('ret-confirm-btn');
  const shortage=document.getElementById('ret-shortage-section');
  if(!box) return;
  box.style.display='block';
  if(actual===expected){
    box.style.background='var(--green-l)';box.style.border='2px solid var(--green)';box.style.color='var(--green-d)';
    box.textContent='✓ Return matches expected ('+expected+' ITNs)';
    if(btn) btn.disabled=false;
    if(shortage) shortage.style.display='none';
  } else {
    box.style.background='var(--red-l)';box.style.border='2px solid var(--red)';box.style.color='var(--red-d)';
    box.textContent='Mismatch!  Expected: '+expected+' | Actual: '+actual+' | Diff: '+(expected-actual);
    if(btn) btn.disabled=true;
    if(shortage) shortage.style.display='block';
    const acctEl=document.getElementById('ret-acct-details');
    if(acctEl) acctEl.innerHTML=`
      <div class="acct-row"><span class="ak">Distributor</span><span class="av">${USERS[S.currentDispatch.key]?.name||'—'}</span></div>
      <div class="acct-row"><span class="ak">Given</span><span class="av">${S.currentDispatch.retDispatch.total}</span></div>
      <div class="acct-row"><span class="ak">Distributed</span><span class="av">${S.currentDispatch.totalDist}</span></div>
      <div class="acct-row"><span class="ak">Expected Return</span><span class="av">${expected}</span></div>
      <div class="acct-row"><span class="ak">Actual Return</span><span class="av">${actual}</span></div>
      <div class="acct-row"><span class="ak" style="color:var(--red-d);font-weight:700;">Shortage</span><span class="av" style="color:var(--red-d);">${expected-actual} ITNs</span></div>
    `;
  }
}

function scanDistForReturnShortage(){notif('Scan distributor ID for accountability acknowledgment','info');startQR('qr-reader4','onDistReturnShortageAck');}

window.onDistReturnShortageAck=function(txt){
  const rpbo=parseInt(document.getElementById('ret-pbo')?.value)||0;
  const rig2=parseInt(document.getElementById('ret-ig2')?.value)||0;
  const note=document.getElementById('ret-shortage-note')?.value;
  const accts=loadState('itn_acct',[]);
  accts.push({type:'dist_return_shortage',distKey:S.currentDispatch.key,distName:USERS[S.currentDispatch.key]?.name,expected:S.currentDispatch.expectedReturn,actual:rpbo+rig2,shortage:S.currentDispatch.expectedReturn-(rpbo+rig2),note,date:new Date().toISOString()});
  saveState('itn_acct',accts);
  const btn=document.getElementById('ret-confirm-btn'); if(btn) btn.disabled=false;
  notif('Distributor acknowledged shortage','warn');
};

function confirmReturn(){
  const rpbo=parseInt(document.getElementById('ret-pbo')?.value)||0;
  const rig2=parseInt(document.getElementById('ret-ig2')?.value)||0;
  const btn=document.getElementById('ret-confirm-btn');
  if(btn){btn.disabled=true;btn.innerHTML='<div class="spinner"></div> PROCESSING...';}
  setTimeout(()=>{
    const idx=phuDispatches.findIndex(d=>d.id===S.currentDispatch.retDispatch.id);
    if(idx>=0){Object.assign(phuDispatches[idx],{returned:true,returnedPBO:rpbo,returnedIG2:rig2,returnedTotal:rpbo+rig2,returnDate:new Date().toISOString()});}
    saveState('itn_phu_dispatches',phuDispatches);
    phuStock.pbo+=rpbo; phuStock.ig2+=rig2;
    phuStock.ledger.push({type:'in',reason:'Return from '+(USERS[S.currentDispatch.key]?.name||S.currentDispatch.key),pbo:rpbo,ig2:rig2,date:new Date().toISOString()});
    saveState('itn_pstock',phuStock);
    notif('Return confirmed! '+(rpbo+rig2)+' ITNs added to PHU stock.','success');
    S.currentDispatch={};
    const retSel=document.getElementById('ret-dist-sel'); if(retSel) retSel.value='';
    setVis('ret-info-block',false);
    if(btn){btn.disabled=false;btn.innerHTML='<svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2;"><polyline points="20 6 9 17 4 12"/></svg>CONFIRM RETURN & UPDATE STOCK';}
    showScreen('scr-phu');
  },700);
}

function renderPHUStock(){
  setEl('phu-ledger-pbo',phuStock.pbo); setEl('phu-ledger-ig2',phuStock.ig2);
  setEl('phu-ledger-total',phuStock.pbo+phuStock.ig2);
  const el=document.getElementById('phu-stock-ledger-content');
  if(!el) return;
  if(!phuStock.ledger.length){el.innerHTML='<div style="text-align:center;color:var(--gray-d);font-size:13px;padding:20px 0;">No transactions yet</div>';return;}
  el.innerHTML=phuStock.ledger.slice().reverse().map(t=>`
    <div class="summ-item">
      <span class="summ-k">${fmtDateTime(new Date(t.date))} — ${t.reason}</span>
      <span class="summ-v" style="color:${t.pbo<0?'var(--red)':'var(--green)'};">${t.pbo>0?'+':''}${t.pbo}PBO / ${t.ig2>0?'+':''}${t.ig2}IG2</span>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════
// DRIVER DASHBOARD
// ═══════════════════════════════════════════
function refreshDriverDash(){
  const myDispatches=dispatches.filter(d=>d.driverCode===S.user.code||d.driver===S.user.name);
  const el=document.getElementById('driver-dispatches');
  if(!el) return;
  if(!myDispatches.length){el.innerHTML='<div style="text-align:center;color:var(--gray-d);font-size:13px;padding:20px 0;">No dispatches assigned</div>';return;}
  el.innerHTML=myDispatches.slice().reverse().map(d=>`
    <div class="dispatch-card ${d.status}" style="margin-bottom:10px;">
      <div class="dc-top"><div class="dc-id">${d.id}</div><span class="pill ${d.status==='received'?'green':d.status==='shortage'?'red':'orange'}">${d.status.toUpperCase()}</span></div>
      <div class="dc-meta">${d.dest} · ${fmtDateTime(new Date(d.date))}</div>
      <div class="dc-qty"><span class="pill navy">PBO:${d.pbo}</span><span class="pill teal">IG2:${d.ig2}</span><span class="pill gold">Total:${d.total}</span></div>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════
// DISTRIBUTOR — NEW CSV-BASED SCHOOL FORM
// ═══════════════════════════════════════════
function refreshDistDash(){
  const key=S.user.username;
  const disp=phuDispatches.find(d=>d.distKey===key&&!d.returned);
  const given=disp?.total||0;
  const distData=distributions[key];
  const distributed=(distData?.schools||[]).reduce((s,sc)=>s+sc.totalITN,0);
  const remaining=given-distributed;
  const coverage=given>0?Math.round(distributed/given*100):0;
  setEl('di-stat1',given); setEl('di-stat2',distributed);
  setEl('di-stat3',Math.max(0,remaining)); setEl('di-stat4',coverage+'%');
}

function renderDistSchools(){
  const key=S.user.username;
  const disp=phuDispatches.find(d=>d.distKey===key&&!d.returned);
  const el=document.getElementById('dist-schools-content');
  if(!el) return;

  const distData=distributions[key]||{schools:[]};
  let html='';

  // Add School button always present
  html+=`<button class="add-school-btn" onclick="openAddSchoolForm()">
    <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    ADD NEW SCHOOL
  </button>`;

  if(!disp){
    html+=`<div class="alert warn"><svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/></svg><div class="alert-txt"><strong>NO ITNs ALLOCATED YET</strong><span>Wait for PHU staff to dispatch ITNs to you. You can still record schools in advance.</span></div></div>`;
  }

  if(!distData.schools.length){
    html+=`<div style="text-align:center;color:var(--gray-d);font-size:13px;padding:30px 0;">No distributions recorded today.<br>Tap the button above to add a school.</div>`;
  } else {
    distData.schools.forEach((s,i)=>{
      const cov=s.pupils>0?Math.round(s.totalITN/s.pupils*100):0;
      html+=`<div class="school-card done">
        <div class="school-card-hdr">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--green-d)" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
          <span class="school-card-name">${s.name}</span>
          <span class="pill green" style="margin-left:auto;font-size:10px;">${s.totalITN} ITNs</span>
        </div>
        <div class="school-card-body">
          <div style="font-size:11px;color:var(--text-s);margin-bottom:8px;">${s.pupils||0} pupils · ${cov}% coverage · ${fmtDateTime(new Date(s.date))}</div>
          <button class="btn" style="background:var(--navy-l);color:var(--navy);border:none;padding:6px 12px;border-radius:6px;font-size:11px;font-family:'Oswald',sans-serif;cursor:pointer;" onclick="viewSchoolRecord(${i})">
            <svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:var(--navy);fill:none;stroke-width:2;display:inline;vertical-align:middle;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            VIEW DETAILS
          </button>
        </div>
      </div>`;
    });
  }
  el.innerHTML=html;
}

// Open the add-school wizard
function openAddSchoolForm(){
  distFormStep=1;
  distFormData={};
  showDistFormStep(1);
  // reset cascades
  ['ds-district','ds-chiefdom','ds-section','ds-facility','ds-community','ds-school'].forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    el.value=''; el.disabled=(id!=='ds-district');
  });
  // pre-fill distributor name
  const nameEl=document.getElementById('ds-dist-name');
  if(nameEl) nameEl.value=S.user.name;
  captureDistGPS();
  showScreen('scr-dist-add');
}

function showDistFormStep(step){
  for(let i=1;i<=3;i++){
    const sec=document.getElementById('dist-form-step-'+i);
    if(sec) sec.style.display=(i===step?'block':'none');
    const dot=document.getElementById('dist-step-dot-'+i);
    if(dot){dot.classList.toggle('active',i===step);dot.classList.toggle('done',i<step);}
  }
  distFormStep=step;
  setEl('dist-form-step-label','STEP '+step+' OF 3');
}

function distFormNext(){
  if(distFormStep===1){
    const school=document.getElementById('ds-school')?.value;
    if(!school){notif('Please select a school first','error');return;}
    distFormData.schoolName=school;
    distFormData.district=document.getElementById('ds-district')?.value||'';
    distFormData.chiefdom=document.getElementById('ds-chiefdom')?.value||'';
    distFormData.section=document.getElementById('ds-section')?.value||'';
    distFormData.facility=document.getElementById('ds-facility')?.value||'';
    distFormData.community=document.getElementById('ds-community')?.value||'';
    buildEnrollmentTable();
    showDistFormStep(2);
  } else if(distFormStep===2){
    if(!collectEnrollment()) return;
    buildDistributionTable();
    showDistFormStep(3);
  }
}
function distFormBack(){
  if(distFormStep>1) showDistFormStep(distFormStep-1);
  else showScreen('scr-dist-schools');
}

// Step 2: Enrollment table (5 classes, boys & girls count)
function buildEnrollmentTable(){
  const tbody=document.getElementById('enroll-tbody');
  if(!tbody) return;
  tbody.innerHTML='';
  for(let c=1;c<=5;c++){
    tbody.innerHTML+=`<tr>
      <td><strong>Class ${c}</strong></td>
      <td><input type="number" min="0" value="0" id="enr-boys-${c}" oninput="calcEnrollTotals()"></td>
      <td><input type="number" min="0" value="0" id="enr-girls-${c}" oninput="calcEnrollTotals()"></td>
      <td id="enr-tot-${c}">0</td>
    </tr>`;
  }
  calcEnrollTotals();
}

function calcEnrollTotals(){
  let totalBoys=0, totalGirls=0;
  for(let c=1;c<=5;c++){
    const b=parseInt(document.getElementById('enr-boys-'+c)?.value)||0;
    const g=parseInt(document.getElementById('enr-girls-'+c)?.value)||0;
    const totEl=document.getElementById('enr-tot-'+c);
    if(totEl) totEl.textContent=b+g;
    totalBoys+=b; totalGirls+=g;
  }
  setEl('enr-total-boys',totalBoys); setEl('enr-total-girls',totalGirls); setEl('enr-total-all',totalBoys+totalGirls);
}

function collectEnrollment(){
  distFormData.classes=[];
  let total=0;
  for(let c=1;c<=5;c++){
    const boys=parseInt(document.getElementById('enr-boys-'+c)?.value)||0;
    const girls=parseInt(document.getElementById('enr-girls-'+c)?.value)||0;
    distFormData.classes.push({c,boys,girls});
    total+=boys+girls;
  }
  if(total===0){notif('Enter at least one pupil in the enrollment table','error');return false;}
  return true;
}

// Step 3: ITN distribution table
function buildDistributionTable(){
  const key=S.user.username;
  const disp=phuDispatches.find(d=>d.distKey===key&&!d.returned);
  const given=disp?.total||0;
  const alreadyDist=(distributions[key]?.schools||[]).reduce((s,sc)=>s+sc.totalITN,0);
  const avail=given-alreadyDist;
  setEl('dist-avail',avail);
  setEl('dist-school-display', distFormData.schoolName||'Unknown School');
  const tbody=document.getElementById('dist-tbody');
  if(!tbody) return;
  tbody.innerHTML='';
  distFormData.classes.forEach(c=>{
    tbody.innerHTML+=`<tr>
      <td><strong>C${c.c}</strong></td>
      <td>${c.boys}</td>
      <td><input type="number" min="0" max="${c.boys}" value="0" id="dist-boys-${c.c}" oninput="validateDistIn(${c.c},'boys',${c.boys});calcDistTotals()"></td>
      <td>${c.girls}</td>
      <td><input type="number" min="0" max="${c.girls}" value="0" id="dist-girls-${c.c}" oninput="validateDistIn(${c.c},'girls',${c.girls});calcDistTotals()"></td>
      <td id="dist-itn-${c.c}">0</td>
    </tr>`;
  });
  calcDistTotals();
}

function validateDistIn(c,gender,max){
  const id=(gender==='boys'?'dist-boys-':'dist-girls-')+c;
  const el=document.getElementById(id); if(!el) return;
  const val=parseInt(el.value)||0;
  if(val>max){el.classList.add('over');el.value=max;}else{el.classList.remove('over');}
}

function calcDistTotals(){
  const key=S.user.username;
  const disp=phuDispatches.find(d=>d.distKey===key&&!d.returned);
  const given=disp?.total||0;
  const alreadyDist=(distributions[key]?.schools||[]).reduce((s,sc)=>s+sc.totalITN,0);
  const avail=given-alreadyDist;
  let total=0;
  (distFormData.classes||[]).forEach(c=>{
    const b=parseInt(document.getElementById('dist-boys-'+c.c)?.value)||0;
    const g=parseInt(document.getElementById('dist-girls-'+c.c)?.value)||0;
    const itn=b+g; total+=itn;
    const itnEl=document.getElementById('dist-itn-'+c.c); if(itnEl) itnEl.textContent=itn;
  });
  setEl('dist-total-itn',total);
  const errEl=document.getElementById('dist-form-err');
  const saveBtn=document.getElementById('dist-save-btn');
  if(given>0&&total>avail){
    if(errEl){errEl.textContent='Exceeds available ITNs ('+avail+' remaining)';errEl.style.display='block';}
    if(saveBtn) saveBtn.disabled=true;
  } else {
    if(errEl) errEl.style.display='none';
    if(saveBtn) saveBtn.disabled=(total===0);
  }
}

function saveDistribution(){
  const key=S.user.username;
  let totalITN=0, totalPupils=0;
  const classes=[];
  (distFormData.classes||[]).forEach(c=>{
    const b=parseInt(document.getElementById('dist-boys-'+c.c)?.value)||0;
    const g=parseInt(document.getElementById('dist-girls-'+c.c)?.value)||0;
    classes.push({c:c.c,boys:c.boys,girls:c.girls,boysITN:b,girlsITN:g,totalITN:b+g});
    totalITN+=b+g; totalPupils+=c.boys+c.girls;
  });
  const record={
    name:distFormData.schoolName,
    district:distFormData.district,
    chiefdom:distFormData.chiefdom,
    facility:distFormData.facility,
    community:distFormData.community,
    classes, totalITN, pupils:totalPupils,
    distributor:S.user.name,
    distCode:S.user.code,
    gps:distFormData.gps||{lat:'',lng:''},
    date:new Date().toISOString()
  };
  if(!distributions[key]) distributions[key]={schools:[]};
  distributions[key].schools.push(record);
  const disp=phuDispatches.find(d=>d.distKey===key&&!d.returned);
  distributions[key].totalGiven=disp?.total||0;
  saveState('itn_distributions',distributions);
  notif(totalITN+' ITNs saved for '+distFormData.schoolName,'success');
  refreshDistDash();
  showScreen('scr-dist-schools');
}

// View a saved school record
function viewSchoolRecord(idx){
  const key=S.user.username;
  const school=(distributions[key]?.schools||[])[idx];
  if(!school) return;
  const el=document.getElementById('school-record-content');
  if(!el) return;
  setEl('school-record-title', school.name);
  el.innerHTML=`
    <div class="card-body">
      <div class="summ-item"><span class="summ-k">District</span><span class="summ-v">${school.district||'—'}</span></div>
      <div class="summ-item"><span class="summ-k">Facility</span><span class="summ-v">${school.facility||'—'}</span></div>
      <div class="summ-item"><span class="summ-k">Community</span><span class="summ-v">${school.community||'—'}</span></div>
      <div class="summ-item"><span class="summ-k">Date</span><span class="summ-v">${fmtDateTime(new Date(school.date))}</span></div>
      <div class="summ-item"><span class="summ-k">Distributor</span><span class="summ-v">${school.distributor}</span></div>
      <div class="summ-item" style="border:none;"><span class="summ-k">Total ITNs</span><span class="summ-v" style="font-size:20px;color:var(--navy);">${school.totalITN}</span></div>
    </div>
    <div style="overflow-x:auto;padding:0 16px 16px;">
      <table class="enroll-table">
        <thead><tr><th>Class</th><th>Boys</th><th>Boys ITN</th><th>Girls</th><th>Girls ITN</th><th>Total ITN</th></tr></thead>
        <tbody>${school.classes.map(c=>`<tr><td><strong>C${c.c}</strong></td><td>${c.boys}</td><td>${c.boysITN}</td><td>${c.girls}</td><td>${c.girlsITN}</td><td><strong>${c.totalITN}</strong></td></tr>`).join('')}</tbody>
      </table>
    </div>
  `;
  showScreen('scr-dist-record');
}

function renderDistSummary(){
  const key=S.user.username;
  const disp=phuDispatches.find(d=>d.distKey===key&&!d.returned);
  const given=disp?.total||0;
  const distData=distributions[key];
  const distributed=(distData?.schools||[]).reduce((s,sc)=>s+sc.totalITN,0);
  const remaining=Math.max(0,given-distributed);
  setEl('ds-given',given); setEl('ds-dist',distributed); setEl('ds-remain',remaining);
  const el=document.getElementById('dist-summary-detail');
  if(!el) return;
  if(!(distData?.schools?.length)){
    el.innerHTML='<div class="card-body" style="text-align:center;color:var(--gray-d);padding:30px 0;font-size:13px;">No distributions recorded yet</div>';
    return;
  }
  let html='<div class="card-body"><div class="fsec" style="font-family:Oswald,sans-serif;font-size:10px;font-weight:600;letter-spacing:1.5px;color:var(--gray-d);margin-bottom:10px;">SCHOOL BREAKDOWN</div>';
  distData.schools.forEach(s=>{
    html+=`<div style="background:var(--gray);border-radius:8px;padding:12px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="font-family:'Oswald',sans-serif;font-size:13px;color:var(--navy);">${s.name}</span>
        <span class="pill green">${s.totalITN} ITNs</span>
      </div>
      <table class="enroll-table" style="font-size:10.5px;">
        <thead><tr><th>C</th><th>Boys</th><th>BITN</th><th>Girls</th><th>GITN</th><th>Total</th></tr></thead>
        <tbody>${s.classes.map(c=>`<tr><td>${c.c}</td><td>${c.boys}</td><td>${c.boysITN}</td><td>${c.girls}</td><td>${c.girlsITN}</td><td><strong>${c.totalITN}</strong></td></tr>`).join('')}</tbody>
      </table>
    </div>`;
  });
  html+='</div>';
  el.innerHTML=html;
}

// ═══════════════════════════════════════════
// DISTRIBUTOR GPS
// ═══════════════════════════════════════════
function setupDistGPS(){}
function captureDistGPS(){
  const dot=document.getElementById('dist-gps-dot');
  const txt=document.getElementById('dist-gps-txt');
  const coordEl=document.getElementById('dist-gps-coords');
  if(dot) dot.className='gps-dot loading';
  if(txt) txt.textContent='Capturing GPS...';
  if(!navigator.geolocation){
    if(dot) dot.className='gps-dot err';
    if(txt) txt.textContent='GPS not supported (optional)';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos=>{
      const {latitude:lat,longitude:lng,accuracy:acc}=pos.coords;
      distFormData.gps={lat:lat.toFixed(6),lng:lng.toFixed(6),acc:Math.round(acc)};
      if(dot) dot.className='gps-dot ok';
      if(txt) txt.textContent='GPS captured!';
      if(coordEl) coordEl.textContent=lat.toFixed(5)+', '+lng.toFixed(5)+' (±'+Math.round(acc)+'m)';
    },
    ()=>{
      if(dot) dot.className='gps-dot err';
      if(txt) txt.textContent='GPS unavailable (optional)';
    },
    {enableHighAccuracy:true,timeout:20000,maximumAge:0}
  );
}

// ═══════════════════════════════════════════
// DISTRIBUTOR SIGNATURE
// ═══════════════════════════════════════════
let distSigPad=null;
function setupDistSignature(){
  const canvas=document.getElementById('dist-sig-canvas');
  if(!canvas||typeof SignaturePad==='undefined') return;
  distSigPad=new SignaturePad(canvas,{backgroundColor:'#fff',penColor:'#000'});
}
function clearDistSig(){if(distSigPad) distSigPad.clear();}
function retryDistGPS(){captureDistGPS();}

// ═══════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════
function genID(prefix){return prefix+'-'+Date.now().toString(36).toUpperCase().slice(-6);}
function initials(name){return (name||'??').split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();}
function fmtDateTime(d){
  return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})
        +' '+d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
}
function setNow(dateId,timeId){
  const now=new Date();
  const dEl=document.getElementById(dateId), tEl=document.getElementById(timeId);
  if(dEl) dEl.value=now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  if(tEl) tEl.value=now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
}
function setEl(id,val){const e=document.getElementById(id);if(e) e.textContent=val;}

let notifTimer;
function notif(msg,type){
  const el=document.getElementById('notif');
  if(!el) return;
  el.textContent=msg;
  el.className='notif show '+(type||'info');
  clearTimeout(notifTimer);
  notifTimer=setTimeout(()=>{el.className='notif';},3000);
}
