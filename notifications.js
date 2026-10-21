/* ═══════════════════════════════════════════════════════════════
   notifications.js — Notification Center (in-system)
   • Shows every SMS / e-mail the system queued, with status, provider
     delivery result, attempts and error messages
   • Retry failed/skipped messages, "send queued now"
   • Notification settings, branches and dentists
   Sending itself happens ONLY in the Supabase Edge Function, where the
   Semaphore / e-mail keys live as secrets. No provider key is in this file.
   ═══════════════════════════════════════════════════════════════ */

let notifStore = [];
const _notifFilters = { status: '', type: '', channel: '', search: '' };
const NOTIF_TYPE_LABEL = { confirmation: 'Confirmation', reminder: 'Reminder', reschedule: 'Reschedule', cancellation: 'Cancellation', manual_reminder: 'Manual reminder',
  registration_received: 'Registration received', request_declined: 'Request declined' };
const NOTIF_STATUS_STYLE = {
  pending: 'background:#E8F6F7;color:#1F6E74', sending: 'background:#E8F6F7;color:#1F6E74',
  sent: 'background:#EAF3DE;color:#3B6D11', failed: 'background:#FCEBEB;color:#B91C1C', skipped: 'background:#F1EFE8;color:#6B7E85',
};

async function loadNotifications() {
  if (!supabase) return;
  const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) { console.warn('[Notif] load:', error.message); return; }
  notifStore = data || [];
  updateNotifBell();
  if (document.getElementById('page-notifications')?.classList.contains('active')) renderNotifLog();
}
setTimeout(loadNotifications, 1300);
setInterval(() => { if (!document.hidden) loadNotifications(); }, 60000);

/* A message needs staff attention when it failed, or was skipped for a reason staff can fix
   (missing contact details / channel turned off) — not when the visit was cancelled or moved. */
function needsAttention(n) {
  return n.status === 'failed' || (n.status === 'skipped' && /no valid|channel disabled/i.test(n.last_error || ''));
}

/* Bell in the top bar: messages that need attention in the last 7 days */
function updateNotifBell() {
  const since = Date.now() - 7 * 864e5;
  const n = notifStore.filter(x => needsAttention(x) && new Date(x.created_at).getTime() > since).length;
  const b = document.getElementById('notif-bell-count');
  if (b) { b.textContent = n; b.style.display = n ? 'flex' : 'none'; }
  const bell = document.getElementById('notif-bell');
  if (bell) bell.title = n ? `${n} message(s) failed or skipped in the last 7 days` : 'Notifications';
}

/* Ask the Edge Function to process the queue now (it also runs every minute via cron) */
async function kickNotificationSender(wait) {
  if (!supabase?.functions) return null;
  const p = supabase.functions.invoke('send-notifications', { body: { action: 'process' } })
    .then(async ({ data, error }) => {
      setTimeout(loadNotifications, 500);
      if (error) {
        let detail = error.message;
        try { const j = await error.context?.json?.(); if (j?.error) detail = j.error; } catch (_) {}
        return { error: detail };
      }
      return data;
    })
    .catch(e => ({ error: e.message }));
  return wait ? p : null;
}

async function sendQueuedNow(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  const r = await kickNotificationSender(true);
  if (btn) { btn.disabled = false; btn.textContent = '📤 Send queued now'; }
  if (!r || r.error) notif('Sender not reachable: ' + (r?.error || 'Edge Function not deployed') + '. See SETUP.md.', 'al-i');
  else notif(`Processed ${r.claimed}: ${r.sent} sent, ${r.retrying} will retry, ${r.failed} failed.`, r.failed ? 'al-i' : 'al-s');
}

async function retryNotification(id) {
  const { data, error } = await supabase.rpc('retry_notification', { p_notification_id: id });
  if (error) return alert(friendlyDbError(error));
  if (data.status === 'skipped') notif(data.last_error, 'al-i');
  else { notif('Message re-queued.', 'al-s'); await kickNotificationSender(true); }
  loadNotifications();
}

