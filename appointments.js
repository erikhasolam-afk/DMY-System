/* ═══════════════════════════════════════════════════════════════
   appointments.js — Appointment Scheduling Module
   • Create / view / edit / reschedule / cancel (never deleted)
   • Day, week, month and list views; filter by dentist, branch, status, date
   • Overlap prevention for the same dentist: checked here for a quick
     message AND enforced by a database constraint (race-proof)
   • Every change is preserved in appointment_history (database trigger)
   • Confirmation / reschedule / cancellation SMS + e-mail are queued by
     the database; reminders are queued by the scheduled job
   ═══════════════════════════════════════════════════════════════ */

let apptStore = [];
let _apptView = 'week';                 // day | week | month | list
let _apptCursor = localISODate();       // date the current view is centred on
const _apptFilters = { dentist: '', branch: '', status: '', search: '', from: '', to: '' };

const APPT_STATUSES = ['Scheduled', 'Confirmed', 'Completed', 'Cancelled', 'No-Show'];
const STATUS_COLORS = {
  'Scheduled': { bg: '#E8F6F7', color: '#1F6E74', border: '#3A9EA5' },
  'Confirmed': { bg: '#EAF3DE', color: '#3B6D11', border: '#639922' },
  'Completed': { bg: '#F0F0F0', color: '#444',    border: '#999'    },
  'Cancelled': { bg: '#FCEBEB', color: '#B91C1C', border: '#E24B4A' },
  'No-Show'  : { bg: '#FFF3E8', color: '#9E5410', border: '#F47B20' },
  'Follow-up': { bg: '#FFF3E8', color: '#9E5410', border: '#F47B20' },
};
const APPT_REASONS = [
  'Consultation', 'Oral Examination', 'Cleaning/Prophylaxis', 'Follow-up', 'Filling', 'Extraction',
  'Root Canal Treatment', 'Orthodontic Adjustment', 'Braces Fitting', 'Scaling & Root Planing',
  'Teeth Whitening', 'Denture / Prosthesis', 'X-Ray', 'Emergency',
];
const ACTIVE_STATUSES = ['Scheduled', 'Confirmed'];

/* ═══ Load ═══ */
async function loadAllAppointmentsFromSupabase() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.from('appointments').select('*')
      .order('appt_date', { ascending: true }).order('start_time', { ascending: true });
    if (error) { reportLoadError('appointments', error); afterApptChange(); return; }
    delete loadErrors.appointments;
    apptStore = (data || []).map(normalizeAppt);
    afterApptChange();
  } catch (e) { reportLoadError('appointments', e); }
}
setTimeout(loadAllAppointmentsFromSupabase, 1100);

function normalizeAppt(r) {
  return {
    ...r,
    start_time: String(r.start_time || '').slice(0, 5),
    end_time: String(r.end_time || '').slice(0, 5),
    branch: r.branch || '', reason: r.reason || '', notes: r.notes || '',
  };
}

function afterApptChange() {
  updateApptStats();
  renderMySchedule();
  if (typeof updateTodaysAppointments === 'function') updateTodaysAppointments();
  if (document.getElementById('page-appointments')?.classList.contains('active')) renderAppointments();
  if (typeof refreshProfileIfOpen === 'function') refreshProfileIfOpen();
}

