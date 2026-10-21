/* ═══════════════════════════════════════════════════════════════
   roles.js — role-based access in the app (Stage 1)
   The REAL protection is in the database (RLS + role-checked functions,
   sql/03_roles_and_access.sql). This file only shows each role the pages
   and buttons it can actually use, so nobody hits "permission denied".
   ═══════════════════════════════════════════════════════════════ */

let currentProfile = null;
let currentRole = null;          // 'admin' | 'dentist' | 'staff' | 'patient'

/* Which roles may open each page */
const PAGE_ROLES = {
  dashboard: ['admin', 'dentist', 'staff'],
  add: ['admin', 'staff'],
  appointments: ['admin', 'dentist', 'staff'],
  registrations: ['admin', 'staff'],
  patients: ['admin', 'dentist', 'staff'],
  profile: ['admin', 'dentist', 'staff'],
  physical: ['admin', 'staff'],
  treatment: ['admin', 'dentist', 'staff'],
  chart: ['admin', 'dentist'],
  xray: ['admin', 'dentist'],
  reports: ['admin'],
  pdf: ['admin', 'dentist'],
  notifications: ['admin', 'staff'],
  users: ['admin'],
  portal: ['patient'],
};

/* Which roles may do each action (mirrors the database rules) */
const ACTION_ROLES = {
  pay: ['admin', 'staff'],                 // record payments
  correct: ['admin'],                      // refunds, reversals, charge corrections, voids
  audit: ['admin'],
  addTreatment: ['admin', 'dentist'],
  bookAppt: ['admin', 'staff'],            // create / move appointments
  apptStatus: ['admin', 'staff', 'dentist'],
  remind: ['admin', 'staff'],
  editPatient: ['admin', 'staff'],
  settings: ['admin'],
  expenses: ['admin'],
};

function can(action) {
  if (!currentRole) return true;           // roles not loaded / not installed yet → database still decides
  return (ACTION_ROLES[action] || []).includes(currentRole);
}
function canOpen(page) {
  if (!currentRole) return true;
  return (PAGE_ROLES[page] || ['admin']).includes(currentRole);
}

const ROLE_LABEL = { admin: 'Administrator', dentist: 'Dentist', staff: 'Front-desk Staff', patient: 'Patient' };

async function loadMyRole() {
  if (!supabase) return;
  const { data, error } = await supabase.rpc('my_profile');
  if (error) {
    // Function missing = roles migration not installed yet: keep the old "everyone is admin" behaviour
    if (/my_profile|Could not find the function|PGRST202/i.test(error.message || '') || error.code === 'PGRST202') {
      console.warn('[roles] 03_roles_and_access.sql not installed yet — running without roles.');
      return;
    }
    console.warn('[roles]', error.message);
    return;
  }
  currentProfile = data;
  currentRole = data?.role || null;
  if (!data || !data.active) return blockApp(data ? 'Your account has been deactivated. Please contact the clinic administrator.'
                                                  : 'Your account has no profile yet. Please contact the clinic administrator.');
  applyRoleUI();
}