function notifRowsHtml(rows, withPatient = true) {
  if (!rows.length) return `<tr><td colspan="${withPatient ? 9 : 6}" class="empty-cell">No messages.</td></tr>`;
  return rows.map(n => {
    const detail = n.status === 'sent'
      ? `${esc(n.provider || '')}${n.delivery_status ? ' · delivery: <b>' + esc(n.delivery_status) + '</b>' : ''}${n.sent_at ? '<div class="sub">' + fmtDateTime(n.sent_at) + '</div>' : ''}`
      : esc(n.last_error || (n.status === 'pending' && n.attempts ? `retry #${n.attempts} at ${fmtDateTime(n.next_attempt_at)}` : ''));
    return `<tr>
      <td style="white-space:nowrap">${fmtDateTime(n.created_at)}</td>
      ${withPatient ? `<td><a class="link" onclick="openPatientProfile('${jsArg(n.patient_name)}')">${esc(n.patient_name || '—')}</a></td>` : ''}
      <td>${esc(NOTIF_TYPE_LABEL[n.type] || n.type)}</td>
      <td>${n.channel === 'sms' ? '📱 SMS' : '✉ E-mail'}</td>
      <td style="font-size:12px">${esc(n.recipient || '—')}</td>
      <td><span class="badge" style="${NOTIF_STATUS_STYLE[n.status] || ''}">${esc(n.status)}</span>${n.attempts > 1 ? `<div class="sub">${n.attempts} attempts</div>` : ''}</td>
      <td style="font-size:12px;max-width:260px">${detail}</td>
      ${withPatient ? `<td style="font-size:11px;max-width:220px;color:var(--mu)" title="${esc(n.message)}">${esc(n.message.slice(0, 70))}${n.message.length > 70 ? '…' : ''}</td>
      <td>${needsAttention(n) && can('remind') ? `<button class="btn btn-o btn-sm" onclick="retryNotification('${n.id}')">↻ Retry</button>` : ''}</td>` : ''}
    </tr>`;
  }).join('');
}

function notifFilterChange() {
  _notifFilters.status  = document.getElementById('nf-status')?.value || '';
  _notifFilters.type    = document.getElementById('nf-type')?.value || '';
  _notifFilters.channel = document.getElementById('nf-channel')?.value || '';
  _notifFilters.search  = (document.getElementById('nf-search')?.value || '').trim().toLowerCase();
  renderNotifLog();
}

function renderNotifLog() {
  const f = _notifFilters;
  const rows = notifStore.filter(n =>
    (!f.status || n.status === f.status) && (!f.type || n.type === f.type) && (!f.channel || n.channel === f.channel) &&
    (!f.search || (n.patient_name || '').toLowerCase().includes(f.search) || (n.recipient || '').toLowerCase().includes(f.search)));
  const body = document.getElementById('notif-log'); if (body) body.innerHTML = notifRowsHtml(rows, true);
  const c = s => notifStore.filter(n => n.status === s).length;
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('nf-stat-sent', c('sent')); set('nf-stat-pending', c('pending') + c('sending'));
  set('nf-stat-failed', c('failed')); set('nf-stat-skipped', c('skipped'));
}