/* ═══ Filtering ═══ */
function apptMatchesFilters(a, ignoreDate) {
  const f = _apptFilters;
  if (f.dentist && a.dentist !== f.dentist) return false;
  if (f.branch && a.branch !== f.branch) return false;
  if (f.status && a.status !== f.status) return false;
  if (f.search) {
    const q = f.search.toLowerCase();
    if (!(a.patient_name || '').toLowerCase().includes(q) && !(a.reason || '').toLowerCase().includes(q)) return false;
  }
  if (!ignoreDate) {
    if (f.from && a.appt_date < f.from) return false;
    if (f.to && a.appt_date > f.to) return false;
  }
  return true;
}
function apptsOn(dateStr) {
  return apptStore.filter(a => a.appt_date === dateStr && apptMatchesFilters(a, true))
    .sort((a, b) => a.start_time.localeCompare(b.start_time) || a.dentist.localeCompare(b.dentist));
}
function apptFilterChange() {
  _apptFilters.dentist = document.getElementById('appt-f-dentist')?.value || '';
  _apptFilters.branch  = document.getElementById('appt-f-branch')?.value || '';
  _apptFilters.status  = document.getElementById('appt-f-status')?.value || '';
  _apptFilters.search  = (document.getElementById('appt-f-search')?.value || '').trim();
  _apptFilters.from    = document.getElementById('appt-f-from')?.value || '';
  _apptFilters.to      = document.getElementById('appt-f-to')?.value || '';
  const jump = document.getElementById('appt-f-date')?.value;
  if (jump) _apptCursor = jump;
  renderAppointments();
}

/* ═══ Views ═══ */
function setApptView(v, btn) {
  _apptView = v;
  document.querySelectorAll('#appt-view-tabs .date-tab').forEach(b => b.classList.toggle('active', b === btn || b.dataset.v === v));
  document.getElementById('appt-range-filters').style.display = v === 'list' ? 'flex' : 'none';
  renderAppointments();
}
function apptNav(dir) {
  if (dir === 0) _apptCursor = localISODate();
  else if (_apptView === 'day') _apptCursor = addDays(_apptCursor, dir);
  else if (_apptView === 'week') _apptCursor = addDays(_apptCursor, 7 * dir);
  else { const d = parseISODate(_apptCursor); d.setDate(1); d.setMonth(d.getMonth() + dir); _apptCursor = localISODate(d); }
  const j = document.getElementById('appt-f-date'); if (j) j.value = _apptCursor;
  renderAppointments();
}
function gotoApptDay(dateStr) { _apptCursor = dateStr; setApptView('day'); }

