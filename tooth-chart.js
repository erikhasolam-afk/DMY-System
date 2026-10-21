/* tooth-chart.js — Anatomical SVG dental chart, correct arch layout */
/* DB NOTE: Run this migration in Supabase SQL Editor if not already done:
   ALTER TABLE public.dental_charts ADD COLUMN IF NOT EXISTS tooth_notes jsonb; */

// ── Tooth number layout ──────────────────────────────────────────────
const PU = [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28];
const PL = [48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];
const TU = [55,54,53,52,51,61,62,63,64,65];
const TL = [85,84,83,82,81,71,72,73,74,75];

const toothState = {};
const toothNotes = {};
let currentTool = 'P';
let currentChartPatient = '';
const chartStore = {};
const chartNotesStore = {};

// ── Tooth type ───────────────────────────────────────────────────────
function getToothType(num) {
  const n = parseInt(num), d = n % 10;
  if ((n>=51&&n<=65)||(n>=71&&n<=85)) {
    if (d<=2) return 'di';
    if (d===3) return 'dc';
    return 'dm';
  }
  if (d===1) return 'ci';
  if (d===2) return 'li';
  if (d===3) return 'ca';
  if (d===4) return 'p1';
  if (d===5) return 'p2';
  if (d===6) return 'm1';
  if (d===7) return 'm2';
  return 'm3';
}

function isLower(num) {
  const n = parseInt(num);
  return (n>=31&&n<=48)||(n>=71&&n<=85);
}

