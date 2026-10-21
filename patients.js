/* patients.js — Patient management with validation, confirmation, edit, Supabase persistence */

let pxCount = 0;
let allPatients = [];
let filterMode  = 'all';
let filterYear  = new Date().getFullYear();
let filterMonth = new Date().getMonth();
let searchQuery = '';

// Will hold a fully-prepared patient record that's pending confirmation
let _pendingPatient = null;
// When editing, holds the patient being edited
let _editingPatient = null;

/* ═══════════════════════════════════════════════════════
   INITIALIZATION
   ═══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initPatientFormHelpers();
  window._weekStart = getWeekStart(new Date());
  renderPxList();
  renderDashRecent();
  loadPatientsFromSupabase();
});

function initPatientFormHelpers() {
  // Birthdate → auto age + minor detection + cap year to 4 digits
  const bd = document.getElementById('p-bd');
  if (bd) {
    bd.addEventListener('change', handleBirthdateChange);
    bd.addEventListener('input', () => {
      // Prevent years longer than 4 digits (e.g. 20250 typed via keyboard)
      if (bd.value) {
        const parts = bd.value.split('-');
        if (parts[0] && parts[0].length > 4) {
          parts[0] = parts[0].slice(0, 4);
          bd.value = parts.join('-');
        }
      }
    });
    // Also clamp via keydown on the year segment
    bd.addEventListener('keydown', e => {
      if (!bd.value) return;
      const parts = bd.value.split('-');
      if (parts[0] && parts[0].length >= 4) {
        // If cursor is in year portion, block extra digit input
        const cursorPos = bd.selectionStart;
        const yearEnd = bd.value.indexOf('-');
        if ((yearEnd === -1 || cursorPos <= yearEnd) && /^\d$/.test(e.key)) {
          e.preventDefault();
        }
      }
    });
  }

  // Cell phone: digits only, max 11
  const cell = document.getElementById('p-cell');
  if (cell) {
    cell.addEventListener('input', e => {
      let v = e.target.value.replace(/\D/g, '');
      if (v.length > 11) v = v.slice(0, 11);
      e.target.value = v;
      clearFieldError('p-cell');
    });
    cell.addEventListener('keypress', e => {
      // Block non-digits + block input when already 11 digits
      if (!/\d/.test(e.key) && e.key.length === 1) e.preventDefault();
      if (e.target.value.length >= 11 && /\d/.test(e.key)) e.preventDefault();
    });
  }

  // Clear errors on input
  ['p-last','p-first','p-bd','p-sex','p-addr','p-email','p-guard']
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => clearFieldError(id));
      if (el) el.addEventListener('change', () => clearFieldError(id));
    });
}

function handleBirthdateChange() {
  const bd = document.getElementById('p-bd');
  const ageEl = document.getElementById('p-age');
  if (!bd.value) { if (ageEl) ageEl.value = ''; refreshMinorState(); return; }
  const d = new Date(bd.value);
  if (isNaN(d)) return;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  if (ageEl) ageEl.value = age;
  refreshMinorState();
}

function refreshMinorState() {
  const ageVal = parseInt(document.getElementById('p-age')?.value);
  const guardLabel = document.getElementById('p-guard-label');
  const guardInput = document.getElementById('p-guard');
  const hint = document.getElementById('p-guard-hint');
  if (!guardInput) return;
  if (!isNaN(ageVal) && ageVal < 18) {
    guardInput.classList.add('minor-required');
    if (hint) hint.classList.add('show');
    if (guardLabel) guardLabel.innerHTML = 'Parent/Guardian * <span style="color:var(--o);font-weight:700">(required — patient is a minor)</span>';
  } else {
    guardInput.classList.remove('minor-required');
    if (hint) hint.classList.remove('show');
    if (guardLabel) guardLabel.innerHTML = 'Parent/Guardian <span style="color:var(--mu);font-weight:400">(auto-required for minors)</span>';
    clearFieldError('p-guard');
  }
}

/* ═══════════════════════════════════════════════════════
   DATE FILTER
   ═══════════════════════════════════════════════════════ */
