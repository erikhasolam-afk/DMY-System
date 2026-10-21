/* ═══════════════════════════════════════════════════════════════════
   pdf.js — PDF Export
   - Patient Record PDF
   - Treatment Ledger PDF
   - Monthly Report PDF (fully dynamic — patients + treatments + charts)
   - Dental Chart PDF (EXACT visual replica — tooth numbers + colors,
     PDA intraoral examination layout)
   ═══════════════════════════════════════════════════════════════════ */

function pdfStatus(msg) {
  const el = document.getElementById('pdf-status');
  if (!el) return;
  el.textContent = msg;
  const isWarn = msg.startsWith('⚠');
  el.style.background = isWarn ? '#FCEBEB' : '';
  el.style.color       = isWarn ? '#B91C1C' : '';
  el.style.border      = isWarn ? '1px solid #F3A0A0' : '';
  el.style.display = 'flex';
  setTimeout(() => {
    el.style.display = 'none';
    el.style.background = el.style.color = el.style.border = '';
  }, isWarn ? 4000 : 3000);
}

/* ── Patient autocomplete for Patient Record PDF ── */
function pdfPxSearch(q) {
  const dropdown = document.getElementById('pdf-px-dropdown');
  if (!dropdown) return;
  dropdown.innerHTML = '';
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
      document.getElementById('pdf-px').value = p.name;
      dropdown.style.display = 'none';
    };
    dropdown.appendChild(item);
  });
  dropdown.style.display = 'block';
}

document.addEventListener('click', e => {
  const inp = document.getElementById('pdf-px');
  const dd  = document.getElementById('pdf-px-dropdown');
  if (dd && inp && !inp.contains(e.target) && !dd.contains(e.target)) dd.style.display = 'none';

  const inp2 = document.getElementById('pdf-tx-px');
  const dd2  = document.getElementById('pdf-tx-px-dropdown');
  if (dd2 && inp2 && !inp2.contains(e.target) && !dd2.contains(e.target)) dd2.style.display = 'none';
});

/* ── Patient autocomplete for Treatment Ledger PDF ── */
function pdfTxPxSearch(q) {
  const dropdown = document.getElementById('pdf-tx-px-dropdown');
  if (!dropdown) return;
  dropdown.innerHTML = '';
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
      document.getElementById('pdf-tx-px').value = p.name;
      dropdown.style.display = 'none';
    };
    dropdown.appendChild(item);
  });
  dropdown.style.display = 'block';
}

function pdfHeader(doc, title, isLandscape) {
  const pageW = isLandscape ? 297 : 210;
  doc.setFillColor(244, 123, 32);
  doc.rect(0, 0, pageW, 22, 'F');
  doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
  doc.text('DMY DENTAL CLINIC', 14, 10);
  doc.setFontSize(8); doc.setFont('helvetica', 'normal');
  doc.text(title, 14, 17);
  doc.text(new Date().toLocaleDateString('en-PH', {year:'numeric', month:'long', day:'numeric'}), pageW - 14, 14, {align:'right'});
}

function pdfSec(doc, y, title, isLandscape) {
  const w = isLandscape ? 269 : 182;
  doc.setFillColor(31, 110, 116); doc.rect(14, y, w, 7, 'F');
  doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
  doc.text(title, 17, y + 5);
  return y + 10;
}

function pdfLine(doc, y, label, val) {
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(107, 126, 133);
  doc.text(label + ':', 18, y);
  doc.setTextColor(26, 46, 53); doc.text(String(val == null || val === '' ? '—' : val), 70, y);
  return y + 6;
}

function checkPageBreak(doc, y, needed, isLandscape) {
  const maxY = isLandscape ? 195 : 275;
  if (y + needed > maxY) { doc.addPage(); return 18; }
  return y;
}

