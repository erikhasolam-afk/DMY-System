/* ═══════════════════════════════════════════
   charts.js — Dynamic dashboard & reports
   Connected to allPatients + txStore
   ═══════════════════════════════════════════ */

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const chartOpts = { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } } };

let dashInst = {};
let rptInst  = {};

// ── Compute live data from stores ──────────
function computeChartData() {
  const now      = new Date();
  const thisYear = now.getFullYear();

  // Monthly patient counts (current year)
  const pxByMonth = Array(12).fill(0);
  (typeof allPatients !== 'undefined' ? allPatients : []).forEach(p => {
    const d = new Date(p.date);
    if (d.getFullYear() === thisYear) pxByMonth[d.getMonth()]++;
  });

  // Monthly COLLECTIONS (current year) — from actual payment records, by payment date,
  // net of refunds. Same function as the Financial Reports, so the numbers match.
  const incByMonth = Array(12).fill(0).map((_, m) => computeFinancials({
    from: localISODate(new Date(thisYear, m, 1)), to: localISODate(new Date(thisYear, m + 1, 0)),
  }).netCollections);
  const procCount  = {};
  const demoCount  = { Male:0, Female:0, 'Child (<12)':0, 'Senior (60+)':0 };
  // Outstanding = what patients still owe on active (non-voided) treatments
  const totalBalance = computeFinancials({}).outstanding;

  Object.entries(typeof txStore !== 'undefined' ? txStore : {}).forEach(([patName, entries]) => {
    entries.forEach(e => {
      if (e.status === 'voided') return;
      procCount[e.procedure] = (procCount[e.procedure] || 0) + 1;
    });
  });

  // Demographics from allPatients
  (typeof allPatients !== 'undefined' ? allPatients : []).forEach(p => {
    const age = parseInt(p.age);
    if (!isNaN(age) && age < 12) demoCount['Child (<12)']++;
    else if (!isNaN(age) && age >= 60) demoCount['Senior (60+)']++;
    else if (p.sex === 'Male')   demoCount['Male']++;
    else if (p.sex === 'Female') demoCount['Female']++;
  });

  // Procedure breakdown (top 6)
  const procLabels = ['Cleaning/Prophylaxis','Amalgam Filling','Extraction','Root Canal','Orthodontic Adj.','Other'];
  const procData   = procLabels.map((l,i) => {
    if (i < 5) return procCount[l] || 0;
    return Object.entries(procCount).filter(([k]) => !procLabels.slice(0,5).includes(k)).reduce((s,[,v])=>s+v,0);
  });

  return { pxByMonth, incByMonth, procLabels, procData, demoCount, totalBalance };
}

function updateReportsData() {
  const { pxByMonth, incByMonth, procLabels, procData, demoCount, totalBalance } = computeChartData();
  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear  = now.getFullYear();

  // Update report stat cards
  const monthIncome   = incByMonth[thisMonth];
  const monthPatients = pxByMonth[thisMonth];
  const totalPatients = (typeof allPatients !== 'undefined' ? allPatients : []).length;

  const el = id => document.getElementById(id);
  if (el('rpt-revenue'))   el('rpt-revenue').textContent   = peso(monthIncome);
  if (el('rpt-total-px'))  el('rpt-total-px').textContent  = totalPatients;
  if (el('rpt-balance'))   el('rpt-balance').textContent   = peso(totalBalance);
  if (el('rpt-new-px'))    el('rpt-new-px').textContent    = monthPatients;
  if (el('stat-new-month')) el('stat-new-month').textContent = monthPatients;
  if (el('stat-total'))    el('stat-total').textContent    = totalPatients;

  // Dashboard monthly revenue — always recalculate from txStore so it persists after reload
  const dashRev = el('dash-revenue');
  if (dashRev) dashRev.textContent = pesoShort(monthIncome);

  // Update charts if they exist
  if (dashInst.px)  { dashInst.px.data.datasets[0].data  = pxByMonth;  dashInst.px.update(); }
  if (dashInst.inc) { dashInst.inc.data.datasets[0].data = incByMonth; dashInst.inc.update(); }
  if (rptInst.px)   { rptInst.px.data.datasets[0].data   = pxByMonth;  rptInst.px.update(); }
  if (rptInst.inc)  { rptInst.inc.data.datasets[0].data  = incByMonth; rptInst.inc.update(); }
  if (rptInst.demo) {
    rptInst.demo.data.labels = Object.keys(demoCount);
    rptInst.demo.data.datasets[0].data = Object.values(demoCount);
    rptInst.demo.update();
  }
}

function initDash() {
  ['dash-px','dash-inc'].forEach(id => { const c = Chart.getChart(id); if (c) c.destroy(); });
  const { pxByMonth, incByMonth } = computeChartData();

  dashInst.px = new Chart(document.getElementById('dash-px'), {
    type: 'line',
    data: { labels: MONTHS, datasets: [{ data: pxByMonth, borderColor:'#3A9EA5', backgroundColor:'rgba(58,158,165,.1)', fill:true, tension:.4, pointRadius:3, pointBackgroundColor:'#3A9EA5' }] },
    options: { ...chartOpts }
  });
  dashInst.inc = new Chart(document.getElementById('dash-inc'), {
    type: 'bar',
    data: { labels: MONTHS, datasets: [{ data: incByMonth, backgroundColor:'#F47B20', borderRadius:5 }] },
    options: { ...chartOpts }
  });

  // Sync stat cards with live data
  updateReportsData();
  if (typeof updateTodaysAppointments === 'function') updateTodaysAppointments();
}

function initReports() {
  ['rpt-px','rpt-inc','rpt-proc','rpt-demo'].forEach(id => { const c = Chart.getChart(id); if (c) c.destroy(); });
  const { pxByMonth, incByMonth, procLabels, procData, demoCount } = computeChartData();

  rptInst.px = new Chart(document.getElementById('rpt-px'), {
    type:'bar',
    data:{ labels:MONTHS, datasets:[{ label:'New Patients', data:pxByMonth, backgroundColor:'rgba(58,158,165,.8)', borderRadius:5 }] },
    options:{ ...chartOpts, plugins:{ legend:{ display:true, labels:{ font:{ size:11 } } } } }
  });
  rptInst.inc = new Chart(document.getElementById('rpt-inc'), {
    type:'line',
    data:{ labels:MONTHS, datasets:[{ label:'Net collections (P)', data:incByMonth, borderColor:'#F47B20', backgroundColor:'rgba(244,123,32,.1)', fill:true, tension:.4, pointRadius:4, pointBackgroundColor:'#F47B20' }] },
    options:{ ...chartOpts, plugins:{ legend:{ display:true, labels:{ font:{ size:11 } } } } }
  });
  if (document.getElementById('rpt-proc')) rptInst.proc = new Chart(document.getElementById('rpt-proc'), {
    type:'doughnut',
    data:{ labels:procLabels, datasets:[{ data:procData, backgroundColor:['#3A9EA5','#F47B20','#E24B4A','#639922','#7F77DD','#B4B2A9'], borderWidth:2 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'right', labels:{ boxWidth:12, font:{ size:11 } } } } }
  });
  rptInst.demo = new Chart(document.getElementById('rpt-demo'), {
    type:'pie',
    data:{ labels:Object.keys(demoCount), datasets:[{ data:Object.values(demoCount), backgroundColor:['#3A9EA5','#F47B20','#639922','#D85A30'], borderWidth:2 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'right', labels:{ boxWidth:12, font:{ size:11 } } } } }
  });
  if (typeof initFinancialReports === 'function') initFinancialReports();
}