// ── SVG paths — viewBox 44×74 ────────────────────────────────────────
// Each entry: [upper_crown, upper_roots, lower_crown, lower_roots]
// Upper = crown near y=0, roots extend toward y=74
// Lower = crown near y=74, roots extend toward y=0
// No flip transforms — both orientations drawn explicitly.
const TP = {
  ci: [
    'M8,10 C8,2 36,2 36,10 L34,16 C34,18 10,18 10,16 Z',          // upper crown
    'M14,18 Q14,52 22,56 Q30,52 30,18 Z',                          // upper roots
    'M8,64 C8,72 36,72 36,64 L34,58 C34,56 10,56 10,58 Z',        // lower crown
    'M14,56 Q14,22 22,18 Q30,22 30,56 Z',                          // lower roots
  ],
  li: [
    'M10,11 C10,3 34,3 34,11 L32,17 C32,18 12,18 12,17 Z',
    'M15,18 Q15,50 22,54 Q29,50 29,18 Z',
    'M10,63 C10,71 34,71 34,63 L32,57 C32,56 12,56 12,57 Z',
    'M15,56 Q15,24 22,20 Q29,24 29,56 Z',
  ],
  ca: [
    'M9,14 L22,2 L35,14 L33,18 L11,18 Z',
    'M14,18 Q14,54 22,58 Q30,54 30,18 Z',
    'M9,60 L22,72 L35,60 L33,56 L11,56 Z',
    'M14,56 Q14,20 22,16 Q30,20 30,56 Z',
  ],
  p1: [
    'M10,10 C10,2 34,2 34,10 L34,17 C34,19 10,19 10,17 Z M18,3 L22,12 L26,3',
    'M11,19 Q12,48 17,52 Q20,50 20,19 Z M24,19 Q24,50 27,52 Q32,48 33,19 Z',
    'M10,64 C10,72 34,72 34,64 L34,57 C34,55 10,55 10,57 Z M18,71 L22,62 L26,71',
    'M11,55 Q12,26 17,22 Q20,24 20,55 Z M24,55 Q24,24 27,22 Q32,26 33,55 Z',
  ],
  p2: [
    'M10,11 C10,3 34,3 34,11 L34,17 C34,19 10,19 10,17 Z M19,4 L22,13 L25,4',
    'M11,19 Q12,46 17,50 Q20,48 20,19 Z M24,19 Q24,48 27,50 Q32,46 33,19 Z',
    'M10,63 C10,71 34,71 34,63 L34,57 C34,55 10,55 10,57 Z M19,70 L22,61 L25,70',
    'M11,55 Q12,28 17,24 Q20,26 20,55 Z M24,55 Q24,26 27,24 Q32,28 33,55 Z',
  ],
  m1: [
    'M7,8 C7,0 37,0 37,8 L37,18 C37,20 7,20 7,18 Z M7,12 L37,12 M22,0 L22,20',
    'M8,20 Q9,48 15,52 Q18,50 18,20 Z M20,20 Q20,50 22,52 Q24,50 24,20 Z M26,20 Q26,48 34,52 Q36,50 36,20 Z',
    'M7,66 C7,74 37,74 37,66 L37,56 C37,54 7,54 7,56 Z M7,62 L37,62 M22,74 L22,54',
    'M8,54 Q9,26 15,22 Q18,24 18,54 Z M20,54 Q20,24 22,22 Q24,24 24,54 Z M26,54 Q26,26 34,22 Q36,24 36,54 Z',
  ],
  m2: [
    'M8,9 C8,1 36,1 36,9 L36,18 C36,20 8,20 8,18 Z M8,13 L36,13 M22,1 L22,20',
    'M9,20 Q10,47 15,51 Q18,49 18,20 Z M20,20 Q20,49 22,51 Q24,49 24,20 Z M26,20 Q26,47 33,50 Q35,48 35,20 Z',
    'M8,65 C8,73 36,73 36,65 L36,56 C36,54 8,54 8,56 Z M8,61 L36,61 M22,73 L22,54',
    'M9,54 Q10,27 15,23 Q18,25 18,54 Z M20,54 Q20,25 22,23 Q24,25 24,54 Z M26,54 Q26,27 33,24 Q35,26 35,54 Z',
  ],
  m3: [
    'M8,9 C8,1 36,1 36,9 L36,18 C36,20 8,20 8,18 Z M8,13 L36,13 M22,1 L22,20',
    'M9,20 Q10,44 15,47 Q17,46 17,20 Z M19,20 Q19,46 22,48 Q25,46 25,20 Z M27,20 Q27,44 34,46 Q36,44 36,20 Z',
    'M8,65 C8,73 36,73 36,65 L36,56 C36,54 8,54 8,56 Z M8,61 L36,61 M22,73 L22,54',
    'M9,54 Q10,30 15,27 Q17,28 17,54 Z M19,54 Q19,28 22,26 Q25,28 25,54 Z M27,54 Q27,30 34,28 Q36,30 36,54 Z',
  ],
  // Deciduous
  di: [
    'M11,11 C11,4 33,4 33,11 L31,17 C31,18 13,18 13,17 Z',
    'M15,18 Q15,46 22,49 Q29,46 29,18 Z',
    'M11,63 C11,70 33,70 33,63 L31,57 C31,56 13,56 13,57 Z',
    'M15,56 Q15,28 22,25 Q29,28 29,56 Z',
  ],
  dc: [
    'M11,14 L22,4 L33,14 L31,18 L13,18 Z',
    'M15,18 Q15,46 22,49 Q29,46 29,18 Z',
    'M11,60 L22,70 L33,60 L31,56 L13,56 Z',
    'M15,56 Q15,28 22,25 Q29,28 29,56 Z',
  ],
  dm: [
    'M8,10 C8,3 36,3 36,10 L36,18 C36,19 8,19 8,18 Z M8,13 L36,13 M22,3 L22,19',
    'M7,19 Q8,44 13,47 Q16,46 16,19 Z M18,19 Q18,46 22,48 Q26,46 26,19 Z M28,19 Q29,43 36,46 Q37,44 37,19 Z',
    'M8,64 C8,71 36,71 36,64 L36,56 C36,55 8,55 8,56 Z M8,61 L36,61 M22,71 L22,55',
    'M7,55 Q8,30 13,27 Q16,28 16,55 Z M18,55 Q18,28 22,26 Q26,28 26,55 Z M28,55 Q29,31 36,28 Q37,30 37,55 Z',
  ],
};

