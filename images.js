/* images.js — X-ray / photo upload with search-first + Save + clear workflow */

const imgStore = {};           // { patientName: [ {src,type,note,name,date} ] }
let _currentXrayPatient = '';   // The patient whose gallery is currently displayed
let _imageQueue = [];           // Images picked but NOT yet saved

/* ═══ Camera capture trigger ═══ */
function triggerCameraCapture() {
  if (!_currentXrayPatient) {
    const errEl = document.getElementById('err-xr-px');
    if (errEl) errEl.classList.add('show');
    notif('⚠ Please search and select a patient first.', 'al-i');
    return;
  }
  document.getElementById('xr-camera').click();
}

/* ═══ Search-first autocomplete ═══ */
function xrayPatientSearch(q) {
  const dropdown = document.getElementById('xr-autocomplete');
  const errEl    = document.getElementById('err-xr-px');
  if (errEl) errEl.classList.remove('show');

  if (!dropdown) return;
  dropdown.innerHTML = '';

  // If user edits the name away from the selected patient, don't silently keep it
  _currentXrayPatient = '';
  loadGallery();

  if (!q) { dropdown.style.display = 'none'; return; }
  const matches = (typeof allPatients !== 'undefined' ? allPatients : [])
    .filter(p => p.name.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 8);
  if (!matches.length) { dropdown.style.display = 'none'; return; }

  matches.forEach(p => {
    const item = document.createElement('div');
    item.className = 'ac-item';
    item.innerHTML = '<strong>' + p.name + '</strong> <span style="color:var(--mu);font-size:11px">' + p.id + ' · Age ' + p.age + ' · ' + (p.sex || '—') + '</span>';
    item.onclick = () => {
      const inp = document.getElementById('xr-px');
      if (inp) inp.value = p.name;
      _currentXrayPatient = p.name;
      dropdown.style.display = 'none';
      loadGallery();
      notif('✓ Selected: ' + p.name, 'al-s');
    };
    dropdown.appendChild(item);
  });
  dropdown.style.display = 'block';
}

/* ═══ Queue images (preview-only, NOT yet persisted) ═══ */
function queueImages(e) {
  if (!_currentXrayPatient) {
    const errEl = document.getElementById('err-xr-px');
    if (errEl) errEl.classList.add('show');
    notif('⚠ Please search and select a patient first.', 'al-i');
    e.target.value = '';
    return;
  }
  const type = document.getElementById('xr-type').value;
  const note = document.getElementById('xr-note').value;
  const files = Array.from(e.target.files);
  if (!files.length) return;

  let loaded = 0;
  files.forEach(f => {
    const r = new FileReader();
    r.onload = ev => {
      _imageQueue.push({
        src: ev.target.result,
        type,
        note,
        name: f.name,
        date: new Date().toLocaleDateString('en-PH')
      });
      loaded++;
      if (loaded === files.length) {
        notif('📥 ' + files.length + ' image(s) queued — click Save to confirm.', 'al-i');
        renderGallery();  // show queued + existing
      }
    };
    r.readAsDataURL(f);
  });
  e.target.value = '';
}

/* ═══ Save queued images → store + DB ═══ */
async function saveImages() {
  if (!_currentXrayPatient) {
    notif('⚠ Please search and select a patient first.', 'al-i');
    return;
  }
  if (!_imageQueue.length) {
    notif('No new images to save. Click the upload area to add images first.', 'al-i');
    return;
  }

  const px = _currentXrayPatient;
  if (!imgStore[px]) imgStore[px] = [];
  const toSave = _imageQueue.slice();
  _imageQueue = [];

  // Persist locally
  toSave.forEach(img => imgStore[px].push(img));

  // Persist to Supabase (best-effort — stores base64 in a patient_images table)
  if (supabase) {
    try {
      const rows = toSave.map(img => ({
        patient_name: px,
        src: img.src,
        type: img.type,
        note: img.note || '',
        filename: img.name,
        uploaded_at: new Date().toISOString()
      }));
      const { error } = await supabase.from('patient_images').insert(rows);
      if (error) {
        console.warn('[Supabase] image insert:', error.message);
        notif('💾 Saved locally (DB sync failed: ' + error.message + ')', 'al-i');
      } else {
        notif('✅ ' + toSave.length + ' image(s) saved to ' + px + '!', 'al-s');
      }
    } catch (e) {
      console.warn('[Supabase] image save skipped:', e.message);
      notif('💾 Saved locally (DB unavailable).', 'al-i');
    }
  } else {
    notif('✅ ' + toSave.length + ' image(s) saved for ' + px + '.', 'al-s');
  }

  clearImageForm();
  // After saving, keep the gallery visible for THAT patient
  const inp = document.getElementById('xr-px');
  if (inp) inp.value = px;
  _currentXrayPatient = px;
  loadGallery();
}

