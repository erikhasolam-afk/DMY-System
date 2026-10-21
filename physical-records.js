/* ═══════════════════════════════════════════
   physical-records.js
   Upload scanned/physical patient records,
   attach them to patients, view from list.
   Supports: click, drag-and-drop, camera capture.
   ═══════════════════════════════════════════ */

// Store: { patientKey: [ {src, name, date, note, pages:[]} ] }
const physStore = {};
let _physQueue = []; // pages staged but not yet saved
let _physSelectedPatient = ''; // the patient name picked from autocomplete (or typed)

/* ═══ Live camera state ═══ */
let _physCamStream   = null;  // active MediaStream
let _physCamMode     = false; // true when live camera panel is open

/* ═══ Patient autocomplete for the Physical Records page ═══
   Pulls from the global allPatients array (populated by patients.js).
   Selecting a match autofills age/sex and updates the records filter. */
function physPatientSearch(q) {
  const dropdown = document.getElementById('ph-autocomplete');
  if (!dropdown) return;
  const query = (q || '').trim();
  _physSelectedPatient = query; // track what's typed (selected or not)

  // Re-render the records list every time the name field changes so it
  // only shows records for the entered patient.
  renderPhysQueue();
  updatePhysFilterStatus(query);

  dropdown.innerHTML = '';
  if (!query) { dropdown.style.display = 'none'; return; }

  const all = (typeof allPatients !== 'undefined' ? allPatients : []);
  const lc  = query.toLowerCase();
  const matches = all
    .filter(p => p.name && p.name.toLowerCase().includes(lc))
    .slice(0, 8);

  if (!matches.length) {
    // Show a "no match — will register as new" hint
    dropdown.innerHTML = `<div class="ac-item" style="cursor:default;color:var(--mu);font-style:italic">
      No matching patient. Press Save to register "<strong style="color:var(--td);font-style:normal">${query}</strong>" as a new entry.
    </div>`;
    dropdown.style.display = 'block';
    return;
  }

  matches.forEach(p => {
    const item = document.createElement('div');
    item.className = 'ac-item';
    item.innerHTML = '<strong>' + p.name + '</strong> <span style="color:var(--mu);font-size:11px">' +
                     (p.id || '—') + ' · Age ' + (p.age || '?') + ' · ' + (p.sex || '—') + '</span>';
    item.onclick = () => physSelectPatient(p);
    dropdown.appendChild(item);
  });
  dropdown.style.display = 'block';
}

function physSelectPatient(p) {
  const nameInp = document.getElementById('ph-name');
  const ageInp  = document.getElementById('ph-age');
  const sexSel  = document.getElementById('ph-sex');
  if (nameInp) nameInp.value = p.name || '';
  if (ageInp)  ageInp.value  = p.age  || '';
  if (sexSel && p.sex)  sexSel.value = p.sex;
  _physSelectedPatient = p.name || '';
  document.getElementById('ph-autocomplete').style.display = 'none';
  renderPhysQueue();
  updatePhysFilterStatus(p.name);
  notif('✓ Loaded records for ' + p.name, 'al-s');
}

function updatePhysFilterStatus(query) {
  const status = document.getElementById('ph-filter-status');
  if (!status) return;
  if (!query) {
    status.textContent = 'Enter a patient name above to view their records';
    status.style.color = 'var(--mu)';
  } else {
    status.innerHTML = 'Showing records for <strong style="color:var(--td)">' + query + '</strong>';
    status.style.color = 'var(--mu)';
  }
}

// Close autocomplete when clicking outside the input/dropdown
document.addEventListener('click', e => {
  const dropdown = document.getElementById('ph-autocomplete');
  const input    = document.getElementById('ph-name');
  if (!dropdown || !input) return;
  if (!input.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.style.display = 'none';
  }
});

/* ═══ Inject Upload Zone UI ═══
   Supports: browse files, live camera capture (with switch front/back),
   file-input camera fallback (mobile), clipboard paste, drag-and-drop.    */