// ── Build SVG for one tooth ───────────────────────────────────────────
// Anatomical convention: crowns face the occlusal plane (midline of chart).
//  - Upper teeth → roots pointing UP, crowns pointing DOWN toward the bite.
//  - Lower teeth → roots pointing DOWN, crowns pointing UP toward the bite.
// The TP definitions originally labelled paths "upper crown at y=top" and
// "lower crown at y=bottom". To get the correct anatomical view we use the
// "bottom-crown" path for upper teeth and the "top-crown" path for lower teeth.
function buildToothSVG(num) {
  const type  = getToothType(num);
  const lower = isLower(num);
  const paths = TP[type] || TP.ci;
  // Swap from the original mapping: crowns now point toward the midline.
  const crownPath = lower ? paths[0] : paths[2];   // lower → top-crown, upper → bottom-crown
  const rootPath  = lower ? paths[1] : paths[3];   // lower → top-roots, upper → bottom-roots
  // Symbol overlay positioned over the crown.
  const symY      = lower ? 12 : 62;

  return `<svg class="tooth-svg" viewBox="0 0 44 74" xmlns="http://www.w3.org/2000/svg">
    <path class="tooth-root" d="${rootPath}"
      fill="#e8eff4" stroke="#8fa8b8" stroke-width="1.2"
      stroke-linejoin="round" stroke-linecap="round"
      pointer-events="visiblePainted"/>
    <path class="tooth-crown" d="${crownPath}"
      fill="#f0f4f8" stroke="#8fa8b8" stroke-width="1.4"
      stroke-linejoin="round" stroke-linecap="round"
      pointer-events="visiblePainted"/>
    <text class="tooth-overlay-sym" x="22" y="${symY}" text-anchor="middle"
      dominant-baseline="central" font-size="11" font-weight="800"
      font-family="Nunito,sans-serif" fill="transparent"
      pointer-events="none"></text>
  </svg>`;
}

// ── Inject CSS ────────────────────────────────────────────────────────
(function injectChartStyles() {
  if (document.getElementById('tooth-chart-css')) return;
  const style = document.createElement('style');
  style.id = 'tooth-chart-css';
  style.textContent = `
    /* Tooth wrapper */
    .t-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0;
    }
    /* The tooth container — pointer-events:none so only SVG paths fire */
    .tooth {
      display: flex;
      flex-direction: column;
      align-items: center;
      position: relative;
      user-select: none;
      pointer-events: none;
    }
    /* Number label */
    .tn {
      font-family: 'Nunito', sans-serif;
      font-size: 12px;
      font-weight: 700;
      color: #5a7a8a;
      line-height: 1.3;
      text-align: center;
      pointer-events: none;
      white-space: nowrap;
    }
    /* SVG — permanent size */
    .tooth-svg {
      display: block;
      width: 50px;
      height: 80px;
      overflow: visible;
      transition: transform .12s ease, filter .12s ease;
      pointer-events: none;
    }
    /* Deciduous teeth — slightly smaller */
    .tooth-svg.decid {
      width: 42px;
      height: 68px;
    }
    /* Only painted path pixels are clickable */
    .tooth-svg .tooth-crown,
    .tooth-svg .tooth-root {
      pointer-events: visiblePainted;
      cursor: pointer;
    }
    .tooth-svg:hover  { transform: scale(1.15); filter: brightness(0.90); }
    .tooth-svg:active { transform: scale(1.05); }

    /* Row containers — override any existing styles */
    #row-pu, #row-tu, #row-tl, #row-pl {
      display: flex !important;
      flex-direction: row !important;
      justify-content: center !important;
      flex-wrap: nowrap !important;
      gap: 12px !important;
    }
    /* Upper rows: align bottoms so crowns sit at the same line */
    #row-pu, #row-tu { align-items: flex-end !important; }
    /* Lower rows: align tops so crowns sit at the same line */
    #row-tl, #row-pl { align-items: flex-start !important; }

    /* Midline divider */
    .tdiv {
      width: 3px;
      min-width: 3px;
      align-self: stretch;
      background: #c0d4de;
      opacity: .5;
      border-radius: 2px;
      margin: 0 8px;
    }

    /* ── State colour overrides ── */
    .tooth.present   .tooth-crown { fill: #EAF3DE !important; stroke: #639922 !important; }
    .tooth.present   .tooth-root  { fill: #d4eab8 !important; stroke: #639922 !important; }
    .tooth.decayed   .tooth-crown { fill: #FAECE7 !important; stroke: #D85A30 !important; }
    .tooth.decayed   .tooth-root  { fill: #f2d0c0 !important; stroke: #D85A30 !important; }
    .tooth.missing   .tooth-crown { fill: #F1EFE8 !important; stroke: #aaa !important; stroke-dasharray:3,2; }
    .tooth.missing   .tooth-root  { fill: #e5e3db !important; stroke: #aaa !important; stroke-dasharray:3,2; }
    .tooth.extracted .tooth-crown { fill: #FCEBEB !important; stroke: #E24B4A !important; }
    .tooth.extracted .tooth-root  { fill: #f8d4d4 !important; stroke: #E24B4A !important; }
    .tooth.filled    .tooth-crown { fill: #FFF3E8 !important; stroke: #F47B20 !important; }
    .tooth.filled    .tooth-root  { fill: #ffe0c0 !important; stroke: #F47B20 !important; }
    .tooth.crown     .tooth-crown { fill: #E8F6F7 !important; stroke: #3A9EA5 !important; stroke-width:2 !important; }
    .tooth.crown     .tooth-root  { fill: #c8eaec !important; stroke: #3A9EA5 !important; }
    .tooth.implant   .tooth-crown { fill: #EEEDFE !important; stroke: #7F77DD !important; }
    .tooth.implant   .tooth-root  { fill: #d8d5fc !important; stroke: #7F77DD !important; stroke-dasharray:3,2; }

    /* Note dot */
    .tnote-dot {
      position: absolute;
      top: 3px; right: 3px;
      width: 8px; height: 8px;
      background: #F47B20;
      border-radius: 50%;
      pointer-events: none;
      z-index: 2;
    }
  `;
  document.head.appendChild(style);
})();

