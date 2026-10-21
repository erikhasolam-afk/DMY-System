/* ═══════════════════════════════════════════════════════════════
   patient-profile.js — Consolidated Patient Profile
   One page per patient, keyed by the patient's unique ID (patients.id):
   personal & medical info, dental chart, treatment ledger & payments,
   appointments, X-rays / images, scanned documents and messages.
   ═══════════════════════════════════════════════════════════════ */

let _profile = null;          // { row (patients table), name, uuid, pid }
let _profileTab = 'overview';
const _profileCache = {};     // tab data fetched from Supabase for the open patient

/* Patient List / dashboard "View" now opens the profile.
   The previous behaviour (jump to Treatment Records) is kept as viewPxTreatment. */
const viewPxTreatment = window.viewPx || null;
window.viewPx = function (name) { openPatientProfile(name); };

async function openPatientProfile(nameOrPid) {
  const key = String(nameOrPid || '').trim();
  const local = (typeof allPatients !== 'undefined' ? allPatients : []).find(p => p.id === key) || findPatientByName(key);
  nav('profile', null);
  document.getElementById('profile-body').innerHTML = '<div class="empty-cell" style="padding:40px">Loading patient…</div>';

  let row = null;
  try {
    let q = supabase.from('patients').select('*');
    q = local ? q.eq('pid', local.id) : q.ilike('name', key);
    const { data } = await q.limit(1);
    row = data?.[0] || null;
  } catch (e) { console.warn('[Profile]', e.message); }

  if (!row && !local) {
    document.getElementById('profile-body').innerHTML = `<div class="empty-cell" style="padding:40px">Patient “${esc(key)}” is not registered.</div>`;
    return;
  }
  row = row || { name: local.name, pid: local.id, age: local.age, sex: local.sex, mobile: local.mobile, email: local.email, address: local.address, guardian: local.guardian, birthdate: local.birthdate, registered_date: local.date, status: local.status, health: local.health };
  _profile = { row, name: row.name, uuid: row.id || null, pid: row.pid };
  Object.keys(_profileCache).forEach(k => delete _profileCache[k]);
  _profileTab = 'overview';
  renderProfile();
}

function refreshProfileIfOpen() {
  if (_profile && document.getElementById('page-profile')?.classList.contains('active')) renderProfile(true);
}

/* Supabase filter: rows linked by patient_id, or (older rows) by exact name */
function byPatient(q) {
  if (_profile.uuid) {
    const nm = _profile.name.replace(/"/g, '\\"');
    return q.or(`patient_id.eq.${_profile.uuid},patient_name.eq."${nm}"`);
  }
  return q.eq('patient_name', _profile.name);
}

function profileTxs() { return (txStore[_profile.name] || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))); }
function profileAppts() {
  return (typeof apptStore !== 'undefined' ? apptStore : [])
    .filter(a => (_profile.uuid && a.patient_id === _profile.uuid) || a.patient_name === _profile.name)
    .sort((a, b) => (b.appt_date + b.start_time).localeCompare(a.appt_date + a.start_time));
}