function renderAppointments() {
  const box = document.getElementById('appt-view'); if (!box) return;
  if (loadErrors.appointments) { box.innerHTML = loadErrorHtml('appointments'); return; }
  const label = document.getElementById('appt-label');
  const navWrap = document.getElementById('appt-nav');
  if (navWrap) navWrap.style.display = _apptView === 'list' ? 'none' : 'flex';
  if (_apptView === 'day') {
    if (label) label.textContent = fmtDate(_apptCursor, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    box.innerHTML = renderDayView(_apptCursor);
  } else if (_apptView === 'week') {
    const s = startOfWeek(_apptCursor), e = addDays(s, 6);
    if (label) label.textContent = fmtDate(s, { month: 'short', day: 'numeric' }) + ' – ' + fmtDate(e);
    box.innerHTML = renderWeekView(s);
  } else if (_apptView === 'month') {
    if (label) label.textContent = parseISODate(_apptCursor).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
    box.innerHTML = renderMonthView(_apptCursor);
  } else {
    box.innerHTML = renderListView();
  }
  updateApptStats();
}

function statusBadge(s) {
  const c = STATUS_COLORS[s] || STATUS_COLORS.Scheduled;
  return `<span class="badge" style="background:${c.bg};color:${c.color};border:1px solid ${c.border}">${esc(s)}</span>`;
}
function apptActionsHtml(a) {
  const active = ACTIVE_STATUSES.includes(a.status);
  const future = (a.appt_date + 'T' + a.start_time) > (localISODate() + 'T' + minToTime(new Date().getHours() * 60 + new Date().getMinutes()));
  return `
    ${can('bookAppt') ? `<button class="btn btn-s btn-sm" title="Edit / reschedule" onclick="openApptDialog('${a.id}')">✏️</button>` : ''}
    ${can('apptStatus') ? `<select class="status-sel" onchange="if(this.value)changeApptStatus('${a.id}',this.value);this.value=''">
      <option value="">Status…</option>
      ${APPT_STATUSES.filter(s => s !== a.status).map(s => `<option>${s}</option>`).join('')}
    </select>` : ''}
    ${active && future && can('remind') ? `<button class="btn btn-gray btn-sm" title="Send reminder now (SMS / e-mail)" onclick="sendManualReminder('${a.id}')">🔔</button>` : ''}
    <button class="btn btn-gray btn-sm" title="History & messages" onclick="openApptDetails('${a.id}')">🕘</button>`;
}

function renderDayView(dateStr) {
  const list = apptsOn(dateStr);
  const head = `<div class="appt-day-head"><b>${list.filter(a => ACTIVE_STATUSES.includes(a.status)).length}</b> active appointment(s)
    ${can('bookAppt') ? `<button class="btn btn-p btn-sm" style="margin-left:auto" onclick="openApptDialog({appt_date:'${dateStr}'})">➕ Book on this day</button>` : ''}</div>`;
  if (!list.length) return head + `<div class="empty-cell" style="padding:40px">No appointments on this day.</div>`;
  return head + `<div style="overflow-x:auto"><table><thead><tr><th>Time</th><th>Patient</th><th>Dentist</th><th>Branch</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map(a => `<tr class="${a.status === 'Cancelled' ? 'tx-voided' : ''}">
      <td style="font-family:var(--fh);font-weight:800;white-space:nowrap">${fmtTime(a.start_time)}<div class="sub">to ${fmtTime(a.end_time)}</div></td>
      <td><a class="link" onclick="openPatientProfile('${jsArg(a.patient_name)}')">${esc(a.patient_name)}</a></td>
      <td>${esc(a.dentist)}</td><td>${esc(a.branch || '—')}</td><td>${esc(a.reason || '—')}</td>
      <td>${statusBadge(a.status)}</td>
      <td style="white-space:nowrap">${apptActionsHtml(a)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function chipHtml(a) {
  const c = STATUS_COLORS[a.status] || STATUS_COLORS.Scheduled;
  return `<div class="appt-chip ${a.status === 'Cancelled' ? 'is-cancelled' : ''}" style="background:${c.bg};border-left-color:${c.border};color:${c.color}"
    title="${esc(a.patient_name)} · ${esc(a.dentist)} · ${esc(a.status)}" onclick="event.stopPropagation();${can('bookAppt') ? 'openApptDialog' : 'openApptDetails'}('${a.id}')">
    <b>${fmtTime(a.start_time)}</b> ${esc(a.patient_name)}<div class="sub">${esc(a.dentist)}</div></div>`;
}

function renderWeekView(weekStart) {
  const today = localISODate();
  let html = '<div class="week-grid">';
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    const list = apptsOn(d);
    html += `<div class="week-col ${d === today ? 'is-today' : ''}">
      <div class="week-hd" onclick="gotoApptDay('${d}')">${fmtDate(d, { weekday: 'short' })}<span>${parseISODate(d).getDate()}</span></div>
      <div class="week-body" ${can('bookAppt') ? `ondblclick="openApptDialog({appt_date:'${d}'})"` : ''}>
        ${list.map(chipHtml).join('') || '<div class="week-empty">—</div>'}
        ${can('bookAppt') ? `<button class="week-add" onclick="openApptDialog({appt_date:'${d}'})">＋</button>` : ''}
      </div></div>`;
  }
  return html + '</div>';
}

function renderMonthView(cursor) {
  const c = parseISODate(cursor);
  const y = c.getFullYear(), m = c.getMonth();
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;           // Monday-first
  const days = new Date(y, m + 1, 0).getDate();
  const today = localISODate();
  let html = '<div class="cal-grid">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="cal-hd">${d}</div>`).join('');
  for (let i = 0; i < lead; i++) html += '<div class="cal-cell cal-empty"></div>';
  for (let d = 1; d <= days; d++) {
    const ds = localISODate(new Date(y, m, d));
    const list = apptsOn(ds);
    const shown = list.filter(a => a.status !== 'Cancelled');
    html += `<div class="cal-cell ${ds === today ? 'cal-today' : ''}" onclick="gotoApptDay('${ds}')">
      <div class="cal-day-num">${d}</div>
      <div class="cal-events">${shown.slice(0, 3).map(a => {
        const sc = STATUS_COLORS[a.status] || STATUS_COLORS.Scheduled;
        return `<div class="cal-ev" style="border-left-color:${sc.border}">${fmtTime(a.start_time).replace(':00', '')} ${esc(a.patient_name.split(' ')[0])}</div>`;
      }).join('')}${shown.length > 3 ? `<div class="cal-more">+${shown.length - 3} more</div>` : ''}</div></div>`;
  }
  return html + '</div>';
}

function renderListView() {
  const rows = apptStore.filter(a => apptMatchesFilters(a, false))
    .sort((a, b) => (a.appt_date + a.start_time).localeCompare(b.appt_date + b.start_time));
  if (!rows.length) return '<div class="empty-cell" style="padding:40px">No appointments match the filters.</div>';
  return `<div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Time</th><th>Patient</th><th>Dentist</th><th>Branch</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(a => `<tr class="${a.status === 'Cancelled' ? 'tx-voided' : ''}">
      <td style="white-space:nowrap">${fmtDate(a.appt_date)}</td>
      <td style="white-space:nowrap">${fmtTime(a.start_time)} – ${fmtTime(a.end_time)}</td>
      <td><a class="link" onclick="openPatientProfile('${jsArg(a.patient_name)}')">${esc(a.patient_name)}</a></td>
      <td>${esc(a.dentist)}</td><td>${esc(a.branch || '—')}</td><td>${esc(a.reason || '—')}</td>
      <td>${statusBadge(a.status)}</td><td style="white-space:nowrap">${apptActionsHtml(a)}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="sub" style="margin-top:8px">${rows.length} appointment(s)</div>`;
}

/* ═══ Stats ═══ */
function updateApptStats() {
  const today = localISODate(), weekEnd = addDays(today, 7), month = today.slice(0, 7);
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('appt-stat-today', apptStore.filter(a => a.appt_date === today && ACTIVE_STATUSES.includes(a.status)).length);
  set('appt-stat-upcoming', apptStore.filter(a => a.appt_date > today && a.appt_date <= weekEnd && ACTIVE_STATUSES.includes(a.status)).length);
  set('appt-stat-month', apptStore.filter(a => a.appt_date.startsWith(month) && a.status !== 'Cancelled').length);
  set('appt-stat-noshow', apptStore.filter(a => a.appt_date.startsWith(month) && a.status === 'No-Show').length);
}

/* ═══ Overlap check (client-side, for a friendly message) ═══ */
function findOverlap(dentist, date, start, end, excludeId) {
  const s1 = timeToMin(start), e1 = timeToMin(end);
  return apptStore.find(a =>
    a.id !== excludeId && ACTIVE_STATUSES.includes(a.status) && a.appt_date === date &&
    (a.dentist_id && refData.dentists.find(d => normDentist(d.name) === normDentist(dentist))?.id === a.dentist_id
       || normDentist(a.dentist) === normDentist(dentist)) &&
    s1 < timeToMin(a.end_time) && e1 > timeToMin(a.start_time));
}

/* ═══ Create / edit / reschedule dialog ═══
   openApptDialog()               → new
   openApptDialog({ ...prefill }) → new with values
   openApptDialog('<uuid>')       → edit existing                         */
function openApptDialog(arg) {
  const existing = typeof arg === 'string' ? apptStore.find(a => a.id === arg) : null;
  const pre = existing || (typeof arg === 'object' && arg) || {};
  const isEdit = !!existing;
  const start = pre.start_time || '09:00';
  const end = pre.end_time || minToTime(timeToMin(start) + 30);
  const reqId = newRequestId();
  const locked = isEdit && !ACTIVE_STATUSES.includes(existing.status);

  openDialog({
    title: isEdit ? '✏️ Edit / Reschedule Appointment' : '📅 New Appointment',
    confirmText: isEdit ? '💾 Save Changes' : '💾 Book Appointment',
    hideConfirm: locked,
    body: `
      ${locked ? `<div class="alert al-i">This appointment is <b>&nbsp;${esc(existing.status)}</b>. Its history is kept; book a new appointment instead of editing it.</div>` : ''}
      ${isEdit ? `<div class="dlg-quick">
        ${ACTIVE_STATUSES.includes(existing.status) && (existing.appt_date + 'T' + existing.start_time) > (localISODate() + 'T' + minToTime(new Date().getHours() * 60 + new Date().getMinutes()))
          ? `<button type="button" class="btn btn-gray btn-sm" onclick="closeTopDialog();sendManualReminder('${existing.id}')">🔔 Send reminder now</button>` : ''}
        <button type="button" class="btn btn-gray btn-sm" onclick="closeTopDialog();openApptDetails('${existing.id}')">🕘 History &amp; messages</button>
      </div>` : ''}
      <div class="fg" style="margin-bottom:12px"><label class="fl">Patient *</label>
        <input class="fc" id="ap-px" value="${esc(pre.patient_name || '')}" ${isEdit ? 'readonly style="background:#f5f5f5"' : ''} placeholder="Type to search registered patients"/>
        <div class="sub" id="ap-px-info"></div></div>
      <div class="fr c2">
        <div class="fg"><label class="fl">Dentist *</label><input class="fc" id="ap-den" list="dl-dentists" value="${esc(pre.dentist || '')}" placeholder="e.g. Dr. Santos"/></div>
        <div class="fg"><label class="fl">Branch</label><select class="fc" id="ap-branch">${optionsHtml(activeBranches().concat(pre.branch && !activeBranches().includes(pre.branch) ? [pre.branch] : []), pre.branch || activeBranches()[0] || '', '— Branch —')}</select></div>
      </div>
      <div class="fr c3">
        <div class="fg"><label class="fl">Date *</label><input class="fc" type="date" id="ap-date" value="${esc(pre.appt_date || localISODate())}"/></div>
        <div class="fg"><label class="fl">Start *</label><input class="fc" type="time" id="ap-start" step="300" value="${esc(start)}"/></div>
        <div class="fg"><label class="fl">End *</label><input class="fc" type="time" id="ap-end" step="300" value="${esc(end)}"/></div>
      </div>
      <div class="fr c2">
        <div class="fg"><label class="fl">Reason / procedure</label><input class="fc" id="ap-reason" list="dl-appt-reasons" value="${esc(pre.reason || '')}"/></div>
        <div class="fg"><label class="fl">Status</label><select class="fc" id="ap-status">${optionsHtml(isEdit ? APPT_STATUSES : ACTIVE_STATUSES, pre.status || 'Scheduled')}</select></div>
      </div>
      <div class="fg"><label class="fl">Notes</label><textarea class="fc" id="ap-notes" rows="2">${esc(pre.notes || '')}</textarea></div>
      <div id="ap-conflict" class="alert" style="display:none;background:#FCEBEB;color:#B91C1C;border:1px solid #F3A0A0;margin:10px 0 0"></div>
      <datalist id="dl-appt-reasons">${APPT_REASONS.map(r => `<option value="${esc(r)}">`).join('')}</datalist>
      <div class="sub" style="margin-top:8px">${isEdit ? 'Changing the date/time sends a reschedule notice; the old slot stays in the history.' : 'The patient receives a confirmation by SMS / e-mail if enabled in Notification Settings.'}</div>`,
    onOpen(d) {
      const pxInfo = () => {
        const p = findPatientByName(d.val('#ap-px'));
        d.q('#ap-px-info').innerHTML = p
          ? `${esc(p.id)} · 📱 ${esc(p.mobile && p.mobile !== '—' ? p.mobile : 'no mobile on file')} · ✉ ${esc(p.email || 'no e-mail on file')}`
          : '';
      };
      if (!isEdit) attachPatientAutocomplete(d.q('#ap-px'), pxInfo);
      pxInfo();
      // keep duration when the start time moves
      let dur = timeToMin(end) - timeToMin(start);
      d.q('#ap-start').addEventListener('change', () => { d.q('#ap-end').value = minToTime(timeToMin(d.val('#ap-start')) + Math.max(dur, 15)); liveCheck(); });
      d.q('#ap-end').addEventListener('change', () => { dur = timeToMin(d.val('#ap-end')) - timeToMin(d.val('#ap-start')); liveCheck(); });
      ['#ap-den', '#ap-date'].forEach(s => d.q(s).addEventListener('change', liveCheck));
      function liveCheck() {
        const c = findOverlap(d.val('#ap-den'), d.val('#ap-date'), d.val('#ap-start'), d.val('#ap-end'), existing?.id);
        const box = d.q('#ap-conflict');
        box.style.display = c ? 'flex' : 'none';
        if (c) box.innerHTML = `⚠ ${esc(c.dentist)} already has <b>&nbsp;${esc(c.patient_name)}&nbsp;</b> from ${fmtTime(c.start_time)} to ${fmtTime(c.end_time)}.`;
      }
      liveCheck();
    },
    async onConfirm(d) {
      const p = findPatientByName(d.val('#ap-px'));
      const v = {
        patient_name: d.val('#ap-px'), dentist: canonicalDentist(d.val('#ap-den')), branch: d.val('#ap-branch') || null,
        appt_date: d.val('#ap-date'), start_time: d.val('#ap-start'), end_time: d.val('#ap-end'),
        reason: d.val('#ap-reason') || null, status: d.val('#ap-status') || 'Scheduled', notes: d.val('#ap-notes') || null,
      };
      if (!p) { d.error('Select a registered patient from the list (register new patients in Add Patient first).'); return false; }
      if (!v.dentist) { d.error('Dentist is required.'); return false; }
      if (!v.appt_date || !v.start_time || !v.end_time) { d.error('Date, start and end time are required.'); return false; }
      if (timeToMin(v.end_time) <= timeToMin(v.start_time)) { d.error('End time must be after the start time.'); return false; }
      const slotChanged = !isEdit || v.appt_date !== existing.appt_date || v.start_time !== existing.start_time || v.dentist !== existing.dentist;
      if (slotChanged && ACTIVE_STATUSES.includes(v.status) && (v.appt_date + 'T' + v.start_time) < localISODate() + 'T00:00') {
        if (!confirm('This date is in the past. Save anyway (e.g. recording a past visit)?')) return false;
      }
      if (ACTIVE_STATUSES.includes(v.status)) {
        const c = findOverlap(v.dentist, v.appt_date, v.start_time, v.end_time, existing?.id);
        if (c) { d.error(`${c.dentist} already has ${c.patient_name} from ${fmtTime(c.start_time)} to ${fmtTime(c.end_time)}.`); return false; }
      }

      let res;
      if (isEdit) {
        res = await supabase.from('appointments').update(v).eq('id', existing.id).select().single();
      } else {
        res = await supabase.from('appointments').insert([{ ...v, client_request_id: reqId }]).select().single();
        if (res.error && res.error.code === '23505') {   // same submission arrived twice
          res = await supabase.from('appointments').select('*').eq('client_request_id', reqId).single();
        }
      }
      if (res.error) throw res.error;
      const row = normalizeAppt(res.data);
      const i = apptStore.findIndex(a => a.id === row.id);
      if (i >= 0) apptStore[i] = row; else apptStore.push(row);
      if (!activeDentists().some(n => n.toLowerCase() === v.dentist.toLowerCase())) {
        supabase.from('dentists').insert([{ name: v.dentist, branch: v.branch }]).then(() => loadRefData());
      }
      afterApptChange();
      notif(isEdit ? 'Appointment updated.' : 'Appointment booked for ' + v.patient_name + '.', 'al-s');
      kickNotificationSender();
    },
  });
}

/* ═══ Status changes (cancel keeps the record) ═══ */
async function changeApptStatus(id, status) {
  const a = apptStore.find(x => x.id === id); if (!a) return;
  const patch = { status };
  if (status === 'Cancelled') {
    const reason = prompt('Reason for cancelling ' + a.patient_name + "'s appointment?");
    if (reason === null) return;
    patch.cancel_reason = reason.trim() || 'Not specified';
  }
  if (ACTIVE_STATUSES.includes(status) && !ACTIVE_STATUSES.includes(a.status)) {
    const c = findOverlap(a.dentist, a.appt_date, a.start_time, a.end_time, a.id);
    if (c) return alert(`Cannot re-activate: ${c.dentist} already has ${c.patient_name} at that time.`);
  }
  const { data, error } = await supabase.from('appointments').update(patch).eq('id', id).select().single();
  if (error) return alert(friendlyDbError(error));
  Object.assign(a, normalizeAppt(data));
  afterApptChange();
  notif('Status changed to ' + status + '.', 'al-s');
  if (status === 'Cancelled') kickNotificationSender();
}

/* ═══ Manual reminder (fallback) ═══ */
async function sendManualReminder(id) {
  const a = apptStore.find(x => x.id === id); if (!a) return;
  if (!confirm(`Send a reminder to ${a.patient_name} now for ${fmtDate(a.appt_date)} at ${fmtTime(a.start_time)}?`)) return;
  const { data, error } = await supabase.rpc('queue_manual_reminder', { p_appointment_id: id });
  if (error) return alert(friendlyDbError(error));
  const rows = data || [];
  const queued = rows.filter(n => n.status === 'pending');
  const skipped = rows.filter(n => n.status === 'skipped');
  let msg = queued.length ? `Reminder queued (${queued.map(n => n.channel.toUpperCase()).join(' + ')}).` : 'No reminder could be queued.';
  if (skipped.length) msg += ' Skipped: ' + skipped.map(n => n.channel.toUpperCase() + ' — ' + n.last_error).join('; ');
  notif(msg, queued.length ? 'al-s' : 'al-i');
  if (queued.length) {
    const result = await kickNotificationSender(true);
    if (result?.error) notif('Queued, but the sender could not run now: ' + result.error + ' It will retry automatically.', 'al-i');
  }
  if (typeof loadNotifications === 'function') loadNotifications();
}

/* ═══ Details: history + messages ═══ */
async function openApptDetails(id) {
  const a = apptStore.find(x => x.id === id); if (!a) return;
  const [h, n] = await Promise.all([
    supabase.from('appointment_history').select('*').eq('appointment_id', id).order('changed_at', { ascending: false }),
    supabase.from('notifications').select('*').eq('appointment_id', id).order('created_at', { ascending: false }),
  ]);
  const histRows = (h.data || []).map(r => {
    const o = r.old_data || {}, nw = r.new_data || {};
    let what = r.change_type === 'created' ? `Booked for ${fmtDate(nw.appt_date)} ${fmtTime(nw.start_time)} with ${esc(nw.dentist)}`
      : r.change_type === 'rescheduled' ? `Moved from ${fmtDate(o.appt_date)} ${fmtTime(o.start_time)} (${esc(o.dentist)}) → ${fmtDate(nw.appt_date)} ${fmtTime(nw.start_time)} (${esc(nw.dentist)})`
      : r.change_type === 'status' ? `Status ${esc(o.status)} → ${esc(nw.status)}${nw.cancel_reason && nw.status === 'Cancelled' ? ' — ' + esc(nw.cancel_reason) : ''}`
      : 'Details edited';
    return `<tr><td style="white-space:nowrap">${fmtDateTime(r.changed_at)}</td><td>${esc(r.changed_by_name || '—')}</td><td>${what}</td></tr>`;
  }).join('') || '<tr><td colspan="3" class="empty-cell">No history.</td></tr>';
  openDialog({
    title: `🕘 ${esc(a.patient_name)} — ${fmtDate(a.appt_date)} ${fmtTime(a.start_time)}`,
    wide: true, hideConfirm: true,
    body: `<div class="ss3" style="margin-top:0">Change history</div>
      <table><thead><tr><th>When</th><th>By</th><th>Change</th></tr></thead><tbody>${histRows}</tbody></table>
      <div class="ss3">Messages</div>
      <table><thead><tr><th>Queued</th><th>Type</th><th>Channel</th><th>To</th><th>Status</th><th>Detail</th></tr></thead>
      <tbody>${notifRowsHtml(n.data || [], false)}</tbody></table>`,
  });
}

/* ═══ Entry points from other modules ═══ */
function scheduleForPatient(patientName) {
  nav('appointments', document.querySelector('.ni[onclick*="appointments"]'));
  setTimeout(() => openApptDialog({ patient_name: patientName }), 60);
}

function initAppointments() {
  fillRefSelects();
  const st = document.getElementById('appt-f-status');
  if (st && st.options.length <= 1) st.insertAdjacentHTML('beforeend', APPT_STATUSES.map(s => `<option>${s}</option>`).join(''));
  const j = document.getElementById('appt-f-date'); if (j && !j.value) j.value = _apptCursor;
  const f = document.getElementById('appt-f-from'); if (f && !f.value) { f.value = localISODate(); _apptFilters.from = f.value; }
  const t = document.getElementById('appt-f-to'); if (t && !t.value) { t.value = addDays(localISODate(), 30); _apptFilters.to = t.value; }
  renderAppointments();
}

/* ═══ Dentist dashboard: my schedule (today + next 7 days) ═══ */
function renderMySchedule() {
  const box = document.getElementById('dash-my-schedule'); if (!box) return;
  if (typeof currentRole === 'undefined' || currentRole !== 'dentist') return;
  if (loadErrors.appointments) { box.innerHTML = loadErrorHtml('appointments'); return; }
  const today = localISODate(), end = addDays(today, 7);
  const list = apptStore.filter(a => a.appt_date >= today && a.appt_date <= end && a.status !== 'Cancelled')
    .sort((a, b) => (a.appt_date + a.start_time).localeCompare(b.appt_date + b.start_time));
  const who = currentProfile?.dentist_display || currentProfile?.dentist_name || '';
  if (!list.length) {
    box.innerHTML = `<div class="empty-cell">📭 No appointments for ${esc(who || 'you')} today or in the next 7 days.</div>`;
    return;
  }
  let lastDay = '';
  box.innerHTML = `<table><thead><tr><th>Date</th><th>Time</th><th>Patient</th><th>Branch</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map(a => {
      const day = a.appt_date === today ? '<b>Today</b>' : fmtDate(a.appt_date, { weekday: 'short', month: 'short', day: 'numeric' });
      const show = a.appt_date !== lastDay; lastDay = a.appt_date;
      return `<tr><td>${show ? day : ''}</td><td style="white-space:nowrap">${fmtTime(a.start_time)} – ${fmtTime(a.end_time)}</td>
        <td><a class="link" onclick="openPatientProfile('${jsArg(a.patient_name)}')">${esc(a.patient_name)}</a></td>
        <td>${esc(a.branch || '—')}</td><td>${esc(a.reason || '—')}</td><td>${statusBadge(a.status)}</td>
        <td style="white-space:nowrap">${apptActionsHtml(a)}</td></tr>`;
    }).join('')}</tbody></table>`;
}