// ── Tool configuration ────────────────────────────────────────────────
const toolCfg = {
  P:  { cls:'present',   sym:'✓',  label:'Present',   fill:'#EAF3DE', stroke:'#639922', text:'#3B6D11' },
  D:  { cls:'decayed',   sym:'D',  label:'Decayed',   fill:'#FAECE7', stroke:'#D85A30', text:'#D85A30' },
  M:  { cls:'missing',   sym:'M',  label:'Missing',   fill:'#F1EFE8', stroke:'#aaaaaa', text:'#888888' },
  X:  { cls:'extracted', sym:'X',  label:'Extracted', fill:'#FCEBEB', stroke:'#E24B4A', text:'#E24B4A' },
  F:  { cls:'filled',    sym:'Am', label:'Filled',    fill:'#FFF3E8', stroke:'#F47B20', text:'#F47B20' },
  C:  { cls:'crown',     sym:'JC', label:'Crown',     fill:'#E8F6F7', stroke:'#3A9EA5', text:'#1F6E74' },
  Im: { cls:'implant',   sym:'Im', label:'Implant',   fill:'#EEEDFE', stroke:'#7F77DD', text:'#534AB7' },
  CLR:{ cls:'',          sym:'',   label:'Clear',     fill:'#ffffff', stroke:'#D6E4E6', text:'#1A2E35' },
};