function pdfImages(doc, y, patientKey, isLandscape) {
  let imgs = [];
  Object.keys(typeof imgStore !== 'undefined' ? imgStore : {}).forEach(key => {
    if (key && patientKey && key.toLowerCase().includes(patientKey.split(' ')[0].toLowerCase()))
      imgs = imgs.concat(imgStore[key]);
  });
  if (!imgs.length) return y;
  y = checkPageBreak(doc, y, 12, isLandscape);
  y = pdfSec(doc, y, 'PATIENT IMAGES / X-RAYS', isLandscape);
  const pageW = isLandscape ? 297 : 210, margin = 14, gutter = 5, cols = isLandscape ? 4 : 3;
  const cellW = (pageW - margin * 2 - gutter * (cols - 1)) / cols;
  const cellH = cellW * 0.75, labelH = 8;
  let col = 0, rowY = y;
  imgs.forEach(img => {
    y = checkPageBreak(doc, rowY, cellH + labelH + 4, isLandscape);
    if (y < rowY) { col = 0; rowY = y; }
    const x = margin + col * (cellW + gutter);
    doc.setDrawColor(214, 228, 230); doc.setLineWidth(0.4); doc.rect(x, rowY, cellW, cellH, 'S');
    try {
      doc.addImage(img.src, img.src.startsWith('data:image/png') ? 'PNG' : 'JPEG', x, rowY, cellW, cellH, '', 'FAST');
    } catch (e) {
      doc.setFillColor(240, 240, 240); doc.rect(x, rowY, cellW, cellH, 'F');
    }
    const labelY = rowY + cellH + 1;
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(31, 110, 116);
    doc.text(img.type, x, labelY + 5, {maxWidth: cellW});
    col++;
    if (col >= cols) { col = 0; rowY += cellH + labelH + gutter + 6; }
  });
  if (col > 0) rowY += cellH + labelH + gutter + 6;
  return rowY + 4;
}

function getSelectedPatient(selId) {
  const el = document.getElementById(selId);
  let name = '';
  if (!el) {
    name = '';
  } else if (el.tagName === 'SELECT') {
    const val = el.value;
    name = val.includes('(') ? val.split('(')[0].trim() : val;
  } else {
    // text input (e.g. pdf-px autocomplete)
    name = el.value.trim();
  }
  return (typeof allPatients !== 'undefined' ? allPatients : []).find(p => p.name === name) ||
    { name: name || '—', age: '—', sex: '—', mobile: '—', email: '—', address: '—' };
}

