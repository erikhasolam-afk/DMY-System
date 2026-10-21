/* ═══════════════════════════════════════════════════════════════
   ledger.js — Treatment Ledger & Payment Module
   ---------------------------------------------------------------
   Three separate quantities, never mixed:
     • CHARGED   = fee for a procedure (minus discount = net charge)
     • COLLECTED = actual money received  → rows in `payments`
     • BALANCE   = net charge − collected (computed by the database)
   Every write goes through a database function that validates it,
   locks the ledger row, and is idempotent (no duplicate submissions).
   Corrections are new rows (refund / reversal / audited adjustment);
   nothing financial is ever silently edited or deleted.
   ═══════════════════════════════════════════════════════════════ */

let paymentStore = [];   // every payment / refund / reversal row
let expenseStore = [];   // active + voided expenses

async function loadPaymentsFromSupabase() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.from('payments').select('*').order('created_at', { ascending: true });
    if (error) { reportLoadError('payments', error); return; }
    paymentStore = (data || []).map(normalizePayment);
    afterLedgerChange();
  } catch (e) { console.warn('[Ledger] payments skipped:', e.message); }
}
async function loadExpensesFromSupabase() {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.from('expenses').select('*').order('expense_date', { ascending: false });
    if (error) { console.warn('[Ledger] expenses:', error.message); return; }
    expenseStore = (data || []).map(e => ({ ...e, amount: Number(e.amount) || 0 }));
    if (typeof renderFinancialReport === 'function' && document.getElementById('page-reports')?.classList.contains('active')) renderFinancialReport();
  } catch (e) { console.warn('[Ledger] expenses skipped:', e.message); }
}
setTimeout(loadPaymentsFromSupabase, 900);
setTimeout(loadExpensesFromSupabase, 950);

function normalizePayment(p) {
  return { ...p, amount: Number(p.amount) || 0, signed: (p.kind === 'payment' ? 1 : -1) * (Number(p.amount) || 0) };
}

/* Treatment row from DB → txStore entry (keeps the old field names used by pdf.js / charts.js) */
function normalizeTx(r) {
  return {
    id: r.id, patient_id: r.patient_id || null, patient_name: r.patient_name, dentist_id: r.dentist_id || null,
    date: r.date, tooth: r.tooth || '—', procedure: r.procedure, dentist: r.dentist || '—',
    charged: Number(r.charged) || 0, discount: Number(r.discount) || 0,
    paid: Number(r.paid) || 0, balance: Number(r.balance) || 0,
    next: r.next_appt || '—', category: r.category || procedureCategory(r.procedure),
    branch: r.branch || '', status: r.status || 'active', notes: r.notes || '',
    void_reason: r.void_reason || '',
  };
}

function allTxEntries() {
  const out = [];
  Object.entries(typeof txStore !== 'undefined' ? txStore : {}).forEach(([name, arr]) => arr.forEach(e => out.push({ ...e, patient: name })));
  return out;
}
function findTx(id) { return allTxEntries().find(e => e.id === id) || null; }

/* Replace one treatment in txStore with fresh data from the DB */
function upsertTxInStore(row) {
  const e = normalizeTx(row);
  // remove from wherever it is (patient may have been renamed)
  Object.keys(txStore).forEach(k => { txStore[k] = txStore[k].filter(x => x.id !== e.id); });
  (txStore[e.patient_name] ||= []).push(e);
  txStore[e.patient_name].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return e;
}
async function refreshTx(id) {
  const { data, error } = await supabase.from('treatments').select('*').eq('id', id).single();
  if (error) throw error;
  return upsertTxInStore(data);
}

/* Re-render everything that shows money */
function afterLedgerChange() {
  if (typeof currentTxPatient !== 'undefined' && currentTxPatient && typeof renderTxTable === 'function') renderTxTable(currentTxPatient);
  if (typeof updateReportsData === 'function') updateReportsData();
  if (typeof renderFinancialReport === 'function' && document.getElementById('page-reports')?.classList.contains('active')) renderFinancialReport();
  if (typeof refreshProfileIfOpen === 'function') refreshProfileIfOpen();
}