// ── Note modal ────────────────────────────────────────────────────────
(function injectNoteModal() {
  if (document.getElementById('tooth-note-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'tooth-note-modal';
  modal.style.cssText = 'display:none;position:fixed;z-index:10000;background:#fff;border:1.5px solid var(--bd,#D6E4E6);border-radius:12px;padding:14px 16px;box-shadow:0 8px 28px rgba(0,0,0,.18);min-width:210px;max-width:260px;font-family:var(--fb,"Lato",sans-serif)';
  modal.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div id="tnm-title" style="font-family:var(--fh,'Nunito',sans-serif);font-size:13px;font-weight:800;color:var(--td,#1F6E74)"></div>
      <button onclick="closeToothNoteModal()" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--mu,#6B7E85);padding:0 2px">&times;</button>
    </div>
    <textarea id="tnm-input" rows="3" placeholder="Add a note for this tooth…"
      style="width:100%;box-sizing:border-box;border:1.5px solid var(--bd,#D6E4E6);border-radius:8px;padding:7px 9px;font-size:12px;font-family:inherit;resize:vertical;color:var(--tx,#1A2E35);outline:none"
      onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();saveToothNote()}"></textarea>
    <div style="display:flex;gap:7px;margin-top:8px">
      <button onclick="saveToothNote()" style="flex:1;padding:7px;background:var(--t,#3A9EA5);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Save</button>
      <button onclick="clearToothNote()" style="padding:7px 10px;background:#FCEBEB;color:#E24B4A;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Clear</button>
    </div>`;
  document.body.appendChild(modal);
  document.addEventListener('click', e => {
    const m = document.getElementById('tooth-note-modal');
    if (m && m.style.display!=='none' && !m.contains(e.target) && !e.target.closest('.tooth')) m.style.display='none';
  });
})();

let _noteTargetTooth = null;

function openToothNoteModal(num, anchorEl) {
  _noteTargetTooth = num;
  const modal = document.getElementById('tooth-note-modal');
  const cfg = toothState[num] ? toolCfg[toothState[num]] : null;
  document.getElementById('tnm-title').textContent = 'Tooth '+num+(cfg?' — '+cfg.label:'');
  document.getElementById('tnm-input').value = toothNotes[num]||'';

  // Get bounding rect of the SVG shape itself for tight positioning
  const svgEl = anchorEl ? (anchorEl.querySelector('.tooth-svg') || anchorEl) : null;
  const rect   = svgEl ? svgEl.getBoundingClientRect() : {top:100,bottom:120,left:100,right:140,width:40};

  // Modal is position:fixed — no scroll offset needed
  modal.style.display = 'block';
  modal.style.top  = '-9999px';
  modal.style.left = '-9999px';

  requestAnimationFrame(() => {
    const mw  = modal.offsetWidth  || 240;
    const mh  = modal.offsetHeight || 140;
    const vw  = window.innerWidth;
    const vh  = window.innerHeight;
    const GAP = 8;

    // Centre horizontally on the tooth, place below it
    let left = rect.left + (rect.width / 2) - (mw / 2);
    let top  = rect.bottom + GAP;

    // If it clips the bottom, flip above
    if (top + mh > vh - GAP) top = rect.top - mh - GAP;
    // Keep within horizontal bounds
    if (left + mw > vw - GAP) left = vw - mw - GAP;
    if (left < GAP) left = GAP;

    modal.style.top  = top  + 'px';
    modal.style.left = left + 'px';
    document.getElementById('tnm-input').focus();
  });
}
function closeToothNoteModal() {
  const m = document.getElementById('tooth-note-modal');
  if (m) m.style.display='none';
  _noteTargetTooth=null;
}
function saveToothNote() {
  if (_noteTargetTooth==null) return;
  const val = document.getElementById('tnm-input').value.trim();
  if (val) toothNotes[_noteTargetTooth]=val; else delete toothNotes[_noteTargetTooth];
  updateToothNoteIndicator(_noteTargetTooth);
  closeToothNoteModal();
  if (typeof notif==='function') notif('Note saved for tooth '+_noteTargetTooth+'.','al-s');
}
function clearToothNote() {
  if (_noteTargetTooth==null) return;
  delete toothNotes[_noteTargetTooth];
  document.getElementById('tnm-input').value='';
  updateToothNoteIndicator(_noteTargetTooth);
  closeToothNoteModal();
}
function updateToothNoteIndicator(num) {
  const el=document.getElementById('tooth-'+num);
  if (!el) return;
  let dot=el.querySelector('.tnote-dot');
  if (toothNotes[num]) {
    if (!dot){dot=document.createElement('div');dot.className='tnote-dot';el.appendChild(dot);}
    el.title='Tooth '+num+' — '+(toolCfg[toothState[num]]?.label||'')+' | Note: '+toothNotes[num];
  } else {
    if (dot) dot.remove();
    el.title='Tooth '+num+' — click to mark, right-click to clear';
  }
}

// ── Build one tooth element ───────────────────────────────────────────
function buildToothEl(num) {
  const lower  = isLower(num);
  const type   = getToothType(num);
  const isDecid = ['di','dc','dm'].includes(type);

  const wrap = document.createElement('div');
  wrap.className = 't-wrap';

  const tooth = document.createElement('div');
  tooth.className = 'tooth';
  tooth.id = 'tooth-'+num;
  tooth.title = 'Tooth '+num+' — click to mark, right-click to clear';

  const numLabel = document.createElement('div');
  numLabel.className = 'tn';
  numLabel.textContent = num;

  const svgWrap = document.createElement('div');
  svgWrap.innerHTML = buildToothSVG(num);
  const svgEl = svgWrap.firstElementChild;
  if (isDecid) svgEl.classList.add('decid');

  svgEl.onclick = () => applyTool(num);
  svgEl.oncontextmenu = e => { e.preventDefault(); clearTooth(num); };

  // Upper: number above, SVG below (roots extend downward)
  // Lower: SVG above (roots extend upward), number below
  if (lower) {
    tooth.appendChild(svgEl);
    tooth.appendChild(numLabel);
  } else {
    tooth.appendChild(numLabel);
    tooth.appendChild(svgEl);
  }

  wrap.appendChild(tooth);
  return wrap;
}

// ── Build a row ───────────────────────────────────────────────────────
function buildRow(nums, rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;
  row.innerHTML = '';
  const mid = Math.floor(nums.length / 2);
  nums.forEach((n, i) => {
    if (i===mid) {
      const d = document.createElement('div');
      d.className = 'tdiv';
      row.appendChild(d);
    }
    row.appendChild(buildToothEl(n));
  });
}

// ── Visual state ──────────────────────────────────────────────────────
function applyToothVisual(num, toolKey) {
  const el = document.getElementById('tooth-'+num);
  if (!el) return;
  Object.values(toolCfg).forEach(c => { if (c.cls) el.classList.remove(c.cls); });
  const cfg = toolCfg[toolKey];
  if (!cfg) return;
  if (toolKey!=='CLR' && cfg.cls) el.classList.add(cfg.cls);
  const sym = el.querySelector('.tooth-overlay-sym');
  if (sym) { sym.textContent=toolKey!=='CLR'?cfg.sym:''; sym.style.fill=toolKey!=='CLR'?cfg.text:'transparent'; }
}

function setTool(t) {
  currentTool = t;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active-tool'));
  const el = document.getElementById('tool-'+t);
  if (el) el.classList.add('active-tool');
}

function applyTool(num) {
  if (currentTool==='CLR') { clearTooth(num); return; }
  toothState[num] = currentTool;
  applyToothVisual(num, currentTool);
  updateToothNoteIndicator(num);
  syncTeethToTreatment();
  openToothNoteModal(num, document.getElementById('tooth-'+num));
}

function clearTooth(num) {
  delete toothState[num];
  delete toothNotes[num];
  const el = document.getElementById('tooth-'+num);
  if (!el) return;
  Object.values(toolCfg).forEach(c => { if (c.cls) el.classList.remove(c.cls); });
  const sym = el.querySelector('.tooth-overlay-sym');
  if (sym) { sym.textContent=''; sym.style.fill='transparent'; }
  updateToothNoteIndicator(num);
  syncTeethToTreatment();
}

function applyTool_direct(num, tool) {
  if (tool==='CLR') return;
  if (!toolCfg[tool]) return;
  toothState[num]=tool;
  applyToothVisual(num, tool);
  updateToothNoteIndicator(num);
}

function syncTeethToTreatment() {
  const txPx    = document.getElementById('tr-nm')?.value?.trim();
  const chartPx = document.getElementById('dc-nm')?.value?.trim();
  if (txPx && chartPx && txPx===chartPx) {
    const tn = document.getElementById('tr-tn');
    if (tn) tn.value = Object.keys(toothState).join(',')||'';
  }
}

// ── Save / Load ───────────────────────────────────────────────────────
async function saveChart() {
  const name = document.getElementById('dc-nm').value.trim();
  if (!name) { notif('Enter a patient name before saving.','al-i'); return; }
  currentChartPatient=name;
  chartStore[name]=JSON.parse(JSON.stringify(toothState));
  chartNotesStore[name]=JSON.parse(JSON.stringify(toothNotes));
  const conditions=collectChartConditions();
  notif('Dental chart saved — '+Object.keys(toothState).length+' tooth/teeth marked.','al-s');
  try {
    if (supabase) {
      const {error}=await supabase.from('dental_charts').upsert([{
        patient_name:name, tooth_state:JSON.stringify(toothState),
        tooth_notes:JSON.stringify(toothNotes), conditions, updated_at:new Date().toISOString()
      }],{onConflict:'patient_name'});
      if (error) console.warn('[Supabase] chart save:',error.message);
    }
  } catch(e){console.warn('chart save skipped:',e.message);}
}

function collectChartConditions() {
  const conds={};
  ['perio','occl','appl','tmd'].forEach(group=>{
    conds[group]=Array.from(document.querySelectorAll(`#page-chart input[name="${group}"]:checked`))
      .map(c=>c.parentElement.textContent.trim());
  });
  return conds;
}

