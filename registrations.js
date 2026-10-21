/* ═══════════════════════════════════════════════════════════════
   registrations.js — Pending Registrations (admin & staff)
   Review online submissions from register.html, check for existing
   patients, approve (new or linked), reject, and confirm / reschedule /
   reject appointment requests. All actions are database functions that
   check the user's role and record who reviewed what and when.
   ═══════════════════════════════════════════════════════════════ */

let regStore = [];
let reqStore = [];
let _regTab = 'Pending Review';

async function loadRegistrations() {
  if (!supabase || (typeof can === 'function' && !canOpen('registrations'))) return;
  const [r, q] = await Promise.all([
    supabase.from('registrations').select('*').order('created_at', { ascending: false }).limit(500),
    supabase.from('appointment_requests').select('*').order('created_at', { ascending: false }).limit(500),
  ]);
  if (r.error) { reportLoadError('registrations', r.error); renderRegistrations(); return; }
  delete loadErrors.registrations;
  regStore = r.data || [];
  reqStore = q.data || [];
  updateRegBadge();
  if (document.getElementById('page-registrations')?.classList.contains('active')) renderRegistrations();
}
setTimeout(loadRegistrations, 1400);
setInterval(() => { if (!document.hidden) loadRegistrations(); }, 60000);

const reqFor = regId => reqStore.find(q => q.registration_id === regId) || null;
const regName = r => [r.first_name, r.middle_name, r.last_name].filter(Boolean).join(' ');
function ageOf(bd) { const b = parseISODate(bd), t = new Date(); let a = t.getFullYear() - b.getFullYear(); if (t < new Date(t.getFullYear(), b.getMonth(), b.getDate())) a--; return a; }

function updateRegBadge() {
  const n = regStore.filter(r => r.status === 'Pending Review').length
    + reqStore.filter(q => q.status === 'Pending Confirmation' && (!q.registration_id || regStore.find(r => r.id === q.registration_id)?.status === 'Approved')).length;
  const b = document.getElementById('reg-badge');
  if (b) { b.textContent = n; b.style.display = n ? '' : 'none'; }
}

const REG_BADGE = { 'Pending Review': 'background:var(--ol);color:#9E5410', Approved: 'background:#EAF3DE;color:#3B6D11', Rejected: 'background:#FCEBEB;color:#B91C1C' };
const REQ_BADGE = { 'Pending Confirmation': 'background:var(--ol);color:#9E5410', Confirmed: 'background:#EAF3DE;color:#3B6D11', Rejected: 'background:#FCEBEB;color:#B91C1C', Cancelled: 'background:#F1EFE8;color:#6B7E85' };

function setRegTab(t, btn) {
  _regTab = t;
  document.querySelectorAll('#reg-tabs .date-tab').forEach(b => b.classList.toggle('active', b === btn));
  renderRegistrations();
}

function reqPatientName(ar) {
  const reg = ar.registration_id ? regStore.find(r => r.id === ar.registration_id) : null;
  if (reg) return regName(reg);
  return (typeof allPatients !== 'undefined' ? allPatients : []).find(p => p.uuid === ar.patient_id)?.name || '(patient)';
}