function paymentsForTx(id)      { return paymentStore.filter(p => p.treatment_id === id); }
function paymentsForPatient(nm) { return paymentStore.filter(p => p.patient_name === nm); }
function remainingReversible(p) {
  const done = paymentStore.filter(x => x.reverses_payment_id === p.id).reduce((s, x) => s + x.amount, 0);
  return round2(p.amount - done);
}

/* ═══════════ Record a payment ═══════════ */
function openPaymentDialog(txId) {
  const t = findTx(txId);
  if (!t) return notif('Treatment not found — reload the page.', 'al-i');
  if (t.status === 'voided') return notif('This treatment was voided.', 'al-i');
  if (t.balance <= 0) return notif('This treatment is fully paid.', 'al-s');
  const reqId = newRequestId();   // one key per dialog → double clicks / retries can't double-charge
  openDialog({
    title: '💳 Record Payment',
    confirmText: '💾 Record Payment',
    body: `
      <div class="ledger-summary">
        <div><span>Patient</span><b>${esc(t.patient)}</b></div>
        <div><span>Procedure</span><b>${esc(t.procedure)} · ${fmtDate(t.date)}</b></div>
        <div><span>Net charge</span><b>${peso(t.charged - t.discount)}</b></div>
        <div><span>Collected so far</span><b style="color:#3B6D11">${peso(t.paid)}</b></div>
        <div><span>Balance</span><b style="color:#D85A30">${peso(t.balance)}</b></div>
      </div>
      <div class="fr c2">
        <div class="fg"><label class="fl">Amount (₱) *</label><input class="fc" type="number" min="0.01" step="0.01" id="pay-amt" value="${t.balance.toFixed(2)}"/></div>
        <div class="fg"><label class="fl">Payment date *</label><input class="fc" type="date" id="pay-date" value="${localISODate()}" max="${localISODate()}"/></div>
      </div>
      <div class="fr c2">
        <div class="fg"><label class="fl">Method *</label><select class="fc" id="pay-method">${optionsHtml(PAYMENT_METHODS, 'Cash')}</select></div>
        <div class="fg"><label class="fl">Reference no. <span id="pay-ref-req" style="color:var(--o)"></span></label><input class="fc" id="pay-ref" placeholder="e.g. GCash ref / OR / check no."/></div>
      </div>
      <div class="fg"><label class="fl">Notes</label><input class="fc" id="pay-notes" placeholder="Optional"/></div>
      <div style="font-size:11px;color:var(--mu);margin-top:8px">Recorded under your account with a receipt number. Payments cannot be edited later — use Refund / Reverse to correct.</div>`,
    onOpen(d) {
      const m = d.q('#pay-method'), r = d.q('#pay-ref-req');
      const upd = () => r.textContent = METHODS_NEEDING_REF.includes(m.value) ? '(required)' : '';
      m.addEventListener('change', upd); upd();
    },
    async onConfirm(d) {
      const amt = round2(d.val('#pay-amt'));
      const method = d.val('#pay-method');
      const ref = d.val('#pay-ref');
      if (!(amt > 0)) { d.error('Enter an amount greater than zero.'); return false; }
      if (amt > t.balance + 0.001) { d.error(`Amount is more than the balance (${peso(t.balance)}).`); return false; }
      if (METHODS_NEEDING_REF.includes(method) && !ref) { d.error(`Reference number is required for ${method}.`); return false; }
      const { data, error } = await supabase.rpc('record_payment', {
        p_treatment_id: t.id, p_amount: amt, p_method: method, p_reference: ref || null,
        p_paid_at: d.val('#pay-date') || null, p_notes: d.val('#pay-notes') || null, p_client_request_id: reqId,
      });
      if (error) throw error;
      if (!paymentStore.some(p => p.id === data.id)) paymentStore.push(normalizePayment(data));
      await refreshTx(t.id);
      afterLedgerChange();
      notif(`Payment ${data.receipt_no} recorded: ${peso(data.amount)}`, 'al-s');
      if (confirm('Payment recorded (' + data.receipt_no + '). Print a receipt?')) printReceipt(data.id);
    },
  });
}

