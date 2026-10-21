/* ═══════════════════════════════════════════════════════════════
   utils.js — shared helpers for the revised modules
   (loaded right after supabase-config.js, before every other module)
   ═══════════════════════════════════════════════════════════════ */

/* ── Escaping: every value that goes into innerHTML passes through esc() ── */
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
/* For a value placed inside a single-quoted JS string in an onclick="" attribute */
function jsArg(v) {
  return esc(String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
}

/* ── Money ── */
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function peso(n) {
  const v = round2(n);
  return (v < 0 ? '−₱' : '₱') + Math.abs(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pesoShort(n) {
  const v = round2(n);
  if (Math.abs(v) >= 1e6) return '₱' + (v / 1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e4) return '₱' + (v / 1e3).toFixed(1) + 'K';
  return peso(v);
}

/* ── Dates (always the clinic's LOCAL date, never UTC) ── */
function localISODate(d = new Date()) {
  const x = new Date(d);
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
}
function parseISODate(s) {             // 'YYYY-MM-DD' → local Date at midnight
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function addDays(iso, n) { const d = parseISODate(iso); d.setDate(d.getDate() + n); return localISODate(d); }
function startOfWeek(iso) {            // Monday
  const d = parseISODate(iso); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return localISODate(d);
}
function fmtDate(iso, opts) {
  if (!iso) return '—';
  const d = parseISODate(iso);
  return d ? d.toLocaleDateString('en-PH', opts || { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}
function fmtTime(t) {
  if (!t) return '—';
  const [h, m] = String(t).split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  return ((h % 12) || 12) + ':' + String(m || 0).padStart(2, '0') + ' ' + ap;
}
function timeToMin(t) { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); }
function minToTime(min) { const h = Math.floor(min / 60) % 24, m = min % 60; return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); }
function fmtDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/* ── IDs (idempotency keys for financial submissions) ── */
function newRequestId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/* ── Turn Supabase/Postgres errors into something staff can read ── */
function friendlyDbError(err) {
  if (!err) return 'Unknown error';
  const code = err.code || '';
  const msg  = err.message || String(err);
  if (code === '23P01' || /no_dentist_overlap/.test(msg))
    return 'That dentist already has an appointment overlapping this time. Choose another time or dentist.';
  if (code === '42501' || /row-level security/i.test(msg))
    return 'You are not allowed to do that (check that you are signed in).';
  if (code === 'PGRST202' || /Could not find the function/i.test(msg))
    return 'Database function missing — run sql/01_revision_migration.sql in Supabase first.';
  if (code === '42P01' || /relation .* does not exist|Could not find the table/i.test(msg))
    return 'Database table missing — run sql/01_revision_migration.sql in Supabase first.';
  if (/Failed to fetch/i.test(msg))
    return 'Cannot reach Supabase. Check your internet connection (and open the app through http://, not file://).';
  return msg;
}

/* ── Procedure categories (same mapping as the database function) ── */
const PROCEDURE_CATEGORIES = ['Preventive','Restorative','Surgical','Endodontic','Orthodontic','Periodontal','Cosmetic','Diagnostic','Other'];
function procedureCategory(p) {
  const s = String(p || '').toLowerCase();
  const any = (...pats) => pats.some(x => x.test(s));
  if (any(/^cleaning/, /^oral exam/, /^fluoride/, /^sealant/)) return 'Preventive';
  if (any(/filling/, /^pit.*fissure/, /^inlay/, /^onlay/, /crown/, /^bridge/)) return 'Restorative';
  if (any(/^extraction/, /^odontectomy/, /^wisdom/)) return 'Surgical';
  if (any(/^root canal/, /^pulpotomy/, /^apicoectomy/)) return 'Endodontic';
  if (any(/^orthodontic/, /^braces/, /^retainer/)) return 'Orthodontic';
  if (any(/^scaling/, /^gum/)) return 'Periodontal';
  if (any(/whitening/, /^veneer/)) return 'Cosmetic';
  if (any(/^consultation/, /^x-?\s?ray/)) return 'Diagnostic';
  return 'Other';
}

const PAYMENT_METHODS = ['Cash','GCash','Maya','Bank Transfer','Credit/Debit Card','Check','HMO/Insurance','Other'];
const METHODS_NEEDING_REF = ['GCash','Maya','Bank Transfer','Credit/Debit Card','Check'];

/* ── Reference data: branches, dentists, clinic settings ── */
const refData = { branches: [], dentists: [], settings: null, loaded: false };

async function loadRefData() {
  if (!supabase) return;
  try {
    const [b, d, s] = await Promise.all([
      supabase.from('branches').select('*').order('name'),
      supabase.from('dentists').select('*').order('name'),
      supabase.from('clinic_settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    if (!b.error) refData.branches = b.data || [];
    if (!d.error) refData.dentists = d.data || [];
    if (!s.error) refData.settings = s.data || null;
    refData.loaded = true;
    fillRefSelects();
  } catch (e) { console.warn('[refData]', e.message); }
}
setTimeout(loadRefData, 600);

function activeBranches() { return refData.branches.filter(b => b.active).map(b => b.name); }
function activeDentists() { return refData.dentists.filter(d => d.active).map(d => d.name); }
/* Use the registered spelling of a dentist's name ("dr. santos" → "Dr. Santos") so overlap checks match */
/* Same rule as the database (_norm_dentist): "Dr. Santos" = "Dr, Santos" = "dr santos" */
function normDentist(name) {
  return String(name || '').toLowerCase().replace(/^\s*(dra|dr|doc|doctor)\s*[.,]?\s*/, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function canonicalDentist(name) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (!n) return '';
  return refData.dentists.find(d => normDentist(d.name) === normDentist(n))?.name || n;
}

/* A failed data load must be visible — never silently look like "no data" */
const loadErrors = {};
function reportLoadError(what, error) {
  const msg = friendlyDbError(error);
  loadErrors[what] = msg;
  console.error('[load] ' + what + ':', error?.message || error, error);
  if (typeof notif === 'function') notif('⚠ Could not load ' + what + ': ' + msg, 'al-i');
  return msg;
}
function loadErrorHtml(what, cols) {
  const m = loadErrors[what];
  if (!m) return '';
  const cell = `<div class="load-error">⚠ Could not load ${esc(what)}: ${esc(m)}<div class="sub">Reload the page. If it keeps happening, send this message to the administrator.</div></div>`;
  return cols ? `<tr><td colspan="${cols}">${cell}</td></tr>` : cell;
}

/* Fill every <select data-ref="branch|dentist"> and <datalist> on the page */
function fillRefSelects() {
  document.querySelectorAll('select[data-ref]').forEach(sel => {
    const kind = sel.dataset.ref;
    const list = kind === 'branch' ? activeBranches() : activeDentists();
    const keep = sel.value;
    const first = sel.dataset.placeholder ?? (kind === 'branch' ? '— Branch —' : '— Dentist —');
    sel.innerHTML = `<option value="">${esc(first)}</option>` + list.map(v => `<option>${esc(v)}</option>`).join('');
    if (keep) {
      if (![...sel.options].some(o => o.value === keep)) sel.insertAdjacentHTML('beforeend', `<option>${esc(keep)}</option>`);
      sel.value = keep;
    }
  });
  const dl = document.getElementById('dl-dentists');
  if (dl) dl.innerHTML = activeDentists().map(v => `<option value="${esc(v)}">`).join('');
}

function optionsHtml(list, selected, placeholder) {
  return (placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : '') +
    list.map(v => `<option ${v === selected ? 'selected' : ''}>${esc(v)}</option>`).join('');
}

/* ── Generic stackable dialog (reuses the existing modal styles) ──
   openDialog({ title, body, confirmText, onConfirm, wide, hideConfirm, cancelText })
   onConfirm(dlg) may return false to keep the dialog open.               */
function openDialog(opts) {
  const ov = document.createElement('div');
  ov.className = 'phys-modal-overlay open dlg-overlay';
  ov.style.zIndex = 9990 + document.querySelectorAll('.dlg-overlay').length * 2 + 2;
  ov.innerHTML = `
    <div class="phys-modal-box" style="max-width:${opts.wide ? '860px' : '520px'}">
      <div class="phys-modal-header"><h3>${opts.title}</h3><button class="phys-modal-close" data-x>✕</button></div>
      <div class="phys-modal-body">${opts.body || ''}<div class="dlg-err" style="display:none"></div></div>
      <div class="edit-foot">
        <button class="btn btn-gray" data-x>${esc(opts.cancelText || (opts.hideConfirm ? 'Close' : 'Cancel'))}</button>
        ${opts.hideConfirm ? '' : `<button class="btn btn-p" data-ok>${opts.confirmText || 'Save'}</button>`}
      </div>
    </div>`;
  const dlg = {
    el: ov,
    q: sel => ov.querySelector(sel),
    val: sel => (ov.querySelector(sel)?.value ?? '').trim(),
    close() { ov.remove(); document.removeEventListener('keydown', onKey); },
    error(msg) { const e = ov.querySelector('.dlg-err'); e.textContent = '⚠ ' + msg; e.style.display = msg ? 'block' : 'none'; },
    busy(on) { const b = ov.querySelector('[data-ok]'); if (b) { b.disabled = on; b.dataset.label ??= b.innerHTML; b.innerHTML = on ? 'Saving…' : b.dataset.label; } },
  };
  const onKey = e => { if (e.key === 'Escape' && ov === [...document.querySelectorAll('.dlg-overlay')].pop()) dlg.close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-x]')) dlg.close(); });
  const ok = ov.querySelector('[data-ok]');
  if (ok) ok.addEventListener('click', async () => {
    if (ok.disabled) return;                 // guards double submission
    dlg.error('');
    dlg.busy(true);
    try {
      const keep = await opts.onConfirm?.(dlg);
      if (keep !== false) dlg.close();
    } catch (e) {
      dlg.error(friendlyDbError(e));
    } finally {
      if (document.body.contains(ov)) dlg.busy(false);
    }
  });
  document.body.appendChild(ov);
  setTimeout(() => ov.querySelector('input:not([readonly]),select,textarea')?.focus(), 30);
  opts.onOpen?.(dlg);
  return dlg;
}

function closeTopDialog() { [...document.querySelectorAll('.dlg-overlay')].pop()?.remove(); }
function closeAllDialogs() { document.querySelectorAll('.dlg-overlay').forEach(o => o.remove()); }

/* Find a patient object (from patients.js) by name */
function findPatientByName(name) {
  const n = String(name || '').trim().toLowerCase();
  return (typeof allPatients !== 'undefined' ? allPatients : []).find(p => (p.name || '').toLowerCase() === n) || null;
}

/* Reusable patient autocomplete for inputs created at runtime */
function attachPatientAutocomplete(input, onPick) {
  if (!input) return;
  const wrap = input.parentElement; wrap.style.position = 'relative';
  const dd = document.createElement('div'); dd.className = 'ac-dropdown'; dd.style.display = 'none';
  wrap.appendChild(dd);
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    dd.innerHTML = '';
    if (!q) { dd.style.display = 'none'; return; }
    const m = (typeof allPatients !== 'undefined' ? allPatients : []).filter(p => p.name.toLowerCase().includes(q)).slice(0, 8);
    if (!m.length) { dd.style.display = 'none'; return; }
    m.forEach(p => {
      const it = document.createElement('div'); it.className = 'ac-item';
      it.innerHTML = `<strong>${esc(p.name)}</strong> <span style="color:var(--mu);font-size:11px">${esc(p.id)} · Age ${esc(p.age)} · ${esc(p.mobile || '—')}</span>`;
      it.onmousedown = e => { e.preventDefault(); input.value = p.name; dd.style.display = 'none'; onPick?.(p); };
      dd.appendChild(it);
    });
    dd.style.display = 'block';
  });
  input.addEventListener('blur', () => setTimeout(() => dd.style.display = 'none', 150));
}
