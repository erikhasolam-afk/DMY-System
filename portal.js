/* ═══════════════════════════════════════════════════════════════
   portal.js — Patient Portal (role: patient)
   Everything comes from ONE database function, patient_portal(), which
   returns only the signed-in patient's own appointments, requests, bills
   and payments. Patients never query clinic tables directly, so they
   cannot reach another patient's data or clinic-wide reports.
   ═══════════════════════════════════════════════════════════════ */

let portalData = null;
let _portalTab = 'upcoming';

async function renderPortal() {
  const box = document.getElementById('portal-body'); if (!box) return;
  box.innerHTML = '<div class="empty-cell">Loading your records…</div>';
  const { data, error } = await supabase.rpc('patient_portal');
  if (error) {
    const msg = String(error.message || '');
    if (msg.startsWith('NOT_LINKED|')) {
      box.innerHTML = `<div class="portal-empty"><div style="font-size:40px">🔗</div>
        <h3>Your login is not linked to a patient record yet</h3>
        <p>For your privacy, the clinic links logins to records only after checking who you are.</p>
        <p>Ask the front desk to link your account <b>${esc(currentProfile?.email || '')}</b>, or make sure the clinic has the same e-mail address on your patient record and that you verified it.</p></div>`;
      return;
    }
    box.innerHTML = `<div class="load-error">⚠ Could not load your records: ${esc(friendlyDbError(error))}
      <div class="sub">Please reload the page. If it keeps happening, tell the clinic this message.</div>
      <button class="btn btn-o btn-sm" style="margin-top:8px" onclick="renderPortal()">↻ Try again</button></div>`;
    console.error('[portal]', error);
    return;
  }
  portalData = data;
  drawPortal();
}

function drawPortal() {
  const d = portalData, box = document.getElementById('portal-body');
  const appts = d.appointments || [];
  const upcoming = appts.filter(a => a.upcoming).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const history = appts.filter(a => !a.upcoming);
  const pending = (d.requests || []).filter(r => r.status === 'Pending Confirmation');
  const t = d.totals || {};
  const tabs = [['upcoming', `📅 Upcoming (${upcoming.length})`], ['requests', `📝 Requests (${pending.length} pending)`],
                ['history', `🕘 History (${history.length})`], ['bills', '💳 Bills & Payments']];

  box.innerHTML = `
    <div class="portal-head">
      <div><div class="page-title" style="margin:0">Hi, ${esc((d.patient?.name || '').split(' ')[0])}!</div>
        <div class="sub" style="font-size:13px">${esc(d.patient?.pid)} · 📱 ${esc(d.patient?.mobile || '—')} · ✉ ${esc(d.patient?.email || '—')}</div></div>
      <div class="portal-actions">
        <button class="btn btn-p" onclick="openPortalRequest()">➕ Request an appointment</button>
        <button class="btn btn-gray btn-sm" onclick="openPortalContact()">✏️ Update my contact details</button>
      </div>
    </div>
    <div class="sg" style="margin-top:16px">
      <div class="sc"><div class="sl">Next visit</div><div class="sv" style="font-size:18px;color:var(--t)">${upcoming[0] ? fmtDate(upcoming[0].date, { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' + fmtTime(upcoming[0].start) : 'None booked'}</div><div class="ss2">${upcoming[0] ? esc(upcoming[0].dentist) : 'Request one anytime'}</div></div>
      <div class="sc"><div class="sl">Pending requests</div><div class="sv">${pending.length}</div><div class="ss2">Waiting for the clinic</div></div>
      <div class="sc"><div class="sl">Total paid</div><div class="sv" style="font-size:24px;color:#3B6D11">${peso(t.paid)}</div><div class="ss2">of ${peso((t.charged || 0) - (t.discount || 0))} billed</div></div>
      <div class="sc"><div class="sl">Balance due</div><div class="sv" style="font-size:24px;color:${t.balance > 0 ? '#D85A30' : '#3B6D11'}">${peso(t.balance)}</div><div class="ss2">${t.balance > 0 ? 'Outstanding' : 'Nothing owed'}</div></div>
    </div>
    <div class="profile-tabs">${tabs.map(([k, l]) => `<button class="ptab ${k === _portalTab ? 'active' : ''}" onclick="_portalTab='${k}';drawPortal()">${l}</button>`).join('')}</div>
    <div class="card" style="border-top-left-radius:0">${portalTab(upcoming, history, d)}</div>`;
}

