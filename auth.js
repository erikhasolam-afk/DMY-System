/* auth.js — Dynamic user info, profile editing, logout */
let currentUser = null;
let clinicLogo  = localStorage.getItem('clinic-logo') || null;

/* Hide page content until auth confirmed (prevents flash of dashboard) */
document.documentElement.style.visibility = 'hidden';

(async () => {
  if (!supabase) { window.location.href = 'login.html'; return; }
  const { data } = await supabase.auth.getSession();
  if (!data.session) { window.location.href = 'login.html'; return; }

  currentUser = data.session.user;
  document.documentElement.style.visibility = '';  // reveal page
  applyUserToUI();

  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') window.location.href = 'login.html';
  });
})();

function getDisplayName(user) {
  if (!user) return 'Doctor';
  const meta = user.user_metadata || {};
  return meta.full_name || meta.name ||
    (user.email || '').split('@')[0].replace(/[._]/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
}

function applyUserToUI() {
  if (!currentUser) return;
  const name = getDisplayName(currentUser);
  const initials = name.split(' ').map(w=>w[0]?.toUpperCase()||'').join('').slice(0,2)||'DR';
  const hour = new Date().getHours();
  const greeting = hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';

  const el = id => document.getElementById(id);
  if (el('nav-user-email')) el('nav-user-email').textContent = name;
  if (el('nav-avatar'))     el('nav-avatar').textContent     = initials;
  if (el('dash-greeting'))  el('dash-greeting').textContent  = greeting+', '+name+' 👋';

  // Apply saved logo
  if (clinicLogo) applyLogo(clinicLogo);
}

function applyLogo(src) {
  const logoWrap = document.getElementById('logo-wrap');
  if (!logoWrap) return;
  logoWrap.innerHTML = '<img src="'+src+'" style="height:36px;border-radius:6px;object-fit:contain;" alt="Logo"/>';
}

/* ── Profile Modal ── */
function openProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (!modal) return;
  if (currentUser) {
    const meta = currentUser.user_metadata || {};
    const el = id => document.getElementById(id);
    if (el('prof-name'))  el('prof-name').value  = meta.full_name || getDisplayName(currentUser);
    if (el('prof-email')) el('prof-email').value  = currentUser.email || '';
    if (el('prof-title')) el('prof-title').value  = meta.title || '';
  }
  modal.classList.add('open');
}
function closeProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (modal) modal.classList.remove('open');
}

async function saveProfile() {
  if (!supabase || !currentUser) return;
  const name  = document.getElementById('prof-name').value.trim();
  const title = document.getElementById('prof-title').value.trim();
  const pwd   = document.getElementById('prof-pwd').value;
  const btn   = document.getElementById('prof-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    const updates = { data: { full_name: name, title } };
    if (pwd && pwd.length >= 6) updates.password = pwd;
    const { error } = await supabase.auth.updateUser(updates);
    if (error) throw error;
    // keep the name on receipts / audit trail in sync (ignored if roles are not installed yet)
    try { await supabase.rpc('update_my_name', { p_full_name: name }); } catch (_) {}
    currentUser.user_metadata = { ...currentUser.user_metadata, full_name: name, title };
    applyUserToUI();
    notif('Profile updated!', 'al-s');
    closeProfileModal();
  } catch(e) {
    notif('Error: '+e.message, 'al-i');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Changes';
  }
}

function uploadLogo(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    clinicLogo = ev.target.result;
    localStorage.setItem('clinic-logo', clinicLogo);
    applyLogo(clinicLogo);
    notif('Clinic logo updated!', 'al-s');
  };
  reader.readAsDataURL(file);
}

async function doLogout() {
  if (supabase) await supabase.auth.signOut();
  window.location.href = 'login.html';
}