function initPhysUploadZone() {
  const container = document.getElementById('ph-upload-zone-wrap');
  if (!container) return;

  container.innerHTML = `
    <!-- Hidden file inputs -->
    <input id="ph-file-pick"   type="file" accept="image/*,application/pdf" multiple style="display:none"
           onchange="handlePhysFiles(this.files)"/>
    <input id="ph-file-camera" type="file" accept="image/*" capture="environment" style="display:none"
           onchange="handlePhysFiles(this.files)"/>

    <!-- Mode toggle tabs -->
    <div style="display:flex;gap:0;margin-bottom:10px;border:1.5px solid var(--bd);border-radius:10px;overflow:hidden;width:fit-content">
      <button id="ph-tab-upload" onclick="physShowUploadMode()"
        style="padding:7px 16px;font-size:12px;font-family:var(--fh);font-weight:700;border:none;cursor:pointer;
               background:var(--t);color:#fff;transition:all .15s">
        🗂 Upload / Drop
      </button>
      <button id="ph-tab-camera" onclick="physShowCameraMode()"
        style="padding:7px 16px;font-size:12px;font-family:var(--fh);font-weight:700;border:none;cursor:pointer;
               background:var(--bg);color:var(--td);border-left:1.5px solid var(--bd);transition:all .15s">
        📷 Live Camera
      </button>
    </div>

    <!-- ── UPLOAD MODE PANEL ── -->
    <div id="ph-panel-upload">
      <div id="ph-drop-zone"
           onclick="document.getElementById('ph-file-pick').click()"
           ondragover="physDragOver(event)"
           ondragleave="physDragLeave(event)"
           ondrop="physDrop(event)"
           style="border:2px dashed var(--bd);border-radius:14px;padding:28px 18px;text-align:center;cursor:pointer;
                  background:var(--bg);transition:border-color .15s,background .15s;user-select:none;position:relative">
        <div style="font-size:36px;margin-bottom:8px;line-height:1">📂</div>
        <div style="font-family:var(--fh);font-size:13px;font-weight:800;color:var(--td);margin-bottom:4px">
          Click to browse or drag &amp; drop files here
        </div>
        <div style="font-size:11px;color:var(--mu);margin-bottom:16px">
          Accepts images (JPG, PNG, WEBP) and PDFs · Multiple files OK
        </div>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap" onclick="event.stopPropagation()">
          <button class="btn btn-s" style="font-size:12px;display:flex;align-items:center;gap:6px;padding:8px 14px"
                  onclick="document.getElementById('ph-file-pick').click()">
            🗂 Browse Files
          </button>
          <button class="btn btn-s" style="font-size:12px;display:flex;align-items:center;gap:6px;padding:8px 14px;background:var(--t);color:#fff"
                  onclick="physTriggerCameraInput()">
            📱 Phone Camera
          </button>
          <button class="btn btn-s" style="font-size:12px;display:flex;align-items:center;gap:6px;padding:8px 14px;background:#EEF0FF;color:#4B46C8"
                  onclick="physPasteFromClipboard()">
            📋 Paste Image
          </button>
        </div>
        <div id="ph-drag-overlay" style="display:none;position:absolute;inset:0;background:rgba(58,158,165,.08);
          border-radius:12px;align-items:center;justify-content:center;
          font-family:var(--fh);font-size:15px;font-weight:800;color:var(--t);pointer-events:none">
          ⬇ Drop files to queue
        </div>
      </div>
    </div>

    <!-- ── LIVE CAMERA PANEL ── -->
    <div id="ph-panel-camera" style="display:none">
      <div style="background:#000;border-radius:14px;overflow:hidden;position:relative;aspect-ratio:4/3;max-height:360px">
        <video id="ph-cam-video" autoplay playsinline muted
               style="width:100%;height:100%;object-fit:cover;display:block"></video>
        <canvas id="ph-cam-canvas" style="display:none"></canvas>
        <!-- Camera controls overlay -->
        <div style="position:absolute;bottom:0;left:0;right:0;padding:12px 14px;
                    background:linear-gradient(transparent,rgba(0,0,0,.7));
                    display:flex;align-items:center;justify-content:space-between;gap:8px">
          <!-- Switch camera -->
          <button onclick="physSwitchCamera()" title="Switch camera"
            style="background:rgba(255,255,255,.18);border:none;border-radius:50%;width:40px;height:40px;
                   font-size:18px;cursor:pointer;color:#fff;display:flex;align-items:center;justify-content:center">
            🔄
          </button>
          <!-- Capture button -->
          <button onclick="physCaptureLive()"
            style="background:#fff;border:none;border-radius:50%;width:64px;height:64px;
                   font-size:28px;cursor:pointer;display:flex;align-items:center;justify-content:center;
                   box-shadow:0 0 0 4px rgba(255,255,255,.4)">
            📸
          </button>
          <!-- Stop camera -->
          <button onclick="physStopCamera()" title="Stop camera"
            style="background:rgba(255,255,255,.18);border:none;border-radius:50%;width:40px;height:40px;
                   font-size:18px;cursor:pointer;color:#fff;display:flex;align-items:center;justify-content:center">
            ✕
          </button>
        </div>
        <!-- Flash effect -->
        <div id="ph-cam-flash" style="display:none;position:absolute;inset:0;background:#fff;opacity:0;
                                       pointer-events:none;transition:opacity .1s"></div>
      </div>
      <!-- Camera status -->
      <div id="ph-cam-status" style="font-size:11px;color:var(--mu);font-family:var(--fh);
                                      margin-top:6px;text-align:center">
        Starting camera…
      </div>
    </div>

    <!-- Queue badge -->
    <div id="ph-queue-badge" style="display:none;margin-top:8px;font-size:11px;color:var(--o);
                                     font-family:var(--fh);font-weight:700;text-align:right"></div>
  `;

  // Global paste listener
  document.addEventListener('paste', e => {
    const page = document.getElementById('page-physical');
    if (!page || !page.classList.contains('active')) return;
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(i => i.type.startsWith('image/'));
    if (!imageItems.length) return;
    const files = imageItems.map(i => i.getAsFile()).filter(Boolean);
    if (files.length) handlePhysFiles(files);
  });
}