const PSTATUS = {
  Scheduled: 'background:#E8F6F7;color:#1F6E74', Confirmed: 'background:#EAF3DE;color:#3B6D11', Completed: 'background:#F0F0F0;color:#444',
  Cancelled: 'background:#FCEBEB;color:#B91C1C', 'No-Show': 'background:#FFF3E8;color:#9E5410',
  'Pending Confirmation': 'background:#FFF3E8;color:#9E5410', Rejected: 'background:#FCEBEB;color:#B91C1C',
  Paid: 'background:#EAF3DE;color:#3B6D11', 'Partially paid': 'background:#FFF3E8;color:#9E5410', Unpaid: 'background:#FCEBEB;color:#B91C1C',
};
const pbadge = s => `<span class="badge" style="${PSTATUS[s] || ''}">${esc(s)}</span>`;
const pempty = (icon, msg) => `<div class="empty-cell" style="padding:34px"><div style="font-size:28px">${icon}</div>${msg}</div>`;

function apptRow(a, actions) {
  return `<tr>
    <td style="white-space:nowrap"><b>${fmtDate(a.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</b><div class="sub">${fmtTime(a.start)} – ${fmtTime(a.end)}</div></td>
    <td>${esc(a.dentist || '—')}</td><td>${esc(a.branch || '—')}</td><td>${esc(a.reason || '—')}</td>
    <td>${pbadge(a.status)}${a.cancel_reason ? `<div class="sub">${esc(a.cancel_reason)}</div>` : ''}${a.reschedule_pending ? '<div class="sub">Reschedule requested</div>' : ''}</td>
    ${actions ? `<td style="white-space:nowrap">${actions}</td>` : ''}</tr>`;
}