function renderProfile(keepTab) {
  if (!_profile) return;
  const r = _profile.row;
  const txs = profileTxs();
  const t = txTotals(txs);
  const initials = (r.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const today = localISODate();
  const next = profileAppts().filter(a => ACTIVE_STATUSES.includes(a.status) && a.appt_date >= today)
    .sort((a, b) => (a.appt_date + a.start_time).localeCompare(b.appt_date + b.start_time))[0];

  const tabs = [
    ['overview', '👤 Overview'], ['chart', '🦷 Dental Chart'], ['ledger', '💳 Treatments & Payments'],
    ['appts', '📅 Appointments'], ['images', '🖼 X-Rays & Images'], ['docs', '📁 Documents'], ['messages', '💬 Messages'],
  ];
  const tabRole = { chart: ['admin', 'dentist', 'staff'], images: ['admin', 'dentist'], messages: ['admin', 'staff'], docs: ['admin', 'staff', 'dentist'] };
  const visibleTabs = tabs.filter(([k]) => !currentRole || !tabRole[k] || tabRole[k].includes(currentRole));
  tabs.length = 0; tabs.push(...visibleTabs);
  if (!tabs.some(([k]) => k === _profileTab)) _profileTab = 'overview';
  if (!keepTab) _profileTab = _profileTab || 'overview';

  document.getElementById('profile-body').innerHTML = `
    <div class="card profile-head">
      <div class="profile-avatar">${esc(initials)}</div>
      <div style="flex:1;min-width:220px">
        <div class="page-title" style="margin:0">${esc(r.name)}</div>
        <div class="sub" style="font-size:13px">${esc(r.pid || '')} · ${esc(r.age ?? '—')} yrs · ${esc(r.sex || '—')} · <span class="badge b-a">${esc(r.status || 'Active')}</span></div>
        <div style="font-size:13px;margin-top:6px">📱 ${esc(r.mobile || '—')} &nbsp; ✉ ${esc(r.email || '—')}</div>
        <div class="sub" style="margin-top:4px">${next ? `Next visit: <b>${fmtDate(next.appt_date)} ${fmtTime(next.start_time)}</b> with ${esc(next.dentist)}` : 'No upcoming appointment'}</div>
      </div>
      <div class="profile-money">
        <div><span>Net charges</span><b>${peso(t.net)}</b></div>
        <div><span>Collected</span><b style="color:#3B6D11">${peso(t.paid)}</b></div>
        <div><span>Balance</span><b style="color:${t.bal > 0 ? '#D85A30' : '#3B6D11'}">${peso(t.bal)}</b></div>
      </div>
      <div class="profile-actions">
        ${can('bookAppt') ? `<button class="btn btn-p btn-sm" onclick="scheduleForPatient('${jsArg(r.name)}')">📅 Book Appointment</button>` : ''}
        ${can('addTreatment') ? `<button class="btn btn-s btn-sm" onclick="profileAddTreatment()">➕ Treatment Entry</button>` : ''}
        ${can('editPatient') ? `<button class="btn btn-o btn-sm" onclick="openEditModal('${jsArg(r.pid)}')">✏️ Edit Info</button>` : ''}
        ${canOpen('pdf') ? `<button class="btn btn-gray btn-sm" onclick="profileExportPdf()">📄 PDF</button>` : ''}
      </div>
    </div>
    <div class="profile-tabs">${tabs.map(([k, l]) => `<button class="ptab ${k === _profileTab ? 'active' : ''}" onclick="setProfileTab('${k}')">${l}</button>`).join('')}</div>
    <div class="card" id="profile-tab-body"></div>`;
  renderProfileTab();
}

function setProfileTab(k) {
  _profileTab = k;
  document.querySelectorAll('.ptab').forEach(b => b.classList.toggle('active', b.getAttribute('onclick').includes(`'${k}'`)));
  renderProfileTab();
}

async function renderProfileTab() {
  const box = document.getElementById('profile-tab-body'); if (!box || !_profile) return;
  const r = _profile.row;
  const kv = (k, v) => `<div class="confirm-row"><div class="k">${esc(k)}</div><div class="v">${esc(v || '—')}</div></div>`;

  if (_profileTab === 'overview') {
    const h = r.health && typeof r.health === 'object' ? r.health : {};
    const healthRows = Object.entries(h).filter(([, v]) => v !== '' && v !== null && !(Array.isArray(v) && !v.length))
      .map(([k, v]) => kv(k.replace(/_/g, ' '), Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v)).join('');
    box.innerHTML = `<div class="profile-2col">
      <div><div class="confirm-sec">Personal Information</div>
        ${kv('Patient ID', r.pid)}${kv('Full name', r.name)}${kv('Birthdate', r.birthdate ? fmtDate(r.birthdate) : '')}${kv('Age / Sex', (r.age ?? '—') + ' / ' + (r.sex || '—'))}
        ${kv('Address', r.address)}${kv('Mobile', r.mobile)}${kv('E-mail', r.email)}${kv('Occupation', r.occupation)}
        ${kv('Parent / Guardian', r.guardian)}${kv('Dental insurance', r.dental_insurance)}${kv('Referred by', r.referrer)}${kv('Reason for consultation', r.reason)}
        ${kv('Registered', r.registered_date ? fmtDate(r.registered_date) : '')}</div>
      <div><div class="confirm-sec">Dental & Medical History</div>
        ${kv('Previous dentist', r.previous_dentist)}${kv('Last dental visit', r.last_visit ? fmtDate(r.last_visit) : '')}
        ${kv('Physician', r.physician)}${kv('Specialty', r.specialty)}
        ${healthRows || '<div class="sub" style="padding:8px 0">No health questionnaire answers saved.</div>'}</div>
    </div>`;
    return;
  }

  if (_profileTab === 'ledger') {
    const txs = profileTxs();
    const pays = paymentsForPatient(_profile.name);
    box.innerHTML = `
      <div class="card-title" style="border:none;padding:0;margin-bottom:8px"><span class="ct-ic">📋</span>Treatment Ledger
        ${can('addTreatment') ? `<button class="btn btn-s btn-sm" style="margin-left:auto" onclick="profileAddTreatment()">➕ Add Entry</button>` : ''}</div>
      <div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Tooth</th><th>Procedure</th><th>Dentist</th><th>Charged</th><th>Disc.</th><th>Paid</th><th>Balance</th><th>Next Appt.</th><th></th></tr></thead>
      <tbody>${txs.length ? txRowsHtml(txs) : '<tr><td colspan="10" class="empty-cell">No treatment records.</td></tr>'}</tbody></table></div>
      <div class="card-title" style="border:none;padding:0;margin:22px 0 8px"><span class="ct-ic">🧾</span>Payment History</div>
      <div style="overflow-x:auto"><table><thead><tr><th>Receipt</th><th>Date</th><th>Type</th><th>Amount</th><th>Method / Ref</th><th>Recorded by</th><th>Notes</th><th></th></tr></thead>
      <tbody>${paymentRowsHtml(pays, true)}</tbody></table></div>`;
    return;
  }

  if (_profileTab === 'appts') {
    const list = profileAppts();
    box.innerHTML = `<div class="card-title" style="border:none;padding:0;margin-bottom:8px"><span class="ct-ic">📅</span>Appointment History
        ${can('bookAppt') ? `<button class="btn btn-p btn-sm" style="margin-left:auto" onclick="scheduleForPatient('${jsArg(_profile.name)}')">➕ Book</button>` : ''}</div>
      <div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Time</th><th>Dentist</th><th>Branch</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(a => `<tr class="${a.status === 'Cancelled' ? 'tx-voided' : ''}"><td>${fmtDate(a.appt_date)}</td><td style="white-space:nowrap">${fmtTime(a.start_time)} – ${fmtTime(a.end_time)}</td>
        <td>${esc(a.dentist)}</td><td>${esc(a.branch || '—')}</td><td>${esc(a.reason || '—')}${a.cancel_reason ? '<div class="sub">Cancelled: ' + esc(a.cancel_reason) + '</div>' : ''}</td>
        <td>${statusBadge(a.status)}</td><td style="white-space:nowrap">${apptActionsHtml(a)}</td></tr>`).join('')
        || '<tr><td colspan="7" class="empty-cell">No appointments yet.</td></tr>'}
      </tbody></table></div>`;
    return;
  }

  // Tabs below load from Supabase on demand
  box.innerHTML = '<div class="empty-cell">Loading…</div>';
  const pname = _profile.name;
  try {
    if (_profileTab === 'chart') {
      const { data, error } = await byPatient(supabase.from('dental_charts').select('*')).limit(1);
      if (error) throw error;
      if (_profile?.name !== pname) return;
      const c = data?.[0];
      const LABEL = { P: 'Present', D: 'Decayed', M: 'Missing', X: 'Extracted', F: 'Filled (Am/Co)', C: 'Crown (JC)', Im: 'Implant' };
      const parse = v => { if (!v) return {}; if (typeof v === 'string') { try { return JSON.parse(v) || {}; } catch { return {}; } } return v; };
      const ts = parse(c?.tooth_state);
      const notes = parse(c?.tooth_notes);
      const marked = Object.entries(ts).filter(([, v]) => v && v !== 'P').sort((a, b) => Number(a[0]) - Number(b[0]));
      const cond = c?.conditions || {};
      box.innerHTML = c ? `
        <div class="card-title" style="border:none;padding:0;margin-bottom:8px"><span class="ct-ic">🦷</span>Chart summary
          <span class="sub" style="margin-left:8px">updated ${fmtDateTime(c.updated_at)}</span>
          <button class="btn btn-s btn-sm" style="margin-left:auto" onclick="profileOpenChart()">Open full chart</button></div>
        <div class="tooth-summary">${marked.map(([n, v]) => `<div class="tooth-pill t-${esc(v)}"><b>${esc(n)}</b>${esc(LABEL[v] || v)}${notes[n] ? `<div class="sub">${esc(notes[n])}</div>` : ''}</div>`).join('')
          || '<div class="sub">All charted teeth are marked present / healthy.</div>'}</div>
        <div class="profile-2col" style="margin-top:14px">${Object.entries(cond).map(([k, v]) => `<div>${kvList(k, v)}</div>`).join('')}</div>`
        : `<div class="empty-cell">No dental chart saved yet. <button class="btn btn-s btn-sm" onclick="profileOpenChart()">Create chart</button></div>`;
    }
    if (_profileTab === 'images') {
      const { data, error } = await byPatient(supabase.from('patient_images').select('id,src,type,note,filename,uploaded_at')).order('uploaded_at', { ascending: false });
      if (error) throw error;
      if (_profile?.name !== pname) return;
      box.innerHTML = (data || []).length ? `<div class="img-gallery">${data.map(i => `
        <div class="img-card"><img src="${esc(i.src)}" alt="" onclick="openLb(this.src,'${jsArg((i.type || '') + ' — ' + (i.note || ''))}')"/>
        <div class="img-card-label">${esc(i.type || '')}<br>${fmtDate(String(i.uploaded_at).slice(0, 10))}</div></div>`).join('')}</div>`
        : `<div class="empty-cell">No images or X-rays. <button class="btn btn-s btn-sm" onclick="nav('xray',document.querySelector('.ni[onclick*=xray]'))">Upload</button></div>`;
    }
    if (_profileTab === 'docs') {
      const { data, error } = await byPatient(supabase.from('physical_records').select('id,record_id,page_number,src,note,uploaded_at')).order('uploaded_at', { ascending: false });
      if (error) throw error;
      if (_profile?.name !== pname) return;
      const groups = {};
      (data || []).forEach(p => (groups[p.record_id] ||= []).push(p));
      box.innerHTML = Object.keys(groups).length ? Object.entries(groups).map(([rid, pages]) => `
        <div class="ph-card"><div class="ph-card-head"><div><div class="ph-card-name">${esc(pages[0].note || 'Scanned record')}</div>
          <div class="ph-card-meta">${esc(rid)} · ${pages.length} page(s) · ${fmtDate(String(pages[0].uploaded_at).slice(0, 10))}</div></div></div>
          <div class="ph-thumbs">${pages.sort((a, b) => a.page_number - b.page_number).map(p => `<div class="ph-thumb" onclick="openLb(this.querySelector('img').src,'Page ${p.page_number}')"><img src="${esc(p.src)}" alt=""/><span>p.${p.page_number}</span></div>`).join('')}</div></div>`).join('')
        : '<div class="empty-cell">No scanned documents. Use Physical Records to upload paper records.</div>';
    }
    if (_profileTab === 'messages') {
      const { data, error } = await byPatient(supabase.from('notifications').select('*')).order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      if (_profile?.name !== pname) return;
      box.innerHTML = `<div style="overflow-x:auto"><table><thead><tr><th>Queued</th><th>Patient</th><th>Type</th><th>Channel</th><th>To</th><th>Status</th><th>Detail</th><th>Message</th><th></th></tr></thead>
        <tbody>${notifRowsHtml(data || [], true)}</tbody></table></div>`;
    }
  } catch (e) {
    box.innerHTML = `<div class="alert al-i">⚠ ${esc(friendlyDbError(e))}</div>`;
  }
}

function kvList(k, v) {
  const items = Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.entries(v).filter(([, x]) => x).map(([a]) => a) : [v]);
  return `<div class="ss3" style="margin-top:0">${esc(k)}</div><div style="font-size:13px">${items.filter(Boolean).map(esc).join(', ') || '—'}</div>`;
}

function profileAddTreatment() {
  if (!_profile) return;
  const p = findPatientByName(_profile.name) || {};
  if (viewPxTreatment) viewPxTreatment(_profile.name, p.age ?? '?', p.sex ?? '?');
}
function profileOpenChart() {
  nav('chart', document.querySelector('.ni[onclick*="chart"]'));
  const nm = document.getElementById('dc-nm'); if (nm) nm.value = _profile.name;
  const ag = document.getElementById('dc-ag'); if (ag) ag.value = _profile.row.age ?? '';
  if (typeof loadChartForPatient === 'function') loadChartForPatient(_profile.name);
}
function profileExportPdf() {
  nav('pdf', document.querySelector('.ni[onclick*="pdf"]'));
  const i = document.getElementById('pdf-px'); if (i) i.value = _profile.name;
  const t = document.getElementById('pdf-tx-px'); if (t) t.value = _profile.name;
  notif('Patient selected — choose the sections and click Export.', 'al-s');
}
