/* ═══════════════════════════════════════════════════════════════
   fin-reports.js — Sales, Income & Financial Reports
   All figures come from computeFinancials() (ledger.js), which reads the
   actual treatment ledger and payment transactions. The dashboard and
   every export use the same function, so the totals always agree.

   Definitions used on screen and in exports:
     Gross charges   = Σ charged on treatments (by treatment date)
     Net charges     = gross charges − discounts
     Collections     = Σ payments received (by payment date)
     Net collections = collections − refunds/reversals
     Outstanding     = net charges − collections still owed on those treatments
     Net income      = net collections − expenses   (cash basis)
   Collections are NOT profit. Net income is shown only when expenses are
   recorded, and only when the report is not filtered by category.
   ═══════════════════════════════════════════════════════════════ */

const _fr = { charts: {} };
const EXPENSE_CATEGORIES = ['Dental Supplies', 'Laboratory Fees', 'Rent', 'Utilities', 'Salaries & Wages', 'Equipment', 'Maintenance', 'Marketing', 'Taxes & Permits', 'Other'];

function frPresetRange(preset) {
  const t = localISODate(), d = parseISODate(t);
  switch (preset) {
    case 'today': return [t, t];
    case 'week': return [startOfWeek(t), addDays(startOfWeek(t), 6)];
    case 'month': return [t.slice(0, 8) + '01', localISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
    case 'lastmonth': return [localISODate(new Date(d.getFullYear(), d.getMonth() - 1, 1)), localISODate(new Date(d.getFullYear(), d.getMonth(), 0))];
    case 'year': return [d.getFullYear() + '-01-01', d.getFullYear() + '-12-31'];
    default: return null;
  }
}

function frFilters() {
  const g = id => document.getElementById(id)?.value || '';
  return { from: g('fr-from'), to: g('fr-to'), branch: g('fr-branch'), category: g('fr-category'), groupBy: g('fr-group') || 'day' };
}

function frPresetChange() {
  const p = document.getElementById('fr-preset').value;
  const r = frPresetRange(p);
  if (r) { document.getElementById('fr-from').value = r[0]; document.getElementById('fr-to').value = r[1]; }
  const grp = document.getElementById('fr-group');
  if (grp && p !== 'custom') grp.value = p === 'year' ? 'month' : 'day';
  renderFinancialReport();
}

function initFinancialReports() {
  const cat = document.getElementById('fr-category');
  if (cat && cat.options.length <= 1) cat.insertAdjacentHTML('beforeend', PROCEDURE_CATEGORIES.map(c => `<option>${c}</option>`).join(''));
  if (!document.getElementById('fr-from').value) {
    document.getElementById('fr-preset').value = 'month';
    const r = frPresetRange('month');
    document.getElementById('fr-from').value = r[0]; document.getElementById('fr-to').value = r[1];
  }
  fillRefSelects();
  renderFinancialReport();
}

function periodLabel(key, groupBy) {
  if (groupBy === 'month') { const [y, m] = key.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' }); }
  if (groupBy === 'week') return 'Week of ' + fmtDate(key, { month: 'short', day: 'numeric' });
  return fmtDate(key, { weekday: 'short', month: 'short', day: 'numeric' });
}

function renderFinancialReport() {
  const f = frFilters();
  if (!f.from || !f.to) return;
  if (f.from > f.to) { notif('“From” date is after “To” date.', 'al-i'); return; }
  const R = computeFinancials(f);
  _fr.last = R;

  const card = (label, value, sub, color) => `<div class="sc"><div class="sl">${label}</div><div class="sv" style="font-size:24px;color:${color}">${value}</div><div class="ss2">${sub}</div></div>`;
  document.getElementById('fr-cards').innerHTML =
    card('Net Charges', peso(R.netCharges), `Gross ${peso(R.grossCharges)} − disc. ${peso(R.discounts)}`, 'var(--td)') +
    card('Net Collections', peso(R.netCollections), `${R.paymentsCount} payment(s) − ${peso(R.refunds)} refunds`, '#3B6D11') +
    card('Outstanding Balance', peso(R.outstanding), `Still owed on ${R.procedures} procedure(s)`, '#D85A30') +
    (R.netIncome === null
      ? card('Net Income', 'n/a', 'Not shown when filtered by category', 'var(--mu)')
      : card('Net Income', peso(R.netIncome), `Net collections − expenses ${peso(R.expenses)}`, R.netIncome < 0 ? '#B91C1C' : 'var(--o)'));

  // Period table + chart
  const keys = Object.keys(R.byPeriod).sort();
  const pRows = keys.map(k => { const b = R.byPeriod[k]; return `<tr><td>${periodLabel(k, f.groupBy)}</td><td>${peso(b.charges)}</td><td>${peso(b.discounts)}</td><td>${peso(b.netCharges)}</td><td>${peso(b.collections)}</td><td>${peso(b.refunds)}</td><td style="font-weight:700;color:#3B6D11">${peso(b.netCollections)}</td><td>${peso(b.expenses)}</td></tr>`; }).join('');
  document.getElementById('fr-period-table').innerHTML = pRows +
    `<tr class="total-row"><td>Total</td><td>${peso(R.grossCharges)}</td><td>${peso(R.discounts)}</td><td>${peso(R.netCharges)}</td><td>${peso(R.collections)}</td><td>${peso(R.refunds)}</td><td>${peso(R.netCollections)}</td><td>${peso(R.expenses)}</td></tr>`;

  const sorted = (obj, by = 'netCollections') => Object.entries(obj).sort((a, b) => (b[1][by] || 0) - (a[1][by] || 0) || a[0].localeCompare(b[0]));
  document.getElementById('fr-category-table').innerHTML = sorted(R.byCategory, 'netCharges').map(([k, b]) =>
    `<tr><td>${esc(k)}</td><td>${b.count}</td><td>${peso(b.netCharges)}</td><td style="color:#3B6D11">${peso(b.netCollections)}</td><td style="color:#D85A30">${peso(b.outstanding)}</td></tr>`).join('')
    || '<tr><td colspan="5" class="empty-cell">No data in this period.</td></tr>';
  document.getElementById('fr-method-table').innerHTML = sorted(R.byMethod).map(([k, b]) =>
    `<tr><td>${esc(k)}</td><td>${peso(b.collections)}</td><td>${peso(b.refunds)}</td><td style="font-weight:700">${peso(b.netCollections)}</td><td>${R.netCollections ? Math.round(b.netCollections / R.netCollections * 100) + '%' : '—'}</td></tr>`).join('')
    || '<tr><td colspan="5" class="empty-cell">No payments in this period.</td></tr>';
  document.getElementById('fr-branch-table').innerHTML = sorted(R.byBranch).map(([k, b]) =>
    `<tr><td>${esc(k)}</td><td>${peso(b.netCharges)}</td><td style="color:#3B6D11;font-weight:700">${peso(b.netCollections)}</td><td style="color:#D85A30">${peso(b.outstanding)}</td><td>${peso(b.expenses)}</td></tr>`).join('')
    || '<tr><td colspan="5" class="empty-cell">No data in this period.</td></tr>';
  const owed = Object.values(R.outstandingByPatient).sort((a, b) => b.balance - a.balance);
  const today = localISODate();
  document.getElementById('fr-outstanding-table').innerHTML = owed.slice(0, 50).map(o => {
    const days = Math.round((parseISODate(today) - parseISODate(o.oldest)) / 864e5);
    return `<tr><td><a class="link" onclick="openPatientProfile('${jsArg(o.patient)}')">${esc(o.patient)}</a></td><td>${o.entries}</td><td>${fmtDate(o.oldest)}</td><td>${days > 90 ? '<span class="badge" style="background:#FCEBEB;color:#B91C1C">' + days + ' days</span>' : days + ' days'}</td><td style="font-weight:700;color:#D85A30">${peso(o.balance)}</td></tr>`;
  }).join('') || '<tr><td colspan="5" class="empty-cell">No outstanding balances. 🎉</td></tr>';

  renderExpenseTable(f);
  renderComparison(f);
  renderFrCharts(R, keys, f);
}

function renderExpenseTable(f) {
  const rows = expenseStore.filter(e => e.expense_date >= f.from && e.expense_date <= f.to && (!f.branch || e.branch === f.branch));
  document.getElementById('fr-expense-table').innerHTML = rows.map(e => `<tr class="${e.status === 'voided' ? 'tx-voided' : ''}">
    <td>${fmtDate(e.expense_date)}</td><td>${esc(e.category)}</td><td>${esc(e.description || '')}${e.status === 'voided' ? '<div class="sub">VOIDED: ' + esc(e.void_reason) + '</div>' : ''}</td>
    <td>${esc(e.branch || '—')}</td><td>${esc(e.recorded_by_name || '—')}</td><td style="font-weight:700">${peso(e.amount)}</td>
    <td>${e.status === 'active' ? `<button class="btn btn-sm btn-gray" onclick="voidExpense('${e.id}')">Void</button>` : ''}</td></tr>`).join('')
    || '<tr><td colspan="7" class="empty-cell">No expenses recorded in this period.</td></tr>';
}

/* Month-by-month: selected year vs the year before (net collections & net charges) */
function renderComparison(f) {
  const y = parseISODate(f.to).getFullYear();
  const rows = []; const tot = { a: 0, b: 0, ca: 0, cb: 0 };
  for (let m = 0; m < 12; m++) {
    const mk = (yy) => { const s = localISODate(new Date(yy, m, 1)), e = localISODate(new Date(yy, m + 1, 0)); return computeFinancials({ from: s, to: e, branch: f.branch, category: f.category }); };
    const A = mk(y), B = mk(y - 1);
    tot.a += A.netCollections; tot.b += B.netCollections; tot.ca += A.netCharges; tot.cb += B.netCharges;
    rows.push({ m, a: A.netCollections, b: B.netCollections, ca: A.netCharges, cb: B.netCharges });
  }
  const pct = (a, b) => b ? ((a - b) / Math.abs(b) * 100) : null;
  const pc = v => v === null ? '—' : `<span style="color:${v >= 0 ? '#3B6D11' : '#B91C1C'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%</span>`;
  document.getElementById('fr-compare-head').innerHTML = `<tr><th>Month</th><th>Net charges ${y - 1}</th><th>Net charges ${y}</th><th>Net collections ${y - 1}</th><th>Net collections ${y}</th><th>Change</th></tr>`;
  document.getElementById('fr-compare-table').innerHTML = rows.map(r => `<tr><td>${MONTHS[r.m]}</td><td>${peso(r.cb)}</td><td>${peso(r.ca)}</td><td>${peso(r.b)}</td><td style="font-weight:700">${peso(r.a)}</td><td>${pc(pct(r.a, r.b))}</td></tr>`).join('')
    + `<tr class="total-row"><td>Year</td><td>${peso(tot.cb)}</td><td>${peso(tot.ca)}</td><td>${peso(tot.b)}</td><td>${peso(tot.a)}</td><td>${pc(pct(tot.a, tot.b))}</td></tr>`;
  _fr.compare = { y, rows, tot };
}

function renderFrCharts(R, keys, f) {
  const mk = (id, cfg) => { const c = Chart.getChart(id); if (c) c.destroy(); const el = document.getElementById(id); if (el) _fr.charts[id] = new Chart(el, cfg); };
  mk('fr-period-chart', {
    type: 'bar',
    data: { labels: keys.map(k => periodLabel(k, f.groupBy)), datasets: [
      { label: 'Net charges', data: keys.map(k => round2(R.byPeriod[k].netCharges)), backgroundColor: 'rgba(58,158,165,.75)', borderRadius: 4 },
      { label: 'Net collections', data: keys.map(k => round2(R.byPeriod[k].netCollections)), backgroundColor: 'rgba(244,123,32,.85)', borderRadius: 4 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, labels: { font: { size: 11 } } } } },
  });
  const m = Object.entries(R.byMethod).filter(([, b]) => b.netCollections > 0);
  mk('fr-method-chart', {
    type: 'doughnut',
    data: { labels: m.map(x => x[0]), datasets: [{ data: m.map(x => round2(x[1].netCollections)), backgroundColor: ['#F47B20', '#3A9EA5', '#639922', '#7F77DD', '#D85A30', '#1F6E74', '#B4B2A9', '#E24B4A'] }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } } },
  });
  const C = _fr.compare;
  mk('fr-compare-chart', {
    type: 'line',
    data: { labels: MONTHS, datasets: [
      { label: 'Net collections ' + C.y, data: C.rows.map(r => round2(r.a)), borderColor: '#F47B20', backgroundColor: 'rgba(244,123,32,.1)', fill: true, tension: .35 },
      { label: 'Net collections ' + (C.y - 1), data: C.rows.map(r => round2(r.b)), borderColor: '#3A9EA5', borderDash: [5, 4], tension: .35 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, labels: { font: { size: 11 } } } } },
  });
}

/* ═══ Expenses ═══ */
function openExpenseDialog() {
  const reqId = newRequestId();
  openDialog({
    title: '🧾 Record Expense', confirmText: '💾 Save Expense',
    body: `<div class="fr c2">
        <div class="fg"><label class="fl">Date *</label><input class="fc" type="date" id="ex-date" value="${localISODate()}"/></div>
        <div class="fg"><label class="fl">Amount (₱) *</label><input class="fc" type="number" step="0.01" min="0.01" id="ex-amt"/></div></div>
      <div class="fr c2">
        <div class="fg"><label class="fl">Category *</label><select class="fc" id="ex-cat">${optionsHtml(EXPENSE_CATEGORIES, 'Dental Supplies')}</select></div>
        <div class="fg"><label class="fl">Branch</label><select class="fc" id="ex-branch">${optionsHtml(activeBranches(), activeBranches()[0] || '', '— Branch —')}</select></div></div>
      <div class="fr c2">
        <div class="fg"><label class="fl">Description</label><input class="fc" id="ex-desc"/></div>
        <div class="fg"><label class="fl">Reference / OR no.</label><input class="fc" id="ex-ref"/></div></div>`,
    async onConfirm(d) {
      const amt = round2(d.val('#ex-amt'));
      if (!(amt > 0)) { d.error('Enter an amount greater than zero.'); return false; }
      const { data, error } = await supabase.rpc('add_expense', {
        p_date: d.val('#ex-date'), p_category: d.val('#ex-cat'), p_amount: amt, p_description: d.val('#ex-desc') || null,
        p_branch: d.val('#ex-branch') || null, p_reference: d.val('#ex-ref') || null, p_client_request_id: reqId,
      });
      if (error) throw error;
      if (!expenseStore.some(e => e.id === data.id)) expenseStore.unshift({ ...data, amount: Number(data.amount) });
      renderFinancialReport();
      if (typeof updateReportsData === 'function') updateReportsData();
      notif('Expense recorded.', 'al-s');
    },
  });
}
async function voidExpense(id) {
  const reason = prompt('Reason for voiding this expense?');
  if (!reason || !reason.trim()) return;
  const { data, error } = await supabase.rpc('void_expense', { p_expense_id: id, p_reason: reason.trim() });
  if (error) return alert(friendlyDbError(error));
  const i = expenseStore.findIndex(e => e.id === id); if (i >= 0) expenseStore[i] = { ...data, amount: Number(data.amount) };
  renderFinancialReport();
}

/* ═══ Exports ═══ */
function frFilterText(f) {
  return `${fmtDate(f.from)} to ${fmtDate(f.to)} · Branch: ${f.branch || 'All'} · Category: ${f.category || 'All'} · Grouped by ${f.groupBy}`;
}

function exportFinancialCSV() {
  const R = _fr.last; if (!R) return;
  const f = R.filters;
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ['DMY Dental Clinic — Financial Report'], [frFilterText(f)], [],
    ['Summary'], ['Gross charges', R.grossCharges], ['Discounts', R.discounts], ['Net charges', R.netCharges],
    ['Collections', R.collections], ['Refunds/Reversals', R.refunds], ['Net collections', R.netCollections],
    ['Outstanding balance', R.outstanding], ['Expenses', R.expenses], ['Net income (net collections - expenses)', R.netIncome ?? 'n/a'], [],
    ['Period', 'Gross charges', 'Discounts', 'Net charges', 'Collections', 'Refunds', 'Net collections', 'Expenses'],
    ...Object.keys(R.byPeriod).sort().map(k => { const b = R.byPeriod[k]; return [k, b.charges, b.discounts, b.netCharges, b.collections, b.refunds, b.netCollections, b.expenses]; }), [],
    ['Category', 'Procedures', 'Net charges', 'Net collections', 'Outstanding'],
    ...Object.entries(R.byCategory).map(([k, b]) => [k, String(b.count), b.netCharges, b.netCollections, b.outstanding]), [],
    ['Payment method', 'Collections', 'Refunds', 'Net collections'],
    ...Object.entries(R.byMethod).map(([k, b]) => [k, b.collections, b.refunds, b.netCollections]), [],
    ['Branch', 'Net charges', 'Net collections', 'Outstanding', 'Expenses'],
    ...Object.entries(R.byBranch).map(([k, b]) => [k, b.netCharges, b.netCollections, b.outstanding, b.expenses]), [],
    ['Patient', 'Entries with balance', 'Oldest', 'Outstanding'],
    ...Object.values(R.outstandingByPatient).sort((a, b) => b.balance - a.balance).map(o => [o.patient, String(o.entries), o.oldest, o.balance]),
  ];
  const csv = lines.map(r => r.map(v => typeof v === 'number' ? round2(v).toFixed(2) : q(v)).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = `DMY_Financial_${f.from}_to_${f.to}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function exportFinancialPDF() {
  const R = _fr.last; if (!R) return;
  const f = R.filters;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });
  const W = 297, L = 14;
  const money = n => (n < 0 ? '-' : '') + 'PHP ' + Math.abs(round2(n)).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (typeof pdfHeader === 'function') pdfHeader(doc, 'Financial Report', true);
  let y = 30;
  doc.setFontSize(9); doc.setTextColor(107, 126, 133); doc.text(frFilterText(f), L, y); y += 7;

  const section = t => { if (y > 180) { doc.addPage(); y = 18; } doc.setFillColor(31, 110, 116); doc.rect(L, y, W - 2 * L, 7, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255); doc.text(t, L + 3, y + 5); y += 11; };
  const table = (head, rows, widths) => {
    const xs = [L]; widths.forEach((w, i) => xs.push(xs[i] + w));
    const line = (cells, bold, color) => {
      if (y > 195) { doc.addPage(); y = 18; }
      doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(8); doc.setTextColor(...(color || [26, 46, 53]));
      cells.forEach((c, i) => { const s = String(c); const right = i > 0 && /^-?PHP|^\d|%$|^-$/.test(s); doc.text(s.length > 42 ? s.slice(0, 41) + '…' : s, right ? xs[i + 1] - 2 : xs[i] + 1, y, right ? { align: 'right' } : undefined); });
      y += 5.5;
    };
    line(head, true, [107, 126, 133]); doc.setDrawColor(214, 228, 230); doc.line(L, y - 4, xs[xs.length - 1], y - 4);
    rows.forEach((r, i) => line(r, r.bold, r.color));
    y += 4;
  };

  section('SUMMARY');
  const S = [['Gross charges', money(R.grossCharges)], ['Discounts', money(R.discounts)], ['Net charges', money(R.netCharges)],
    ['Collections (payments received)', money(R.collections)], ['Refunds / reversals', money(R.refunds)], ['Net collections', money(R.netCollections)],
    ['Outstanding balance', money(R.outstanding)], ['Expenses', money(R.expenses)],
    ['Net income = net collections - expenses', R.netIncome === null ? 'n/a (category filter)' : money(R.netIncome)]];
  table(['Measure', 'Amount'], S.map((r, i) => Object.assign(r, { bold: [2, 5, 8].includes(i) })), [120, 50]);

  section('BY PERIOD');
  const keys = Object.keys(R.byPeriod).sort();
  const pr = keys.map(k => { const b = R.byPeriod[k]; return [periodLabel(k, f.groupBy), money(b.charges), money(b.discounts), money(b.netCharges), money(b.collections), money(b.refunds), money(b.netCollections), money(b.expenses)]; });
  pr.push(Object.assign(['TOTAL', money(R.grossCharges), money(R.discounts), money(R.netCharges), money(R.collections), money(R.refunds), money(R.netCollections), money(R.expenses)], { bold: true }));
  table(['Period', 'Gross charges', 'Discounts', 'Net charges', 'Collections', 'Refunds', 'Net collections', 'Expenses'], pr, [45, 32, 28, 32, 32, 28, 34, 30]);

  section('COLLECTIONS BY PAYMENT METHOD');
  table(['Method', 'Collections', 'Refunds', 'Net collections', 'Share'],
    Object.entries(R.byMethod).map(([k, b]) => [k, money(b.collections), money(b.refunds), money(b.netCollections), R.netCollections ? Math.round(b.netCollections / R.netCollections * 100) + '%' : '-']), [60, 40, 40, 40, 25]);

  section('BY TREATMENT CATEGORY');
  table(['Category', 'Procedures', 'Net charges', 'Net collections', 'Outstanding'],
    Object.entries(R.byCategory).map(([k, b]) => [k, String(b.count), money(b.netCharges), money(b.netCollections), money(b.outstanding)]), [60, 25, 40, 40, 40]);

  section('BY BRANCH');
  table(['Branch', 'Net charges', 'Net collections', 'Outstanding', 'Expenses'],
    Object.entries(R.byBranch).map(([k, b]) => [k, money(b.netCharges), money(b.netCollections), money(b.outstanding), money(b.expenses)]), [60, 40, 40, 40, 40]);

  const C = _fr.compare;
  if (C) {
    section(`MONTHLY COMPARISON ${C.y - 1} vs ${C.y} (same branch/category filters)`);
    const rr = C.rows.map(r => [MONTHS[r.m], money(r.cb), money(r.ca), money(r.b), money(r.a), r.b ? ((r.a - r.b) / Math.abs(r.b) * 100).toFixed(1) + '%' : '-']);
    rr.push(Object.assign(['YEAR', money(C.tot.cb), money(C.tot.ca), money(C.tot.b), money(C.tot.a), C.tot.b ? ((C.tot.a - C.tot.b) / Math.abs(C.tot.b) * 100).toFixed(1) + '%' : '-'], { bold: true }));
    table(['Month', `Net charges ${C.y - 1}`, `Net charges ${C.y}`, `Net coll. ${C.y - 1}`, `Net coll. ${C.y}`, 'Change'], rr, [30, 40, 40, 40, 40, 25]);
  }

  const owed = Object.values(R.outstandingByPatient).sort((a, b) => b.balance - a.balance);
  if (owed.length) {
    section('OUTSTANDING BALANCES BY PATIENT');
    table(['Patient', 'Entries', 'Oldest unpaid', 'Outstanding'], owed.map(o => [o.patient, String(o.entries), fmtDate(o.oldest), money(o.balance)]), [90, 25, 40, 40]);
  }

  if (y > 185) { doc.addPage(); y = 18; }
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(107, 126, 133);
  doc.text('Charges are counted by treatment date; collections, refunds and expenses by their transaction date. Collections are cash received, not profit.', L, y);
  doc.text(`Generated ${new Date().toLocaleString('en-PH')} by ${typeof getDisplayName === 'function' ? getDisplayName(currentUser) : 'staff'}.`, L, y + 4.5);
  doc.save(`DMY_Financial_Report_${f.from}_to_${f.to}.pdf`);
}