/* ═══════════ Payment history (per treatment or per patient) ═══════════ */
function paymentRowsHtml(rows, withActions) {
  if (!rows.length) return `<tr><td colspan="${withActions ? 8 : 7}" class="empty-cell">No payments recorded yet.</td></tr>`;
  return rows.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(p => {
    const isPay = p.kind === 'payment';
    const left = isPay ? remainingReversible(p) : 0;
    const kindBadge = isPay ? '<span class="badge b-d">Payment</span>'
      : `<span class="badge" style="background:#FCEBEB;color:#B91C1C">${p.kind === 'refund' ? 'Refund' : 'Reversal'}</span>`;
    return `<tr>
      <td style="font-family:var(--fh);font-weight:700">${esc(p.receipt_no)}</td>
      <td>${fmtDate(p.paid_at)}</td>
      <td>${kindBadge}</td>
      <td style="font-weight:700;color:${isPay ? '#3B6D11' : '#B91C1C'}">${isPay ? '' : '−'}${peso(p.amount)}</td>
      <td>${esc(p.method)}${p.reference_no ? `<div class="sub">${esc(p.reference_no)}</div>` : ''}</td>
      <td>${esc(p.recorded_by_name || '—')}<div class="sub">${fmtDateTime(p.created_at)}</div></td>
      <td class="sub" style="max-width:180px">${esc(p.notes || '')}</td>
      ${withActions ? `<td style="white-space:nowrap">
        <button class="btn btn-sm btn-gray" title="Print receipt" onclick="printReceipt('${p.id}')">🖨</button>
        ${isPay && left > 0 && can('correct') ? `<button class="btn btn-sm btn-danger-o" onclick="openReverseDialog('${p.id}')">↩ Refund / Reverse</button>` : ''}
      </td>` : ''}
    </tr>`;
  }).join('');
}

function openPaymentHistory(txId) {
  const t = findTx(txId);
  if (!t) return;
  const rows = paymentsForTx(txId);
  openDialog({
    title: `🧾 Payments — ${esc(t.procedure)} (${fmtDate(t.date)})`,
    wide: true, hideConfirm: true,
    body: `
      <div class="ledger-summary">
        <div><span>Charged</span><b>${peso(t.charged)}</b></div>
        <div><span>Discount</span><b>${peso(t.discount)}</b></div>
        <div><span>Net charge</span><b>${peso(t.charged - t.discount)}</b></div>
        <div><span>Collected</span><b style="color:#3B6D11">${peso(t.paid)}</b></div>
        <div><span>Balance</span><b style="color:#D85A30">${peso(t.balance)}</b></div>
      </div>
      ${t.status === 'voided' ? `<div class="alert al-i">This treatment was voided: ${esc(t.void_reason)}</div>` : ''}
      <div style="overflow-x:auto"><table><thead><tr><th>Receipt</th><th>Date</th><th>Type</th><th>Amount</th><th>Method / Ref</th><th>Recorded by</th><th>Notes</th><th></th></tr></thead>
      <tbody>${paymentRowsHtml(rows, true)}</tbody></table></div>
      <div class="bg" style="margin-top:14px">
        ${t.status === 'active' && t.balance > 0 && can('pay') ? `<button class="btn btn-p btn-sm" onclick="closeTopDialog();openPaymentDialog('${t.id}')">💳 Record Payment</button>` : ''}
        ${t.status === 'active' && can('correct') ? `<button class="btn btn-o btn-sm" onclick="openAdjustDialog('${t.id}')">✏️ Correct Charge</button>` : ''}
        ${t.status === 'active' && t.paid === 0 && can('correct') ? `<button class="btn btn-sm btn-danger-o" onclick="openVoidDialog('${t.id}')">🚫 Void Entry</button>` : ''}
        ${can('audit') ? `<button class="btn btn-gray btn-sm" onclick="openAuditTrail('${t.id}')">📜 Audit Trail</button>` : ''}
      </div>`,
  });
}

