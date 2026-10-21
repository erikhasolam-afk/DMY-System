/* ═══════════════════════════════════════════
   notif.js — Toast notification helper
   ═══════════════════════════════════════════ */

function notif(msg, cls) {
  const el = document.createElement('div');
  el.className = 'alert ' + cls;
  el.style.cssText = [
    'position:fixed',
    'top:68px',
    'right:18px',
    'z-index:9998',
    'max-width:280px',
    'box-shadow:0 4px 16px rgba(0,0,0,.12)',
    'animation:fadeIn .2s',
    'font-size:12px'
  ].join(';');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}