function setFilterMode(mode, el) {
  filterMode = mode;
  document.querySelectorAll('.date-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  renderFilterControls();
  renderPxList();
}

function renderFilterControls() {
  const wrap = document.getElementById('date-filter-controls'); if (!wrap) return;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (filterMode === 'year') {
    wrap.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><button class="pf-nav" onclick="shiftYear(-1)">&#9664;</button><span class="pf-label" id="pf-year-label">${filterYear}</span><button class="pf-nav" onclick="shiftYear(1)">&#9654;</button></div>`;
  } else if (filterMode === 'month') {
    wrap.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><button class="pf-nav" onclick="shiftMonthYear(-1)">&#9664;</button><span class="pf-label" id="pf-month-label">${months[filterMonth]} ${filterYear}</span><button class="pf-nav" onclick="shiftMonthYear(1)">&#9654;</button></div>`;
  } else if (filterMode === 'week') {
    if (!window._weekStart) window._weekStart = getWeekStart(new Date());
    wrap.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><button class="pf-nav" onclick="shiftWeek(-1)">&#9664;</button><span class="pf-label" id="pf-week-label"></span><button class="pf-nav" onclick="shiftWeek(1)">&#9654;</button></div>`;
    setTimeout(updateWeekLabel, 0);
  } else wrap.innerHTML = '';
}

function getWeekStart(d) {
  const date = new Date(d);
  date.setDate(date.getDate() - date.getDay());
  date.setHours(0,0,0,0);
  return date;
}

function updateWeekLabel() {
  const el = document.getElementById('pf-week-label'); if (!el) return;
  const ws = window._weekStart;
  const we = new Date(ws); we.setDate(we.getDate() + 6);
  const fmt = d => d.toLocaleDateString('en-PH', {month:'short', day:'numeric'});
  el.textContent = fmt(ws) + ' - ' + fmt(we) + ', ' + ws.getFullYear();
}

function shiftYear(d)      { filterYear += d; renderFilterControls(); renderPxList(); }
function shiftMonthYear(d) { filterMonth += d; if (filterMonth > 11) { filterMonth = 0; filterYear++; } if (filterMonth < 0) { filterMonth = 11; filterYear--; } renderFilterControls(); renderPxList(); }
function shiftWeek(d)      { window._weekStart = window._weekStart || getWeekStart(new Date()); window._weekStart.setDate(window._weekStart.getDate() + d * 7); updateWeekLabel(); renderPxList(); }

function matchesDateFilter(dateStr) {
  if (filterMode === 'all') return true;
  const d = new Date(dateStr);
  if (isNaN(d)) return false;
  if (filterMode === 'year')  return d.getFullYear() === filterYear;
  if (filterMode === 'month') return d.getFullYear() === filterYear && d.getMonth() === filterMonth;
  if (filterMode === 'week') {
    const ws = window._weekStart || getWeekStart(new Date());
    const we = new Date(ws); we.setDate(we.getDate() + 7);
    return d >= ws && d < we;
  }
  return true;
}

/* ═══════════════════════════════════════════════════════
   RENDER PATIENT LIST (with Edit button)
   ═══════════════════════════════════════════════════════ */
function renderPxList() {
  const tbody = document.getElementById('px-list'); if (!tbody) return;
  tbody.innerHTML = '';
  const q = searchQuery.toLowerCase();
  // Dentists: optional "my patients" filter (appointments or treatments under their name)
  const mineOnly = document.getElementById('px-mine')?.checked && typeof currentRole !== 'undefined' && currentRole === 'dentist';
  const mine = new Set();
  if (mineOnly) {
    (typeof apptStore !== 'undefined' ? apptStore : []).forEach(a => mine.add(a.patient_id || a.patient_name));
    Object.entries(typeof txStore !== 'undefined' ? txStore : {}).forEach(([n, arr]) => arr.forEach(t => { if (t.dentist_id && t.dentist_id === currentProfile?.dentist_id) { mine.add(t.patient_id || n); } }));
  }
  const filtered = allPatients.filter(p => {
    const ms = !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || (p.mobile || '').includes(q);
    return ms && matchesDateFilter(p.date) && (!mineOnly || mine.has(p.uuid) || mine.has(p.name));
  });
  if (!filtered.length) {
    if (typeof loadErrors !== 'undefined' && loadErrors.patients) { tbody.innerHTML = loadErrorHtml('patients', 8); return; }
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--mu);padding:24px;font-size:12px">' +
      (allPatients.length ? 'No patients match the search or filter.' : 'No patient records yet.') + '</td></tr>';
    return;
  }
  filtered.forEach(p => {
    const bc = p.status === 'Active' || p.status === 'New' ? 'b-a' : p.status === 'Follow-up' ? 'b-p' : p.status === 'Physical Record' ? 'b-p' : 'b-d';
    const safeName = (p.name || '').replace(/'/g, "\\'");
    const tr = document.createElement('tr');
    const isPhysical = p.status === 'Physical' || p.status === 'Physical Record';
    const recordsBadge = isPhysical
      ? `<span class="badge" style="background:#EEF0FF;color:#4B46C8;margin-left:3px;cursor:pointer"
              onclick="if(typeof openPhysModal==='function')openPhysModal('${safeName}')">📄 Records</span>`
      : '';
    tr.innerHTML = `<td>${p.id}</td><td>${p.name}</td><td>${p.age || '—'}</td><td>${p.sex || '—'}</td><td>${p.mobile || '—'}</td><td>${formatDatePH(p.date)}</td>
      <td><span class="badge ${bc}">${p.status}</span>${recordsBadge}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-s btn-sm" onclick="viewPx('${safeName}','${p.age||'?'}','${p.sex||'?'}')">👁 View</button>
        ${typeof can !== 'function' || can('editPatient') ? `<button class="btn btn-o btn-sm" style="margin-left:4px" onclick="openEditModal('${p.id}')">✏️ Edit</button>` : ''}
      </td>`;
    tbody.appendChild(tr);
  });
}

function renderDashRecent() {
  const tbody = document.getElementById('dash-recent'); if (!tbody) return;
  tbody.innerHTML = '';
  const recent = [...allPatients].slice(0, 5);
  if (!recent.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--mu);padding:20px;font-size:12px">No patients yet.</td></tr>';
    return;
  }
  recent.forEach(p => {
    const txList = (typeof txStore !== 'undefined' && txStore[p.name]) || [];
    const lastTx = txList[txList.length - 1];
    const safeName = (p.name || '').replace(/'/g, "\\'");
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.id}</td><td>${p.name}</td><td>${p.age || '—'}</td><td>${formatDatePH(p.date)}</td><td>${lastTx ? lastTx.procedure : '—'}</td><td><span class="badge b-a">${p.status}</span></td><td><button class="btn btn-o btn-sm" onclick="viewPx('${safeName}','${p.age||'?'}','${p.sex||'?'}')">View</button></td>`;
    tbody.appendChild(tr);
  });
  const totalEl = document.getElementById('stat-total'); if (totalEl) totalEl.textContent = allPatients.length;
  const thisMonth = new Date().getMonth(), thisYear = new Date().getFullYear();
  const nm = allPatients.filter(p => { const d = new Date(p.date); return d.getMonth() === thisMonth && d.getFullYear() === thisYear; }).length;
  const el = document.getElementById('stat-new-month'); if (el) el.textContent = nm;
}

function formatDatePH(ds) {
  const d = new Date(ds);
  if (isNaN(d)) return ds || '—';
  return d.toLocaleDateString('en-PH', {month:'short', day:'numeric', year:'numeric'});
}

/* ═══════════════════════════════════════════════════════
   DROPDOWN HELPER — call this every time a patient is added
   Updates: PDF selects, x-ray autocomplete data, treatment
   autocomplete data, and any other select that lists patients.
   ═══════════════════════════════════════════════════════ */
function addPatientToDropdowns(name, pid) {
  // pdf-px and pdf-tx-px are now text inputs with autocomplete — they read from allPatients[] directly.
  // No select dropdowns need updating for patient PDFs.
}

/* ═══════════════════════════════════════════════════════
   VALIDATION HELPERS
   ═══════════════════════════════════════════════════════ */
function setFieldError(id, msg) {
  const el = document.getElementById(id);
  const err = document.getElementById('err-' + id);
  if (el) el.classList.add('has-error');
  if (err) { if (msg) err.textContent = msg; err.classList.add('show'); }
}

function clearFieldError(id) {
  const el = document.getElementById(id);
  const err = document.getElementById('err-' + id);
  if (el) el.classList.remove('has-error');
  if (err) err.classList.remove('show');
}

function clearAllErrors() {
  ['p-last','p-first','p-bd','p-sex','p-addr','p-cell','p-email','p-guard']
    .forEach(clearFieldError);
}

/* ═══════════════════════════════════════════════════════
   SAVE PATIENT (Step 1: validate → show confirmation)
   ═══════════════════════════════════════════════════════ */
function savePatient() {
  clearAllErrors();
  let ok = true;

  // Collect fields
  const l    = document.getElementById('p-last').value.trim();
  const f    = document.getElementById('p-first').value.trim();
  const mid  = document.getElementById('p-mid').value.trim();
  const bd   = document.getElementById('p-bd').value;
  const age  = parseInt(document.getElementById('p-age').value);
  const sex  = document.getElementById('p-sex').value;
  const nick = document.getElementById('p-nick').value.trim();
  const addr = document.getElementById('p-addr').value.trim();
  const cell = document.getElementById('p-cell').value.trim();
  const email= document.getElementById('p-email').value.trim();
  const guard= document.getElementById('p-guard').value.trim();
  const nat  = document.getElementById('p-nat').value.trim();
  const rel  = document.getElementById('p-rel').value.trim();
  const occ  = document.getElementById('p-occ').value.trim();
  const ins  = document.getElementById('p-ins').value.trim();
  const ref  = document.getElementById('p-ref').value.trim();
  const reason = document.getElementById('p-reason').value.trim();

  // ── 1. REQUIRED FIELDS ──
  if (!l)   { setFieldError('p-last');  ok = false; }
  if (!f)   { setFieldError('p-first'); ok = false; }
  if (!bd)  { setFieldError('p-bd');    ok = false; }
  if (!sex) { setFieldError('p-sex');   ok = false; }
  if (!addr){ setFieldError('p-addr');  ok = false; }

  // ── 2. Mobile: exactly 11 digits ──
  const digits = cell.replace(/\D/g, '');
  if (!digits)            { setFieldError('p-cell', 'Mobile number required'); ok = false; }
  else if (digits.length !== 11) { setFieldError('p-cell', 'Must be exactly 11 digits'); ok = false; }

  // ── 3. Email required + valid ──
  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email)             { setFieldError('p-email', 'Email is required'); ok = false; }
  else if (!emailRx.test(email)) { setFieldError('p-email', 'Enter a valid email'); ok = false; }

  // ── 4. Parent/guardian required if minor (age < 18) ──
  if (!isNaN(age) && age < 18 && !guard) {
    setFieldError('p-guard', 'Required for minor patients');
    ok = false;
  }

  // ── 5. Required health questions (all except #7, #13, bleeding time, blood type) ──
  const requiredRadio = ['q1','q2','q3','q4','q5','q6','q10a','q10b','q10c'];
  const missingHealth = [];
  requiredRadio.forEach(q => {
    const chosen = document.querySelector(`input[name="${q}"]:checked`);
    const row = document.querySelector(`.yn[data-q="${q}"]`);
    if (!chosen) {
      missingHealth.push(q);
      if (row) row.style.background = '#FFF5F5';
      ok = false;
    } else {
      if (row) row.style.background = '';
    }
  });
  // Q8 is a checkbox set — at least one must be checked
  const q8Any = document.querySelectorAll('input[name="q8"]:checked').length;
  const q8Row = document.querySelector('.yn[data-q="q8"]');
  if (q8Any === 0) {
    missingHealth.push('q8');
    if (q8Row) q8Row.style.background = '#FFF5F5';
    ok = false;
  } else {
    if (q8Row) q8Row.style.background = '';
  }
  // Q9 Bleeding Time and Blood Type are now OPTIONAL — no validation required

  if (!ok) {
    notif('⚠ Please fill in all required fields (highlighted in red).', 'al-i');
    // Scroll to first error
    const firstErr = document.querySelector('.fc.has-error, .yn[style*="FFF5F5"]');
    if (firstErr) firstErr.scrollIntoView({behavior:'smooth', block:'center'});
    return;
  }

  // Collect health answers for storage
  const health = {};
  ['q1','q2','q3','q4','q5','q6','q7','q10a','q10b','q10c'].forEach(q => {
    const el = document.querySelector(`input[name="${q}"]:checked`);
    health[q] = el ? el.value : null;
  });
  // Allergy checkboxes
  health.q8_allergies = Array.from(document.querySelectorAll('input[name="q8"]:checked'))
    .map(c => c.parentElement.textContent.trim()).filter(v => v);
  health.q9_bleeding_time = document.getElementById('q9').value.trim();
  health.blood_type = document.getElementById('p-bt').value;
  health.q13_conditions = Array.from(document.querySelectorAll('input[name="q13"]:checked'))
    .map(c => c.parentElement.textContent.trim());
  health.q2a = document.getElementById('q2a').value.trim();
  health.q3a = document.getElementById('q3a').value.trim();
  health.q4a = document.getElementById('q4a').value.trim();
  health.q5a = document.getElementById('q5a').value.trim();

  // Build pending patient
  const name  = (f + (mid ? ' ' + mid : '') + ' ' + l).trim();
  const nextNo = pxCount + 1;
  const id    = '#DMY-' + String(nextNo).padStart(3, '0');
  const today = new Date().toISOString().split('T')[0];

  // ── DUPLICATE CHECK: same name + mobile + email ──
  const duplicate = allPatients.find(p =>
    p.name.toLowerCase() === name.toLowerCase() &&
    (p.mobile || '').replace(/\D/g, '') === digits &&
    (p.email || '').toLowerCase() === email.toLowerCase()
  );
  if (duplicate) {
    notif('⚠ A patient with the same name, mobile, and email already exists (' + duplicate.id + ').', 'al-i');
    return;
  }

  _pendingPatient = {
    pid: id,
    name,
    last_name: l, first_name: f, middle_name: mid,
    nickname: nick,
    birthdate: bd,
    age: isNaN(age) ? null : age,
    sex,
    religion: rel,
    nationality: nat || 'Filipino',
    address: addr,
    occupation: occ,
    mobile: digits,
    email,
    dental_insurance: ins,
    guardian: guard,
    referrer: ref,
    reason,
    previous_dentist: document.getElementById('p-pdent').value.trim(),
    last_visit: document.getElementById('p-lv').value || null,
    physician: document.getElementById('p-phys').value.trim(),
    specialty: document.getElementById('p-spec').value.trim(),
    signature: document.getElementById('p-sig').value.trim(),
    health,
    registered_date: today,
    status: 'New',
    _nextNo: nextNo
  };

  showConfirmModal(_pendingPatient);
}

/* ═══════════════════════════════════════════════════════
   CONFIRMATION MODAL
   ═══════════════════════════════════════════════════════ */
function showConfirmModal(p) {
  const body = document.getElementById('confirm-body');
  if (!body) return;

  const row = (k, v) => `<div class="confirm-row"><div class="k">${k}</div><div class="v">${v || '—'}</div></div>`;
  const fullName = [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' ');
  const allergies = (p.health.q8_allergies || []).join(', ') || 'None selected';
  const conditions = (p.health.q13_conditions || []).join(', ') || 'None';
  const minor = (p.age != null && p.age < 18);

  body.innerHTML = `
    <div style="background:var(--ol);border-left:4px solid var(--o);padding:10px 14px;border-radius:6px;margin-bottom:14px;font-size:12px">
      Please review the information below carefully. Click <strong>Confirm &amp; Save</strong> to register, or <strong>Go Back</strong> to make changes.
    </div>

    <div class="confirm-sec">👤 Personal Information</div>
    ${row('Patient ID', p.pid)}
    ${row('Full Name', fullName)}
    ${row('Nickname', p.nickname)}
    ${row('Birthdate', p.birthdate)}
    ${row('Age', p.age + (minor ? ' <span style="color:var(--o);font-weight:700">(Minor)</span>' : ''))}
    ${row('Sex', p.sex)}
    ${row('Nationality', p.nationality)}
    ${row('Religion', p.religion)}

    <div class="confirm-sec">📞 Contact</div>
    ${row('Mobile', p.mobile)}
    ${row('Email', p.email)}
    ${row('Address', p.address)}
    ${row('Occupation', p.occupation)}
    ${minor ? row('Parent/Guardian', p.guardian + ' <span style="color:var(--o);font-weight:700">(required — minor)</span>') : row('Parent/Guardian', p.guardian)}

    <div class="confirm-sec">🏥 Dental &amp; Medical</div>
    ${row('Previous Dentist', p.previous_dentist)}
    ${row('Last Visit', p.last_visit)}
    ${row('Physician', p.physician)}
    ${row('Specialty', p.specialty)}
    ${row('Referred By', p.referrer)}
    ${row('Reason for Visit', p.reason)}

    <div class="confirm-sec">✅ Health Questions</div>
    ${row('1. Good Health?', p.health.q1)}
    ${row('2. Under Treatment?', p.health.q2 + (p.health.q2a ? ' — ' + p.health.q2a : ''))}
    ${row('3. Serious Illness?', p.health.q3 + (p.health.q3a ? ' — ' + p.health.q3a : ''))}
    ${row('4. Hospitalized?', p.health.q4 + (p.health.q4a ? ' — ' + p.health.q4a : ''))}
    ${row('5. Taking Medication?', p.health.q5 + (p.health.q5a ? ' — ' + p.health.q5a : ''))}
    ${row('6. Uses Tobacco?', p.health.q6)}
    ${row('7. Alcohol/Drugs?', p.health.q7 || 'Not answered (optional)')}
    ${row('8. Allergies', allergies)}
    ${row('9. Bleeding Time', p.health.q9_bleeding_time)}
    ${row('Blood Type', p.health.blood_type)}
    ${row('10. Pregnant?', p.health.q10a)}
    ${row('10. Nursing?', p.health.q10b)}
    ${row('10. Birth Control?', p.health.q10c)}
    ${row('13. Conditions', conditions)}
  `;

  document.getElementById('confirm-modal').classList.add('open');
}

function closeConfirmModal() {
  document.getElementById('confirm-modal').classList.remove('open');
}

/* ═══════════════════════════════════════════════════════
   CONFIRM → ACTUALLY SAVE TO DB + UI
   ═══════════════════════════════════════════════════════ */
async function confirmAndSave() {
  if (!_pendingPatient) { closeConfirmModal(); return; }
  const p = _pendingPatient;
  const btn = document.getElementById('confirm-save-btn');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Saving…';

  try {
    // ── Save to Supabase ──
    if (supabase) {
      const row = {
        pid: p.pid,
        name: p.name,
        last_name: p.last_name,
        first_name: p.first_name,
        middle_name: p.middle_name || null,
        nickname: p.nickname || null,
        birthdate: p.birthdate || null,
        age: p.age,
        sex: p.sex,
        religion: p.religion || null,
        nationality: p.nationality,
        address: p.address,
        occupation: p.occupation || null,
        mobile: p.mobile,
        email: p.email,
        dental_insurance: p.dental_insurance || null,
        guardian: p.guardian || null,
        referrer: p.referrer || null,
        reason: p.reason || null,
        previous_dentist: p.previous_dentist || null,
        last_visit: p.last_visit,
        physician: p.physician || null,
        specialty: p.specialty || null,
        signature: p.signature || null,
        health: p.health,  // jsonb column expected
        registered_date: p.registered_date,
        status: p.status
      };
      const { error } = await supabase.from('patients').insert([row]);
      if (error) {
        // Most common issues: missing table / column. Log but don't block local save.
        console.warn('[Supabase] insert failed:', error.message);
        notif('⚠ Saved locally. DB sync failed: ' + error.message, 'al-i');
      } else {
        notif('✅ Patient saved to database!', 'al-s');
      }
    } else {
      notif('⚠ Saved locally — database not connected.', 'al-i');
    }

    // ── Update local UI state ──
    pxCount = p._nextNo;
    const uiPatient = {
      id: p.pid, name: p.name, age: p.age || '—', sex: p.sex,
      mobile: p.mobile, email: p.email, address: p.address,
      guardian: p.guardian, birthdate: p.birthdate,
      date: p.registered_date, status: p.status,
      health: p.health
    };
    allPatients.unshift(uiPatient);

    // Update dropdowns
    addPatientToDropdowns(p.name, p.pid);

    // Refresh UI
    const el = id => document.getElementById(id);
    if (el('stat-total'))     el('stat-total').textContent     = allPatients.length;
    if (el('new-pid'))        el('new-pid').textContent        = pxCount + 1;
    renderPxList();
    renderDashRecent();
    if (typeof updateReportsData === 'function') updateReportsData();

    // Show success banner + clear form
    const okBanner = document.getElementById('form-ok');
    if (okBanner) {
      okBanner.style.display = 'flex';
      setTimeout(() => okBanner.style.display = 'none', 2500);
    }
    clearAddForm();
    closeConfirmModal();
    _pendingPatient = null;

  } catch (e) {
    console.error(e);
    notif('Error: ' + e.message, 'al-i');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function clearAddForm() {
  // Clear all text/date/select inputs on page-add
  document.querySelectorAll('#page-add input:not([type=radio]):not([type=checkbox]),#page-add textarea,#page-add select')
    .forEach(el => { if (el.id === 'p-nat') el.value = 'Filipino'; else el.value = ''; });
  document.querySelectorAll('#page-add input[type=radio],#page-add input[type=checkbox]')
    .forEach(el => el.checked = false);
  document.querySelectorAll('#page-add .yn').forEach(row => row.style.background = '');
  clearAllErrors();
  refreshMinorState();
}

/* ═══════════════════════════════════════════════════════
   VIEW PATIENT (navigate to treatment + load chart)
   ═══════════════════════════════════════════════════════ */
function viewPx(name, age, sex) {
  nav('treatment', document.querySelector('.ni[onclick*="treatment"]'));
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
  set('tr-nm', name);
  set('tr-ag', age !== '?' ? age : '');
  const gn = document.getElementById('tr-gn'); if (gn && sex && sex !== '?') gn.value = sex;
  set('dc-nm', name);
  set('dc-ag', age !== '?' ? age : '');
  if (typeof loadTreatmentForPatient === 'function') loadTreatmentForPatient(name);
  if (typeof loadChartForPatient === 'function')     loadChartForPatient(name);
}

function filterPxList(q) { searchQuery = q; renderPxList(); }

/* ═══════════════════════════════════════════════════════
   EDIT PATIENT
   ═══════════════════════════════════════════════════════ */
function openEditModal(pid) {
  const p = allPatients.find(x => x.id === pid);
  if (!p) { notif('Patient not found.', 'al-i'); return; }
  _editingPatient = p;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = (v == null || v === '—') ? '' : v; };
  set('ed-id', p.id);
  set('ed-name', p.name);
  set('ed-age', p.age);
  set('ed-sex', p.sex);
  set('ed-status', p.status);
  set('ed-mobile', p.mobile);
  set('ed-email', p.email);
  set('ed-addr', p.address);
  set('ed-guard', p.guardian);
  set('ed-date', p.date);
  // 11-digit cap on edit mobile
  const edMobile = document.getElementById('ed-mobile');
  if (edMobile && !edMobile._capped) {
    edMobile.addEventListener('input', e => {
      let v = e.target.value.replace(/\D/g, '');
      if (v.length > 11) v = v.slice(0, 11);
      e.target.value = v;
    });
    edMobile._capped = true;
  }
  document.getElementById('edit-modal').classList.add('open');
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.remove('open');
  _editingPatient = null;
}

async function saveEditedPatient() {
  if (!_editingPatient) return;
  const btn = document.getElementById('edit-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    const get = id => document.getElementById(id).value.trim();
    const name = get('ed-name');
    const age  = parseInt(get('ed-age'));
    const mobile = get('ed-mobile');

    // Validate mobile
    if (mobile && mobile.replace(/\D/g, '').length !== 11) {
      notif('⚠ Mobile must be exactly 11 digits.', 'al-i');
      btn.disabled = false; btn.textContent = '💾 Save Changes';
      return;
    }

    // Update local record
    _editingPatient.name = name;
    _editingPatient.age = isNaN(age) ? '—' : age;
    _editingPatient.sex = get('ed-sex');
    _editingPatient.status = get('ed-status');
    _editingPatient.mobile = mobile || '—';
    _editingPatient.email = get('ed-email');
    _editingPatient.address = get('ed-addr');
    _editingPatient.guardian = get('ed-guard');
    _editingPatient.date = get('ed-date') || _editingPatient.date;

    // Persist to Supabase
    if (supabase) {
      const { error } = await supabase.from('patients').update({
        name, age: isNaN(age) ? null : age,
        sex: _editingPatient.sex,
        status: _editingPatient.status,
        mobile, email: _editingPatient.email,
        address: _editingPatient.address,
        guardian: _editingPatient.guardian,
        registered_date: _editingPatient.date
      }).eq('pid', _editingPatient.id);
      if (error) {
        console.warn('[Supabase] update failed:', error.message);
        notif('⚠ Updated locally. DB sync: ' + error.message, 'al-i');
      } else {
        notif('✅ Patient updated!', 'al-s');
      }
    } else {
      notif('✅ Patient updated locally.', 'al-s');
    }

    renderPxList();
    renderDashRecent();
    if (typeof updateReportsData === 'function') updateReportsData();
    closeEditModal();
  } catch (e) {
    notif('Error: ' + e.message, 'al-i');
  } finally {
    btn.disabled = false; btn.textContent = '💾 Save Changes';
  }
}

/* ═══════════════════════════════════════════════════════
   LOAD FROM SUPABASE
   ═══════════════════════════════════════════════════════ */
async function loadPatientsFromSupabase() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.from('patients').select('*').order('registered_date', {ascending: false});
    if (error) {
      const m = typeof reportLoadError === 'function' ? reportLoadError('patients', error) : error.message;
      const tb = document.getElementById('px-list');
      if (tb) tb.innerHTML = typeof loadErrorHtml === 'function' ? loadErrorHtml('patients', 8) : '<tr><td colspan="8">⚠ ' + m + '</td></tr>';
      return;
    }
    if (typeof loadErrors !== 'undefined') delete loadErrors.patients;
    if (!data || !data.length) return;

    const existingIds = new Set(allPatients.map(p => p.id));
    data.forEach(row => {
      if (existingIds.has(row.pid)) return;
      allPatients.push({
        id: row.pid,
        uuid: row.id,
        name: row.name,
        age: row.age || '—',
        sex: row.sex || '—',
        mobile: row.mobile || '—',
        email: row.email || '',
        address: row.address || '',
        guardian: row.guardian || '',
        birthdate: row.birthdate || '',
        date: row.registered_date,
        status: row.status === 'Physical' ? 'Physical Record' : (row.status || 'Active'),
        health: row.health || {}
      });
      existingIds.add(row.pid);
      addPatientToDropdowns(row.name, row.pid);
    });

    // Derive next pxCount from highest PID number
    let maxNo = 0;
    allPatients.forEach(p => {
      const m = (p.id || '').match(/(\d+)$/);
      if (m) maxNo = Math.max(maxNo, parseInt(m[1]));
    });
    pxCount = Math.max(maxNo, allPatients.length);
    const el = id => document.getElementById(id);
    if (el('stat-total')) el('stat-total').textContent = allPatients.length;
    if (el('new-pid'))    el('new-pid').textContent    = pxCount + 1;
    renderPxList();
    renderDashRecent();
    if (typeof updateReportsData === 'function') updateReportsData();
    if (typeof updateTodaysAppointments === 'function') updateTodaysAppointments();
  } catch (e) {
    console.warn('[Supabase] load skipped:', e.message);
  }
}

/* ═══════════════════════════════════════════════════════
   PHYSICAL RECORDS → register as patient
   ═══════════════════════════════════════════════════════ */
function registerPhysicalPatient(name, age, sex) {
  if (allPatients.find(p => p.name.toLowerCase() === name.toLowerCase())) return;
  pxCount++;
  const id = '#DMY-' + String(pxCount).padStart(3, '0');
  const today = new Date().toISOString().split('T')[0];
  allPatients.unshift({
    id, name,
    age: age || '—',
    sex: sex || '—',
    mobile: '—',
    date: today,
    status: 'Physical Record'
  });
  const el = document.getElementById('stat-total'); if (el) el.textContent = allPatients.length;
  const el2 = document.getElementById('new-pid'); if (el2) el2.textContent = pxCount + 1;
  renderPxList();
  renderDashRecent();
  if (typeof updateReportsData === 'function') updateReportsData();
  addPatientToDropdowns(name, id);

  // Persist to DB (best-effort)
  if (supabase) {
    supabase.from('patients').insert([{
      pid: id, name,
      age: parseInt(age) || null,
      sex: sex || null,
      registered_date: today,
      status: 'Physical Record'
    }]).then(({error}) => { if (error) console.warn('[Supabase] phys patient:', error.message); });
  }
}