/* ═══════════ Refund / reversal ═══════════ */
function openReverseDialog(paymentId) {
  const p = paymentStore.find(x => x.id === paymentId);
  if (!p) return;
  const left = remainingReversible(p);
  const reqId = newRequestId();
  openDialog({
    title: `↩ Refund / Reverse ${esc(p.receipt_no)}`,
    confirmText: 'Confirm',
    body: `
      <div class="ledger-summary">
        <div><span>Original payment</span><b>${peso(p.amount)} · ${esc(p.method)} · ${fmtDate(p.paid_at)}</b></div>
        <div><span>Can still be refunded/reversed</span><b>${peso(left)}</b></div>
      </div>
      <div class="fg" style="margin-bottom:12px"><label class="fl">Type *</label>
        <label class="fck" style="margin:4px 0"><input type="radio" name="rv-kind" value="refund" checked/> <b>Refund</b>&nbsp;— money was given back to the patient</label>
        <label class="fck"><input type="radio" name="rv-kind" value="reversal"/> <b>Reversal</b>&nbsp;— the payment was recorded by mistake (wrong amount / patient)</label>
      </div>
      <div class="fr c2">
        <div class="fg"><label class="fl">Amount (₱) *</label><input class="fc" type="number" step="0.01" min="0.01" max="${left}" id="rv-amt" value="${left.toFixed(2)}"/></div>
        <div class="fg"><label class="fl">Refund method</label><select class="fc" id="rv-method">${optionsHtml(PAYMENT_METHODS, PAYMENT_METHODS.includes(p.method) ? p.method : 'Cash')}</select></div>
      </div>
      <div class="fg"><label class="fl">Reason * <span style="font-weight:400;text-transform:none">(kept in the audit trail)</span></label><textarea class="fc" id="rv-reason" rows="2"></textarea></div>`,
    async onConfirm(d) {
      const kind = d.q('input[name="rv-kind"]:checked').value;
      const amt = round2(d.val('#rv-amt'));
      const reason = d.val('#rv-reason');
      if (!(amt > 0) || amt > left + 0.001) { d.error(`Amount must be between ₱0.01 and ${peso(left)}.`); return false; }
      if (!reason) { d.error('Please give a reason.'); return false; }
      const { data, error } = await supabase.rpc('reverse_payment', {
        p_payment_id: p.id, p_amount: amt, p_kind: kind, p_reason: reason,
        p_method: d.val('#rv-method') || null, p_client_request_id: reqId,
      });
      if (error) throw error;
      if (!paymentStore.some(x => x.id === data.id)) paymentStore.push(normalizePayment(data));
      await refreshTx(p.treatment_id);
      closeAllDialogs();   // close the stale history view
      afterLedgerChange();
      notif(`${kind === 'refund' ? 'Refund' : 'Reversal'} ${data.receipt_no} recorded.`, 'al-s');
    },
  });
}