function portalTab(upcoming, history, d) {
  if (_portalTab === 'upcoming') {
    if (!upcoming.length) return pempty('📭', 'You have no upcoming appointments.<br><button class="btn btn-p btn-sm" style="margin-top:10px" onclick="openPortalRequest()">Request an appointment</button>');
    return `<div style="overflow-x:auto"><table><thead><tr><th>When</th><th>Dentist</th><th>Branch</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>
      ${upcoming.map(a => apptRow(a, `
        ${!a.reschedule_pending ? `<button class="btn btn-gray btn-sm" onclick="openPortalRequest('${a.id}')">↻ Request new time</button>` : ''}
        ${a.can_cancel ? `<button class="btn btn-sm btn-danger-o" onclick="portalCancelAppt('${a.id}')">Cancel</button>`
                       : `<span class="sub" title="Online cancellation closes ${d.cancel_hours} hours before">call to cancel</span>`}`)).join('')}
      </tbody></table></div>
      <div class="sub" style="margin-top:8px">You can cancel online up to ${d.cancel_hours} hours before your visit. After that, please call ${esc(d.clinic?.phone || 'the clinic')}.</div>`;
  }
  if (_portalTab === 'requests') {
    const reqs = d.requests || [];
    if (!reqs.length) return pempty('📝', 'You have not made any appointment requests.');
    return `<div style="overflow-x:auto"><table><thead><tr><th>Requested time</th><th>Dentist / branch</th><th>Reason</th><th>Status</th><th>Clinic note</th><th></th></tr></thead><tbody>
      ${reqs.map(r => `<tr>
        <td style="white-space:nowrap"><b>${fmtDate(r.date, { weekday: 'short', month: 'short', day: 'numeric' })}</b> · ${fmtTime(r.time)}
          <div class="sub">${r.reschedule_of ? 'Reschedule request' : 'New visit'}${r.ref_no ? ' · ' + esc(r.ref_no) : ''} · sent ${fmtDate(String(r.created_at).slice(0, 10), { month: 'short', day: 'numeric' })}</div></td>
        <td>${esc(r.dentist || 'Any dentist')}<div class="sub">${esc(r.branch || 'Any branch')}</div></td>
        <td>${esc(r.reason)}</td><td>${pbadge(r.status)}</td><td class="sub">${esc(r.review_notes || (r.status === 'Pending Confirmation' ? 'Not confirmed yet — the clinic will contact you.' : ''))}</td>
        <td>${r.status === 'Pending Confirmation' ? `<button class="btn btn-sm btn-gray" onclick="portalCancelRequest('${r.id}')">Withdraw</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>`;
  }
  if (_portalTab === 'history') {
    if (!history.length) return pempty('🕘', 'No past appointments yet.');
    return `<div style="overflow-x:auto"><table><thead><tr><th>When</th><th>Dentist</th><th>Branch</th><th>Reason</th><th>Status</th></tr></thead><tbody>
      ${history.map(a => apptRow(a, null)).join('')}</tbody></table></div>`;
  }
  // bills
  const bills = d.bills || [], pays = d.payments || [], t = d.totals || {};
  return `
    <div class="ledger-summary">
      <div><span>Total charges</span><b>${peso(t.charged)}</b></div><div><span>Discounts</span><b>${peso(t.discount)}</b></div>
      <div><span>Paid</span><b style="color:#3B6D11">${peso(t.paid)}</b></div><div><span>Balance due</span><b style="color:#D85A30">${peso(t.balance)}</b></div>
    </div>
    <div class="ss3" style="margin-top:4px">Bills</div>
    ${bills.length ? `<div style="overflow-x:auto"><table class="num-table"><thead><tr><th>Date / treatment</th><th>Charged</th><th>Discount</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>
      ${bills.map(b => `<tr><td><b>${esc(b.procedure)}</b><div class="sub">${fmtDate(b.date)} · ${esc(b.dentist || '')}</div></td>
        <td>${peso(b.charged)}</td><td>${b.discount ? peso(b.discount) : '—'}</td><td>${peso(b.paid)}</td>
        <td style="font-weight:700;color:${b.balance > 0 ? '#D85A30' : '#3B6D11'}">${peso(b.balance)}</td><td>${pbadge(b.status)}</td></tr>`).join('')}
      </tbody></table></div>` : pempty('🧾', 'You have no bills.')}
    <div class="ss3">Payment history</div>
    ${pays.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Receipt</th><th>Date</th><th>For</th><th>Method / reference</th><th>Amount</th></tr></thead><tbody>
      ${pays.map(p => `<tr><td style="font-family:var(--fh);font-weight:700">${esc(p.receipt_no)}</td><td>${fmtDate(p.date)}</td><td>${esc(p.procedure || '—')}</td>
        <td>${esc(p.method)}${p.reference ? `<div class="sub">${esc(p.reference)}</div>` : ''}</td>
        <td style="font-weight:700;color:${p.kind === 'payment' ? '#3B6D11' : '#B91C1C'}">${p.kind === 'payment' ? '' : '−'}${peso(p.amount)}${p.kind !== 'payment' ? `<div class="sub">${p.kind === 'refund' ? 'Refund' : 'Correction'}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : pempty('💳', 'No payments recorded yet.')}
    <div class="sub" style="margin-top:8px">Payments are recorded by the clinic. If something looks wrong, please contact ${esc(d.clinic?.phone || 'the clinic')}.</div>`;
}

/* ═══ Actions (each is a checked database function) ═══ */
function openPortalRequest(rescheduleOf) {
  const appt = rescheduleOf ? (portalData.appointments || []).find(a => a.id === rescheduleOf) : null;
  const token = newRequestId();
  let slot = '';
  openDialog({
    title: appt ? '↻ Request a new time' : '📅 Request an appointment', confirmText: 'Send request',
    body: `
      ${appt ? `<div class="alert al-i">Current: ${fmtDate(appt.date)} at ${fmtTime(appt.start)} with ${esc(appt.dentist)}. It stays booked until the clinic confirms the new time.</div>` : ''}
      <div class="fr c2">
        <div class="fg"><label class="fl">Branch</label><select class="fc" id="pr-branch"><option value="">No preference</option></select></div>
        <div class="fg"><label class="fl">Dentist</label><select class="fc" id="pr-dentist"><option value="">No preference</option></select></div>
      </div>
      <div class="fr c2">
        <div class="fg"><label class="fl">Date *</label><input class="fc" type="date" id="pr-date"/></div>
        <div class="fg"><label class="fl">Reason *</label><select class="fc" id="pr-reason"><option value="">Select</option>
          ${(() => {
            const list = ['Check-up / Consultation', 'Cleaning', 'Tooth pain', 'Filling', 'Extraction', 'Braces / Orthodontic', 'Root canal', 'Follow-up', 'Other'];
            const keep = appt ? (appt.reason || 'Rescheduled visit') : '';      // a reschedule keeps the original reason
            if (keep && !list.includes(keep)) list.unshift(keep);
            return list.map(r => `<option ${r === keep ? 'selected' : ''}>${esc(r)}</option>`).join('');
          })()}</select></div>
      </div>
      <div class="fg"><label class="fl">Time *</label><div id="pr-slots" class="slot-grid"><span class="sub">Choose a date first.</span></div></div>
      <div class="fg" style="margin-top:10px"><label class="fl">Notes</label><textarea class="fc" id="pr-notes" rows="2" maxlength="500"></textarea></div>
      <div class="sub" style="margin-top:8px">Only free times are shown. <b>This is a request</b> — it is confirmed only when the clinic approves it.</div>`,
    async onOpen(d) {
      const { data: info } = await supabase.rpc('public_clinic_info');
      if (info) {
        d.q('#pr-branch').innerHTML = '<option value="">No preference</option>' + (info.branches || []).map(b => `<option>${esc(b)}</option>`).join('');
        const fillDent = () => { const b = d.val('#pr-branch'); d.q('#pr-dentist').innerHTML = '<option value="">No preference</option>' + (info.dentists || []).filter(x => !b || !x.branch || x.branch === b).map(x => `<option ${appt && normDentist(appt.dentist) === normDentist(x.name) ? 'selected' : ''}>${esc(x.name)}</option>`).join(''); };
        fillDent(); d.q('#pr-branch').addEventListener('change', () => { fillDent(); loadSlots(); });
        d.q('#pr-date').min = info.today; d.q('#pr-date').max = addDays(info.today, info.max_days_ahead || 90);
      }
      async function loadSlots() {
        slot = ''; const day = d.val('#pr-date'); const box = d.q('#pr-slots');
        if (!day) return;
        box.innerHTML = '<span class="sub">Checking free times…</span>';
        const { data, error } = await supabase.rpc('public_free_slots', { p_date: day, p_dentist: d.val('#pr-dentist') || null, p_branch: d.val('#pr-branch') || null });
        if (error) { box.innerHTML = `<span class="sub" style="color:#B91C1C">${esc(friendlyDbError(error))}</span>`; return; }
        const times = (data || []).map(x => String(x).slice(0, 5));
        box.innerHTML = times.length ? times.map(x => `<button type="button" class="slot" data-t="${x}">${fmtTime(x)}</button>`).join('')
          : '<span class="sub" style="color:#B91C1C">No free times on this day — try another date.</span>';
        box.querySelectorAll('.slot').forEach(b => b.addEventListener('click', () => { box.querySelectorAll('.slot').forEach(x => x.classList.remove('on')); b.classList.add('on'); slot = b.dataset.t; }));
      }
      d.q('#pr-date').addEventListener('change', loadSlots);
      d.q('#pr-dentist').addEventListener('change', loadSlots);
    },
    async onConfirm(d) {
      if (!d.val('#pr-date') || !slot) { d.error('Choose a date and one of the free times.'); return false; }
      if (!d.val('#pr-reason')) { d.error('Choose a reason.'); return false; }
      const { error } = await supabase.rpc('patient_request_appointment', {
        p_date: d.val('#pr-date'), p_time: slot, p_reason: d.val('#pr-reason'), p_dentist: d.val('#pr-dentist') || null,
        p_branch: d.val('#pr-branch') || null, p_notes: d.val('#pr-notes') || null, p_reschedule_of: rescheduleOf || null, p_client_token: token,
      });
      if (error) throw error;
      notif('Request sent. The clinic will confirm it.', 'al-s');
      _portalTab = 'requests'; renderPortal();
    },
  });
}

async function portalCancelAppt(id) {
  const a = (portalData.appointments || []).find(x => x.id === id);
  const reason = prompt(`Cancel your appointment on ${fmtDate(a.date)} at ${fmtTime(a.start)}?\nReason (optional):`);
  if (reason === null) return;
  const { error } = await supabase.rpc('patient_cancel_appointment', { p_appointment_id: id, p_reason: reason });
  if (error) return alert(friendlyDbError(error));
  notif('Appointment cancelled.', 'al-s'); renderPortal();
}

async function portalCancelRequest(id) {
  if (!confirm('Withdraw this request?')) return;
  const { error } = await supabase.rpc('patient_cancel_request', { p_request_id: id });
  if (error) return alert(friendlyDbError(error));
  notif('Request withdrawn.', 'al-s'); renderPortal();
}

function openPortalContact() {
  const p = portalData.patient || {};
  openDialog({
    title: '✏️ Update my contact details', confirmText: 'Save',
    body: `<div class="fr c2">
        <div class="fg"><label class="fl">Mobile *</label><input class="fc" id="pc-mobile" maxlength="11" inputmode="numeric" value="${esc(p.mobile || '')}"/></div>
        <div class="fg"><label class="fl">E-mail</label><input class="fc" type="email" id="pc-email" value="${esc(p.email || '')}"/></div></div>
      <div class="fg"><label class="fl">Home address *</label><input class="fc" id="pc-address" value="${esc(p.address || '')}"/></div>
      <div class="sub" style="margin-top:8px">To change your name, birthdate or medical information, please inform the clinic.</div>`,
    async onConfirm(d) {
      const { error } = await supabase.rpc('patient_update_contact', { p_mobile: d.val('#pc-mobile'), p_email: d.val('#pc-email'), p_address: d.val('#pc-address') });
      if (error) throw error;
      notif('Contact details updated.', 'al-s'); renderPortal();
    },
  });
}