function resetChart() {
  Object.keys(toothState).forEach(k=>clearTooth(k));
  Object.keys(toothNotes).forEach(k=>delete toothNotes[k]);
  document.querySelectorAll('#page-chart input[type="checkbox"]').forEach(cb=>cb.checked=false);
  setTool('P');
  syncTeethToTreatment();
  notif('✅ Chart fully reset.','al-s');
}

function loadChartForPatient(name) {
  if (!name) return;
  currentChartPatient=name;
  const dcNm=document.getElementById('dc-nm'); if(dcNm) dcNm.value=name;
  const dcDt=document.getElementById('dc-dt'); if(dcDt) dcDt.value=new Date().toISOString().split('T')[0];
  const p=typeof allPatients!=='undefined'?allPatients.find(x=>x.name===name):null;
  const dcAg=document.getElementById('dc-ag'); if(dcAg&&p) dcAg.value=p.age||'';
  Object.keys(toothState).forEach(k=>clearTooth(k));
  Object.keys(toothNotes).forEach(k=>delete toothNotes[k]);
  document.querySelectorAll('#page-chart input[type="checkbox"]').forEach(cb=>cb.checked=false);
  if (chartStore[name]) {
    Object.entries(chartStore[name]).forEach(([n,t])=>applyTool_direct(n,t));
    if (chartNotesStore[name]) Object.entries(chartNotesStore[name]).forEach(([n,note])=>{toothNotes[n]=note;updateToothNoteIndicator(n);});
    syncTeethToTreatment(); return;
  }
  (async()=>{
    try {
      if (!supabase) return;
      const {data}=await supabase.from('dental_charts').select('tooth_state,tooth_notes,conditions').eq('patient_name',name).single();
      if (data?.tooth_state) {
        let state; try{state=typeof data.tooth_state==='string'?JSON.parse(data.tooth_state):data.tooth_state;}catch{return;}
        chartStore[name]=state;
        Object.keys(toothState).forEach(k=>clearTooth(k));
        Object.entries(state).forEach(([n,t])=>applyTool_direct(n,t));
        if (data.tooth_notes){
          let notes; try{notes=typeof data.tooth_notes==='string'?JSON.parse(data.tooth_notes):data.tooth_notes;}catch{notes={};}
          chartNotesStore[name]=notes;
          Object.entries(notes).forEach(([n,note])=>{toothNotes[n]=note;updateToothNoteIndicator(n);});
        }
        if (data.conditions) Object.entries(data.conditions).forEach(([group,values])=>{
          if (!Array.isArray(values)) return;
          document.querySelectorAll(`#page-chart input[name="${group}"]`).forEach(cb=>{
            if (values.includes(cb.parentElement.textContent.trim())) cb.checked=true;
          });
        });
        syncTeethToTreatment();
      }
    } catch(e){/* no chart yet */}
  })();
}

/* ═══ Export snapshot for pdf.js ═══ */
function getChartSnapshot() {
  return {
    rows:{permanent_upper:PU,temporary_upper:TU,temporary_lower:TL,permanent_lower:PL},
    state:Object.assign({},toothState),
    notes:Object.assign({},toothNotes),
    conditions:collectChartConditions(),
    toolCfg
  };
}

/* ═══ Initialization ═══ */
buildRow(PU,'row-pu');
buildRow(TU,'row-tu');
buildRow(TL,'row-tl');
buildRow(PL,'row-pl');
const _dcDt=document.getElementById('dc-dt');
if (_dcDt) _dcDt.value=new Date().toISOString().split('T')[0];