/* ═══════════ Correct a charge (audited) ═══════════ */
function openAdjustDialog(txId) {
  const t = findTx(txId);
  if (!t) return;
  openDialog({
    title: '✏️ Correct Charge',
    confirmText: 'Save Correction',
    body: `
      <div class="alert al-i">Already collected on this entry: <b>&nbsp;${peso(t.paid)}</b>. The new net charge cannot be lower than that.</div>
      <div class="fr c2">
        <div class="fg"><label class="fl">Charged (₱)</label><input class="fc" type="number" step="0.01" min="0" id="adj-ch" value="${t.charged}"/></div>
        <div class="fg"><label class="fl">Discount (₱)</label><input class="fc" type="number" step="0.01" min="0" id="adj-disc" value="${t.discount}"/></div>
      </div>
      <div class="fg"><label class="fl">Reason for correction *</label><textarea class="fc" id="adj-reason" rows="2"></textarea></div>`,
    async onConfirm(d) {
      const ch = round2(d.val('#adj-ch')), disc = round2(d.val('#adj-disc')), reason = d.val('#adj-reason');
      if (ch < 0 || disc < 0 || disc > ch) { d.error('Discount must be between ₱0 and the charged amount.'); return false; }
      if (ch - disc < t.paid) { d.error(`Net charge cannot be below what was already collected (${peso(t.paid)}). Refund first.`); return false; }
      if (!reason) { d.error('Please give a reason.'); return false; }
      const { data, error } = await supabase.rpc('adjust_treatment_charge', { p_treatment_id: t.id, p_charged: ch, p_discount: disc, p_reason: reason });
      if (error) throw error;
      upsertTxInStore(data);
      closeAllDialogs();
      afterLedgerChange();
      notif('Charge corrected (logged in audit trail).', 'al-s');
    },
  });
}

/* ═══════════ Void an entry made in error ═══════════ */
function openVoidDialog(txId) {
  const t = findTx(txId);
  if (!t) return;
  openDialog({
    title: '🚫 Void Treatment Entry',
    confirmText: 'Void Entry',
    body: `
      <p style="font-size:13px;margin-bottom:10px">The entry <b>${esc(t.procedure)}</b> on ${fmtDate(t.date)} (${peso(t.charged)}) will be kept in the records but marked <b>VOIDED</b> and excluded from all totals.</p>
      <div class="fg"><label class="fl">Reason *</label><textarea class="fc" id="void-reason" rows="2" placeholder="e.g. Entered on the wrong patient"></textarea></div>`,
    async onConfirm(d) {
      const reason = d.val('#void-reason');
      if (!reason) { d.error('Please give a reason.'); return false; }
      const { data, error } = await supabase.rpc('void_treatment', { p_treatment_id: t.id, p_reason: reason });
      if (error) throw error;
      upsertTxInStore(data);
      closeAllDialogs();
      afterLedgerChange();
      notif('Treatment entry voided.', 'al-s');
    },
  });
}

/* ═══════════ Audit trail ═══════════ */
async function openAuditTrail(recordId) {
  const pIds = paymentsForTx(recordId).map(p => p.id);
  const ids = [recordId, ...pIds];
  const { data, error } = await supabase.from('ledger_audit').select('*').in('record_id', ids).order('at', { ascending: false }).order('id', { ascending: false });
  if (error) return notif(friendlyDbError(error), 'al-i');
  const describe = a => {
    const o = a.old_data || {}, n = a.new_data || {};
    if (a.table_name === 'payments') return `${n.kind} ${n.receipt_no}: ${peso(n.amount)} (${n.method})`;
    if (a.action === 'INSERT') return `Entry created: ${n.procedure} — charged ${peso(n.charged)}, discount ${peso(n.discount)}`;
    const ch = [];
    ['charged', 'discount', 'status', 'patient_name', 'procedure', 'date'].forEach(k => {
      if (String(o[k]) !== String(n[k])) ch.push(`${k}: ${esc(o[k])} → ${esc(n[k])}`);
    });
    return ch.join('; ') || 'Updated';
  };
  openDialog({
    title: '📜 Audit Trail', wide: true, hideConfirm: true,
    body: `<table><thead><tr><th>When</th><th>By</th><th>Change</th><th>Reason</th></tr></thead><tbody>
      ${(data || []).map(a => `<tr><td>${fmtDateTime(a.at)}</td><td>${esc(a.actor_name || '—')}</td><td>${esc(describe(a))}</td><td>${esc(a.reason || '')}</td></tr>`).join('')
        || '<tr><td colspan="4" class="empty-cell">No audit entries.</td></tr>'}
    </tbody></table>`,
  });
}