/* ── Ensure chart data for a patient is in chartStore before generating PDF ── */
async function ensureChartLoaded(patientName) {
  if (!patientName) return;
  // Already in memory — nothing to do
  if (typeof chartStore !== 'undefined' && chartStore[patientName]) return;
  // Try loading from Supabase
  try {
    if (typeof supabase === 'undefined' || !supabase) return;
    const { data } = await supabase
      .from('dental_charts')
      .select('tooth_state, tooth_notes')
      .eq('patient_name', patientName)
      .single();
    if (!data) return;
    if (data.tooth_state) {
      const state = typeof data.tooth_state === 'string' ? JSON.parse(data.tooth_state) : data.tooth_state;
      if (typeof chartStore !== 'undefined') chartStore[patientName] = state;
    }
    if (data.tooth_notes) {
      const notes = typeof data.tooth_notes === 'string' ? JSON.parse(data.tooth_notes) : data.tooth_notes;
      if (typeof chartNotesStore !== 'undefined') chartNotesStore[patientName] = notes;
    }
  } catch (e) {
    console.warn('[PDF] ensureChartLoaded skipped:', e.message);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   1. PATIENT RECORD PDF
   ═══════════════════════════════════════════════════════════════════ */
async function pdfPatient() {
  const nameVal = (document.getElementById('pdf-px')?.value || '').trim();
  if (!nameVal) {
    pdfStatus('⚠ Please select a patient before exporting.');
    const inp = document.getElementById('pdf-px');
    if (inp) { inp.style.borderColor = 'var(--o)'; inp.focus(); setTimeout(() => inp.style.borderColor = '', 2500); }
    return;
  }
  const px = getSelectedPatient('pdf-px');
  if (!px || !px.name || px.name === '—') {
    pdfStatus('⚠ Patient not found. Please search and select a valid patient.');
    return;
  }

  // Pre-load chart from DB if not already in memory
  if (document.getElementById('inc-chart')?.checked) {
    pdfStatus('Loading chart data…');
    await ensureChartLoaded(px.name);
  }

  pdfStatus('Generating...');
  const { jsPDF } = window.jspdf; const doc = new jsPDF();
  pdfHeader(doc, 'Patient Information Record');
  let y = 30;
  doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 46, 53);
  doc.text('Patient: ' + px.name, 14, y); y += 7;
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(107, 126, 133);
  doc.text('Generated: ' + new Date().toLocaleString('en-PH'), 14, y); y += 10;

  if (document.getElementById('inc-info')?.checked) {
    y = pdfSec(doc, y, 'PERSONAL INFORMATION');
    y = pdfLine(doc, y, 'Name', px.name);
    y = pdfLine(doc, y, 'Age', px.age);
    y = pdfLine(doc, y, 'Sex', px.sex);
    y = pdfLine(doc, y, 'Mobile', px.mobile);
    if (px.email)   y = pdfLine(doc, y, 'Email', px.email);
    if (px.address) y = pdfLine(doc, y, 'Address', px.address);
    if (px.guardian) y = pdfLine(doc, y, 'Parent/Guardian', px.guardian);
    y += 4;
  }

  if (document.getElementById('inc-med')?.checked && px.health) {
    y = checkPageBreak(doc, y, 12, false);
    y = pdfSec(doc, y, 'MEDICAL HISTORY');
    const h = px.health;
    y = pdfLine(doc, y, 'Good health', h.q1);
    y = pdfLine(doc, y, 'Under treatment', (h.q2 || '') + (h.q2a ? ' — ' + h.q2a : ''));
    y = pdfLine(doc, y, 'Serious illness', (h.q3 || '') + (h.q3a ? ' — ' + h.q3a : ''));
    y = pdfLine(doc, y, 'Hospitalized', (h.q4 || '') + (h.q4a ? ' — ' + h.q4a : ''));
    y = pdfLine(doc, y, 'Medications', (h.q5 || '') + (h.q5a ? ' — ' + h.q5a : ''));
    y = pdfLine(doc, y, 'Tobacco use', h.q6);
    y = pdfLine(doc, y, 'Alcohol/Drugs', h.q7);
    y = pdfLine(doc, y, 'Allergies', (h.q8_allergies || []).join(', '));
    y = pdfLine(doc, y, 'Bleeding time', h.q9_bleeding_time);
    y = pdfLine(doc, y, 'Blood type', h.blood_type);
    if (h.q13_conditions?.length) y = pdfLine(doc, y, 'Conditions', h.q13_conditions.join(', '));
    y += 4;
  }

  if (document.getElementById('inc-tx')?.checked) {
    y = checkPageBreak(doc, y, 12, false);
    y = pdfSec(doc, y, 'TREATMENT RECORDS');
    const entries = (typeof txStore !== 'undefined' && txStore[px.name]) || [];
    if (!entries.length) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(107, 126, 133);
      doc.text('No treatment records.', 18, y); y += 8;
    } else {
      entries.forEach(e => {
        y = checkPageBreak(doc, y, 7, false);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(26, 46, 53);
        doc.text('• ' + e.date + ' — ' + e.procedure + ' — Charged P' + e.charged + (e.discount ? ' (disc. P' + e.discount + ')' : '') +
                 ' — Paid P' + e.paid + (e.status === 'voided' ? ' — VOIDED' : ' — Balance P' + e.balance), 18, y);
        y += 6;
      });
      y += 4;
    }
  }

  if (document.getElementById('inc-chart')?.checked) {
    y = checkPageBreak(doc, y, 12, false);
    y = pdfSec(doc, y, 'DENTAL CHART SUMMARY');

    // ── Resolve chart data for THIS patient (not the live global state) ──
    // chartStore and chartNotesStore are keyed by patient name (tooth-chart.js)
    // Fall back to live globals only when this patient IS the one on-screen.
    const patChartState = (typeof chartStore !== 'undefined' && chartStore[px.name])
      ? chartStore[px.name]
      : (typeof toothState !== 'undefined' && typeof currentChartPatient !== 'undefined' && currentChartPatient === px.name)
        ? toothState
        : {};

    const patChartNotes = (typeof chartNotesStore !== 'undefined' && chartNotesStore[px.name])
      ? chartNotesStore[px.name]
      : (typeof toothNotes !== 'undefined' && typeof currentChartPatient !== 'undefined' && currentChartPatient === px.name)
        ? toothNotes
        : {};

    const marked = Object.keys(patChartState);

    if (!marked.length) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(107, 126, 133);
      doc.text('No dental chart on file for this patient.', 18, y); y += 8;
    } else {
      // ── Tooth condition legend row ──
      // Group teeth by condition so the summary is easy to read
      const byCondition = {};
      marked.forEach(num => {
        const tool = patChartState[num];
        const label = (typeof toolCfg !== 'undefined' && toolCfg[tool])
          ? toolCfg[tool].label
          : tool;
        if (!byCondition[label]) byCondition[label] = [];
        byCondition[label].push(num);
      });

      y = pdfLine(doc, y, 'Total marked teeth', marked.length);
      y += 2;

      // Print each condition group
      Object.entries(byCondition).forEach(([label, nums]) => {
        y = checkPageBreak(doc, y, 7, false);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(31, 110, 116);
        doc.text(label + ':', 22, y);
        doc.setFont('helvetica', 'normal'); doc.setTextColor(26, 46, 53);
        doc.text(nums.join(', '), 65, y, { maxWidth: 130 });
        y += 6;
      });

      // ── Tooth-specific clinical notes ──
      const noteEntries = Object.entries(patChartNotes);
      if (noteEntries.length) {
        y = checkPageBreak(doc, y, 10, false);
        y += 2;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(31, 110, 116);
        doc.text('Clinical Notes per Tooth:', 18, y); y += 6;
        doc.setDrawColor(214, 228, 230); doc.line(18, y - 1, 196, y - 1);
        y += 2;

        noteEntries.forEach(([num, note]) => {
          y = checkPageBreak(doc, y, 8, false);
          const tool  = patChartState[num];
          const label = (typeof toolCfg !== 'undefined' && tool && toolCfg[tool])
            ? toolCfg[tool].label
            : (tool || '');

          // Tooth number badge area
          doc.setFillColor(232, 246, 247);
          doc.roundedRect(18, y - 4, 40, 6, 1, 1, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(31, 110, 116);
          doc.text('Tooth ' + num + (label ? '  [' + label + ']' : ''), 20, y);

          // Note text
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(26, 46, 53);
          const lines = doc.splitTextToSize(note, 125);
          doc.text(lines, 65, y);
          y += Math.max(6, lines.length * 5);
        });
      }
    }
    y += 4;
  }

  if (document.getElementById('inc-images')?.checked) {
    y = checkPageBreak(doc, y, 20, false);
    y = pdfImages(doc, y, px.name, false);
  }

  doc.setFontSize(7); doc.setTextColor(107, 126, 133);
  doc.text('DMY Dental Clinic — Confidential', 105, 290, {align:'center'});
  doc.save('DMY-PatientRecord-' + px.name.replace(/[^a-zA-Z0-9]/g, '-') + '.pdf');
  pdfStatus('Patient Record PDF downloaded!');
}