function renderRequestRows(q) {
  const rows = reqStore.filter(ar => ar.status === 'Pending Confirmation')
    .filter(ar => !q || reqPatientName(ar).toLowerCase().includes(q))
    .sort((a, b) => (a.preferred_date + a.preferred_time).localeCompare(b.preferred_date + b.preferred_time));
  document.getElementById('reg-list').innerHTML = rows.map(ar => {
    const reg = ar.registration_id ? regStore.find(r => r.id === ar.registration_id) : null;
    return `<tr>
      <td style="font-family:var(--fh);font-weight:800;white-space:nowrap">${esc(reg?.ref_no || 'Portal')}</td>
      <td><b>${esc(reqPatientName(ar))}</b><div class="sub">${esc(ar.source)}${ar.reschedule_of ? ' · <b>reschedule</b>' : ''}</div></td>
      <td style="white-space:nowrap">${fmtDateTime(ar.created_at)}</td>
      <td>${reg ? `<span class="badge" style="${REG_BADGE[reg.status]}">${esc(reg.status)}</span>` : '<span class="badge b-d">Existing patient</span>'}</td>
      <td><span class="badge" style="${REQ_BADGE[ar.status]}">${esc(ar.status)}</span><div class="sub">${fmtDate(ar.preferred_date, { month: 'short', day: 'numeric' })} ${fmtTime(ar.preferred_time)} · ${esc(ar.dentist || 'any dentist')}</div></td>
      <td><button class="btn btn-s btn-sm" onclick="openRequest('${ar.id}')">🔍 Review</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="empty-cell">No pending appointment requests.</td></tr>';
}

function renderRegistrations() {
  const q = (document.getElementById('reg-search')?.value || '').trim().toLowerCase();
  if (loadErrors.registrations) { document.getElementById('reg-list').innerHTML = loadErrorHtml('registrations', 6); return; }
  if (_regTab === 'Requests') { renderRequestRows(q); updateRegStats(); return; }
  let rows = regStore;
  if (_regTab !== 'All') rows = regStore.filter(r => r.status === _regTab);
  if (q) rows = rows.filter(r => regName(r).toLowerCase().includes(q) || r.ref_no.toLowerCase().includes(q) || r.mobile.includes(q));

  document.getElementById('reg-list').innerHTML = rows.map(r => {
    const ar = reqFor(r.id);
    return `<tr>
      <td style="font-family:var(--fh);font-weight:800;white-space:nowrap">${esc(r.ref_no)}</td>
      <td><b>${esc(regName(r))}</b>${r.possible_duplicate && r.status === 'Pending Review' ? ' <span class="badge" style="background:#FFF3E8;color:#9E5410" title="Name, birthdate, mobile or e-mail matches an existing patient">⚠ possible duplicate</span>' : ''}
          <div class="sub">${esc(r.sex)} · ${ageOf(r.birthdate)} yrs · ${esc(r.mobile)}</div></td>
      <td style="white-space:nowrap">${fmtDateTime(r.created_at)}</td>
      <td><span class="badge" style="${REG_BADGE[r.status]}">${esc(r.status)}</span>${r.reviewed_by_name ? `<div class="sub">${esc(r.reviewed_by_name)} · ${fmtDate(String(r.reviewed_at).slice(0, 10))}</div>` : ''}</td>
      <td>${ar ? `<span class="badge" style="${REQ_BADGE[ar.status]}">${esc(ar.status)}</span><div class="sub">${fmtDate(ar.preferred_date, { month: 'short', day: 'numeric' })} ${fmtTime(ar.preferred_time)} · ${esc(ar.dentist || 'any dentist')}</div>` : '<span class="sub">none</span>'}</td>
      <td><button class="btn btn-s btn-sm" onclick="openRegistration('${r.id}')">${r.status === 'Pending Review' ? '🔍 Review' : '👁 Open'}</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" class="empty-cell">No ${_regTab === 'All' ? '' : _regTab.toLowerCase() + ' '}registrations.</td></tr>`;
  updateRegStats();
}

function updateRegStats() {
  const month = localISODate().slice(0, 7);
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('reg-stat-pending', regStore.filter(r => r.status === 'Pending Review').length);
  set('reg-stat-requests', reqStore.filter(q => q.status === 'Pending Confirmation').length);
  set('reg-stat-dup', regStore.filter(r => r.status === 'Pending Review' && r.possible_duplicate).length);
  set('reg-stat-approved', regStore.filter(r => r.status === 'Approved' && String(r.reviewed_at).startsWith(month)).length);
  updateRegBadge();
}

/* ═══ Review dialog ═══ */
async function openRegistration(id) {
  const r = regStore.find(x => x.id === id); if (!r) return;
  const ar = reqFor(r.id);
  const pending = r.status === 'Pending Review';
  const h = r.health || {};
  const yn = v => ({ yes: 'Yes', no: 'No', na: 'N/A' }[v] || '—');
  const inp = (key, label, val, type = 'text') => `<div class="fg"><label class="fl">${label}</label>
      <input class="fc" data-k="${key}" type="${type}" value="${esc(val ?? '')}" ${pending ? '' : 'readonly style="background:#f5f5f5"'}/></div>`;

  let matches = [];
  if (pending) {
    const m = await supabase.rpc('registration_matches', { p_reg_id: r.id });
    matches = m.data || [];
  }

  const dlg = openDialog({
    title: `📝 ${esc(r.ref_no)} — ${esc(regName(r))}`, wide: true, hideConfirm: true,
    body: `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <span class="badge" style="${REG_BADGE[r.status]}">${esc(r.status)}</span>
        <span class="sub">Submitted ${fmtDateTime(r.created_at)} · consent given ${fmtDateTime(r.consented_at)}</span>
        ${r.reviewed_by_name ? `<span class="sub">· Reviewed by ${esc(r.reviewed_by_name)} on ${fmtDateTime(r.reviewed_at)}</span>` : ''}
        ${r.review_notes ? `<span class="sub">· Notes: ${esc(r.review_notes)}</span>` : ''}
      </div>
      <div class="confirm-sec">Personal information ${pending ? '<span class="sub">(you can correct mistakes before approving)</span>' : ''}</div>
      <div class="fr c3">${inp('last_name', 'Last name', r.last_name)}${inp('first_name', 'First name', r.first_name)}${inp('middle_name', 'Middle name', r.middle_name)}</div>
      <div class="fr c3">${inp('birthdate', 'Birthdate (' + ageOf(r.birthdate) + ' yrs)', r.birthdate, 'date')}
        <div class="fg"><label class="fl">Sex</label><select class="fc" data-k="sex" ${pending ? '' : 'disabled'}>${optionsHtml(['Male', 'Female'], r.sex)}</select></div>
        ${inp('mobile', 'Cellphone', r.mobile)}</div>
      <div class="fr c2">${inp('address', 'Address', r.address)}${inp('email', 'E-mail', r.email, 'email')}</div>
      <div class="fr c2">${inp('guardian_name', 'Parent / guardian', r.guardian_name)}${inp('guardian_mobile', 'Guardian cellphone', r.guardian_mobile)}</div>

      <div class="confirm-sec">Health answers</div>
      <div class="reg-health">
        ${[['q1', 'Good health'], ['q2', 'Under treatment', 'q2a'], ['q3', 'Serious illness / operation', 'q3a'], ['q4', 'Hospitalized', 'q4a'], ['q5', 'Taking medication', 'q5a'], ['q6', 'Uses tobacco']]
          .map(([q, l, s]) => `<div><span>${l}</span><b>${yn(h[q])}${s && h[s] ? ' — ' + esc(h[s]) : ''}</b></div>`).join('')}
        <div><span>Allergies</span><b>${esc((h.q8_allergies || []).join(', ') || '—')}</b></div>
        <div><span>Pregnant / nursing / pills</span><b>${[h.q10a, h.q10b, h.q10c].map(yn).join(' / ')}</b></div>
      </div>

      ${pending ? `
      <div class="confirm-sec">Existing patients that may be the same person</div>
      ${matches.length ? `<table><thead><tr><th>Patient</th><th>Birthdate</th><th>Mobile</th><th>Why it matched</th><th></th></tr></thead><tbody>
        ${matches.map(m => `<tr><td><b>${esc(m.name)}</b><div class="sub">${esc(m.pid)}</div></td><td>${m.birthdate ? fmtDate(m.birthdate) : '—'}</td><td>${esc(m.mobile || '—')}</td>
          <td class="sub">${esc(m.match_reason)}</td><td><button class="btn btn-o btn-sm" onclick="approveRegistration('${r.id}','${m.patient_id}','${jsArg(m.name)}')">🔗 Same person — link</button></td></tr>`).join('')}
        </tbody></table>` : '<div class="sub" style="margin-bottom:8px">No existing patient matches the name + birthdate, mobile or e-mail.</div>'}
      <div class="fg" style="margin-top:10px;max-width:420px"><label class="fl">Or search all patients</label><input class="fc" id="reg-link-search" placeholder="Type a name…"/></div>` : ''}

      ${ar ? `<div class="confirm-sec">Appointment request <span class="badge" style="${REQ_BADGE[ar.status]}">${esc(ar.status)}</span></div>
        <div class="reg-health">
          <div><span>Preferred</span><b>${fmtDate(ar.preferred_date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} at ${fmtTime(ar.preferred_time)}</b></div>
          <div><span>Branch / dentist</span><b>${esc(ar.branch || 'No preference')} / ${esc(ar.dentist || 'No preference')}</b></div>
          <div><span>Reason</span><b>${esc(ar.reason)}</b></div>
          ${ar.notes ? `<div><span>Notes</span><b>${esc(ar.notes)}</b></div>` : ''}
          ${ar.review_notes ? `<div><span>Review</span><b>${esc(ar.review_notes)} ${ar.reviewed_by_name ? '· ' + esc(ar.reviewed_by_name) : ''}</b></div>` : ''}
        </div>
        ${ar.status === 'Pending Confirmation' ? (r.status === 'Approved' ? `
          <div class="fr c4" style="margin-top:10px">
            <div class="fg"><label class="fl">Date</label><input class="fc" type="date" id="ar-date" value="${esc(ar.preferred_date)}"/></div>
            <div class="fg"><label class="fl">Start</label><input class="fc" type="time" id="ar-start" step="300" value="${esc(String(ar.preferred_time).slice(0, 5))}"/></div>
            <div class="fg"><label class="fl">End</label><input class="fc" type="time" id="ar-end" step="300" value="${minToTime(timeToMin(ar.preferred_time) + (refData.settings?.slot_minutes || 30))}"/></div>
            <div class="fg"><label class="fl">Dentist *</label><input class="fc" id="ar-dentist" list="dl-dentists" value="${esc(ar.dentist || '')}"/></div>
          </div>
          <div id="ar-conflict" class="sub" style="color:#B91C1C"></div>
          <div class="bg" style="margin-top:6px">
            <button class="btn btn-p btn-sm" onclick="confirmRequest('${ar.id}')">✓ Confirm appointment</button>
            <button class="btn btn-sm btn-danger-o" onclick="rejectRequest('${ar.id}')">✗ Reject request</button>
            <span class="sub" style="align-self:center">Change the date/time above to reschedule. The patient gets the confirmation by SMS/e-mail if enabled.</span>
          </div>` : `<div class="sub" style="margin-top:6px">Approve the registration first; the appointment is then linked to the patient's record.</div>`)
        : (ar.appointment_id ? `<div class="sub" style="margin-top:6px">Appointment created — see <b>Appointments</b>.</div>` : '')}` : ''}

      ${pending ? `<div class="bg" style="margin-top:18px;border-top:1px solid var(--bd);padding-top:14px">
        <button class="btn btn-gray btn-sm" onclick="saveRegistrationEdits('${r.id}')">💾 Save corrections</button>
        <button class="btn btn-p btn-sm" onclick="approveRegistration('${r.id}', null)">✓ Approve as NEW patient</button>
        <button class="btn btn-sm btn-danger-o" onclick="rejectRegistration('${r.id}')">✗ Reject (spam / invalid)</button>
      </div>` : (r.patient_id ? `<div class="bg"><button class="btn btn-s btn-sm" onclick="closeAllDialogs();openPatientProfile('${jsArg((typeof allPatients !== 'undefined' ? allPatients.find(p => p.uuid === r.patient_id)?.id : '') || regName(r))}')">👤 Open patient record</button></div>` : '')}`,
    onOpen(d) {
      const s = d.q('#reg-link-search');
      if (s) attachPatientAutocomplete(s, p => approveRegistration(r.id, p.uuid, p.name));
      const chk = () => {
        const c = d.q('#ar-conflict'); if (!c) return;
        const o = findOverlap(canonicalDentist(d.val('#ar-dentist')), d.val('#ar-date'), d.val('#ar-start'), d.val('#ar-end'), null);
        c.textContent = o ? `⚠ ${o.dentist} already has ${o.patient_name} from ${fmtTime(o.start_time)} to ${fmtTime(o.end_time)}.` : '';
      };
      ['#ar-date', '#ar-start', '#ar-end', '#ar-dentist'].forEach(sel => d.q(sel)?.addEventListener('change', chk)); chk();
    },
  });
}

function regEdits() {
  const dlg = [...document.querySelectorAll('.dlg-overlay')].pop(); const p = {};
  dlg.querySelectorAll('[data-k]').forEach(el => { p[el.dataset.k] = el.value.trim(); });
  return p;
}
async function saveRegistrationEdits(id, silent) {
  const p = regEdits();
  if (!/^09\d{9}$/.test(p.mobile.replace(/\D/g, ''))) { alert('Cellphone must be 11 digits starting with 09.'); return false; }
  const { data, error } = await supabase.rpc('update_registration', { p_reg_id: id, p });
  if (error) { alert(friendlyDbError(error)); return false; }
  const i = regStore.findIndex(r => r.id === id); if (i >= 0) regStore[i] = data;
  if (!silent) { notif('Corrections saved.', 'al-s'); closeAllDialogs(); openRegistration(id); }
  return true;
}

let _approving = false;
async function approveRegistration(id, existingPatientId, existingName) {
  if (_approving) return;
  const r = regStore.find(x => x.id === id);
  const msg = existingPatientId
    ? `Link ${r.ref_no} to the EXISTING patient "${existingName}"?\nNo new patient record will be created.`
    : `Create a NEW patient record for ${regName(r)}?`;
  if (!confirm(msg)) return;
  _approving = true;
  try {
    if (!(await saveRegistrationEdits(id, true))) return;          // keep any corrections typed in the dialog
    const { data, error } = await supabase.rpc('approve_registration', { p_reg_id: id, p_existing_patient_id: existingPatientId || null, p_notes: null });
    if (error) return alert(friendlyDbError(error));
    notif(data.already ? 'Already approved — no duplicate created.' : `Approved → patient ${data.pid}.`, 'al-s');
    if (typeof loadPatientsFromSupabase === 'function') await loadPatientsFromSupabase();
    await loadRegistrations();
    closeAllDialogs(); openRegistration(id);
  } finally { _approving = false; }
}

async function rejectRegistration(id) {
  const reason = prompt('Reason for rejecting (e.g. spam, duplicate, fake details):');
  if (!reason || !reason.trim()) return;
  const { error } = await supabase.rpc('reject_registration', { p_reg_id: id, p_reason: reason.trim() });
  if (error) return alert(friendlyDbError(error));
  notif('Registration rejected.', 'al-s');
  await loadRegistrations(); closeAllDialogs();
}

let _confirming = false;
async function confirmRequest(reqId) {
  if (_confirming) return;
  const dlg = [...document.querySelectorAll('.dlg-overlay')].pop();
  const v = s => dlg.querySelector(s)?.value.trim() || '';
  const dentist = canonicalDentist(v('#ar-dentist'));
  if (!dentist) return alert('Choose the dentist for this appointment.');
  if (!v('#ar-date') || !v('#ar-start') || !v('#ar-end')) return alert('Date, start and end time are required.');
  if (timeToMin(v('#ar-end')) <= timeToMin(v('#ar-start'))) return alert('End time must be after start time.');
  const moving = reqStore.find(q => q.id === reqId)?.reschedule_of || null;
  const o = findOverlap(dentist, v('#ar-date'), v('#ar-start'), v('#ar-end'), moving);
  if (o) return alert(`${o.dentist} already has ${o.patient_name} at that time. Choose another time or dentist.`);
  _confirming = true;
  try {
    const { data, error } = await supabase.rpc('confirm_appointment_request', {
      p_request_id: reqId, p_date: v('#ar-date'), p_start: v('#ar-start'), p_end: v('#ar-end'), p_dentist: dentist, p_branch: null, p_notes: null,
    });
    if (error) return alert(friendlyDbError(error));
    notif(data.already ? 'This request was already confirmed.' : 'Appointment confirmed and added to the schedule.', 'al-s');
    if (typeof loadAllAppointmentsFromSupabase === 'function') await loadAllAppointmentsFromSupabase();
    if (typeof kickNotificationSender === 'function') kickNotificationSender();
    await loadRegistrations();
    const reg = reqStore.find(q => q.id === reqId)?.registration_id;
    closeAllDialogs(); if (reg) openRegistration(reg); else renderRegistrations();
  } finally { _confirming = false; }
}

async function rejectRequest(reqId) {
  const reason = prompt('Reason for not confirming this request (kept for the record):');
  if (!reason || !reason.trim()) return;
  const notify = confirm('Send the patient a message that the requested time could not be confirmed? (Only if SMS/e-mail is set up.)');
  const { error } = await supabase.rpc('reject_appointment_request', { p_request_id: reqId, p_reason: reason.trim(), p_notify: notify });
  if (error) return alert(friendlyDbError(error));
  notif('Request rejected.', 'al-s');
  if (notify && typeof kickNotificationSender === 'function') kickNotificationSender();
  const reg = reqStore.find(q => q.id === reqId)?.registration_id;
  await loadRegistrations(); closeAllDialogs(); if (reg) openRegistration(reg);
}

function initRegistrations() { fillRefSelects(); renderRegistrations(); loadRegistrations(); }

/* ═══ Review a request from the patient portal (existing patient, no registration) ═══ */
function openRequest(reqId) {
  const ar = reqStore.find(q => q.id === reqId); if (!ar) return;
  if (ar.registration_id) return openRegistration(ar.registration_id);
  const name = reqPatientName(ar);
  const orig = ar.reschedule_of ? apptStore.find(a => a.id === ar.reschedule_of) : null;
  openDialog({
    title: `📅 Appointment request — ${esc(name)}`, wide: true, hideConfirm: true,
    body: `
      <div class="reg-health">
        <div><span>Patient</span><b><a class="link" onclick="closeAllDialogs();openPatientProfile('${jsArg(name)}')">${esc(name)}</a></b></div>
        <div><span>Requested from</span><b>${esc(ar.source)} · ${fmtDateTime(ar.created_at)}</b></div>
        <div><span>Preferred</span><b>${fmtDate(ar.preferred_date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} at ${fmtTime(ar.preferred_time)}</b></div>
        <div><span>Branch / dentist</span><b>${esc(ar.branch || 'No preference')} / ${esc(ar.dentist || 'No preference')}</b></div>
        <div><span>Reason</span><b>${esc(ar.reason)}</b></div>
        ${ar.notes ? `<div><span>Notes</span><b>${esc(ar.notes)}</b></div>` : ''}
        ${ar.reschedule_of ? `<div><span>Reschedule of</span><b>${orig ? fmtDate(orig.appt_date) + ' ' + fmtTime(orig.start_time) + ' with ' + esc(orig.dentist) : 'an existing appointment'}</b></div>` : ''}
      </div>
      ${ar.status === 'Pending Confirmation' ? `
        <div class="fr c4" style="margin-top:10px">
          <div class="fg"><label class="fl">Date</label><input class="fc" type="date" id="ar-date" value="${esc(ar.preferred_date)}"/></div>
          <div class="fg"><label class="fl">Start</label><input class="fc" type="time" id="ar-start" step="300" value="${esc(String(ar.preferred_time).slice(0, 5))}"/></div>
          <div class="fg"><label class="fl">End</label><input class="fc" type="time" id="ar-end" step="300" value="${minToTime(timeToMin(ar.preferred_time) + (refData.settings?.slot_minutes || 30))}"/></div>
          <div class="fg"><label class="fl">Dentist *</label><input class="fc" id="ar-dentist" list="dl-dentists" value="${esc(ar.dentist || orig?.dentist || '')}"/></div>
        </div>
        <div id="ar-conflict" class="sub" style="color:#B91C1C"></div>
        <div class="bg" style="margin-top:6px">
          <button class="btn btn-p btn-sm" onclick="confirmRequest('${ar.id}')">✓ ${ar.reschedule_of ? 'Move appointment to this time' : 'Confirm appointment'}</button>
          <button class="btn btn-sm btn-danger-o" onclick="rejectRequest('${ar.id}')">✗ Reject request</button>
        </div>` : `<div class="sub">This request is ${esc(ar.status)}. ${esc(ar.review_notes || '')}</div>`}`,
    onOpen(d) {
      const chk = () => {
        const c = d.q('#ar-conflict'); if (!c) return;
        const o = findOverlap(canonicalDentist(d.val('#ar-dentist')), d.val('#ar-date'), d.val('#ar-start'), d.val('#ar-end'), ar.reschedule_of);
        c.textContent = o ? `⚠ ${o.dentist} already has ${o.patient_name} from ${fmtTime(o.start_time)} to ${fmtTime(o.end_time)}.` : '';
      };
      ['#ar-date', '#ar-start', '#ar-end', '#ar-dentist'].forEach(sel => d.q(sel)?.addEventListener('change', chk)); chk();
    },
  });
}