/* ═══ Provider status (asks the Edge Function — never returns keys) ═══ */
async function checkProviderStatus() {
  const box = document.getElementById('notif-provider-status'); if (!box) return;
  box.innerHTML = '<span class="sub">Checking…</span>';
  try {
    const { data, error } = await supabase.functions.invoke('send-notifications', { body: { action: 'status' } });
    if (error) throw error;
    const pill = (ok, label, extra) => `<div class="prov ${ok ? 'ok' : 'bad'}"><b>${ok ? '✔' : '✖'} ${label}</b><span>${ok ? 'Configured' : 'Not configured'}${extra ? ' · ' + esc(extra) : ''}</span></div>`;
    box.innerHTML = pill(data.sms.configured, 'SMS — Semaphore', data.sms.sender_name ? 'sender ' + data.sms.sender_name : 'default sender')
      + pill(data.email.configured, 'E-mail — Resend', data.email.from || '')
      + pill(data.cron_secret_configured, 'Scheduler secret', '')
      + ((!data.sms.configured || !data.email.configured) ? `<div class="sub" style="width:100%">Messages for a channel that is not configured are marked <b>failed</b> (never shown as sent). Set the secrets as described in SETUP.md, then press Retry.</div>` : '');
  } catch (e) {
    const d = await diagnoseFunctionError(e);
    box.innerHTML = `<div class="prov bad" style="max-width:640px"><b>✖ ${esc(d.title)}</b><span>${esc(d.fix)}</span>
        <span style="opacity:.75;margin-top:4px">Details: ${esc(d.detail)}</span></div>
      <div class="sub" style="width:100%">Until this works, messages stay queued as <b>pending</b> — nothing is reported as sent.</div>`;
  }
}

/* Turn a functions.invoke() error into a specific cause + fix */
async function diagnoseFunctionError(e) {
  const name = e?.name || '';
  const res = e?.context;                       // Response object for HTTP errors
  const status = res?.status;
  let body = '';
  try { body = res ? await res.clone().text() : ''; } catch (_) {}
  const detail = (status ? 'HTTP ' + status + ' ' : '') + (body || e?.message || String(e)).slice(0, 200);

  if (location.protocol === 'file:')
    return { title: 'App opened as a file', fix: 'Open the app through http://localhost (Live Server / http-server), not by double-clicking index.html.', detail };
  if (name === 'FunctionsFetchError' || /Failed to send a request|Failed to fetch/i.test(e?.message || ''))
    return { title: 'Function not found or not deployed', fix: 'In Supabase → Edge Functions, check there is a function named exactly “send-notifications” and that its deploy finished. (A missing function shows up in the browser as a blocked request.)', detail };
  if (status === 404)
    return { title: 'Function not found', fix: 'No function named exactly “send-notifications” is deployed in this project. Check the name (lowercase, with the hyphen) and the project.', detail };
  if (status === 401 || status === 403) {
    if (/Unauthorized/.test(body) && !/Invalid JWT|Missing authorization/i.test(body))
      return { title: 'Function rejected your login', fix: 'Log out of the app and log in again, then click Check.', detail };
    return { title: 'Verify JWT is still ON', fix: 'Supabase → Edge Functions → send-notifications → Details/Settings: turn “Verify JWT” / “Enforce JWT verification” OFF, save, then click Check again.', detail };
  }
  if (status === 500 || status === 502 || status === 503 || /BOOT_ERROR|WORKER_ERROR/i.test(body))
    return { title: 'Function crashed while starting', fix: 'Open Supabase → Edge Functions → send-notifications → Logs and look at the newest error. Usually the code was not pasted completely — copy the whole index.ts again and redeploy.', detail };
  return { title: 'Edge Function error', fix: 'See the details below and the function Logs in Supabase.', detail };
}