/* ═══════════ Printable official receipt ═══════════ */
function printReceipt(paymentId) {
  const p = paymentStore.find(x => x.id === paymentId);
  if (!p) return;
  const t = findTx(p.treatment_id) || {};
  const clinic = refData.settings?.clinic_name || 'DMY Dental Clinic';
  const w = window.open('', '_blank', 'width=420,height=640');
  if (!w) return notif('Allow pop-ups to print receipts.', 'al-i');
  const title = p.kind === 'payment' ? 'PAYMENT RECEIPT' : (p.kind === 'refund' ? 'REFUND SLIP' : 'REVERSAL SLIP');
  w.document.write(`<!doctype html><html><head><title>${esc(p.receipt_no)}</title>
  <style>body{font-family:Arial,sans-serif;font-size:13px;color:#1A2E35;padding:24px;max-width:360px;margin:auto}
  h1{font-size:17px;margin:0;color:#F47B20}h2{font-size:12px;letter-spacing:1px;margin:14px 0 10px;border-top:2px solid #F47B20;padding-top:10px}
  table{width:100%;border-collapse:collapse}td{padding:4px 0;vertical-align:top}td:last-child{text-align:right;font-weight:bold}
  .big{font-size:20px;color:${p.kind === 'payment' ? '#3B6D11' : '#B91C1C'}}.mu{color:#6B7E85;font-size:11px}</style></head><body>
  <h1>${esc(clinic)}</h1>
  <div class="mu">${esc(refData.settings?.clinic_address || '')} ${esc(refData.settings?.clinic_phone || '')}</div>
  <h2>${title}</h2>
  <table>
    <tr><td>Receipt no.</td><td>${esc(p.receipt_no)}</td></tr>
    <tr><td>Date</td><td>${fmtDate(p.paid_at)}</td></tr>
    <tr><td>Patient</td><td>${esc(p.patient_name)}</td></tr>
    <tr><td>Procedure</td><td>${esc(t.procedure || '—')} (${fmtDate(t.date)})</td></tr>
    <tr><td>Method</td><td>${esc(p.method)}${p.reference_no ? ' · ' + esc(p.reference_no) : ''}</td></tr>
    <tr><td>Amount</td><td class="big">${p.kind === 'payment' ? '' : '−'}${peso(p.amount)}</td></tr>
    <tr><td colspan="2"><hr style="border:none;border-top:1px dashed #ccc"></td></tr>
    <tr><td>Net charge</td><td>${peso((t.charged || 0) - (t.discount || 0))}</td></tr>
    <tr><td>Total collected</td><td>${peso(t.paid || 0)}</td></tr>
    <tr><td>Remaining balance</td><td>${peso(t.balance || 0)}</td></tr>
  </table>
  ${p.notes ? `<p class="mu">Note: ${esc(p.notes)}</p>` : ''}
  <p class="mu" style="margin-top:18px">Received by: ${esc(p.recorded_by_name || '—')}<br>Printed ${new Date().toLocaleString('en-PH')}</p>
  <script>window.onload=()=>{window.print();}<\/script></body></html>`);
  w.document.close();
}

/* ═══════════════════════════════════════════════════════════════
   computeFinancials — the ONE calculation used by the dashboard,
   Reports page and every PDF/CSV export, so the numbers always match.
     charges      : treatments (status active) by TREATMENT date
     collections  : payment rows by PAYMENT date
     refunds      : refund + reversal rows by their date
     outstanding  : balance still owed on the treatments in range
     net income   : net collections − expenses  (only when not filtered by category)
   filters: { from, to, branch, category, groupBy: 'day'|'week'|'month' }
   ═══════════════════════════════════════════════════════════════ */