/* ═══════════════════════════════════════════════════════════════════
   2. TREATMENT LEDGER PDF
   ═══════════════════════════════════════════════════════════════════ */
function pdfTreatment() {
  const nameVal = (document.getElementById('pdf-tx-px')?.value || '').trim();
  if (!nameVal) {
    pdfStatus('⚠ Please select a patient before exporting.');
    const inp = document.getElementById('pdf-tx-px');
    if (inp) { inp.style.borderColor = 'var(--o)'; inp.focus(); setTimeout(() => inp.style.borderColor = '', 2500); }
    return;
  }
  const px = getSelectedPatient('pdf-tx-px');
  if (!px || !px.name || px.name === '—') {
    pdfStatus('⚠ Patient not found. Please search and select a valid patient.');
    return;
  }
  pdfStatus('Generating...');
  const { jsPDF } = window.jspdf; const doc = new jsPDF('landscape');
  doc.setFillColor(244, 123, 32); doc.rect(0, 0, 297, 20, 'F');
  doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
  doc.text('DMY DENTAL CLINIC — TREATMENT LEDGER', 14, 13);
  let y = 28;
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 46, 53);
  doc.text('Patient: ' + px.name, 14, y); y += 7;
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(107, 126, 133);
  doc.text('Age: ' + px.age + '   Sex: ' + px.sex, 14, y); y += 9;

  const cols = [['Date',26],['Tooth',18],['Procedure',54],['Dentist',36],['Charged',22],['Paid',22],['Balance',22],['Next Appt.',32]];
  doc.setFillColor(31, 110, 116); doc.rect(14, y, 269, 8, 'F');
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(255, 255, 255);
  let cx = 14;
  cols.forEach(([h, w]) => { doc.text(h, cx + 2, y + 5.5); cx += w; });
  y += 9;

  const dateFrom = document.getElementById('pdf-from')?.value;
  const dateTo   = document.getElementById('pdf-to')?.value;
  let entries = (typeof txStore !== 'undefined' && txStore[px.name]) || [];
  if (dateFrom) entries = entries.filter(e => e.date >= dateFrom);
  if (dateTo)   entries = entries.filter(e => e.date <= dateTo);

  let totalBal = 0;
  doc.setFont('helvetica', 'normal'); doc.setTextColor(26, 46, 53);
  entries.forEach((e, ri) => {
    const voided = e.status === 'voided';
    if (!voided) totalBal += (e.balance || 0);
    y = checkPageBreak(doc, y, 8, true);
    if (ri % 2 === 0) { doc.setFillColor(247, 249, 250); doc.rect(14, y, 269, 7, 'F'); }
    cx = 14;
    const procTxt = e.procedure + (e.discount ? ' (disc. P' + e.discount + ')' : '') + (voided ? ' [VOIDED]' : '');
    [e.date, e.tooth, procTxt, e.dentist, 'P' + (e.charged || 0), 'P' + (e.paid || 0), voided ? '-' : 'P' + (e.balance || 0), e.next || '—']
      .forEach((cell, ci) => { doc.text(String(cell), cx + 2, y + 5, {maxWidth: cols[ci][1] - 3}); cx += cols[ci][1]; });
    y += 7;
  });
  y += 5; doc.setFont('helvetica', 'bold'); doc.setTextColor(244, 123, 32);
  doc.text('Total Balance: P' + totalBal.toLocaleString(), 200, y);
  y += 10;

  // ── Payment history (actual transactions, with receipt numbers) ──
  let pays = (typeof paymentStore !== 'undefined' ? paymentStore : []).filter(p => p.patient_name === px.name);
  if (dateFrom) pays = pays.filter(p => p.paid_at >= dateFrom);
  if (dateTo)   pays = pays.filter(p => p.paid_at <= dateTo);
  if (pays.length) {
    y = checkPageBreak(doc, y, 20, true);
    y = pdfSec(doc, y, 'PAYMENT HISTORY', true);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(107, 126, 133);
    [['Receipt', 14], ['Date', 44], ['Type', 72], ['Method / Ref', 96], ['Amount', 160], ['Recorded by', 192], ['Notes', 232]].forEach(([h, x]) => doc.text(h, x + 2, y));
    y += 6;
    doc.setFont('helvetica', 'normal'); doc.setTextColor(26, 46, 53);
    pays.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).forEach(p => {
      y = checkPageBreak(doc, y, 7, true);
      const sign = p.kind === 'payment' ? '' : '-';
      [[p.receipt_no, 14], [p.paid_at, 44], [p.kind, 72], [p.method + (p.reference_no ? ' / ' + p.reference_no : ''), 96],
       [sign + 'P' + p.amount.toLocaleString(), 160], [p.recorded_by_name || '-', 192], [(p.notes || '').slice(0, 28), 232]]
        .forEach(([v, x]) => doc.text(String(v), x + 2, y, { maxWidth: 60 }));
      y += 6;
    });
  }
  doc.setFontSize(7); doc.setTextColor(107, 126, 133);
  doc.text('DMY Dental Clinic — Treatment Ledger — Confidential', 148.5, 208, {align:'center'});
  doc.save('DMY-Ledger-' + px.name.replace(/[^a-zA-Z0-9]/g, '-') + '.pdf');
  pdfStatus('Treatment Ledger PDF downloaded!');
}