/* ═══ Clear form: inputs + queued images + gallery view ═══ */
function clearImageForm() {
  const ids = ['xr-px','xr-note'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const typeSel = document.getElementById('xr-type'); if (typeSel) typeSel.selectedIndex = 0;
  const fileInp = document.getElementById('xr-inp'); if (fileInp) fileInp.value = '';
  _imageQueue = [];
  _currentXrayPatient = '';
  const errEl = document.getElementById('err-xr-px');
  if (errEl) errEl.classList.remove('show');
  loadGallery();
}

/* ═══ Gallery rendering ═══ */
function renderGallery() {
  const gallery = document.getElementById('img-gallery');
  const empty   = document.getElementById('img-empty');
  const cnt     = document.getElementById('img-cnt');
  if (!gallery) return;
  gallery.innerHTML = '';

  const saved = (_currentXrayPatient && imgStore[_currentXrayPatient]) ? imgStore[_currentXrayPatient] : [];
  const queued = _imageQueue;

  const total = saved.length + queued.length;
  if (cnt) cnt.textContent = `(${total} image${total !== 1 ? 's' : ''}${queued.length ? ' — ' + queued.length + ' pending save' : ''})`;
  if (empty) empty.style.display = total ? 'none' : 'block';

  // Render queued first (with "PENDING" label)
  queued.forEach((img, i) => {
    const card = document.createElement('div');
    card.className = 'img-card';
    card.style.outline = '2px dashed var(--o)';
    card.innerHTML = `
      <img src="${img.src}" alt="${img.type}" onclick="openLb('${img.src.replace(/'/g,"\\'")}','[PENDING] ${img.type} — ${img.note || img.date}')"/>
      <button class="img-card-del" onclick="removeQueued(${i})">✕</button>
      <div class="img-card-label" style="background:var(--o)">
        ⏳ PENDING · ${img.type}<br>
        <span style="opacity:.8">${img.note || img.date}</span>
      </div>`;
    gallery.appendChild(card);
  });

  // Render saved
  saved.forEach((img, i) => {
    const card = document.createElement('div');
    card.className = 'img-card';
    card.innerHTML = `
      <img src="${img.src}" alt="${img.type}" onclick="openLb('${img.src.replace(/'/g,"\\'")}','${img.type} — ${img.note || img.date}')"/>
      <button class="img-card-del" onclick="delImg('${_currentXrayPatient}',${i})">✕</button>
      <div class="img-card-label">
        ${img.type}<br>
        <span style="opacity:.7">${img.note || img.date}</span>
      </div>`;
    gallery.appendChild(card);
  });
}

function loadGallery() { renderGallery(); }

function removeQueued(i) {
  _imageQueue.splice(i, 1);
  renderGallery();
  notif('Removed from queue.', 'al-i');
}

async function delImg(px, i) {
  if (!confirm('Remove this image?')) return;
  const img = imgStore[px][i];
  imgStore[px].splice(i, 1);
  renderGallery();
  // Attempt DB deletion (best-effort match by filename + patient)
  if (supabase && img) {
    try {
      await supabase.from('patient_images').delete().eq('patient_name', px).eq('filename', img.name);
    } catch (e) { /* ignore */ }
  }
}

function openLb(src, cap) {
  document.getElementById('lb-img').src = src;
  document.getElementById('lb-cap').textContent = cap;
  document.getElementById('lightbox').classList.add('open');
}

function closeLb() {
  document.getElementById('lightbox').classList.remove('open');
}

/* ═══ Bootstrap: load images from Supabase ═══ */
async function loadImagesFromSupabase() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.from('patient_images').select('*');
    if (error || !data) return;
    data.forEach(row => {
      const key = row.patient_name;
      if (!imgStore[key]) imgStore[key] = [];
      imgStore[key].push({
        src: row.src,
        type: row.type || 'Image',
        note: row.note || '',
        name: row.filename || 'image',
        date: row.uploaded_at ? new Date(row.uploaded_at).toLocaleDateString('en-PH') : ''
      });
    });
  } catch (e) { /* ignore */ }
}

// Load DB images after a short delay (so Supabase client is ready)
setTimeout(loadImagesFromSupabase, 600);