function computeFinancials(f = {}) {
  const from = f.from || '0000-01-01', to = f.to || '9999-12-31';
  const inRange = d => d && d >= from && d <= to;
  const okBranch = b => !f.branch || (b || '') === f.branch;
  const okCat = c => !f.category || c === f.category;
  const groupBy = f.groupBy || 'month';
  const keyOf = d => groupBy === 'day' ? d : groupBy === 'week' ? startOfWeek(d) : d.slice(0, 7);

  const txs = allTxEntries();
  const txById = Object.fromEntries(txs.map(t => [t.id, t]));
  const activeTx = txs.filter(t => t.status !== 'voided' && inRange(t.date) && okBranch(t.branch) && okCat(t.category));

  const pays = paymentStore.filter(p => {
    const t = txById[p.treatment_id];
    const cat = t ? t.category : 'Other';
    return inRange(p.paid_at) && okBranch(p.branch || t?.branch) && okCat(cat);
  });
  const exps = expenseStore.filter(e => e.status === 'active' && inRange(e.expense_date) && okBranch(e.branch));

  const R = {
    filters: { ...f, from, to, groupBy },
    grossCharges: 0, discounts: 0, netCharges: 0,
    collections: 0, refunds: 0, netCollections: 0,
    outstanding: 0, credits: 0, expenses: 0, netIncome: null,
    procedures: activeTx.length, paymentsCount: 0,
    byPeriod: {}, byMethod: {}, byCategory: {}, byBranch: {}, byProcedure: {}, byExpenseCategory: {},
    outstandingByPatient: {},
  };
  const bucket = (obj, k) => (obj[k] ||= { charges: 0, discounts: 0, netCharges: 0, collections: 0, refunds: 0, netCollections: 0, outstanding: 0, expenses: 0, count: 0 });

  activeTx.forEach(t => {
    const net = t.charged - t.discount;
    R.grossCharges += t.charged; R.discounts += t.discount; R.netCharges += net;
    if (t.balance > 0) R.outstanding += t.balance; else if (t.balance < 0) R.credits += -t.balance;
    for (const [obj, k] of [[R.byPeriod, keyOf(t.date)], [R.byCategory, t.category], [R.byBranch, t.branch || '(no branch)'], [R.byProcedure, t.procedure]]) {
      const b = bucket(obj, k); b.charges += t.charged; b.discounts += t.discount; b.netCharges += net; b.count++;
      if (obj !== R.byPeriod && t.balance > 0) b.outstanding += t.balance;
    }
    if (t.balance > 0) {
      const o = (R.outstandingByPatient[t.patient] ||= { patient: t.patient, balance: 0, entries: 0, oldest: t.date });
      o.balance += t.balance; o.entries++; if (t.date < o.oldest) o.oldest = t.date;
    }
  });

  pays.forEach(p => {
    const t = txById[p.treatment_id];
    const cat = t ? t.category : 'Other', br = p.branch || t?.branch || '(no branch)', proc = t ? t.procedure : '—';
    const isPay = p.kind === 'payment';
    if (isPay) { R.collections += p.amount; R.paymentsCount++; } else R.refunds += p.amount;
    const m = bucket(R.byMethod, p.method);
    for (const b of [bucket(R.byPeriod, keyOf(p.paid_at)), bucket(R.byCategory, cat), bucket(R.byBranch, br), bucket(R.byProcedure, proc), m]) {
      if (isPay) b.collections += p.amount; else b.refunds += p.amount;
      b.netCollections = b.collections - b.refunds;
    }
  });

  exps.forEach(e => {
    R.expenses += e.amount;
    bucket(R.byPeriod, keyOf(e.expense_date)).expenses += e.amount;
    bucket(R.byBranch, e.branch || '(no branch)').expenses += e.amount;
    bucket(R.byExpenseCategory, e.category).expenses += e.amount;
  });

  R.netCollections = R.collections - R.refunds;
  if (!f.category) R.netIncome = R.netCollections - R.expenses;
  // round everything once
  ['grossCharges','discounts','netCharges','collections','refunds','netCollections','outstanding','credits','expenses'].forEach(k => R[k] = round2(R[k]));
  if (R.netIncome !== null) R.netIncome = round2(R.netIncome);
  return R;
}