/* ═══════════════════════════════════════════════════════════════════
   3. MONTHLY REPORT PDF — dynamic from patients + txStore + charts
   ═══════════════════════════════════════════════════════════════════ */
function pdfReport() {
  pdfStatus('Generating...');
  const { jsPDF } = window.jspdf; const doc = new jsPDF();
  const mo = document.getElementById('pdf-mo').value;
  const yr = document.getElementById('pdf-yr').value;
  const moIdx = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(mo);
  const yrInt = parseInt(yr);

  pdfHeader(doc, 'Monthly Report — ' + mo + ' ' + yr);
  let y = 30;

  // ── Collect everything ──
  const patientsAll = (typeof allPatients !== 'undefined' ? allPatients : []);
  const patientsThisMonth = patientsAll.filter(p => {
    const d = new Date(p.date);
    return d.getMonth() === moIdx && d.getFullYear() === yrInt;
  });

  const allTxEntries = [];
  Object.entries(typeof txStore !== 'undefined' ? txStore : {}).forEach(([pname, arr]) => {
    arr.forEach(e => allTxEntries.push({...e, patient: pname}));
  });
  const monthEntries = allTxEntries.filter(e => {
    if (e.status === 'voided') return false;
    const d = new Date(e.date);
    return d.getMonth() === moIdx && d.getFullYear() === yrInt;
  });

  // Same calculation as the dashboard and the Financial Reports page:
  // charges by treatment date, collections by actual payment date.
  const FIN = computeFinancials({
    from: localISODate(new Date(yrInt, moIdx, 1)), to: localISODate(new Date(yrInt, moIdx + 1, 0)),
  });
  const pm = n => 'P ' + round2(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const chartsCount = typeof chartStore !== 'undefined' ? Object.keys(chartStore).length : 0;
  const patientsWithCharts = patientsThisMonth.filter(p =>
    typeof chartStore !== 'undefined' && chartStore[p.name] && Object.keys(chartStore[p.name]).length
  ).length;

  // Demographics (this month)
  const demo = { Male:0, Female:0, 'Under 12':0, '12-17':0, '18-59':0, '60+':0 };
  patientsThisMonth.forEach(p => {
    if (p.sex === 'Male') demo.Male++;
    else if (p.sex === 'Female') demo.Female++;
    const a = parseInt(p.age);
    if (!isNaN(a)) {
      if (a < 12) demo['Under 12']++;
      else if (a < 18) demo['12-17']++;
      else if (a < 60) demo['18-59']++;
      else demo['60+']++;
    }
  });

  // ── Summary ──
  y = pdfSec(doc, y, 'MONTHLY SUMMARY');
  y = pdfLine(doc, y, 'Reporting Period', mo + ' ' + yr);
  y = pdfLine(doc, y, 'Total Patients (all-time)', patientsAll.length);
  y = pdfLine(doc, y, 'New Patients This Month', patientsThisMonth.length);
  y = pdfLine(doc, y, 'Procedures Performed', monthEntries.length);
  y = pdfLine(doc, y, 'Gross Charges', pm(FIN.grossCharges));
  y = pdfLine(doc, y, 'Discounts', pm(FIN.discounts));
  y = pdfLine(doc, y, 'Net Charges', pm(FIN.netCharges));
  y = pdfLine(doc, y, 'Collections (payments received)', pm(FIN.collections));
  y = pdfLine(doc, y, 'Refunds / Reversals', pm(FIN.refunds));
  y = pdfLine(doc, y, 'Net Collections', pm(FIN.netCollections));
  y = pdfLine(doc, y, 'Outstanding (this month\'s charges)', pm(FIN.outstanding));
  if (FIN.expenses) {
    y = pdfLine(doc, y, 'Expenses', pm(FIN.expenses));
    y = pdfLine(doc, y, 'Net Income (net coll. - expenses)', pm(FIN.netIncome));
  }
  y = pdfLine(doc, y, 'Dental Charts on File', chartsCount + ' patient(s)');
  y += 6;

  // ── Procedure Breakdown ──
  if (monthEntries.length) {
    y = checkPageBreak(doc, y, 14, false);
    y = pdfSec(doc, y, 'PROCEDURE BREAKDOWN');
    const procCount = {};
    const procRevenue = {};   // net collections received this month for each procedure
    monthEntries.forEach(e => { procCount[e.procedure] = (procCount[e.procedure] || 0) + 1; });
    Object.entries(FIN.byProcedure).forEach(([k, b]) => { procRevenue[k] = b.netCollections; });
    const entries = Object.entries(procCount).sort((a,b) => b[1] - a[1]);
    // Column header
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(107, 126, 133);
    doc.text('PROCEDURE', 18, y);
    doc.text('COUNT', 130, y);
    doc.text('COLLECTED', 160, y);
    y += 5;
    doc.setDrawColor(214, 228, 230); doc.line(18, y - 2, 192, y - 2);
    entries.forEach(([name, cnt]) => {
      y = checkPageBreak(doc, y, 7, false);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(26, 46, 53);
      doc.text(name.length > 50 ? name.slice(0, 50) + '…' : name, 18, y);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(244, 123, 32);
      doc.text(String(cnt), 130, y);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(58, 158, 165);
      doc.text(pm(procRevenue[name] || 0), 160, y);
      y += 6;
    });
    y += 4;
  }

  // ── Demographics ──
  y = checkPageBreak(doc, y, 24, false);
  y = pdfSec(doc, y, 'PATIENT DEMOGRAPHICS (THIS MONTH)');
  Object.entries(demo).forEach(([k, v]) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(26, 46, 53);
    doc.text(k, 18, y);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(58, 158, 165);
    doc.text(String(v), 80, y);
    y += 6;
  });
  y += 4;

  // ── New Patients List — sorted by Patient ID ──
  if (patientsThisMonth.length) {
    y = checkPageBreak(doc, y, 14, false);
    y = pdfSec(doc, y, 'NEW PATIENTS THIS MONTH');
    // Numeric-aware sort by trailing digits in id (e.g. "#DMY-007" → 7),
    // falling back to a lexical compare so ids without numbers still sort.
    const idSorted = patientsThisMonth.slice().sort((a, b) => {
      const an = parseInt(String(a.id || '').replace(/\D/g, ''), 10);
      const bn = parseInt(String(b.id || '').replace(/\D/g, ''), 10);
      if (!isNaN(an) && !isNaN(bn)) return an - bn;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
    idSorted.slice(0, 20).forEach(p => {
      y = checkPageBreak(doc, y, 7, false);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(26, 46, 53);
      doc.text('• ' + p.id + ' — ' + p.name + ' (' + p.age + ', ' + (p.sex || '—') + ') — ' + formatDatePH(p.date), 18, y);
      y += 5;
    });
    if (idSorted.length > 20) {
      doc.setFont('helvetica', 'italic'); doc.setTextColor(107, 126, 133);
      doc.text('… and ' + (idSorted.length - 20) + ' more.', 18, y + 2);
      y += 8;
    }
    y += 4;
  }

  // ── Outstanding Balances ──
  const outstandingByPatient = {};
  allTxEntries.forEach(e => {
    if (e.status !== 'voided' && (e.balance || 0) > 0) outstandingByPatient[e.patient] = (outstandingByPatient[e.patient] || 0) + e.balance;
  });
  const outList = Object.entries(outstandingByPatient).sort((a,b) => b[1] - a[1]);
  if (outList.length) {
    y = checkPageBreak(doc, y, 14, false);
    y = pdfSec(doc, y, 'OUTSTANDING BALANCES');
    outList.slice(0, 15).forEach(([name, bal]) => {
      y = checkPageBreak(doc, y, 7, false);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(26, 46, 53);
      doc.text(name, 18, y);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(216, 90, 48);
      doc.text('P ' + bal.toLocaleString(), 150, y);
      y += 6;
    });
  }

  doc.setFontSize(7); doc.setTextColor(107, 126, 133);
  doc.text('Generated by DMY Dental Clinic PMS · ' + new Date().toLocaleString('en-PH'), 105, 290, {align:'center'});
  doc.save('DMY-Report-' + mo + yr + '.pdf');
  pdfStatus('Monthly Report PDF downloaded!');
}

/* hexToRgb helper — used by other utilities */
function hexToRgb(hex) {
  hex = (hex || '#ffffff').replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  return {
    r: parseInt(hex.slice(0, 2), 16) || 0,
    g: parseInt(hex.slice(2, 4), 16) || 0,
    b: parseInt(hex.slice(4, 6), 16) || 0
  };
}
