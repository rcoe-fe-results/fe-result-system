// ============================================================
// ui-utils.js — Shared UI helpers
// ============================================================

const UI = (() => {
  // ── Toast notifications ───────────────────────────────────
  let _toastTimer = null;

  function toast(msg, type = 'info', duration = 3500) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show ' + type;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  // ── Modal ─────────────────────────────────────────────────
  function showModal(title, bodyHTML, { onConfirm, confirmLabel = 'Confirm', danger = false } = {}) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHTML;
    const btn = document.getElementById('modal-confirm');
    btn.textContent = confirmLabel;
    btn.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    btn.onclick = () => { hideModal(); onConfirm && onConfirm(); };
    document.getElementById('modal').classList.add('open');
  }

  function hideModal() {
    document.getElementById('modal').classList.remove('open');
  }

  // ── Spinner ───────────────────────────────────────────────
  function showSpinner(msg = 'Loading…') {
    const el = document.getElementById('spinner');
    if (el) { el.querySelector('.spinner-msg').textContent = msg; el.classList.add('visible'); }
  }

  function hideSpinner() {
    const el = document.getElementById('spinner');
    if (el) el.classList.remove('visible');
  }

  // ── Select builder ────────────────────────────────────────
  function buildSelect(id, options, placeholder = '— select —', valueKey = null, labelKey = null) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `<option value="">${placeholder}</option>`;
    options.forEach(o => {
      const val   = valueKey ? o[valueKey] : o;
      const label = labelKey ? o[labelKey] : o;
      el.innerHTML += `<option value="${esc(val)}">${esc(label)}</option>`;
    });
  }

  // ── Export to CSV (opens as Excel-compatible) ─────────────
  function exportCSV(filename, headers, rows) {
    const BOM = '\uFEFF';
    const csvContent = [headers, ...rows]
      .map(r => r.map(c => `"${String(c ?? '').replace(/"/g,'""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename + '.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Escape HTML ───────────────────────────────────────────
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Cell class helper ─────────────────────────────────────
  function markClass(parsed) {
    if (!parsed || parsed.value === null) return 'cell-empty';
    if (parsed.absent) return 'cell-absent';
    if (parsed.grace)  return 'cell-grace';
    return 'cell-ok';
  }

  // ── Result badge ──────────────────────────────────────────
  function resultBadge(result) {
    if (!result) return '<span class="badge badge-pending">—</span>';
    const cls = { Pass:'badge-pass', Fail:'badge-fail', AB:'badge-ab' }[result] || 'badge-pending';
    return `<span class="badge ${cls}">${esc(result)}</span>`;
  }

  // ── Attempt type badge ────────────────────────────────────
  function attemptBadge(type) {
    const cls = { Regular:'badge-regular', Reval:'badge-reval', KT:'badge-kt', Grace:'badge-grace' }[type] || '';
    return `<span class="badge ${cls}">${esc(type)}</span>`;
  }

  return { toast, showModal, hideModal, showSpinner, hideSpinner, buildSelect, exportCSV, esc, markClass, resultBadge, attemptBadge };
})();