function blockApp(msg) {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="phys-modal-overlay open" style="z-index:10050">
      <div class="phys-modal-box" style="max-width:420px"><div class="phys-modal-header"><h3>🔒 No access</h3></div>
      <div class="phys-modal-body"><p style="font-size:14px;margin-bottom:16px">${esc(msg)}</p>
      <button class="btn btn-p" onclick="doLogout()">Log out</button></div></div></div>`);
}

function applyRoleUI() {
  if (!currentRole) return;
  document.body.classList.add('role-' + currentRole);

  // sidebar items
  document.querySelectorAll('.sidebar .ni').forEach(ni => {
    const m = (ni.getAttribute('onclick') || '').match(/nav\('([a-z]+)'/);
    if (m) ni.style.display = canOpen(m[1]) ? '' : 'none';
  });
  // hide section headings that have no visible items under them
  document.querySelectorAll('.sidebar .ss').forEach(ss => {
    let el = ss.nextElementSibling, any = false;
    while (el && !el.classList.contains('ss')) { if (el.classList.contains('ni') && el.style.display !== 'none') any = true; el = el.nextElementSibling; }
    ss.style.display = any ? '' : 'none';
  });
  // any element marked data-roles="admin,staff" or data-can="pay"
  document.querySelectorAll('[data-roles]').forEach(el => {
    el.style.display = el.dataset.roles.split(',').map(s => s.trim()).includes(currentRole) ? '' : 'none';
  });
  document.querySelectorAll('[data-can]').forEach(el => { el.style.display = can(el.dataset.can) ? '' : 'none'; });

  // top bar: show the role next to the name
  const u = document.getElementById('nav-user-email');
  if (u && !document.getElementById('nav-role')) u.insertAdjacentHTML('afterend', `<span id="nav-role" class="role-pill">${esc(ROLE_LABEL[currentRole] || currentRole)}</span>`);
  if (!can('remind')) { const b = document.getElementById('notif-bell'); if (b) b.style.display = 'none'; }

  // dentists: payment fields on the treatment form are not theirs to fill
  if (!can('pay')) ['tr-pd', 'tr-method', 'tr-ref', 'tr-bl'].forEach(id => { const f = document.getElementById(id)?.closest('.fg'); if (f) f.style.display = 'none'; });

  // land on the right first page
  const active = document.querySelector('.page.active')?.id?.replace('page-', '');
  if (currentRole === 'patient') nav('portal', null);
  else if (active && !canOpen(active)) nav('dashboard', document.querySelector('.ni[onclick*="dashboard"]'));

  if (currentRole === 'patient') (typeof renderPortal === 'function' ? renderPortal : renderPortalPlaceholder)();
  if (currentRole === 'dentist' && typeof renderMySchedule === 'function') renderMySchedule();
  ['renderPxList', 'renderAppointments', 'renderNotifLog'].forEach(fn => { try { if (typeof window[fn] === 'function') window[fn](); } catch (_) {} });
  if (typeof currentTxPatient !== 'undefined' && currentTxPatient && typeof renderTxTable === 'function') renderTxTable(currentTxPatient);
}

/* Guard every navigation, including links inside pages */
(function wrapNav() {
  const original = window.nav;
  if (typeof original !== 'function') return;
  window.nav = function (id, el) {
    if (!canOpen(id)) {
      if (typeof notif === 'function') notif('Your role does not have access to that page.', 'al-i');
      return;
    }
    original(id, el);
    if (id === 'users') initUsersPage();
    if (id === 'registrations' && typeof initRegistrations === 'function') initRegistrations();
  };
})();

/* ═══════════ Users & Roles page (admin) ═══════════ */
let _users = [];

async function initUsersPage() {
  const box = document.getElementById('users-table'); if (!box) return;
  box.innerHTML = '<tr><td colspan="6" class="empty-cell">Loading…</td></tr>';
  const { data, error } = await supabase.from('profiles').select('*').order('role').order('full_name');
  if (error) { box.innerHTML = `<tr><td colspan="6" class="empty-cell">⚠ ${esc(friendlyDbError(error))}</td></tr>`; return; }
  _users = data || [];
  renderUsers();
}

function renderUsers() {
  const q = (document.getElementById('users-search')?.value || '').toLowerCase();
  const rf = document.getElementById('users-role')?.value || '';
  const rows = _users.filter(u => (!rf || u.role === rf) && (!q || (u.email || '').toLowerCase().includes(q) || (u.full_name || '').toLowerCase().includes(q)));
  const pidOf = id => (typeof allPatients !== 'undefined' ? allPatients : []).find(p => p.uuid === id)?.id;
  document.getElementById('users-table').innerHTML = rows.map(u => `
    <tr class="${u.active ? '' : 'tx-voided'}">
      <td><b>${esc(u.full_name || '—')}</b>${u.id === currentProfile?.id ? ' <span class="badge b-a">you</span>' : ''}<div class="sub">${esc(u.email || '')}</div></td>
      <td><span class="badge role-badge role-${esc(u.role)}">${esc(ROLE_LABEL[u.role] || u.role)}</span></td>
      <td>${u.role === 'dentist' ? esc(u.dentist_name || '—') : u.role === 'patient' ? (u.patient_id ? esc(pidOf(u.patient_id) || 'linked') : '<span class="sub">not linked</span>') : '—'}</td>
      <td>${u.active ? '<span class="badge b-d">Active</span>' : '<span class="badge" style="background:#FCEBEB;color:#B91C1C">Disabled</span>'}</td>
      <td class="sub">${fmtDate(String(u.created_at).slice(0, 10))}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-s btn-sm" onclick="openRoleDialog('${u.id}')">✏️ Role</button>
        <button class="btn btn-gray btn-sm" onclick="openResetPassword('${u.id}')">🔑</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty-cell">No users.</td></tr>';
  const c = r => _users.filter(u => u.role === r && u.active).length;
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('users-stat-admin', c('admin')); set('users-stat-dentist', c('dentist')); set('users-stat-staff', c('staff')); set('users-stat-patient', c('patient'));
}

