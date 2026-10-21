/* treatment.js — Treatment ledger with autocomplete, date auto-fill, chart tooth sync
   REVISED: charges and payments are separate. A treatment entry is a CHARGE;
   money received is recorded as payment transactions (ledger.js). The paid
   and balance columns are computed by the database from those payments.   */
const txStore = {};
let currentTxPatient = '';
let _txRequestId = newRequestId();   // idempotency key for the entry form

/* ═══ Bootstrap: load ALL treatments from Supabase on startup ═══ */
async function loadAllTreatmentsFromSupabase() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase
      .from('treatments')
      .select('*')
      .order('date', { ascending: true });
    if (error || !data) { reportLoadError('treatment records', error || 'no data'); return; }
    delete loadErrors['treatment records'];

    Object.keys(txStore).forEach(k => delete txStore[k]);
    data.forEach(r => {
      if (!r.patient_name) return;
      (txStore[r.patient_name] ||= []).push(normalizeTx(r));
    });

    if (currentTxPatient) renderTxTable(currentTxPatient);
    if (typeof updateReportsData === 'function') updateReportsData();
    if (typeof initDash === 'function') {
      const dashPage = document.getElementById('page-dashboard');
      if (dashPage && dashPage.classList.contains('active')) initDash();
    }
    updateTodaysAppointments();
    if (typeof refreshProfileIfOpen === 'function') refreshProfileIfOpen();
  } catch (e) {
    console.warn('[Supabase] loadAllTreatments skipped:', e.message);
  }
}

/* ═══ Today's appointments on the dashboard ═══
   Source 1: Appointment module (real appointments with time, dentist, status)
   Source 2: legacy "Next Appt." dates on treatment entries not yet booked   */
