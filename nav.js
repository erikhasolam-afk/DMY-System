/* ═══════════════════════════════════════════
   nav.js — Sidebar navigation controller
   ═══════════════════════════════════════════ */

function nav(id, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  if (id === 'reports')   setTimeout(initReports, 80);
  if (id === 'dashboard') setTimeout(initDash, 80);
  if (id === 'treatment' && typeof initTreatmentDefaults === 'function') {
    setTimeout(initTreatmentDefaults, 30);
  }
  if (id === 'appointments'  && typeof initAppointments === 'function')       setTimeout(initAppointments, 30);
  if (id === 'notifications' && typeof initNotificationCenter === 'function') setTimeout(initNotificationCenter, 30);
  // close the mobile sidebar after choosing a page
  const sb = document.getElementById('sidebar');
  if (sb && sb.classList.contains('open') && typeof toggleSidebar === 'function') toggleSidebar();
  const main = document.querySelector('.main'); if (main) main.scrollTop = 0;
}