/* ═══ Mode switching ═══ */
function physShowUploadMode() {
  physStopCamera();
  document.getElementById('ph-panel-upload').style.display = '';
  document.getElementById('ph-panel-camera').style.display = 'none';
  document.getElementById('ph-tab-upload').style.background = 'var(--t)';
  document.getElementById('ph-tab-upload').style.color = '#fff';
  document.getElementById('ph-tab-camera').style.background = 'var(--bg)';
  document.getElementById('ph-tab-camera').style.color = 'var(--td)';
}

function physShowCameraMode() {
  const nameVal = document.getElementById('ph-name')?.value?.trim();
  if (!nameVal) { notif('⚠ Enter the patient name first.', 'al-i'); return; }
  document.getElementById('ph-panel-upload').style.display = 'none';
  document.getElementById('ph-panel-camera').style.display = '';
  document.getElementById('ph-tab-camera').style.background = 'var(--t)';
  document.getElementById('ph-tab-camera').style.color = '#fff';
  document.getElementById('ph-tab-upload').style.background = 'var(--bg)';
  document.getElementById('ph-tab-upload').style.color = 'var(--td)';
  physStartCamera();
}

/* ═══ Live camera ═══ */
let _physCamFacing = 'environment'; // or 'user'

async function physStartCamera() {
  physStopCamera();
  const statusEl = document.getElementById('ph-cam-status');
  if (statusEl) statusEl.textContent = 'Starting camera…';
  try {
    _physCamStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: _physCamFacing, width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false
    });
    const video = document.getElementById('ph-cam-video');
    if (video) {
      video.srcObject = _physCamStream;
      await video.play();
      _physCamMode = true;
      const track = _physCamStream.getVideoTracks()[0];
      const label = track?.label || 'Camera';
      if (statusEl) statusEl.textContent = '● Live — ' + label + ' — tap 📸 to capture';
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = '⚠ Camera unavailable: ' + err.message;
    notif('Camera access denied or unavailable. Use Browse Files instead.', 'al-i');
    physShowUploadMode();
  }
}

async function physSwitchCamera() {
  _physCamFacing = _physCamFacing === 'environment' ? 'user' : 'environment';
  await physStartCamera();
}

function physStopCamera() {
  if (_physCamStream) {
    _physCamStream.getTracks().forEach(t => t.stop());
    _physCamStream = null;
  }
  _physCamMode = false;
  const video = document.getElementById('ph-cam-video');
  if (video) video.srcObject = null;
  const statusEl = document.getElementById('ph-cam-status');
  if (statusEl) statusEl.textContent = 'Camera stopped.';
}