function roleFieldsHtml(u) {
  const dentists = activeDentists();
  return `
    <div class="fr c2">
      <div class="fg"><label class="fl">Role *</label>
        <select class="fc" id="ru-role">${['admin', 'dentist', 'staff', 'patient'].map(r => `<option value="${r}" ${u?.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select></div>
      <div class="fg" id="ru-dentist-wrap"><label class="fl">Dentist *</label>
        <select class="fc" id="ru-dentist">${optionsHtml(dentists.concat(u?.dentist_name && !dentists.includes(u.dentist_name) ? [u.dentist_name] : []), u?.dentist_name || '', '— choose dentist —')}</select>
        <div class="sub">Linked by ID: this login sees that dentist's appointments even if the name was typed differently. Add new dentists in Notifications &amp; Settings.</div></div>
      <div class="fg" id="ru-patient-wrap"><label class="fl">Link to patient ID</label>
        <input class="fc" id="ru-patient" placeholder="#DMY-001"/>
        <div class="sub">Optional. Patients are linked automatically when their verified e-mail matches the record.</div></div>
    </div>
    <div class="role-help" id="ru-help"></div>`;
}
const ROLE_HELP = {
  admin: 'Full access: users and roles, settings, all reports, refunds and corrections.',
  dentist: 'Own schedule and assigned patients: dental charts, treatment entries, images. No payments or reports.',
  staff: 'Front desk: register patients, book/reschedule appointments, record payments, follow up failed messages.',
  patient: 'Patient portal only: their own record, appointments and bills.',
};
function wireRoleFields(d) {
  const upd = () => {
    const r = d.val('#ru-role');
    d.q('#ru-dentist-wrap').style.display = r === 'dentist' ? '' : 'none';
    d.q('#ru-patient-wrap').style.display = r === 'patient' ? '' : 'none';
    d.q('#ru-help').textContent = ROLE_HELP[r];
  };
  d.q('#ru-role').addEventListener('change', upd); upd();
}

function openRoleDialog(userId) {
  const u = _users.find(x => x.id === userId); if (!u) return;
  openDialog({
    title: `✏️ ${esc(u.full_name || u.email)}`, confirmText: '💾 Save',
    body: `<div class="fg" style="margin-bottom:12px"><label class="fl">Display name</label><input class="fc" id="ru-name" value="${esc(u.full_name || '')}"/></div>
      ${roleFieldsHtml(u)}
      <label class="fck" style="margin-top:12px"><input type="checkbox" id="ru-active" ${u.active ? 'checked' : ''}/> Account active (untick to block this login)</label>`,
    onOpen: wireRoleFields,
    async onConfirm(d) {
      const { error } = await supabase.rpc('set_user_role', {
        p_user_id: u.id, p_role: d.val('#ru-role'), p_dentist_name: d.val('#ru-dentist') || null,
        p_active: d.q('#ru-active').checked, p_full_name: d.val('#ru-name') || null, p_patient_pid: d.val('#ru-patient') || null,
      });
      if (error) throw error;
      notif('Saved. The user sees the change on their next page load.', 'al-s');
      initUsersPage();
    },
  });
}

function openAddUserDialog() {
  openDialog({
    title: '➕ Add Clinic User', confirmText: 'Create Login',
    body: `<div class="fr c2">
        <div class="fg"><label class="fl">Full name *</label><input class="fc" id="ru-name" placeholder="e.g. Dr. Ana Lim"/></div>
        <div class="fg"><label class="fl">E-mail (login) *</label><input class="fc" type="email" id="ru-email"/></div></div>
      <div class="fg" style="margin-bottom:12px"><label class="fl">Temporary password * <span class="sub">(min. 8 characters — give it to the user; they can change it under their avatar)</span></label>
        <div style="display:flex;gap:6px"><input class="fc" id="ru-pass" style="flex:1"/><button type="button" class="btn btn-gray btn-sm" id="ru-gen">Generate</button></div></div>
      ${roleFieldsHtml({ role: 'staff' })}`,
    onOpen(d) {
      wireRoleFields(d);
      const gen = () => { const a = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; d.q('#ru-pass').value = Array.from(crypto.getRandomValues(new Uint32Array(12)), n => a[n % a.length]).join(''); };
      d.q('#ru-gen').addEventListener('click', gen); gen();
    },
    async onConfirm(d) {
      const body = { action: 'create', full_name: d.val('#ru-name'), email: d.val('#ru-email'), password: d.val('#ru-pass'),
        role: d.val('#ru-role'), dentist_name: d.val('#ru-dentist') || null, patient_pid: d.val('#ru-patient') || null };
      if (!body.full_name) { d.error('Enter the full name.'); return false; }
      const { data, error } = await supabase.functions.invoke('admin-users', { body });
      if (error) {
        let m = error.message; try { const j = await error.context?.json?.(); if (j?.error) m = j.error; } catch (_) {}
        if (/non-2xx|Failed to send/i.test(m)) m += ' — is the “admin-users” Edge Function deployed with Verify JWT off? (SETUP.md Stage 1)';
        throw new Error(m);
      }
      notif(`Login created for ${body.email}. Temporary password: ${body.password}`, 'al-s');
      alert(`Login created.\n\nE-mail: ${body.email}\nTemporary password: ${body.password}\n\nGive these to the user and ask them to change the password after logging in.`);
      initUsersPage();
    },
  });
}

function openResetPassword(userId) {
  const u = _users.find(x => x.id === userId); if (!u) return;
  openDialog({
    title: `🔑 Reset password — ${esc(u.email)}`, confirmText: 'Set Password',
    body: `<div class="fg"><label class="fl">New temporary password (min. 8)</label><input class="fc" id="rp-pass"/></div>`,
    async onConfirm(d) {
      const pw = d.val('#rp-pass');
      if (pw.length < 8) { d.error('At least 8 characters.'); return false; }
      const { error } = await supabase.functions.invoke('admin-users', { body: { action: 'reset_password', user_id: u.id, password: pw } });
      if (error) { let m = error.message; try { const j = await error.context?.json?.(); if (j?.error) m = j.error; } catch (_) {} throw new Error(m); }
      notif('Password changed.', 'al-s');
    },
  });
}

/* Load the role once the session is ready (auth.js reveals the page first) */
setTimeout(loadMyRole, 400);

/* Old placeholder, kept only if portal.js is missing */
function renderPortalPlaceholder() {
  const box = document.getElementById('portal-body'); if (!box || !currentProfile) return;
  box.innerHTML = currentProfile.patient_id
    ? `<p style="font-size:14px">Welcome! Your login is linked to patient record <b>${esc(currentProfile.patient_pid || '')}</b>.</p>
       <p class="sub" style="margin-top:8px">Appointment requests, your appointment history and bills will appear here.</p>`
    : `<p style="font-size:14px">Your account is not linked to a patient record yet.</p>
       <p class="sub" style="margin-top:8px">Make sure you verified your e-mail, and that it is the same e-mail the clinic has on file. You can also ask the front desk to link it for you.</p>`;
}