/* ═══ Settings ═══ */
function renderNotifSettings() {
  const s = refData.settings; if (!s) return;
  const set = (id, v) => { const e = document.getElementById(id); if (!e) return; if (e.type === 'checkbox') e.checked = !!v; else e.value = v ?? ''; };
  set('ns-clinic', s.clinic_name); set('ns-phone', s.clinic_phone); set('ns-address', s.clinic_address);
  set('ns-sms', s.sms_enabled); set('ns-email', s.email_enabled); set('ns-hours', s.reminder_hours_before);
  set('ns-create', s.notify_on_create); set('ns-resched', s.notify_on_reschedule); set('ns-cancel', s.notify_on_cancel);
  set('ns-dentall', s.dentists_see_all_patients ?? true); set('ns-cancelh', s.patient_cancel_hours ?? 24);
  set('ns-public', s.public_booking_enabled ?? true); set('ns-open', String(s.open_time || '09:00').slice(0, 5));
  set('ns-close', String(s.close_time || '17:00').slice(0, 5)); set('ns-slot', s.slot_minutes || 30);
  const box = document.getElementById('ns-closed');
  if (box) box.innerHTML = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) =>
    `<label class="fck"><input type="checkbox" value="${i}" ${(s.closed_weekdays || [0]).includes(i) ? 'checked' : ''}/>${d}</label>`).join('');
}
async function saveNotifSettings(btn) {
  const g = id => document.getElementById(id);
  const hours = parseInt(g('ns-hours').value, 10);
  if (!(hours >= 1 && hours <= 168)) return alert('Reminder time must be between 1 and 168 hours.');
  const patch = {
    clinic_name: g('ns-clinic').value.trim() || 'DMY Dental Clinic', clinic_phone: g('ns-phone').value.trim() || null,
    clinic_address: g('ns-address').value.trim() || null, sms_enabled: g('ns-sms').checked, email_enabled: g('ns-email').checked,
    reminder_hours_before: hours, notify_on_create: g('ns-create').checked, notify_on_reschedule: g('ns-resched').checked,
    notify_on_cancel: g('ns-cancel').checked, updated_at: new Date().toISOString(),
  };
  if (g('ns-open')) {   // clinic hours (needs sql/04_public_registration.sql)
    if (!g('ns-open').value || !g('ns-close').value || g('ns-close').value <= g('ns-open').value) return alert('Closing time must be after opening time.');
    Object.assign(patch, { public_booking_enabled: g('ns-public').checked, open_time: g('ns-open').value, close_time: g('ns-close').value,
      slot_minutes: parseInt(g('ns-slot').value, 10) || 30,
      closed_weekdays: [...document.querySelectorAll('#ns-closed input:checked')].map(c => +c.value) });
  }
  if (g('ns-dentall') && refData.settings && 'dentists_see_all_patients' in refData.settings) {   // needs sql/05
    Object.assign(patch, { dentists_see_all_patients: g('ns-dentall').checked,
      patient_cancel_hours: Math.max(0, parseInt(g('ns-cancelh').value, 10) || 0) });
  }
  btn.disabled = true;
  const { data, error } = await supabase.from('clinic_settings').update(patch).eq('id', 1).select().single();
  btn.disabled = false;
  if (error) return alert(friendlyDbError(error));
  refData.settings = data;
  notif('Notification settings saved.', 'al-s');
}

/* ═══ Branches & dentists ═══ */
function renderRefLists() {
  const row = (kind, r) => `<div class="ref-row ${r.active ? '' : 'inactive'}"><span>${esc(r.name)}${kind === 'dentists' && r.branch ? ' <span class="sub">· ' + esc(r.branch) + '</span>' : ''}</span>
    <button class="btn btn-sm btn-gray" onclick="toggleRef('${kind}','${r.id}',${!r.active})">${r.active ? 'Deactivate' : 'Activate'}</button></div>`;
  const b = document.getElementById('ref-branches'); if (b) b.innerHTML = refData.branches.map(r => row('branches', r)).join('') || '<div class="sub">None yet.</div>';
  const d = document.getElementById('ref-dentists'); if (d) d.innerHTML = refData.dentists.map(r => row('dentists', r)).join('') || '<div class="sub">None yet.</div>';
}
async function addRef(kind) {
  const inp = document.getElementById(kind === 'branches' ? 'ref-new-branch' : 'ref-new-dentist');
  const name = inp.value.trim(); if (!name) return;
  const { error } = await supabase.from(kind).insert([{ name }]);
  if (error) return alert(friendlyDbError(error));
  inp.value = '';
  await loadRefData(); renderRefLists();
}
async function toggleRef(kind, id, active) {
  const { error } = await supabase.from(kind).update({ active }).eq('id', id);
  if (error) return alert(friendlyDbError(error));
  await loadRefData(); renderRefLists();
}

async function initNotificationCenter() {
  await loadRefData();
  renderNotifSettings();
  renderRefLists();
  renderNotifLog();
  loadNotifications();
  checkProviderStatus();
}