function physCaptureLive() {
  const nameVal = document.getElementById('ph-name')?.value?.trim();
  if (!nameVal) { notif('⚠ Enter the patient name first.', 'al-i'); return; }

  const video  = document.getElementById('ph-cam-video');
  const canvas = document.getElementById('ph-cam-canvas');
  if (!video || !canvas) return;

  canvas.width  = video.videoWidth  || 1280;
  canvas.height = video.videoHeight || 960;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // Flash effect
  const flash = document.getElementById('ph-cam-flash');
  if (flash) {
    flash.style.display = 'block';
    flash.style.opacity = '0.7';
    setTimeout(() => { flash.style.opacity = '0'; setTimeout(() => flash.style.display = 'none', 150); }, 80);
  }

  const src      = canvas.toDataURL('image/jpeg', 0.92);
  const filename = 'capture-' + Date.now() + '.jpg';
  _physQueue.push({ src, filename, type: 'image/jpeg' });
  notif('📸 Photo captured — tap 📸 again for more, or click Save.', 'al-s');
  renderPhysQueue();
  updatePhysQueueBadge();
}

/* ═══ Drag-and-drop handlers ═══ */
function physDragOver(e) {
  e.preventDefault();
  const zone = document.getElementById('ph-drop-zone');
  if (zone) {
    zone.style.borderColor = 'var(--t)';
    zone.style.background  = 'var(--tl)';
    const overlay = document.getElementById('ph-drag-overlay');
    if (overlay) overlay.style.display = 'flex';
  }
}

function physDragLeave(e) {
  const zone = document.getElementById('ph-drop-zone');
  if (zone) {
    zone.style.borderColor = 'var(--bd)';
    zone.style.background  = 'var(--bg)';
    const overlay = document.getElementById('ph-drag-overlay');
    if (overlay) overlay.style.display = 'none';
  }
}

function physDrop(e) {
  e.preventDefault();
  physDragLeave(e);
  const files = Array.from(e.dataTransfer?.files || []);
  if (files.length) handlePhysFiles(files);
}

/* ═══ Phone camera input fallback (for mobile devices) ═══ */
function physTriggerCameraInput() {
  const nameVal = document.getElementById('ph-name')?.value?.trim();
  if (!nameVal) { notif('⚠ Enter the patient name first.', 'al-i'); return; }
  document.getElementById('ph-file-camera').click();
}

/* ═══ Camera trigger (kept for backward compat) ═══ */
function physTriggerCamera() {
  physTriggerCameraInput();
}

/* ═══ Clipboard paste ═══ */
async function physPasteFromClipboard() {
  const nameVal = document.getElementById('ph-name')?.value?.trim();
  if (!nameVal) { notif('⚠ Enter the patient name first.', 'al-i'); return; }
  try {
    const items = await navigator.clipboard.read();
    let found = false;
    for (const item of items) {
      const imageType = item.types.find(t => t.startsWith('image/'));
      if (imageType) {
        const blob = await item.getType(imageType);
        const file = new File([blob], 'pasted-image.png', { type: imageType });
        handlePhysFiles([file]);
        found = true;
      }
    }
    if (!found) notif('No image found in clipboard. Copy an image first.', 'al-i');
  } catch (err) {
    notif('Clipboard access denied. Use Ctrl+V while this page is focused.', 'al-i');
  }
}

/* ═══ Core file handler (shared by all upload methods) ═══ */
function handlePhysFiles(filesOrList) {
  const nameVal = document.getElementById('ph-name')?.value?.trim();
  if (!nameVal) { notif('⚠ Please enter the patient name first.', 'al-i'); return; }

  const files = Array.from(filesOrList);
  if (!files.length) return;

  // Validate types
  const allowed = ['image/jpeg','image/png','image/webp','image/gif','image/bmp','application/pdf'];
  const valid   = files.filter(f => allowed.includes(f.type));
  const skipped = files.length - valid.length;
  if (!valid.length) { notif('⚠ No supported files found (use JPG, PNG, WEBP, or PDF).', 'al-i'); return; }
  if (skipped) notif(`⚠ ${skipped} unsupported file(s) skipped.`, 'al-i');

  let loaded = 0;
  valid.forEach(f => {
    const reader = new FileReader();
    reader.onload = ev => {
      _physQueue.push({ src: ev.target.result, filename: f.name, type: f.type });
      loaded++;
      if (loaded === valid.length) {
        notif(`📥 ${valid.length} page(s) staged — click Save Physical Record to confirm.`, 'al-i');
        renderPhysQueue();
        updatePhysQueueBadge();
      }
    };
    reader.readAsDataURL(f);
  });
}