function updateTodaysAppointments() {
  const todayStr = localISODate();
  const rows = [];

  const appts = (typeof apptStore !== 'undefined' ? apptStore : [])
    .filter(a => a.appt_date === todayStr && a.status !== 'Cancelled')
    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
  const booked = new Set(appts.map(a => a.patient_name));
  appts.forEach(a => rows.push({ name: a.patient_name, procedure: a.reason || '—', dentist: a.dentist,
                                 time: fmtTime(a.start_time) + ' – ' + fmtTime(a.end_time), status: a.status, apptId: a.id }));

  const seen = new Set();
  Object.entries(txStore).forEach(([patName, entries]) => {
    entries.forEach(e => {
      if (e.status === 'voided' || !e.next || e.next === '—') return;
      // a dentist's dashboard lists only their own follow-ups
      if (typeof currentRole !== 'undefined' && currentRole === 'dentist' && e.dentist_id && e.dentist_id !== currentProfile?.dentist_id) return;
      const d = String(e.next).split('T')[0];
      if (d !== todayStr || booked.has(patName) || seen.has(patName)) return;
      seen.add(patName);
      rows.push({ name: patName, procedure: e.procedure || '—', dentist: e.dentist || '—', time: 'Not booked', status: 'Follow-up' });
    });
  });

  const activeCount = rows.filter(r => !['No-Show', 'Completed'].includes(r.status)).length;
  ['stat-appt-today', 'dash-appt-today'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = activeCount;
  });

  const dateLabel = document.getElementById('dash-appt-date');
  if (dateLabel) dateLabel.textContent = new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const tbody = document.getElementById('dash-appt-list');
  if (!tbody) return activeCount;

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:28px 14px;color:var(--mu)">
          <div style="font-size:24px;margin-bottom:8px">📭</div>
          <div style="font-family:var(--fh);font-weight:700;font-size:13px;color:var(--td);margin-bottom:4px">No appointments today</div>
          <div style="font-size:11px">Book one in the Appointments module to see it here.</div>
        </td>
      </tr>`;
    return activeCount;
  }

  tbody.innerHTML = rows.map(a => {
    const patient = findPatientByName(a.name);
    const sc = (typeof STATUS_COLORS !== 'undefined' && STATUS_COLORS[a.status]) || { bg: 'var(--ol)', color: '#9E5410' };
    return `<tr>
      <td style="font-weight:700;color:var(--td)">${esc(a.name)}</td>
      <td>${esc(patient?.age ?? '—')}</td>
      <td>${esc(patient?.sex ?? '—')}</td>
      <td>${esc(a.procedure)}</td>
      <td>${esc(a.dentist)}</td>
      <td style="white-space:nowrap">${esc(a.time)} <span class="badge" style="background:${sc.bg};color:${sc.color}">${esc(a.status)}</span></td>
      <td style="white-space:nowrap"><button class="btn btn-s btn-sm" onclick="openPatientProfile('${jsArg(a.name)}')">👁 View</button></td>
    </tr>`;
  }).join('');
  return activeCount;
}

// Run bootstrap after Supabase is ready
setTimeout(loadAllTreatmentsFromSupabase, 800);

/* Live preview of the balance for the entry being typed */
function calcBal() {
  const c = parseFloat(document.getElementById('tr-ch').value) || 0;
  const d = parseFloat(document.getElementById('tr-disc')?.value) || 0;
  const p = parseFloat(document.getElementById('tr-pd').value) || 0;
  document.getElementById('tr-bl').value = (c - d - p).toFixed(2);
  const refReq = document.getElementById('tr-ref-req');
  const m = document.getElementById('tr-method')?.value;
  if (refReq) refReq.textContent = p > 0 && METHODS_NEEDING_REF.includes(m) ? '(required)' : '';
}

/* Auto-set today's date and pull tooth from chart */
function initTreatmentDefaults() {
  const dt = document.getElementById('tr-dt');
  if (dt && !dt.value) dt.value = localISODate();
  const tn = document.getElementById('tr-tn');
  if (tn && !tn.value && typeof toothState !== 'undefined') {
    const marked = Object.keys(toothState);
    if (marked.length) tn.value = marked.join(',');
  }
}

let _addTxBusy = false;
async function addTx() {
  if (_addTxBusy) return;                     // prevent double submission
  const g = id => (document.getElementById(id)?.value ?? '').trim();
  const name = g('tr-nm');
  let dt = g('tr-dt');
  if (!dt) { dt = localISODate(); document.getElementById('tr-dt').value = dt; }

  const prSel = document.getElementById('tr-pr');
  const prCustom = document.getElementById('tr-pr-custom');
  let pr = prSel ? prSel.value : '';
  if (pr === '__other__') {
    pr = (prCustom?.value || '').trim();
    if (!pr) { notif('Please specify the procedure name.', 'al-i'); prCustom?.focus(); return; }
  }

  if (!name) { alert('Enter a patient name first.'); return; }
  if (!findPatientByName(name)) { alert('“' + name + '” is not a registered patient. Pick a patient from the list (or register them first).'); return; }
  if (!dt || !pr) { alert('Fill in Date and Procedure.'); return; }

  const ch = round2(g('tr-ch')), disc = round2(g('tr-disc')), pd = round2(g('tr-pd'));
  const method = g('tr-method') || 'Cash', ref = g('tr-ref');
  if (ch < 0 || disc < 0 || pd < 0) { alert('Amounts cannot be negative.'); return; }
  if (disc > ch) { alert('Discount cannot be more than the charged amount.'); return; }
  if (pd > ch - disc) { alert('Initial payment cannot be more than the net charge (charged − discount).'); return; }
  if (pd > 0 && METHODS_NEEDING_REF.includes(method) && !ref) { alert('A reference number is required for ' + method + ' payments.'); return; }

  const btn = document.getElementById('tr-save-btn');
  _addTxBusy = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const { data, error } = await supabase.rpc('add_treatment', {
      p_patient_name: name, p_date: dt, p_procedure: pr, p_charged: ch, p_discount: disc,
      p_tooth: g('tr-tn') || null, p_dentist: canonicalDentist(g('tr-den')) || null,
      p_category: procedureCategory(pr), p_branch: g('tr-branch') || null,
      p_next_appt: g('tr-nx') || null, p_notes: g('tr-notes') || null,
      p_initial_payment: pd, p_method: method, p_reference: ref || null,
      p_client_request_id: _txRequestId,
    });
    if (error) throw error;
    _txRequestId = newRequestId();
    upsertTxInStore(data);
    if (pd > 0) await loadPaymentsFromSupabase();   // pulls the new receipt row
    currentTxPatient = name;
    afterLedgerChange();
    updateTodaysAppointments();
    notif('Treatment entry added for ' + name + (pd > 0 ? ' with payment of ' + peso(pd) : ''), 'al-s');

    // A follow-up date → offer to book a real appointment (with overlap check + SMS)
    const nx = g('tr-nx'), den = g('tr-den');
    clearTxForm(false);
    renderTxTable(name);
    if (nx && typeof openApptDialog === 'function' &&
        confirm('Book the follow-up on ' + fmtDate(nx) + ' as an appointment now?')) {
      openApptDialog({ patient_name: name, appt_date: nx, dentist: den, reason: 'Follow-up' });
    }
  } catch (e) {
    alert('Could not save treatment: ' + friendlyDbError(e));
  } finally {
    _addTxBusy = false;
    if (btn) { btn.disabled = false; btn.textContent = '💾 Add Entry'; }
  }
}

function clearTxForm(clearPatient = true) {
  const ids = ['tr-tn', 'tr-ch', 'tr-disc', 'tr-pd', 'tr-bl', 'tr-nx', 'tr-ref', 'tr-notes'];
  if (clearPatient) ids.push('tr-nm', 'tr-ag', 'tr-den');
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const prSel = document.getElementById('tr-pr'); if (prSel) prSel.value = '';
  const prCustom = document.getElementById('tr-pr-custom'); if (prCustom) { prCustom.value = ''; prCustom.style.display = 'none'; }
  const m = document.getElementById('tr-method'); if (m) m.value = 'Cash';
  if (clearPatient) { const trGn = document.getElementById('tr-gn'); if (trGn) trGn.selectedIndex = 0; }
  document.getElementById('tr-dt').value = localISODate();
  calcBal();
}

/* When the procedure dropdown changes, show/hide the custom input. */
function onProcedureChange() {
  const sel = document.getElementById('tr-pr');
  const custom = document.getElementById('tr-pr-custom');
  if (!sel || !custom) return;
  if (sel.value === '__other__') {
    custom.style.display = '';
    setTimeout(() => custom.focus(), 0);
  } else {
    custom.style.display = 'none';
    custom.value = '';
  }
}

/* Ledger table for one patient. Charged, collected and balance stay separate. */
function txRowsHtml(entries) {
  return entries.map(e => {
    const voided = e.status === 'voided';
    const bc = e.balance > 0 ? '#D85A30' : '#3B6D11';
    return `<tr class="${voided ? 'tx-voided' : ''}" title="${voided ? 'VOIDED: ' + esc(e.void_reason) : ''}">
      <td>${esc(e.date)}</td><td>${esc(e.tooth)}</td>
      <td>${esc(e.procedure)}${voided ? ' <span class="badge" style="background:#FCEBEB;color:#B91C1C">VOIDED</span>' : ''}<div class="sub">${esc(e.category)}${e.branch ? ' · ' + esc(e.branch) : ''}</div></td>
      <td>${esc(e.dentist)}</td>
      <td>${peso(e.charged)}</td>
      <td>${e.discount ? peso(e.discount) : '—'}</td>
      <td style="color:#3B6D11">${peso(e.paid)}</td>
      <td style="color:${bc};font-weight:700">${voided ? '—' : peso(e.balance)}</td>
      <td>${esc(e.next || '—')}</td>
      <td style="white-space:nowrap">
        ${!voided && e.balance > 0 && can('pay') ? `<button class="btn btn-p btn-sm" onclick="openPaymentDialog('${e.id}')" title="Record payment">💳 Pay</button>` : ''}
        <button class="btn btn-gray btn-sm" onclick="openPaymentHistory('${e.id}')" title="Payments, corrections, audit trail">🧾</button>
      </td></tr>`;
  }).join('');
}

function txTotals(entries) {
  const a = entries.filter(e => e.status !== 'voided');
  return {
    net: round2(a.reduce((s, e) => s + e.charged - e.discount, 0)),
    paid: round2(a.reduce((s, e) => s + e.paid, 0)),
    bal: round2(a.reduce((s, e) => s + e.balance, 0)),
  };
}

function renderTxTable(name) {
  const tbody = document.getElementById('tx-body'); if (!tbody) return;
  const entries = txStore[name] || [];
  const totalEl = document.getElementById('tx-total-bal');
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-cell">No treatment records for this patient yet.</td></tr>';
    if (totalEl) totalEl.textContent = peso(0);
    ['tx-total-net', 'tx-total-paid'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = peso(0); });
    return;
  }
  tbody.innerHTML = txRowsHtml(entries);
  const t = txTotals(entries);
  if (totalEl) totalEl.textContent = peso(t.bal);
  const n = document.getElementById('tx-total-net'); if (n) n.textContent = peso(t.net);
  const p = document.getElementById('tx-total-paid'); if (p) p.textContent = peso(t.paid);
}

async function loadTreatmentForPatient(name) {
  currentTxPatient = name;
  renderTxTable(name);
  initTreatmentDefaults();
  if (txStore[name] && txStore[name].length > 0) return;
  try {
    if (!supabase) return;
    const { data, error } = await supabase.from('treatments').select('*').eq('patient_name', name).order('date', { ascending: true });
    if (error || !data?.length) return;
    txStore[name] = data.map(normalizeTx);
    renderTxTable(name);
    if (typeof updateReportsData === 'function') updateReportsData();
    updateTodaysAppointments();
  } catch (e) { console.warn('Supabase tx load skipped:', e.message); }
}

function initTreatmentAutocomplete() {
  const input = document.getElementById('tr-nm');
  const dropdown = document.getElementById('tx-autocomplete');
  if (!input || !dropdown) return;

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    dropdown.innerHTML = '';
    if (!q) { dropdown.style.display = 'none'; return; }
    const matches = (typeof allPatients !== 'undefined' ? allPatients : []).filter(p => p.name.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) { dropdown.style.display = 'none'; return; }
    matches.forEach(p => {
      const item = document.createElement('div');
      item.className = 'ac-item';
      item.innerHTML = '<strong>' + esc(p.name) + '</strong> <span style="color:var(--mu);font-size:11px">' + esc(p.id) + ' · Age ' + esc(p.age) + ' · ' + esc(p.sex) + '</span>';
      item.onclick = () => {
        input.value = p.name;
        const ag = document.getElementById('tr-ag'); if (ag) ag.value = p.age || '';
        const gn = document.getElementById('tr-gn'); if (gn && p.sex) gn.value = p.sex;
        dropdown.style.display = 'none';
        loadTreatmentForPatient(p.name);
        const dcNm = document.getElementById('dc-nm'); if (dcNm) dcNm.value = p.name;
        const dcAg = document.getElementById('dc-ag'); if (dcAg) dcAg.value = p.age || '';
        if (typeof loadChartForPatient === 'function') loadChartForPatient(p.name);
      };
      dropdown.appendChild(item);
    });
    dropdown.style.display = 'block';
  });

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = 'none';
  });
  input.addEventListener('blur', () => {
    setTimeout(() => { const n = input.value.trim(); if (n && n !== currentTxPatient) loadTreatmentForPatient(n); }, 200);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTreatmentAutocomplete();
  initTreatmentDefaults();
  const m = document.getElementById('tr-method');
  if (m && m.options.length <= 1) m.innerHTML = optionsHtml(PAYMENT_METHODS, 'Cash');
});