/* ═══ Queue badge updater ═══ */
function updatePhysQueueBadge() {
  const badge = document.getElementById('ph-queue-badge');
  if (!badge) return;
  if (_physQueue.length) {
    badge.style.display = 'block';
    badge.textContent   = `⏳ ${_physQueue.length} page(s) pending save`;
  } else {
    badge.style.display = 'none';
  }
}

// ── Legacy handler kept for backward compat (old <input onchange="uploadPhysical"> in HTML) ──
function uploadPhysical(e) {
  handlePhysFiles(e.target.files);
  e.target.value = '';
}

// ── Save button handler ──────────────────────
async function savePhysicalRecord() {
  const nameVal = document.getElementById('ph-name').value.trim();
  const ageVal  = document.getElementById('ph-age').value.trim();
  const sexVal  = document.getElementById('ph-sex').value;
  const noteVal = document.getElementById('ph-note').value.trim();

  if (!nameVal) { notif('⚠ Please enter the patient name first.', 'al-i'); return; }
  if (!_physQueue.length) { notif('⚠ No pages staged. Please upload or capture pages first.', 'al-i'); return; }

  const key = nameVal;
  if (!physStore[key]) physStore[key] = [];

  const pages   = _physQueue.slice();
  _physQueue    = [];

  const recId   = 'PHY-' + Date.now();
  const recDate = new Date().toLocaleDateString('en-PH', {month:'short', day:'numeric', year:'numeric'});
  const recNote = noteVal || 'Physical record';

  const record = {
    name:  nameVal,
    age:   ageVal || '—',
    sex:   sexVal || '—',
    note:  recNote,
    date:  recDate,
    pages,
    id:    recId
  };

  physStore[key].push(record);

  // Register in patient list
  registerPhysicalPatient(nameVal, ageVal, sexVal);
  renderPhysQueue();
  updatePhysQueueBadge();

  // ── Persist to Supabase ──────────────────────
  if (typeof supabase !== 'undefined' && supabase) {
    try {
      const rows = pages.map((pg, i) => ({
        patient_name: nameVal,
        record_id:    recId,
        page_number:  i + 1,
        src:          pg.src,
        filename:     pg.filename || ('page-' + (i + 1) + '.jpg'),
        note:         recNote,
        age:          parseInt(ageVal) || null,
        sex:          sexVal || null,
        uploaded_at:  new Date().toISOString()
      }));
      const { error } = await supabase.from('physical_records').insert(rows);
      if (error) {
        console.warn('[Supabase] physical_records insert:', error.message);
        notif('✅ ' + pages.length + ' page(s) saved locally (DB: ' + error.message + ').', 'al-i');
      } else {
        notif('✅ ' + pages.length + ' page(s) saved for ' + nameVal + ' and synced to database!', 'al-s');
      }
    } catch (e) {
      console.warn('[Supabase] physical_records skipped:', e.message);
      notif('✅ ' + pages.length + ' page(s) saved locally (DB unavailable).', 'al-i');
    }
  } else {
    notif('✅ ' + pages.length + ' page(s) saved for ' + nameVal + '.', 'al-s');
  }

  // Clear staging fields, but KEEP the patient name + age + sex visible so the
  // user can see the record they just saved under the now-filtered list.
  ['ph-note'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  // Re-render so the new saved record appears under the current name filter
  renderPhysQueue();
  updatePhysFilterStatus(nameVal);
}

// ── Register patient into the system ────────
// Delegates to the full version in patients.js which handles allPatients[], renderPxList(),
// renderDashRecent(), Supabase persistence, and dropdowns in one place.
function registerPhysicalPatient(name, age, sex) {
  // patients.js defines the authoritative version — call it if available
  // (this file loads after patients.js so the function below is the override;
  //  we replicate the same logic here to stay self-contained)
  if (typeof allPatients === 'undefined') return;
  if (allPatients.find(p => p.name.toLowerCase() === name.toLowerCase())) return;

  pxCount++;
  const id    = '#DMY-' + String(pxCount).padStart(3, '0');
  const today = new Date().toISOString().split('T')[0];

  allPatients.unshift({ id, name, age: age || '—', sex: sex || '—', mobile: '—', date: today, status: 'Physical Record' });

  const el  = document.getElementById('stat-total'); if (el)  el.textContent  = allPatients.length;
  const el2 = document.getElementById('new-pid');    if (el2) el2.textContent = pxCount + 1;

  renderPxList();
  renderDashRecent();
  if (typeof updateReportsData   === 'function') updateReportsData();
  if (typeof addPatientToDropdowns === 'function') addPatientToDropdowns(name, id);

  // Persist to Supabase
  if (typeof supabase !== 'undefined' && supabase) {
    supabase.from('patients').insert([{
      pid: id, name,
      age: parseInt(age) || null,
      sex: sex || null,
      registered_date: today,
      status: 'Physical Record'
    }]).then(({ error }) => { if (error) console.warn('[Supabase] phys patient:', error.message); });
  }
}

// ── Render the queued uploads preview ───────
// Only shows records matching the patient currently typed in #ph-name.
function renderPhysQueue() {
  const wrap = document.getElementById('ph-queue');
  if (!wrap) return;
  wrap.innerHTML = '';
  let total = 0;

  // Current filter — patient name typed in the search input.
  // Match is case-insensitive substring so partial typing still works
  // (e.g. "juan" matches "Juan Dela Cruz").
  const filterRaw = (document.getElementById('ph-name')?.value || '').trim();
  const filterLC  = filterRaw.toLowerCase();

  // Show staged (pending save) pages first — always visible regardless of
  // filter, so the user can see what they're about to save.
  if (_physQueue.length) {
    const stageName = filterRaw || 'Unknown Patient';
    const stageCard = document.createElement('div');
    stageCard.className = 'ph-card';
    stageCard.style.outline = '2px dashed var(--o)';
    stageCard.innerHTML = `
      <div class="ph-card-head">
        <div>
          <div class="ph-card-name">⏳ ${stageName} <span style="color:var(--o);font-size:11px;font-weight:700">PENDING SAVE</span></div>
          <div class="ph-card-meta">${_physQueue.length} page${_physQueue.length > 1 ? 's' : ''} staged — click Save Physical Record to confirm</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm" style="background:var(--t);color:#fff;font-size:11px"
                  onclick="document.getElementById('ph-file-pick')?.click()">➕ Add More</button>
          <button class="btn btn-sm" style="background:#E24B4A;color:#fff"
                  onclick="_physQueue=[];renderPhysQueue();updatePhysQueueBadge();notif('Staged pages cleared.','al-i')">✕ Clear</button>
        </div>
      </div>
      <div class="ph-thumbs">
        ${_physQueue.map((pg, pi) => `
          <div class="ph-thumb" style="position:relative">
            <img src="${pg.src}" alt="Page ${pi + 1}"/>
            <span>Pg ${pi + 1}</span>
            <button onclick="removePhysQueued(${pi})" title="Remove this page"
                    style="position:absolute;top:2px;right:2px;background:#E24B4A;color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:10px;cursor:pointer;line-height:1;display:flex;align-items:center;justify-content:center">✕</button>
          </div>`).join('')}
      </div>`;
    wrap.appendChild(stageCard);
  }

  // ── Saved records — filter to the entered patient ──
  // If no filter has been entered, show nothing (the empty-state message
  // tells the user to type a name).
  if (filterLC) {
    Object.entries(physStore).forEach(([patient, records]) => {
      if (!patient.toLowerCase().includes(filterLC)) return;
      records.forEach(rec => {
        total++;
        const card = document.createElement('div');
        card.className = 'ph-card';
        card.innerHTML = `
          <div class="ph-card-head">
            <div>
              <div class="ph-card-name">👤 ${rec.name}</div>
              <div class="ph-card-meta">${rec.age} yrs · ${rec.sex} · Uploaded ${rec.date}</div>
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              <span class="badge" style="background:#EEF0FF;color:#4B46C8">${rec.pages.length} page${rec.pages.length>1?'s':''}</span>
              <button class="btn btn-s btn-sm" onclick="openPhysModal('${rec.name}')">🔍 View</button>
              <button class="btn btn-sm" style="background:#E24B4A;color:#fff" onclick="deletePhysRec('${patient}','${rec.id}')">✕</button>
            </div>
          </div>
          <div class="ph-note">${rec.note}</div>
          <div class="ph-thumbs">
            ${rec.pages.map((pg,pi) => `
              <div class="ph-thumb" onclick="openPhysViewer('${rec.name}',${records.indexOf(rec)},${pi})">
                <img src="${pg.src}" alt="Page ${pi+1}"/>
                <span>Pg ${pi+1}</span>
              </div>`).join('')}
          </div>`;
        wrap.appendChild(card);
      });
    });
  }

  // Empty-state messaging
  const emptyEl = document.getElementById('ph-queue-empty');
  if (emptyEl) {
    if (_physQueue.length || total > 0) {
      emptyEl.style.display = 'none';
    } else {
      emptyEl.style.display = 'block';
      if (!filterLC) {
        emptyEl.innerHTML = 'Enter a patient name above to view their physical records.';
      } else {
        emptyEl.innerHTML = `No physical records found for <strong style="color:var(--td)">${filterRaw}</strong>.<br><span style="font-size:11px">Upload scanned pages above to attach a new record.</span>`;
      }
    }
  }

  const cntEl = document.getElementById('ph-count');
  if (cntEl) cntEl.textContent = total + ' record set' + (total !== 1 ? 's' : '') + (filterLC ? ' for this patient' : '');
}

// ── Remove a single queued page ──────────────
function removePhysQueued(index) {
  _physQueue.splice(index, 1);
  renderPhysQueue();
  updatePhysQueueBadge();
  notif('Page removed from queue.', 'al-i');
}

// ── Delete a saved record ────────────────────
function deletePhysRec(patient, id) {
  if (!confirm('Remove this physical record?')) return;
  physStore[patient] = (physStore[patient] || []).filter(r => r.id !== id);
  if (!physStore[patient].length) delete physStore[patient];
  renderPhysQueue();
  // Best-effort DB delete
  if (typeof supabase !== 'undefined' && supabase) {
    supabase.from('physical_records').delete().eq('record_id', id)
      .then(({ error }) => { if (error) console.warn('[Supabase] phys delete:', error.message); });
  }
}

// ── Modal: all records for a patient ────────
function openPhysModal(name) {
  const records = physStore[name] || [];
  const modal   = document.getElementById('phys-modal');
  const content = document.getElementById('phys-modal-content');

  document.getElementById('phys-modal-title').textContent = '📄 Physical Records — ' + name;

  if (!records.length) {
    content.innerHTML = '<p style="color:var(--mu);font-size:12px;padding:10px 0">No physical records uploaded for this patient.</p>';
  } else {
    content.innerHTML = records.map((rec, ri) => `
      <div style="margin-bottom:18px">
        <div style="font-family:var(--fh);font-size:12px;font-weight:700;color:var(--td);margin-bottom:6px">
          Record ${ri+1} — ${rec.date} &nbsp;<span style="font-weight:400;color:var(--mu)">${rec.note}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">
          ${rec.pages.map((pg, pi) => `
            <div style="border:1px solid var(--bd);border-radius:8px;overflow:hidden;cursor:pointer;background:#f8f8f8"
                 onclick="openPhysViewer('${name}',${ri},${pi})">
              <img src="${pg.src}" style="width:100%;display:block;object-fit:cover;aspect-ratio:3/4"/>
              <div style="font-size:9px;color:var(--mu);padding:3px 5px;font-family:var(--fh);font-weight:600">
                Page ${pi+1} · ${pg.filename}
              </div>
            </div>`).join('')}
        </div>
      </div>`).join('<hr style="border:none;border-top:1px dashed var(--bd);margin:14px 0"/>');
  }

  modal.classList.add('open');
}

function closePhysModal() {
  document.getElementById('phys-modal').classList.remove('open');
}

// ── Full-screen page viewer ──────────────────
function openPhysViewer(name, recIdx, pageIdx) {
  const rec = (physStore[name] || [])[recIdx];
  if (!rec) return;
  const viewer = document.getElementById('phys-viewer');
  viewer.setAttribute('data-name',  name);
  viewer.setAttribute('data-rec',   recIdx);
  viewer.setAttribute('data-page',  pageIdx);
  viewer.setAttribute('data-pages', rec.pages.length);
  renderViewerPage(rec, pageIdx);
  viewer.classList.add('open');
}

function renderViewerPage(rec, pageIdx) {
  const pg = rec.pages[pageIdx];
  document.getElementById('pv-img').src = pg.src;
  document.getElementById('pv-caption').textContent =
    rec.name + ' — ' + rec.note + ' — Page ' + (pageIdx+1) + ' of ' + rec.pages.length;
  document.getElementById('pv-prev').style.opacity = pageIdx === 0 ? '.3' : '1';
  document.getElementById('pv-next').style.opacity = pageIdx >= rec.pages.length-1 ? '.3' : '1';
}

function viewerNav(dir) {
  const viewer  = document.getElementById('phys-viewer');
  const name    = viewer.getAttribute('data-name');
  const recIdx  = +viewer.getAttribute('data-rec');
  const total   = +viewer.getAttribute('data-pages');
  let   pageIdx = +viewer.getAttribute('data-page') + dir;
  if (pageIdx < 0 || pageIdx >= total) return;
  viewer.setAttribute('data-page', pageIdx);
  renderViewerPage(physStore[name][recIdx], pageIdx);
}

function closePhysViewer() {
  document.getElementById('phys-viewer').classList.remove('open');
}

// ── Keyboard nav in viewer ───────────────────
document.addEventListener('keydown', e => {
  const v = document.getElementById('phys-viewer');
  if (!v?.classList.contains('open')) return;
  if (e.key === 'ArrowRight') viewerNav(1);
  if (e.key === 'ArrowLeft')  viewerNav(-1);
  if (e.key === 'Escape')     closePhysViewer();
});

// ── Bootstrap: load physical records from Supabase on startup ────────────
async function loadPhysicalRecordsFromSupabase() {
  if (typeof supabase === 'undefined' || !supabase) return;
  try {
    const { data, error } = await supabase
      .from('physical_records')
      .select('*')
      .order('uploaded_at', { ascending: true });
    if (error || !data) { console.warn('[Supabase] physical_records load:', error?.message); return; }

    // Group rows by record_id
    const groups = {};
    data.forEach(row => {
      const key = row.patient_name;
      if (!groups[key]) groups[key] = {};
      if (!groups[key][row.record_id]) {
        groups[key][row.record_id] = {
          id:    row.record_id,
          name:  row.patient_name,
          age:   row.age ? String(row.age) : '—',
          sex:   row.sex || '—',
          note:  row.note || 'Physical record',
          date:  row.uploaded_at ? new Date(row.uploaded_at).toLocaleDateString('en-PH', {month:'short',day:'numeric',year:'numeric'}) : '—',
          pages: []
        };
      }
      groups[key][row.record_id].pages.push({
        src:      row.src,
        filename: row.filename || 'page.jpg',
        type:     'image/jpeg'
      });
    });

    // Merge into physStore (avoid duplicates)
    Object.entries(groups).forEach(([patName, recs]) => {
      if (!physStore[patName]) physStore[patName] = [];
      const existingIds = new Set(physStore[patName].map(r => r.id));
      Object.values(recs).forEach(rec => {
        if (!existingIds.has(rec.id)) physStore[patName].push(rec);
      });
    });

    // Re-render if the physical records page is active
    const page = document.getElementById('page-physical');
    if (page && page.classList.contains('active')) renderPhysQueue();
  } catch (e) {
    console.warn('[Supabase] physical_records bootstrap skipped:', e.message);
  }
}

// Stop live camera when user navigates away from physical records page
(function watchPhysNav() {
  const origNav = window.nav;
  window.nav = function(id, el) {
    if (id !== 'physical' && _physCamMode) physStopCamera();
    if (typeof origNav === 'function') origNav(id, el);
    // When entering the page, refresh the records list (applies the patient-name filter)
    if (id === 'physical') setTimeout(renderPhysQueue, 60);
  };
})();

// ── Init upload zone on DOM ready ────────────
document.addEventListener('DOMContentLoaded', () => {
  initPhysUploadZone();
  // Bootstrap DB records with a slight delay so supabase client is ready
  setTimeout(loadPhysicalRecordsFromSupabase, 1000);
});
