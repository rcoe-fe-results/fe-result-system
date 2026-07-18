// ============================================================
// app.js — MU FYE Result Management System
// Main controller — all screen logic
// ============================================================

// ── App bootstrap ────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  Auth.init(_onAuthChange);
  _bindModalClose();
  _bindNav();
});

function _onAuthChange(user) {
  if (!user) {
    _showScreen('login');
    return;
  }
  _showScreen('loading');
  UI.showSpinner('Loading student and session data…');
  State.loadAll().then(() => {
    UI.hideSpinner();
    _buildNav(user);
    _showScreen('app');
    showTab('bulk-entry');
  }).catch(err => {
    UI.hideSpinner();
    UI.toast('Failed to load data: ' + err.message, 'error', 8000);
    _showScreen('app');
  });
}

function _showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('hidden', s.id !== 'screen-' + name));
}

// ── Navigation ────────────────────────────────────────────────
function _buildNav(user) {
  const info = document.getElementById('user-info');
  if (info) {
    info.innerHTML = `
      <img src="${UI.esc(user.picture)}" class="avatar" alt="">
      <span class="user-name">${UI.esc(user.name)}</span>
      <span class="user-role role-${user.role}">${user.role === 'admin' ? 'Admin' : 'Faculty'}</span>
    `;
  }

  document.querySelectorAll('[data-admin-only]').forEach(el => {
    el.style.display = Auth.isAdmin() ? '' : 'none';
  });
}

function _bindNav() {
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
  document.getElementById('sign-out-btn')?.addEventListener('click', () => {
    UI.showModal('Sign out', 'Sign out of the Result Management System?', {
      confirmLabel: 'Sign out', onConfirm: Auth.signOut
    });
  });
}

function showTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('hidden', p.id !== 'tab-' + tabId));
  const init = TAB_INIT[tabId];
  if (init) init();
}

const TAB_INIT = {
  'bulk-entry':    initBulkEntry,
  'single-entry':  initSingleEntry,
  'progress':      initProgress,
  'reports':       initReports,
  'admin':         initAdmin,
};

function _bindModalClose() {
  document.getElementById('modal-cancel')?.addEventListener('click', UI.hideModal);
  document.getElementById('modal')?.addEventListener('click', e => {
    if (e.target.id === 'modal') UI.hideModal();
  });
}

// ═══════════════════════════════════════════════════════════════
// TAB 1 — BULK ENTRY
// ═══════════════════════════════════════════════════════════════
let bulkState = {
  session: null, semester: null, branch: null, division: null,
  subjects: [], students: [], seatMap: {},
  activeComps: new Set(['IAT','ESE','TW','Oral']),
  sortBy: 'default',
};

function initBulkEntry() {
  const sessions = State.getSessions().filter(s => s.status === 'Active');
  UI.buildSelect('be-session', sessions, '— select session —', 'id', 'name');
  document.getElementById('be-session').onchange  = _beOnSessionChange;
  document.getElementById('be-semester').onchange = _beOnSemesterChange;
  document.getElementById('be-branch').onchange   = _beOnBranchChange;
  document.getElementById('be-division').onchange = _beOnDivisionChange;
  document.getElementById('be-load-btn').onclick  = _beLoadGrid;
  document.getElementById('be-submit-btn').onclick = _beSubmit;
  document.getElementById('be-grid-area').innerHTML = '';
  document.getElementById('be-toolbar').classList.add('hidden');
  _beResetFilters();
}

function _beResetFilters() {
  ['be-semester','be-branch','be-division'].forEach(id => {
    document.getElementById(id).disabled = true;
    document.getElementById(id).value = '';
  });
  document.getElementById('be-load-btn').disabled = true;
  document.getElementById('be-submit-btn').disabled = true;
  document.getElementById('be-grid-area').innerHTML = '';
}

function _beOnSessionChange() {
  const sessionId = document.getElementById('be-session').value;
  bulkState.session = State.getSession(sessionId);
  if (!bulkState.session) return;
  const semEl = document.getElementById('be-semester');
  semEl.disabled = false;
  semEl.value = bulkState.session.semester;
  bulkState.semester = bulkState.session.semester;
  _beEnableBranch();
}

function _beOnSemesterChange() {
  bulkState.semester = Number(document.getElementById('be-semester').value);
  _beEnableBranch();
}

function _beEnableBranch() {
  const branchEl = document.getElementById('be-branch');
  branchEl.disabled = false;
  UI.buildSelect('be-branch', BRANCHES, '— select branch —');
}

// FIX 2: Division — show explicit options when multiple divisions exist
function _beOnBranchChange() {
  bulkState.branch = document.getElementById('be-branch').value;
  bulkState.division = null;
  const divs = State.getDivisions(bulkState.branch);
  const multiDiv = divs.length > 1;
  const placeholder = multiDiv ? '— select division —' : '— all divisions —';
  const options = multiDiv ? ['All', ...divs] : divs;
  UI.buildSelect('be-division', options, placeholder);
  document.getElementById('be-division').disabled = false;
  // Enable load button — no attempt type dropdown anymore
  document.getElementById('be-load-btn').disabled = false;
}

function _beOnDivisionChange() {
  const val = document.getElementById('be-division').value;
  bulkState.division = (val === 'All') ? null : (val || null);
}

function _beEnableAttempt() {
  // Kept for compatibility but no longer used in bulk entry
}

function _beLoadGrid() {
  const { session, semester, branch, division } = bulkState;

  // FIX 2: Require division choice when multiple divisions exist
  const divs = State.getDivisions(bulkState.branch || '');
  const requireDivChoice = divs.length > 1;
  const divEl = document.getElementById('be-division');

  if (!session || !branch) {
    UI.toast('Select session and branch first.', 'error'); return;
  }
  if (requireDivChoice && !divEl.value) {
    UI.toast('This branch has multiple divisions — select Div A, Div B, or All Divisions.', 'error', 5000);
    return;
  }
  if (session.semester === 2 && !sessionHasElectives(session)) {
    UI.toast('This Sem II session has no electives configured. Ask an Admin to edit the session.', 'error', 6000);
    return;
  }

  bulkState.subjects = getSubjectsForSem(semester, branch, session);

  // For Final Gazette: show all students (no KT filter)
  // KT detection is automatic at query time
  let students = State.getStudents({ branch, division: division || undefined });
  if (session.batchYear) {
    students = students.filter(s => s.batchYear === session.batchYear);
  }

  // Build seat map for this session
  const seatEntries = State.getSeatsForSession(session.id);
  bulkState.seatMap = {};
  for (const s of seatEntries) {
    bulkState.seatMap[s.uin] = s.seatNumber;
  }

  if (students.length === 0) {
    document.getElementById('be-grid-area').innerHTML = '<div class="empty-state">No students found for this selection.</div>';
    document.getElementById('be-toolbar').classList.add('hidden');
    return;
  }

  bulkState.students = students;
  bulkState.sortBy = 'default';
  bulkState.activeComps = new Set(['IAT','ESE','TW','Oral']);

  _beRenderToolbar();
  _beRenderGrid();
  document.getElementById('be-submit-btn').disabled = false;
}

// ── Toolbar: sort + column picker ────────────────────────────
function _beRenderToolbar() {
  const toolbar = document.getElementById('be-toolbar');
  toolbar.classList.remove('hidden');

  const sortEl = document.getElementById('be-sort');
  sortEl.value = bulkState.sortBy;
  sortEl.onchange = () => {
    bulkState.sortBy = sortEl.value;
    _beSortStudents();
    _beRenderGrid();
  };

  // Show session type badge
  const session = bulkState.session;
  const typeBadge = document.getElementById('be-session-type-badge');
  if (typeBadge) {
    const isFinal = session && session.entryType === 'Final Gazette';
    typeBadge.textContent = isFinal ? '📋 Final Gazette' : '📝 Preliminary';
    typeBadge.className = 'session-type-badge ' + (isFinal ? 'final-gazette' : 'preliminary');
    typeBadge.style.display = '';
  }

  const allComps = ['IAT','ESE','TW','Oral'];
  const presentComps = new Set();
  for (const subj of bulkState.subjects) {
    Object.keys(subj.marks).forEach(c => presentComps.add(c));
  }

  const picker = document.getElementById('be-col-picker');
  picker.innerHTML = '';
  for (const comp of allComps) {
    if (!presentComps.has(comp)) continue;
    const label = document.createElement('label');
    label.className = 'col-pill' + (bulkState.activeComps.has(comp) ? ' active' : '');
    label.innerHTML = `<input type="checkbox" value="${comp}" ${bulkState.activeComps.has(comp) ? 'checked' : ''}>${comp}`;
    label.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) bulkState.activeComps.add(comp);
      else bulkState.activeComps.delete(comp);
      label.classList.toggle('active', e.target.checked);
      _beRenderGrid();
    });
    picker.appendChild(label);
  }
}

function _beSortStudents() {
  const by = bulkState.sortBy;
  if (by === 'default') return;
  const seatMap = bulkState.seatMap || {};
  bulkState.students = [...bulkState.students].sort((a, b) => {
    if (by === 'name')  return a.name.localeCompare(b.name);
    if (by === 'uin')   return a.uin.localeCompare(b.uin);
    if (by === 'prn')   return (a.prn||'').localeCompare(b.prn||'');
    if (by === 'batch') return (a.batchYear||'').localeCompare(b.batchYear||'');
    if (by === 'seat') {
      const sa = seatMap[a.uin] || '';
      const sb = seatMap[b.uin] || '';
      // Numeric sort if both look like numbers, else string sort
      const na = Number(sa), nb = Number(sb);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return sa.localeCompare(sb);
    }
    return 0;
  });
}

// ── Grid render ───────────────────────────────────────────────
function _beRenderGrid() {
  const { subjects, students, activeComps, session, seatMap } = bulkState;
  const container = document.getElementById('be-grid-area');
  const isFinal   = session && session.entryType === 'Final Gazette';

  const getVisibleComps = (subj) => {
    const comps = Object.keys(subj.marks);
    if (isFinal) {
      // Final Gazette: only show ESE editable; IAT/TW/Oral shown greyed as reference
      return comps; // show all but only ESE is editable (handled per-cell)
    }
    return comps.filter(c => activeComps.size === 0 || activeComps.has(c));
  };

  const totalVisibleCols = subjects.reduce((n, s) => n + getVisibleComps(s).length, 0);

  if (totalVisibleCols === 0) {
    container.innerHTML = '<div class="empty-state">Select at least one column type above to show the grid.</div>';
    _setupMirrorScroll();
    return;
  }

  // For Final Gazette: find linked preliminary session
  const prelimSession = isFinal && session.linkedPrelimSessionId
    ? State.getSession(session.linkedPrelimSessionId)
    : null;

  const sessionTypeLabel = isFinal
    ? `<span class="session-type-inline final-gazette">📋 Final Gazette${prelimSession ? ' · linked to: ' + UI.esc(prelimSession.name) : ' · no preliminary linked'}</span>`
    : `<span class="session-type-inline preliminary">📝 Preliminary — all components editable</span>`;

  let html = `
  <div class="grid-info">
    <span>${students.length} students · ${subjects.length} subjects · ${sessionTypeLabel}</span>
    <span class="grid-legend">
      <span class="dot dot-grace"></span> Grace (e.g. 21*)
      <span class="dot dot-absent"></span> AB
      <span class="dot dot-error"></span> Invalid / over max
    </span>
  </div>
  <div class="grid-scroll-outer">
  <div class="grid-scroll-mirror" id="be-mirror"><div class="grid-scroll-mirror-inner" id="be-mirror-inner"></div></div>
  <div class="grid-scroll-wrapper" id="be-scroll"><div class="grid-scroll">
  <table class="entry-grid" id="entry-table">
    <thead>
      <tr>
        <th class="col-student sticky-col">Student</th>
        <th class="col-seat">Seat</th>
        <th class="col-branch">Branch</th>`;

  for (const subj of subjects) {
    const visComps = getVisibleComps(subj);
    if (visComps.length === 0) continue;
    html += `<th colspan="${visComps.length}" class="subj-header" title="${UI.esc(subj.name)}">${UI.esc(subj.code)}<br><small>${UI.esc(subj.name.length>20 ? subj.name.slice(0,18)+'…' : subj.name)}</small></th>`;
  }

  html += `</tr><tr><th class="sticky-col"></th><th></th><th></th>`;
  for (const subj of subjects) {
    const visComps = getVisibleComps(subj);
    for (const comp of visComps) {
      const isFinalLocked = isFinal && comp !== 'ESE';
      html += `<th class="comp-header${isFinalLocked?' locked':''}">${comp}<br><small>/${subj.marks[comp]}</small></th>`;
    }
  }
  html += `</tr></thead><tbody>`;

  for (const student of students) {
    const seatNum = seatMap[student.uin] || '—';
    html += `<tr data-uin="${UI.esc(student.uin)}">
      <td class="sticky-col student-cell">
        <div class="student-name">${UI.esc(student.name)}</div>
        <div class="student-ids">${UI.esc(student.uin)}${student.prn ? ' · ' + UI.esc(student.prn) : ''}</div>
        ${student.batchYear ? `<div class="student-batch">Batch ${UI.esc(student.batchYear)}</div>` : ''}
      </td>
      <td class="seat-cell">${UI.esc(seatNum)}</td>
      <td class="branch-cell">${UI.esc(student.branch)}</td>`;

    for (const subj of subjects) {
      const visComps = getVisibleComps(subj);
      if (visComps.length === 0) continue;

      // Prelim entry: look up any previously submitted value for this session to pre-fill
      const prevEntry = State.getLatestEntryForSubject(student.uin, subj.code, session.id);

      // For Final Gazette: look up the Preliminary entry for pre-fill
      const prelimEntry = isFinal && session.linkedPrelimSessionId
        ? State.getLatestEntryForSubject(student.uin, subj.code, session.linkedPrelimSessionId)
        : null;

      for (const comp of visComps) {
        if (isFinal) {
          // Final Gazette mode
          if (comp !== 'ESE') {
            // Non-ESE: show pre-filled from preliminary (greyed, read-only)
            const prelimVal = prelimEntry ? prelimEntry[comp.toLowerCase() + 'Marks'] : '';
            html += `<td class="cell-locked"><span class="locked-val">${UI.esc(prelimVal || '—')}</span></td>`;
          } else {
            // ESE: editable, pre-filled with preliminary ESE as default
            const prelimESE = prelimEntry ? (prelimEntry.eseMarks || '') : '';
            const existingFinalESE = prevEntry ? (prevEntry.eseMarks || '') : '';
            // Use existing Final Gazette value if already entered, else prelim ESE
            const defaultVal = existingFinalESE || prelimESE;
            html += `<td>
              <input type="text"
                class="mark-input${defaultVal ? ' cell-prefilled' : ''}"
                id="cell-${UI.esc(student.uin)}-${UI.esc(subj.code)}-${comp}"
                data-uin="${UI.esc(student.uin)}"
                data-code="${UI.esc(subj.code)}"
                data-comp="${comp}"
                data-max="${subj.marks[comp]}"
                data-prelim-ese="${UI.esc(prelimESE)}"
                value="${UI.esc(defaultVal)}"
                autocomplete="off" spellcheck="false"
              >
            </td>`;
          }
        } else {
          // Preliminary mode: all editable, pre-fill existing values (not greyed)
          const existingVal = prevEntry ? (prevEntry[comp.toLowerCase() + 'Marks'] || '') : '';
          html += `<td>
            <input type="text"
              class="mark-input${existingVal ? ' cell-prefilled' : ''}"
              id="cell-${UI.esc(student.uin)}-${UI.esc(subj.code)}-${comp}"
              data-uin="${UI.esc(student.uin)}"
              data-code="${UI.esc(subj.code)}"
              data-comp="${comp}"
              data-max="${subj.marks[comp]}"
              value="${UI.esc(existingVal)}"
              placeholder=""
              autocomplete="off" spellcheck="false"
            >
          </td>`;
        }
      }
    }
    html += `</tr>`;
  }

  html += `</tbody></table></div></div></div>`;
  container.innerHTML = html;

  // Validate any pre-filled values
  container.querySelectorAll('.mark-input').forEach(input => {
    if (input.value) _beOnCellInput({ target: input });
    input.addEventListener('input', _beOnCellInput);
    input.addEventListener('keydown', _beOnCellKeydown);
  });

  _setupMirrorScroll();
}

function _setupMirrorScroll() {
  const scroll  = document.getElementById('be-scroll');   // outer wrapper
  const mirror  = document.getElementById('be-mirror');
  const inner   = document.getElementById('be-mirror-inner');
  if (!scroll || !mirror || !inner) return;

  // Match inner width to the actual scrollable table inside the wrapper
  const syncWidth = () => { inner.style.width = scroll.scrollWidth + 'px'; };
  syncWidth();
  new ResizeObserver(syncWidth).observe(scroll);

  let syncing = false;
  mirror.addEventListener('scroll', () => {
    if (syncing) return; syncing = true;
    scroll.scrollLeft = mirror.scrollLeft;
    syncing = false;
  });
  scroll.addEventListener('scroll', () => {
    if (syncing) return; syncing = true;
    mirror.scrollLeft = scroll.scrollLeft;
    syncing = false;
  });
}

function _beOnCellInput(e) {
  const input  = e.target;
  const raw    = input.value.trim();
  const parsed = parseMarkValue(raw);
  const max    = Number(input.dataset.max);

  input.classList.remove('cell-grace','cell-absent','cell-error','cell-ok','cell-over-max');
  input.title = '';

  if (!raw) return;
  if (!parsed.valid)          { input.classList.add('cell-error'); input.title = 'Invalid value'; return; }
  if (parsed.absent)          { input.classList.add('cell-absent'); return; }
  if (parsed.grace)           { input.classList.add('cell-grace'); return; }
  if (parsed.value > max)     { input.classList.add('cell-over-max'); input.title = `Max allowed: ${max}`; return; }
  input.classList.add('cell-ok');
}

function _beOnCellKeydown(e) {
  if (!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown','Tab','Enter'].includes(e.key)) return;

  const allInputs = [...document.querySelectorAll('#entry-table .mark-input:not([disabled])')];
  const idx = allInputs.indexOf(e.target);
  if (idx < 0) return;

  let next = null;
  if (e.key === 'ArrowRight' || e.key === 'Tab') {
    e.preventDefault(); next = allInputs[idx + 1];
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault(); next = allInputs[idx - 1];
  } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
    e.preventDefault();
    const nextRow = e.target.closest('tr')?.nextElementSibling;
    if (nextRow) next = nextRow.querySelector(`input[data-code="${e.target.dataset.code}"][data-comp="${e.target.dataset.comp}"]`);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const prevRow = e.target.closest('tr')?.previousElementSibling;
    if (prevRow) next = prevRow.querySelector(`input[data-code="${e.target.dataset.code}"][data-comp="${e.target.dataset.comp}"]`);
  }
  if (next) { next.focus(); next.select(); }
}

async function _beSubmit() {
  const { session, students } = bulkState;

  const errorInputs = [...document.querySelectorAll('#entry-table .mark-input.cell-error, #entry-table .mark-input.cell-over-max')];
  if (errorInputs.length > 0) {
    errorInputs[0].focus();
    UI.toast(`Fix ${errorInputs.length} invalid cell(s) before submitting.`, 'error', 5000);
    return;
  }

  const isFinal = session && session.entryType === 'Final Gazette';

  // For Final Gazette: collect all ESE inputs (including pre-filled ones), skip if empty
  // For Preliminary: collect all inputs with a value
  const inputs = [...document.querySelectorAll('#entry-table .mark-input')].filter(i => {
    const val = i.value.trim();
    if (!val) return false;
    // Final Gazette: only ESE inputs are editable/relevant
    if (isFinal && i.dataset.comp !== 'ESE') return false;
    return true;
  });

  if (inputs.length === 0) {
    UI.toast('No marks entered yet.', 'info'); return;
  }

  const entriesByStudentSubject = {};
  for (const input of inputs) {
    const { uin, code, comp } = input.dataset;
    const key = uin + '||' + code;
    if (!entriesByStudentSubject[key]) entriesByStudentSubject[key] = { uin, code, marks: {} };
    entriesByStudentSubject[key].marks[comp] = parseMarkValue(input.value.trim());
  }

  const entries = Object.values(entriesByStudentSubject).map(e => ({
    uin: e.uin, subjectCode: e.code, marks: e.marks,
  }));

  const filledStudents = new Set(entries.map(e => e.uin)).size;
  const filledSubjects = entries.length;

  UI.showModal(
    'Confirm submission',
    `Save marks for <strong>${filledStudents} students</strong> × <strong>${filledSubjects} subject entries</strong>?<br>
    <small>Empty cells are skipped — you can fill the rest in a later session.</small>`,
    {
      confirmLabel: 'Save marks',
      onConfirm: async () => {
        UI.showSpinner('Writing to ledger…');
        try {
          const count = await State.submitEntries(session, entries);
          UI.hideSpinner();
          UI.toast(`✓ ${count} new ledger entries saved.`, 'success');
        } catch (err) {
          UI.hideSpinner();
          UI.toast('Error saving: ' + err.message, 'error', 8000);
        }
      }
    }
  );
}


// ═══════════════════════════════════════════════════════════════
// TAB 2 — SINGLE STUDENT ENTRY
// ═══════════════════════════════════════════════════════════════
let singleState = { student: null, session: null, subjects: [] };

function initSingleEntry() {
  const searchInput = document.getElementById('se-search');
  const resultsBox  = document.getElementById('se-results');
  searchInput.value = '';
  resultsBox.innerHTML = '';
  document.getElementById('se-student-panel').classList.add('hidden');

  searchInput.addEventListener('input', _debounce(() => {
    const q = searchInput.value.trim();
    if (q.length < 2) { resultsBox.innerHTML = ''; return; }
    const matches = State.searchStudents(q).slice(0, 10);
    resultsBox.innerHTML = matches.length ? matches.map(s =>
      `<div class="search-result" data-uin="${UI.esc(s.uin)}">
        <strong>${UI.esc(s.name)}</strong>
        <span>${UI.esc(s.uin)} · ${UI.esc(s.branch)} · Batch ${UI.esc(s.batchYear)}</span>
      </div>`
    ).join('') : '<div class="search-result muted">No students found.</div>';

    resultsBox.querySelectorAll('.search-result[data-uin]').forEach(el => {
      el.onclick = () => _seSelectStudent(el.dataset.uin);
    });
  }, 250));

  const sessions = State.getSessions().filter(s => s.status === 'Active');
  UI.buildSelect('se-session', sessions, '— select session —', 'id', 'name');
  document.getElementById('se-session').onchange = () => {
    singleState.session = State.getSession(document.getElementById('se-session').value);
    if (singleState.student) _seRenderGrid();
  };
  document.getElementById('se-submit-btn').onclick = _seSubmit;
}

function _seSelectStudent(uin) {
  singleState.student = State.getStudent(uin);
  document.getElementById('se-results').innerHTML = '';
  document.getElementById('se-search').value = singleState.student.name;

  if (!singleState.session) {
    UI.toast('Select a session first.', 'info'); return;
  }
  _seRenderGrid();
  document.getElementById('se-student-panel').classList.remove('hidden');
}

function _seRenderGrid() {
  const { student, session } = singleState;
  if (!student || !session) return;

  const isFinal  = session.entryType === 'Final Gazette';
  const subjects = getSubjectsForSem(session.semester, student.branch, session);
  singleState.subjects = subjects;

  const info = document.getElementById('se-student-info');
  info.innerHTML = `
    <div class="student-card">
      <div class="sc-name">${UI.esc(student.name)}</div>
      <div class="sc-meta">UIN: ${UI.esc(student.uin)} · PRN: ${UI.esc(student.prn || '—')} · ${UI.esc(student.branch)} · Div ${UI.esc(student.division)} · Batch ${UI.esc(student.batchYear)}</div>
      ${isFinal ? '<div style="margin-top:6px;"><span class="session-type-inline final-gazette">📋 Final Gazette — only ESE editable</span></div>' : '<div style="margin-top:6px;"><span class="session-type-inline preliminary">📝 Preliminary — all components editable</span></div>'}
    </div>`;

  let html = `<div class="single-grid">`;
  for (const subj of subjects) {
    const comps     = Object.keys(subj.marks);
    const prevEntry = State.getLatestEntryForSubject(student.uin, subj.code, session.id);
    const prelimEntry = isFinal && session.linkedPrelimSessionId
      ? State.getLatestEntryForSubject(student.uin, subj.code, session.linkedPrelimSessionId)
      : null;

    html += `
    <div class="subj-card">
      <div class="subj-card-header">
        <span class="subj-code">${UI.esc(subj.code)}</span>
        <span class="subj-name">${UI.esc(subj.name)}</span>
        <span class="subj-credits">${subj.credits} cr</span>
      </div>
      <div class="subj-inputs">`;

    for (const comp of comps) {
      if (isFinal) {
        if (comp !== 'ESE') {
          // Show prelim value greyed
          const prelimVal = prelimEntry ? (prelimEntry[comp.toLowerCase() + 'Marks'] || '—') : '—';
          html += `
            <label class="comp-label locked">
              <span>${comp}<small>/${subj.marks[comp]}</small></span>
              <input type="text" class="mark-input-single" data-code="${UI.esc(subj.code)}" data-comp="${comp}"
                data-max="${subj.marks[comp]}" value="${UI.esc(prelimVal)}" disabled autocomplete="off">
            </label>`;
        } else {
          // ESE: editable, pre-filled with existing final gazette or prelim ESE
          const existingFinal = prevEntry ? (prevEntry.eseMarks || '') : '';
          const prelimESE     = prelimEntry ? (prelimEntry.eseMarks || '') : '';
          const defaultVal    = existingFinal || prelimESE;
          html += `
            <label class="comp-label">
              <span>${comp}<small>/${subj.marks[comp]}</small></span>
              <input type="text"
                class="mark-input-single${defaultVal ? ' cell-prefilled' : ''}"
                data-code="${UI.esc(subj.code)}"
                data-comp="${comp}"
                data-max="${subj.marks[comp]}"
                value="${UI.esc(defaultVal)}"
                autocomplete="off">
            </label>`;
        }
      } else {
        // Preliminary: all editable, pre-fill existing values
        const existingVal = prevEntry ? (prevEntry[comp.toLowerCase() + 'Marks'] || '') : '';
        html += `
          <label class="comp-label">
            <span>${comp}<small>/${subj.marks[comp]}</small></span>
            <input type="text"
              class="mark-input-single${existingVal ? ' cell-prefilled' : ''}"
              data-code="${UI.esc(subj.code)}"
              data-comp="${comp}"
              data-max="${subj.marks[comp]}"
              value="${UI.esc(existingVal)}"
              autocomplete="off">
          </label>`;
      }
    }
    html += `</div></div>`;
  }
  html += `</div>`;
  document.getElementById('se-grid').innerHTML = html;

  document.querySelectorAll('.mark-input-single').forEach(i => {
    i.addEventListener('input', _beOnCellInput);
  });
}

async function _seSubmit() {
  const { student, session, subjects } = singleState;
  if (!student || !session) { UI.toast('Select a student and session.', 'error'); return; }

  const isFinal = session.entryType === 'Final Gazette';
  const inputs  = [...document.querySelectorAll('.mark-input-single:not([disabled])')];

  const subjectMap = {};
  for (const input of inputs) {
    const { code, comp } = input.dataset;
    const val = input.value.trim();
    if (!val) continue;
    if (!subjectMap[code]) subjectMap[code] = {};
    subjectMap[code][comp] = parseMarkValue(val);
  }

  const entries = Object.entries(subjectMap).map(([code, marks]) => ({ uin: student.uin, subjectCode: code, marks }));

  UI.showSpinner('Saving…');
  try {
    const count = await State.submitEntries(session, entries);
    UI.hideSpinner();
    UI.toast(`✓ ${count} entries saved for ${student.name}.`, 'success');
  } catch (err) {
    UI.hideSpinner();
    UI.toast('Error: ' + err.message, 'error', 8000);
  }
}


// ═══════════════════════════════════════════════════════════════
// TAB 3 — STUDENT PROGRESS VIEW
// ═══════════════════════════════════════════════════════════════
function initProgress() {
  const searchInput = document.getElementById('pv-search');
  const resultsBox  = document.getElementById('pv-results');
  searchInput.value = '';
  resultsBox.innerHTML = '';
  document.getElementById('pv-timeline').innerHTML = '';
  document.getElementById('pv-student-info').innerHTML = '';

  searchInput.addEventListener('input', _debounce(() => {
    const q = searchInput.value.trim();
    if (q.length < 2) { resultsBox.innerHTML = ''; return; }

    let students;
    const ql = q.toLowerCase();
    if (ql === 'reval') {
      // Find students who have any Final Gazette ESE that differs from their Preliminary ESE
      const revalUINs = new Set();
      for (const sess of State.getSessions()) {
        if (sess.entryType !== 'Final Gazette' || !sess.linkedPrelimSessionId) continue;
        const finalRows = State.ledger.filter(r => r.examSession === sess.id);
        for (const fr of finalRows) {
          const pr = State.ledger
            .filter(p => p.uin === fr.uin && p.subjectCode === fr.subjectCode && p.examSession === sess.linkedPrelimSessionId)
            .sort((a,b) => b.entryDateTime.localeCompare(a.entryDateTime))[0];
          if (pr && String(fr.eseMarks).trim() !== String(pr.eseMarks).trim()) revalUINs.add(fr.uin);
        }
      }
      students = State.getStudents().filter(s => revalUINs.has(s.uin));
    } else if (ql === 'kt' || ql === 'failed' || ql === 'fail') {
      const ktUINs = new Set(State.ledger.filter(r => r.result === 'Fail' || r.result === 'AB').map(r => r.uin));
      students = State.getStudents().filter(s => ktUINs.has(s.uin));
    } else {
      students = State.searchStudents(q).slice(0, 10);
    }

    resultsBox.innerHTML = students.length ? students.slice(0,10).map(s =>
      `<div class="search-result" data-uin="${UI.esc(s.uin)}">
        <strong>${UI.esc(s.name)}</strong>
        <span>${UI.esc(s.uin)} · ${UI.esc(s.branch)} · Batch ${UI.esc(s.batchYear)}</span>
      </div>`
    ).join('') : '<div class="search-result muted">No students found.</div>';

    resultsBox.querySelectorAll('.search-result[data-uin]').forEach(el => {
      el.onclick = () => _pvShowStudent(el.dataset.uin);
    });
  }, 250));
}

// ── Computed attempt tag HTML (for progress view) ─────────────
function _pvAttemptTag(uin, subjectCode, sessionId) {
  const tag = State.computeAttemptTag(uin, subjectCode, sessionId);
  if (!tag) return '<span class="badge badge-pending">—</span>';
  const cls = tag.includes('KT')    ? 'badge-kt'
            : tag.includes('Reval') ? 'badge-reval'
            : 'badge-regular';
  return `<span class="badge ${cls}" title="${UI.esc(tag)}">${UI.esc(tag)}</span>`;
}

// ── Mark outcome tag (per-component) ─────────────────────────
function _pvMarkTag(markStr, maxMark) {
  if (!markStr || markStr === '—') return '<span class="pv-tag pv-tag-pending">—</span>';
  if (markStr === 'AB') return '<span class="pv-tag pv-tag-absent">Absent</span>';

  const val = parseFloat(markStr.replace('*',''));
  const threshold = maxMark * 0.4; // 40% rule
  const isGrace = markStr.includes('*');

  if (isNaN(val)) return `<span class="pv-tag pv-tag-pending">${UI.esc(markStr)}</span>`;

  if (val >= threshold || isGrace) {
    return `<span class="pv-tag pv-tag-success">✓</span>`;
  } else {
    return `<span class="pv-tag pv-tag-fail">✗</span>`;
  }
}

function _pvShowStudent(uin) {
  const student  = State.getStudent(uin);
  const ledger   = State.getLedgerForStudent(uin);
  document.getElementById('pv-results').innerHTML = '';
  document.getElementById('pv-search').value = student.name;

  // Compute full academics (grades, SGPA, CGPA, credits)
  const academics = State.computeStudentAcademics(uin);

  // Student info card
  let cgpaStr = academics?.cgpa != null ? academics.cgpa.toFixed(2) : '—';
  let credStr = academics
    ? `${academics.totalCredits.earned} / ${academics.totalCredits.max}`
    : '—';

  let feHTML = '';
  if (academics?.feCompleted?.done) {
    feHTML = `<span class="fe-completed-badge">🎓 FE Completed — ${UI.esc(academics.feCompleted.session || '')}</span>`;
  }

  document.getElementById('pv-student-info').innerHTML = `
    <div class="student-card" style="display:flex; align-items:center; gap:16px; flex-wrap:wrap; justify-content:space-between;">
      <div>
        <div class="sc-name">${UI.esc(student.name)}</div>
        <div class="sc-meta">UIN: ${UI.esc(student.uin)} · PRN: ${UI.esc(student.prn || '—')} · ${UI.esc(student.branch)} · Div ${UI.esc(student.division)} · Batch ${UI.esc(student.batchYear)}</div>
      </div>
      <div class="pv-quick-stats">
        <div class="pv-stat"><span class="pv-stat-val">${UI.esc(cgpaStr)}</span><span class="pv-stat-lbl">CGPA</span></div>
        <div class="pv-stat"><span class="pv-stat-val">${UI.esc(credStr)}</span><span class="pv-stat-lbl">Credits</span></div>
        ${feHTML}
      </div>
    </div>`;

  if (ledger.length === 0) {
    document.getElementById('pv-timeline').innerHTML = '<div class="empty-state">No entries found for this student.</div>';
    return;
  }

  // Build a quick lookup: sessionId+subjectCode → computed display result
  const drLookup = {};
  if (academics) {
    for (const sr of academics.sessionResults) {
      for (const { r, dr } of sr.subjects) {
        drLookup[r.examSession + '||' + r.subjectCode + '||' + r.entryId] = dr;
      }
    }
  }

  // Build session display map
  const sessionMap = {};
  State.getSessions().forEach(s => { sessionMap[s.id] = s; });

  const bySession = {};
  for (const row of ledger) {
    const key = row.examSession;
    if (!bySession[key]) bySession[key] = {
      sessionId: row.examSession,
      sessionName: sessionMap[row.examSession]?.name || row.examSession,
      semester: row.semester,
      rows: [],
    };
    bySession[key].rows.push(row);
  }

  let html = '';

  // Use academics.sessionResults order (chronological); fall back to bySession
  const orderedSessions = academics
    ? academics.sessionResults.map(sr => sr.session.id).filter(id => bySession[id])
    : Object.keys(bySession);
  // Also include any sessions in bySession not in academics (edge case)
  for (const id of Object.keys(bySession)) {
    if (!orderedSessions.includes(id)) orderedSessions.push(id);
  }

  for (const sessionId of orderedSessions) {
    const group = bySession[sessionId];
    if (!group) continue;
    const sess = sessionMap[group.sessionId];

    // Find matching academics session result
    const acadSess = academics?.sessionResults.find(sr => sr.session.id === sessionId);

    // Latest row per subject
    const latestBySubject = {};
    for (const r of group.rows) {
      if (!latestBySubject[r.subjectCode] || r.entryDateTime > latestBySubject[r.subjectCode].entryDateTime) {
        latestBySubject[r.subjectCode] = r;
      }
    }

    // Session credits from academics
    const sessionCreditsEarned = acadSess
      ? acadSess.subjects.filter(s => !s.pending && s.dr.creditsEarned > 0).reduce((a, s) => a + s.dr.creditsEarned, 0)
      : Object.values(latestBySubject).reduce((a, r) => a + (Number(r.creditsEarned) || 0), 0);
    const sessionCreditsMax = Object.values(latestBySubject).reduce((a, r) => a + (Number(r.creditsAssigned) || 0), 0);

    const sessionStatus = sess ? State.getSessionStatus(uin, sess) : 'pending';
    const showPerComp   = sessionStatus === 'multi-attempt';

    let sessionBadge = '';
    if (sessionStatus === 'successful') {
      sessionBadge = `<span class="pv-session-badge pv-session-success">🎉 First Attempt</span>`;
    } else if (sessionStatus === 'pending') {
      sessionBadge = `<span class="pv-session-badge pv-session-pending">⏳ Pending</span>`;
    }

    const sgpaStr = acadSess?.sgpa != null ? acadSess.sgpa.toFixed(2) : (acadSess?.pendingCount > 0 ? 'Partial' : '—');
    const pendingNote = acadSess?.pendingCount > 0
      ? `<span class="pv-pending-note">${acadSess.pendingCount} subject${acadSess.pendingCount > 1 ? 's' : ''} pending</span>`
      : '';

    const isFinal = sess?.entryType === 'Final Gazette';

    html += `
    <div class="session-block">
      <div class="session-header">
        <span class="session-name">${UI.esc(group.sessionName)}</span>
        <span class="session-sem">Sem ${UI.esc(group.semester)}</span>
        ${isFinal ? '<span class="session-type-inline final-gazette">Final Gazette</span>' : ''}
        ${sessionBadge}
        ${pendingNote}
        <span class="credit-pill">${sessionCreditsEarned} / ${sessionCreditsMax} cr</span>
        <span class="sgpa-pill">SGPA: <strong>${UI.esc(sgpaStr)}</strong></span>
      </div>
      <div style="overflow-x:auto;">
      <table class="progress-table">
        <thead><tr>
          <th>Subject</th><th>Type</th><th>Attempt</th>
          <th>IAT</th><th>ESE</th><th>TW</th><th>Oral</th>
          <th>Total</th><th>%</th><th>Grade</th><th>GP</th><th>Credits</th><th>G×C</th>
          <th>Result</th>
        </tr></thead>
        <tbody>`;

// Use merged rows from academics (one per subject per session)
// acadSess.subjects has the merged data; fall back to group.rows deduped if academics unavailable
    const displayRows = acadSess
      ? acadSess.subjects.map(s => s.r)
      : Object.values((() => {
          const m = {};
          for (const r of group.rows) {
            if (!m[r.subjectCode] || r.entryDateTime > m[r.subjectCode].entryDateTime) m[r.subjectCode] = r;
          }
          return m;
        })());

    // Totals for footer
    let footerTotalMarks = 0;
    let footerGxC        = 0;
    let footerCredits    = 0;
    let footerHasTotal   = false;

    for (const r of displayRows) {
      const drKey = r.examSession + '||' + r.subjectCode + '||' + r.entryId;
      const dr    = drLookup[drKey] || (acadSess?.subjects.find(s => s.r.subjectCode === r.subjectCode)?.dr) || null;

      let subjConfig = SEM1_SUBJECTS.find(s => s.code === r.subjectCode);
      if (!subjConfig) subjConfig = getSem2Subjects(student.branch, sess).find(s => s.code === r.subjectCode);
      if (!subjConfig) subjConfig = getSem2Subjects(student.branch, null).find(s => s.code === r.subjectCode);

      const comps      = ['IAT', 'ESE', 'TW', 'Oral'];
      const compFields = { IAT: r.iatMarks, ESE: r.eseMarks, TW: r.twMarks, Oral: r.oralMarks };

      const cells = comps.map(comp => {
        const val     = compFields[comp] || '—';
        const maxMark = subjConfig?.marks?.[comp];
        if (!maxMark) return `<td class="muted">—</td>`;
        if (showPerComp) {
          return `<td class="pv-comp-cell">${UI.esc(val)} ${_pvMarkTag(val === '—' ? null : val, maxMark)}</td>`;
        }
        return `<td>${UI.esc(val)}</td>`;
      }).join('');

      let gradeCell  = '<td class="muted">—</td>';
      let gpCell     = '<td class="muted">—</td>';
      let creditCell = '<td class="muted">—</td>';
      let gxcCell    = '<td class="muted">—</td>';
      let pctCell    = '<td class="muted">—</td>';
      let totalCell  = `<td class="muted">—</td>`;
      let resultCell = `<td>${UI.resultBadge(r.result)}</td>`;

      if (dr && !dr.pending) {
        const gradeCls   = dr.grade === 'F' ? 'grade-f' : dr.grade === 'O' ? 'grade-o' : '';
        gradeCell  = `<td class="grade-cell ${gradeCls}">${UI.esc(dr.grade)}</td>`;
        gpCell     = `<td class="gp-cell">${dr.gradePoint}</td>`;
        const creditCls  = dr.creditsEarned > 0 ? 'credit-earned' : 'credit-zero';
        creditCell = `<td class="${creditCls}">${dr.creditsEarned}</td>`;
        gxcCell    = `<td class="gxc-cell">${dr.GxC.toFixed(1)}</td>`;
        pctCell    = `<td>${dr.pct.toFixed(1)}%</td>`;
        totalCell  = `<td>${dr.total}<small>/${dr.totalMax}</small></td>`;
        resultCell = `<td>${UI.resultBadge(dr.result)}</td>`;
        // Accumulate footer totals
        footerTotalMarks += dr.total;
        footerGxC        += dr.GxC;
        footerCredits    += dr.creditsEarned;
        footerHasTotal    = true;
      } else if (dr?.pending) {
        gradeCell  = `<td class="muted">Pending</td>`;
        resultCell = `<td>${UI.resultBadge('Pending')}</td>`;
      }

      html += `
        <tr>
          <td><span class="subj-code-small">${UI.esc(r.subjectCode)}</span> ${UI.esc(r.subjectName)}</td>
          <td>${UI.esc(r.subjectType)}</td>
          <td>${_pvAttemptTag(r.uin, r.subjectCode, r.examSession)}</td>
          ${cells}
          ${totalCell}${pctCell}${gradeCell}${gpCell}${creditCell}${gxcCell}
          ${resultCell}
        </tr>`;
    }

    // Total + SGPA footer row
    const footerTotal   = footerHasTotal ? String(footerTotalMarks) : '—';
    const footerGxCStr  = footerHasTotal ? footerGxC.toFixed(1) : '—';
    const footerCredStr = footerHasTotal ? String(footerCredits)  : '—';

    html += `
        <tr class="sgpa-row">
          <td colspan="7" style="text-align:right; font-weight:600; color:var(--ink-2); padding-right:12px;">Total</td>
          <td style="font-weight:700;">${UI.esc(footerTotal)}</td>
          <td></td>
          <td></td>
          <td></td>
          <td class="credit-earned" style="font-weight:700;">${UI.esc(footerCredStr)}</td>
          <td class="gxc-cell" style="font-weight:700;">${UI.esc(footerGxCStr)}</td>
          <td class="sgpa-val" colspan="1">SGPA: ${UI.esc(sgpaStr)}</td>
        </tr>`;

    html += `</tbody></table></div></div>`;
  }

  // ── Academics summary panel ──────────────────────────────────
  if (academics) {
    const { semCredits, consolidatedSGPA, cgpa, totalCredits, feCompleted } = academics;

    html += `<div class="academics-summary">
      <div class="acad-title">Academic Summary</div>
      <div class="acad-grid">`;

    for (const sem of [1, 2]) {
      const sc    = semCredits[sem];
      const cSGPA = consolidatedSGPA[sem];
      const pct   = sc.max > 0 ? Math.round((sc.earned / sc.max) * 100) : 0;
      const done  = sc.earned >= sc.max && sc.max > 0;
      html += `
        <div class="acad-sem-card${done ? ' acad-sem-done' : ''}">
          <div class="acad-sem-title">Semester ${sem}</div>
          <div class="acad-credits">
            <span class="acad-credits-val">${sc.earned} <span class="acad-credits-max">/ ${sc.max}</span></span>
            <span class="acad-credits-lbl">credits</span>
          </div>
          <div class="acad-progress-bar">
            <div class="acad-progress-fill" style="width:${pct}%"></div>
          </div>
          ${done
            ? `<div class="acad-done-note">✓ Completed — ${UI.esc(sc.completedInSession || '')}</div>`
            : `<div class="acad-pending-note">${sc.max - sc.earned} credits pending</div>`}
          ${cSGPA != null
            ? `<div class="acad-sgpa">Semester SGPA: <strong>${cSGPA.toFixed(2)}</strong></div>`
            : sc.earned > 0 ? `<div class="acad-sgpa muted">Semester SGPA: available after completion</div>` : ''}
        </div>`;
    }

    html += `
        <div class="acad-totals-card">
          <div class="acad-sem-title">Overall</div>
          <div class="acad-cgpa-big">${cgpa != null ? cgpa.toFixed(2) : '—'}</div>
          <div class="acad-cgpa-lbl">CGPA</div>
          <div class="acad-total-credits">${totalCredits.earned} / ${totalCredits.max} total credits</div>
          ${feCompleted.done
            ? `<div class="fe-completed-badge" style="margin-top:10px;">🎓 FE Completed<br><small>${UI.esc(feCompleted.session || '')}</small></div>`
            : ''}
        </div>`;

    html += `</div></div>`;
  }

  document.getElementById('pv-timeline').innerHTML = html;
}


// ═══════════════════════════════════════════════════════════════
// TAB 4 — REPORTS
// ═══════════════════════════════════════════════════════════════
function initReports() {
  const sessions = State.getSessions();
  UI.buildSelect('rpt-session', sessions, '— all sessions —', 'id', 'name');

  // Populate branch and batchYear dropdowns
  UI.buildSelect('rpt-branch', BRANCHES, '— all branches —');
  const years = State.getBatchYears();
  UI.buildSelect('rpt-batch', years, '— all years —');

  // Populate subject dropdown from ledger
  const subjects = State.getAllSubjects();
  const subjEl = document.getElementById('rpt-subject');
  subjEl.innerHTML = '<option value="">— all subjects —</option>' +
    subjects.map(s => `<option value="${UI.esc(s.code)}">${UI.esc(s.code)} — ${UI.esc(s.name)}</option>`).join('');

  // Wire live result summary
  ['rpt-session','rpt-branch','rpt-batch','rpt-subject','rpt-component'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', _rptLiveResultSummary);
  });
  _rptLiveResultSummary(); // initial render

  // Reval filters
  UI.buildSelect('rpt-reval-branch', BRANCHES, '— all branches —');
  UI.buildSelect('rpt-reval-subject', [{ code:'', name:'All subjects' }, ...subjects], '— all subjects —', 'code', 'name');
  ['rpt-reval-session','rpt-reval-branch','rpt-reval-subject'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', _rptLiveRevalImpact);
  });
  UI.buildSelect('rpt-reval-session', sessions, '— all sessions —', 'id', 'name');
  _rptLiveRevalImpact();

  // Topper filters
  UI.buildSelect('rpt-topper-branch', BRANCHES, '— all branches —');
  UI.buildSelect('rpt-topper-subject', [{ code:'', name:'All subjects' }, ...subjects], '— all subjects —', 'code', 'name');
  UI.buildSelect('rpt-topper-session', sessions, '— select session —', 'id', 'name');
  document.getElementById('rpt-topper-mode').onchange = _rptToggleTopperMode;
  _rptToggleTopperMode();
  ['rpt-topper-session','rpt-topper-branch','rpt-topper-mode','rpt-topper-subject','rpt-topper-n'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', _rptLiveToppers);
    document.getElementById(id)?.addEventListener('input', _rptLiveToppers);
  });

  // Populate per-card session selects
  UI.buildSelect('rpt-my-session', sessions, '— all sessions —', 'id', 'name');

  // Credit filter branch dropdowns
  UI.buildSelect('rpt-credit-branch', BRANCHES, '— all branches —');
  UI.buildSelect('rpt-total-credit-branch', BRANCHES, '— all branches —');

  // Export buttons
  document.getElementById('rpt-result-summary-csv').onclick  = _rptExportResultSummary;
  document.getElementById('rpt-reval-impact-csv').onclick    = _rptExportRevalImpact;
  document.getElementById('rpt-toppers-csv').onclick         = _rptExportToppers;
  document.getElementById('rpt-credit-filter').onclick       = _rptCreditFilter;
  document.getElementById('rpt-total-credit-filter').onclick = _rptTotalCreditFilter;
  document.getElementById('rpt-kt-filter').onclick           = _rptKTFilter;
  document.getElementById('rpt-my-entries').onclick          = _rptMyEntries;
}

// ── Result Summary (live) ─────────────────────────────────────
function _rptGetSummaryFilters() {
  return {
    sessionId:   document.getElementById('rpt-session').value   || null,
    branch:      document.getElementById('rpt-branch').value    || null,
    batchYear:   document.getElementById('rpt-batch').value     || null,
    subjectCode: document.getElementById('rpt-subject').value   || null,
    component:   document.getElementById('rpt-component').value || null,
  };
}

function _rptLiveResultSummary() {
  const filters = _rptGetSummaryFilters();
  const data    = State.reportResultSummary(filters);
  const comp    = filters.component;
  const tbody   = document.getElementById('rpt-summary-tbody');
  if (!tbody) return;

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--ink-4);padding:12px;">No data for this filter.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(d => {
    const avgCell = comp === 'IAT'  ? d.avgIAT
                  : comp === 'ESE'  ? d.avgESE
                  : comp === 'TW'   ? d.avgTW
                  : comp === 'Oral' ? d.avgOral
                  : '—';
    return `<tr>
      <td><span class="subj-code-small">${UI.esc(d.code)}</span></td>
      <td>${UI.esc(d.name)}</td>
      <td>${d.total}</td>
      <td style="color:var(--pass);font-weight:600;">${d.pass}</td>
      <td style="color:var(--fail);font-weight:600;">${d.fail}</td>
      <td style="color:var(--ab);font-weight:600;">${d.ab}</td>
      <td><span class="badge ${d.passPct >= 60 ? 'badge-pass' : d.passPct >= 40 ? 'badge-pending' : 'badge-fail'}">${d.passPct}%</span></td>
      <td>${comp ? avgCell : `IAT:${d.avgIAT} ESE:${d.avgESE} TW:${d.avgTW}`}</td>
    </tr>`;
  }).join('');
}

function _rptExportResultSummary() {
  const filters = _rptGetSummaryFilters();
  const data    = State.reportResultSummary(filters);
  UI.exportCSV(`ResultSummary`,
    ['Subject Code','Subject Name','Total','Pass','Fail','AB','Pass %','Avg IAT','Avg ESE','Avg TW','Avg Oral'],
    data.map(d => [d.code, d.name, d.total, d.pass, d.fail, d.ab, d.passPct+'%', d.avgIAT, d.avgESE, d.avgTW, d.avgOral])
  );
  UI.toast('Result summary exported.', 'success');
}

// ── Reval Impact (live) ───────────────────────────────────────
function _rptGetRevalFilters() {
  return {
    sessionId:   document.getElementById('rpt-reval-session').value  || null,
    branch:      document.getElementById('rpt-reval-branch').value   || null,
    subjectCode: document.getElementById('rpt-reval-subject').value  || null,
  };
}

function _rptLiveRevalImpact() {
  const filters = _rptGetRevalFilters();
  const data    = State.reportRevalImpact(filters);
  const tbody   = document.getElementById('rpt-reval-tbody');
  if (!tbody) return;

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--ink-4);padding:12px;">No reval changes for this filter.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(d => `
    <tr class="${d.direction === 'worsened' ? 'reval-worsened' : ''}">
      <td>${UI.esc(d.name)}</td>
      <td><span class="subj-code-small">${UI.esc(d.uin)}</span></td>
      <td>${UI.esc(d.branch)}</td>
      <td><span class="subj-code-small">${UI.esc(d.subjectCode)}</span></td>
      <td>${UI.resultBadge(d.prevResult)}</td>
      <td>${UI.resultBadge(d.result)}</td>
      <td>${d.direction === 'worsened'
        ? '<span class="badge badge-fail">⚠ Worsened</span>'
        : '<span class="badge badge-pass">↑ Improved</span>'}</td>
      <td style="font-size:11px;color:var(--ink-3);">${UI.esc(d.entryDateTime?.slice(0,10)||'')}</td>
    </tr>`).join('');
}

function _rptExportRevalImpact() {
  const filters = _rptGetRevalFilters();
  const data    = State.reportRevalImpact(filters);
  UI.exportCSV('RevalImpact',
    ['UIN','PRN','Name','Branch','Subject Code','Subject Name','Prev Result','New Result','Direction','Entry Date'],
    data.map(d => [d.uin, d.prn, d.name, d.branch, d.subjectCode, d.subjectName, d.prevResult, d.result, d.direction, d.entryDateTime])
  );
  UI.toast('Reval impact exported.', 'success');
}

// ── Toppers (live) ────────────────────────────────────────────
function _rptToggleTopperMode() {
  const mode = document.getElementById('rpt-topper-mode').value;
  document.getElementById('rpt-topper-subject-row').style.display = mode === 'subject' ? '' : 'none';
  document.getElementById('rpt-topper-n-row').style.display       = mode === 'branch'  ? '' : 'none';
  _rptLiveToppers();
}

function _rptLiveToppers() {
  const sessionId  = document.getElementById('rpt-topper-session').value || null;
  if (!sessionId) {
    const tbody = document.getElementById('rpt-toppers-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-4);padding:12px;">Select a session.</td></tr>';
    return;
  }
  const mode       = document.getElementById('rpt-topper-mode').value || 'branch';
  const branch     = document.getElementById('rpt-topper-branch').value || null;
  const subjectCode= document.getElementById('rpt-topper-subject').value || null;
  const topN       = Number(document.getElementById('rpt-topper-n').value || 10);

  const data = State.reportToppers({ sessionId, mode, branch, subjectCode, topN });
  const tbody = document.getElementById('rpt-toppers-tbody');
  if (!tbody) return;

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--ink-4);padding:12px;">No data.</td></tr>';
    return;
  }

  if (mode === 'branch') {
    tbody.innerHTML = data.map(d => `<tr>
      <td style="font-weight:700;color:var(--brand);">#${d.rank}</td>
      <td>${UI.esc(d.name)}</td>
      <td><span class="subj-code-small">${UI.esc(d.uin)}</span></td>
      <td>${UI.esc(d.branch)}</td>
      <td style="font-weight:600;">${d.totalMarks}</td>
      <td>${d.totalCredits}</td>
    </tr>`).join('');
  } else {
    tbody.innerHTML = data.map(d => `<tr>
      <td style="font-weight:700;color:var(--brand);">#${d.rank}</td>
      <td>${UI.esc(d.name)}</td>
      <td><span class="subj-code-small">${UI.esc(d.uin)}</span></td>
      <td>${UI.esc(d.branch)}</td>
      <td><span class="subj-code-small">${UI.esc(d.subjectCode)}</span></td>
      <td style="font-weight:600;">${d.totalMarks}</td>
    </tr>`).join('');
  }
}

function _rptExportToppers() {
  const sessionId   = document.getElementById('rpt-topper-session').value || null;
  const mode        = document.getElementById('rpt-topper-mode').value || 'branch';
  const branch      = document.getElementById('rpt-topper-branch').value || null;
  const subjectCode = document.getElementById('rpt-topper-subject').value || null;
  const topN        = Number(document.getElementById('rpt-topper-n').value || 10);
  const data = State.reportToppers({ sessionId, mode, branch, subjectCode, topN });
  if (mode === 'branch') {
    UI.exportCSV('Toppers_Branch',
      ['Rank','Name','UIN','Branch','Total Marks','Credits Earned'],
      data.map(d => [d.rank, d.name, d.uin, d.branch, d.totalMarks, d.totalCredits])
    );
  } else {
    UI.exportCSV('Toppers_Subject',
      ['Rank','Name','UIN','Branch','Subject Code','Total Marks'],
      data.map(d => [d.rank, d.name, d.uin, d.branch, d.subjectCode, d.totalMarks])
    );
  }
  UI.toast('Toppers exported.', 'success');
}

// ── Credit Eligibility Filters ────────────────────────────────

// Filter 1: Students who have not completed Sem N credits
function _rptCreditFilter() {
  const sem    = Number(document.getElementById('rpt-credit-sem').value || 0);
  const branch = document.getElementById('rpt-credit-branch').value || null;
  if (!sem) { UI.toast('Select a semester.', 'error'); return; }

  const students = State.getStudents({ branch: branch || undefined });
  const rows = [];

  for (const s of students) {
    const acad = State.computeStudentAcademics(s.uin);
    if (!acad) continue;
    const sc = acad.semCredits[sem];
    if (!sc || sc.max === 0) continue;
    if (sc.earned >= sc.max) continue;  // already completed — exclude

    rows.push({
      uin:     s.uin,
      prn:     s.prn,
      name:    s.name,
      branch:  s.branch,
      division: s.division,
      batchYear: s.batchYear,
      semEarned: sc.earned,
      semMax:    sc.max,
      semPending: sc.max - sc.earned,
      cgpa:    acad.cgpa != null ? acad.cgpa.toFixed(2) : '—',
    });
  }

  // Display in table
  _rptRenderCreditFilterTable(rows, sem);

  // Export CSV
  UI.exportCSV(`Sem${sem}_IncompleteCredits`,
    ['UIN','PRN','Name','Branch','Division','Batch Year',`Sem ${sem} Earned`,`Sem ${sem} Max`,'Pending Credits','CGPA'],
    rows.map(r => [r.uin, r.prn, r.name, r.branch, r.division, r.batchYear, r.semEarned, r.semMax, r.semPending, r.cgpa])
  );
  UI.toast(`${rows.length} students with incomplete Sem ${sem} credits exported.`, 'success');
}

// Filter 2: Students with total cumulative credits < X
function _rptTotalCreditFilter() {
  const threshold = Number(document.getElementById('rpt-credit-x').value || 0);
  const branch    = document.getElementById('rpt-total-credit-branch').value || null;
  if (!threshold) { UI.toast('Enter a credit threshold.', 'error'); return; }

  const students = State.getStudents({ branch: branch || undefined });
  const rows = [];

  for (const s of students) {
    const acad = State.computeStudentAcademics(s.uin);
    if (!acad) continue;
    const { earned, max } = acad.totalCredits;
    if (earned >= threshold) continue;

    rows.push({
      uin:       s.uin,
      prn:       s.prn,
      name:      s.name,
      branch:    s.branch,
      division:  s.division,
      batchYear: s.batchYear,
      sem1Earned: acad.semCredits[1].earned,
      sem1Max:    acad.semCredits[1].max,
      sem2Earned: acad.semCredits[2].earned,
      sem2Max:    acad.semCredits[2].max,
      totalEarned: earned,
      totalMax:    max,
      cgpa:       acad.cgpa != null ? acad.cgpa.toFixed(2) : '—',
    });
  }

  _rptRenderTotalCreditFilterTable(rows, threshold);

  UI.exportCSV(`TotalCredits_lt${threshold}`,
    ['UIN','PRN','Name','Branch','Division','Batch Year','Sem 1 Earned','Sem 1 Max','Sem 2 Earned','Sem 2 Max','Total Earned','Total Max','CGPA'],
    rows.map(r => [r.uin, r.prn, r.name, r.branch, r.division, r.batchYear, r.sem1Earned, r.sem1Max, r.sem2Earned, r.sem2Max, r.totalEarned, r.totalMax, r.cgpa])
  );
  UI.toast(`${rows.length} students with < ${threshold} total credits exported.`, 'success');
}

function _rptRenderCreditFilterTable(rows, sem) {
  const out = document.getElementById('rpt-credit-filter-output');
  if (!out) return;
  if (rows.length === 0) {
    out.innerHTML = '<div class="empty-state">No students found matching this filter.</div>';
    return;
  }
  out.innerHTML = `
    <div style="margin-bottom:8px; font-size:12px; color:var(--ink-3);">${rows.length} students with incomplete Sem ${sem} credits</div>
    <div style="overflow-x:auto;">
    <table class="audit-table">
      <thead><tr>
        <th>Name</th><th>UIN</th><th>Branch</th><th>Batch</th>
        <th>Sem ${sem} Credits</th><th>Pending</th><th>CGPA</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `<tr>
          <td>${UI.esc(r.name)}</td>
          <td><span class="subj-code-small">${UI.esc(r.uin)}</span></td>
          <td>${UI.esc(r.branch)}</td>
          <td>${UI.esc(r.batchYear)}</td>
          <td>${r.semEarned} / ${r.semMax}</td>
          <td class="credit-zero">${r.semPending}</td>
          <td><strong>${UI.esc(r.cgpa)}</strong></td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

function _rptRenderTotalCreditFilterTable(rows, threshold) {
  const out = document.getElementById('rpt-total-credit-filter-output');
  if (!out) return;
  if (rows.length === 0) {
    out.innerHTML = '<div class="empty-state">No students found matching this filter.</div>';
    return;
  }
  out.innerHTML = `
    <div style="margin-bottom:8px; font-size:12px; color:var(--ink-3);">${rows.length} students with < ${threshold} total credits</div>
    <div style="overflow-x:auto;">
    <table class="audit-table">
      <thead><tr>
        <th>Name</th><th>UIN</th><th>Branch</th><th>Batch</th>
        <th>Sem 1</th><th>Sem 2</th><th>Total Credits</th><th>CGPA</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `<tr>
          <td>${UI.esc(r.name)}</td>
          <td><span class="subj-code-small">${UI.esc(r.uin)}</span></td>
          <td>${UI.esc(r.branch)}</td>
          <td>${UI.esc(r.batchYear)}</td>
          <td>${r.sem1Earned}/${r.sem1Max}</td>
          <td>${r.sem2Earned}/${r.sem2Max}</td>
          <td class="${r.totalEarned < threshold ? 'credit-zero' : 'credit-earned'}">${r.totalEarned} / ${r.totalMax}</td>
          <td><strong>${UI.esc(r.cgpa)}</strong></td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
}

function _rptKTFilter() {
  const n     = Number(document.getElementById('rpt-kt-n').value || 1);
  const mode  = document.getElementById('rpt-kt-mode').value  || 'At least';
  const scope = document.getElementById('rpt-kt-scope').value || 'Active';
  const data = State.reportKTFilter(n, mode, scope);
  UI.exportCSV(`KTFilter_${mode.replace(' ','')}_${n}_${scope}`,
    ['PRN','UIN','Name','Branch','Subject Code','Subject Name','Session','Result'],
    data.map(d => [d.prn, d.uin, d.name, d.branch, d.subjectCode, d.subjectName, d.session, d.result])
  );
  UI.toast('KT filter exported.', 'success');
}

function _rptMyEntries() {
  const user = Auth.getUser();
  const session = document.getElementById('rpt-my-session').value;
  const data = State.getMyEntries(user.email, session || null);
  UI.exportCSV(`MyEntries_${user.email}`,
    LEDGER_COLS,
    data.map(d => Object.values(d))
  );
  UI.toast(`Exported ${data.length} of your entries.`, 'success');
}


// ═══════════════════════════════════════════════════════════════
// TAB 5 — ADMIN  (admin-only)
// ═══════════════════════════════════════════════════════════════
function initAdmin() {
  if (!Auth.isAdmin()) {
    document.getElementById('tab-admin').innerHTML = '<div class="access-denied">Admin access only.</div>';
    return;
  }

  document.getElementById('admin-add-session').onclick  = _adminAddSession;
  document.getElementById('admin-lock-session').onclick = _adminLockSession;

  const semEl = document.getElementById('admin-session-sem');
  semEl.onchange = _adminToggleElectives;
  _adminToggleElectives();

  _buildElectiveSelects();

  // Entry type dropdown — show/hide linked prelim selector
  const entryTypeEl = document.getElementById('admin-session-entry-type');
  if (entryTypeEl) {
    entryTypeEl.onchange = _adminToggleLinkedPrelim;
    _adminToggleLinkedPrelim();
  }

  document.getElementById('admin-upload-btn').onclick = _adminUploadStudents;
  document.getElementById('admin-csv-file').onchange  = _adminPreviewCSV;

  // Seat number CSV upload
  document.getElementById('admin-seat-csv-file')?.addEventListener('change', _adminPreviewSeatCSV);
  document.getElementById('admin-seat-upload-btn')?.addEventListener('click', _adminUploadSeats);

  // Manual seat entry
  _adminInitManualSeatEntry();

  // Session link update (for existing Final Gazette sessions)
  document.getElementById('admin-link-session-btn')?.addEventListener('click', _adminUpdateSessionLink);

  const sessions = State.getSessions();
  UI.buildSelect('admin-session-lock-select', sessions.filter(s => s.status === 'Active'), '— select session to lock —', 'id', 'name');

  // Populate link dropdowns
  _adminPopulateLinkDropdowns();

  _adminRenderSessionList();
  _adminRenderAudit();
}

function _adminToggleLinkedPrelim() {
  const entryType = document.getElementById('admin-session-entry-type')?.value;
  const section   = document.getElementById('admin-linked-prelim-section');
  if (section) section.classList.toggle('hidden', entryType !== 'Final Gazette');
  _adminPopulateLinkedPrelimSelect();
}

function _adminPopulateLinkedPrelimSelect() {
  const semEl    = document.getElementById('admin-session-sem');
  const batchEl  = document.getElementById('admin-session-batch');
  const sem      = Number(semEl?.value) || 0;
  const batch    = batchEl?.value.trim() || '';
  const selEl    = document.getElementById('admin-linked-prelim-select');
  if (!selEl) return;
  const prelims  = State.getSessions().filter(s =>
    s.entryType !== 'Final Gazette' &&
    (sem === 0 || s.semester === sem) &&
    (batch === '' || s.batchYear === batch)
  );
  selEl.innerHTML = '<option value="">— none (skip reval detection) —</option>' +
    prelims.map(s => `<option value="${UI.esc(s.id)}">${UI.esc(s.name)} (Sem ${s.semester}, ${s.batchYear})</option>`).join('');
}

function _adminPopulateLinkDropdowns() {
  // For the "update link" section
  const finalSessions = State.getSessions().filter(s => s.entryType === 'Final Gazette');
  const finalSelEl    = document.getElementById('admin-link-final-select');
  if (finalSelEl) {
    finalSelEl.innerHTML = '<option value="">— select Final Gazette session —</option>' +
      finalSessions.map(s => `<option value="${UI.esc(s.id)}">${UI.esc(s.name)} (Sem ${s.semester}, ${s.batchYear})</option>`).join('');
    finalSelEl.onchange = () => {
      const sess = State.getSession(finalSelEl.value);
      const prelimSelEl = document.getElementById('admin-link-prelim-select');
      if (!prelimSelEl || !sess) return;
      const prelims = State.getSessions().filter(s =>
        s.entryType !== 'Final Gazette' &&
        s.semester === sess.semester &&
        s.batchYear === sess.batchYear
      );
      prelimSelEl.innerHTML = '<option value="">— none —</option>' +
        prelims.map(s => `<option value="${UI.esc(s.id)}" ${s.id === sess.linkedPrelimSessionId ? 'selected' : ''}>${UI.esc(s.name)} (${s.batchYear})</option>`).join('');
    };
  }
}

function _adminToggleElectives() {
  const sem     = document.getElementById('admin-session-sem').value;
  const section = document.getElementById('admin-electives-section');
  if (section) section.classList.toggle('hidden', sem !== '2');
}

function _buildElectiveSelects() {
  const pt = document.getElementById('admin-phys-theory');
  if (pt) {
    pt.innerHTML = '<option value="">— select —</option>' +
      ELECTIVE_PHYSICS_THEORY.map(e => `<option value="${UI.esc(e.code)}">${UI.esc(e.code)} — ${UI.esc(e.name)}</option>`).join('');
  }
  const pl = document.getElementById('admin-phys-lab');
  if (pl) {
    pl.innerHTML = '<option value="">— select —</option>' +
      ELECTIVE_PHYSICS_LAB.map(e => `<option value="${UI.esc(e.code)}">${UI.esc(e.code)} — ${UI.esc(e.name)}</option>`).join('');
  }
  const ct = document.getElementById('admin-chem-theory');
  if (ct) {
    ct.innerHTML = '<option value="">— select —</option>' +
      ELECTIVE_CHEMISTRY_THEORY.map(e => `<option value="${UI.esc(e.code)}">${UI.esc(e.code)} — ${UI.esc(e.name)}</option>`).join('');
  }
  const cl = document.getElementById('admin-chem-lab');
  if (cl) {
    cl.innerHTML = '<option value="">— select —</option>' +
      ELECTIVE_CHEMISTRY_LAB.map(e => `<option value="${UI.esc(e.code)}">${UI.esc(e.code)} — ${UI.esc(e.name)}</option>`).join('');
  }

  document.getElementById('admin-phys-theory')?.addEventListener('change', e => {
    const code    = e.target.value;
    const labCode = code.replace('BSC202', 'BSL201');
    const labEl   = document.getElementById('admin-phys-lab');
    if (labEl && labCode && labEl.querySelector(`option[value="${labCode}"]`)) labEl.value = labCode;
  });

  document.getElementById('admin-chem-theory')?.addEventListener('change', e => {
    const code    = e.target.value;
    const labCode = code.replace('BSC203', 'BSL202');
    const labEl   = document.getElementById('admin-chem-lab');
    if (labEl && labCode && labEl.querySelector(`option[value="${labCode}"]`)) labEl.value = labCode;
  });
}

async function _adminAddSession() {
  const name      = document.getElementById('admin-session-name').value.trim();
  const semester  = document.getElementById('admin-session-sem').value;
  const batch     = document.getElementById('admin-session-batch').value.trim();
  const entryType = document.getElementById('admin-session-entry-type')?.value || 'Preliminary';
  const linkedPrelimSessionId = entryType === 'Final Gazette'
    ? (document.getElementById('admin-linked-prelim-select')?.value || '')
    : '';

  if (!name || !semester || !batch) {
    UI.toast('Fill in session name, semester, and batch year.', 'error'); return;
  }

  let electives = {};
  if (semester === '2') {
    electives = {
      physicsTheoryCode: document.getElementById('admin-phys-theory').value,
      physicsLabCode:    document.getElementById('admin-phys-lab').value,
      chemTheoryCode:    document.getElementById('admin-chem-theory').value,
      chemLabCode:       document.getElementById('admin-chem-lab').value,
    };
    const missing = Object.entries(electives).filter(([,v]) => !v).map(([k]) => k);
    if (missing.length > 0) {
      UI.toast('Select all 4 electives for a Sem II session.', 'error'); return;
    }
  }

  const linkedSession = linkedPrelimSessionId ? State.getSession(linkedPrelimSessionId) : null;

  let confirmBody = `Create session <strong>${UI.esc(name)}</strong>?<br>
    Semester: <strong>${semester === '1' ? 'I' : 'II'}</strong> &nbsp;·&nbsp; Batch: <strong>${UI.esc(batch)}</strong>
    &nbsp;·&nbsp; Type: <strong>${UI.esc(entryType)}</strong>`;

  if (linkedSession) {
    confirmBody += `<br>Linked preliminary: <strong>${UI.esc(linkedSession.name)}</strong>`;
  }

  if (semester === '2') {
    const pt = findElective(electives.physicsTheoryCode);
    const ct = findElective(electives.chemTheoryCode);
    confirmBody += `<br><br>
    <table class="elective-confirm-table">
      <tr><td>Physics Theory</td><td><strong>${UI.esc(electives.physicsTheoryCode)}</strong> — ${UI.esc(pt?.name || '')}</td></tr>
      <tr><td>Physics Lab</td><td><strong>${UI.esc(electives.physicsLabCode)}</strong></td></tr>
      <tr><td>Chemistry Theory</td><td><strong>${UI.esc(electives.chemTheoryCode)}</strong> — ${UI.esc(ct?.name || '')}</td></tr>
      <tr><td>Chemistry Lab</td><td><strong>${UI.esc(electives.chemLabCode)}</strong></td></tr>
    </table>
    <p class="elective-lock-note">⚠ Electives are locked once the session is created and cannot be changed.</p>`;
  }

  UI.showModal('Confirm session creation', confirmBody, {
    confirmLabel: 'Create session',
    onConfirm: async () => {
      UI.showSpinner('Creating session…');
      try {
        const s = await State.addSession(name, semester, batch, electives, entryType, linkedPrelimSessionId);
        UI.hideSpinner();
        UI.toast(`Session "${s.name}" created.`, 'success');
        ['admin-session-name','admin-session-batch'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('admin-session-sem').value = '';
        if (document.getElementById('admin-session-entry-type')) document.getElementById('admin-session-entry-type').value = 'Preliminary';
        _adminToggleElectives();
        _adminToggleLinkedPrelim();
        initAdmin();
      } catch(e) {
        UI.hideSpinner();
        UI.toast('Error: ' + e.message, 'error', 8000);
      }
    }
  });
}

function _adminRenderSessionList() {
  const tbody = document.getElementById('admin-session-tbody');
  if (!tbody) return;
  const sessions = State.getSessions();
  if (sessions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--ink-4);padding:16px;">No sessions yet.</td></tr>';
    return;
  }
  tbody.innerHTML = sessions.map(s => {
    const electiveInfo = s.semester === 2 && s.physicsTheoryCode
      ? `<span class="elective-pill phys">${UI.esc(s.physicsTheoryCode)}</span>
         <span class="elective-pill phys-lab">${UI.esc(s.physicsLabCode)}</span>
         <span class="elective-pill chem">${UI.esc(s.chemTheoryCode)}</span>
         <span class="elective-pill chem-lab">${UI.esc(s.chemLabCode)}</span>`
      : s.semester === 2
        ? '<span class="elective-missing">⚠ No electives set</span>'
        : '<span class="muted">—</span>';

    const typeCls   = s.entryType === 'Final Gazette' ? 'badge-reval' : 'badge-regular';
    const typeLabel = s.entryType || 'Preliminary';

    let linkedInfo = '—';
    if (s.entryType === 'Final Gazette') {
      if (s.linkedPrelimSessionId) {
        const prelim = State.getSession(s.linkedPrelimSessionId);
        linkedInfo = prelim ? UI.esc(prelim.name) : `<span class="muted">${UI.esc(s.linkedPrelimSessionId)}</span>`;
      } else {
        linkedInfo = '<span class="elective-missing">No link</span>';
      }
    }

    return `<tr>
      <td>${UI.esc(s.name)}</td>
      <td>Sem ${UI.esc(String(s.semester))}</td>
      <td>${UI.esc(s.batchYear)}</td>
      <td><span class="badge ${typeCls}">${UI.esc(typeLabel)}</span></td>
      <td>${linkedInfo}</td>
      <td>${electiveInfo}</td>
      <td><span class="badge ${s.status === 'Active' ? 'badge-pass' : 'badge-pending'}">${UI.esc(s.status)}</span></td>
      <td class="muted" style="font-size:11px;">${UI.esc(s.createdBy)}</td>
    </tr>`;
  }).join('');
}

async function _adminLockSession() {
  const id = document.getElementById('admin-session-lock-select').value;
  if (!id) { UI.toast('Select a session to lock.', 'error'); return; }
  const session = State.getSession(id);
  UI.showModal('Lock session', `Lock <strong>${UI.esc(session.name)}</strong>? No further entries will be accepted.`, {
    confirmLabel: 'Lock session', danger: true,
    onConfirm: async () => {
      UI.showSpinner('Locking…');
      try {
        await State.lockSession(id);
        UI.hideSpinner();
        UI.toast(`Session "${session.name}" locked.`, 'success');
        initAdmin();
      } catch(e) {
        UI.hideSpinner();
        UI.toast('Error: ' + e.message, 'error');
      }
    }
  });
}

let _csvStudents = [];
function _adminPreviewCSV(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const lines = ev.target.result.split('\n').filter(l => l.trim());
    _csvStudents = lines.slice(1).map(line => {
      const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g,''));
      return { uin:cols[0], prn:cols[1], name:cols[2], branch:cols[3], division:cols[4], batchYear:cols[5] };
    }).filter(s => s.uin);

    const preview = document.getElementById('admin-csv-preview');
    preview.innerHTML = `<strong>${_csvStudents.length} students parsed.</strong><br>
      Preview: ${_csvStudents.slice(0,3).map(s => UI.esc(s.name + ' (' + s.uin + ')')).join(', ')}…`;
    document.getElementById('admin-upload-btn').disabled = false;
  };
  reader.readAsText(file);
}

async function _adminUploadStudents() {
  if (_csvStudents.length === 0) return;
  UI.showModal('Upload students', `Upload <strong>${_csvStudents.length} students</strong> to STUDENT_MASTER?`, {
    confirmLabel: 'Upload',
    onConfirm: async () => {
      UI.showSpinner('Uploading…');
      try {
        await Sheets.uploadStudents(_csvStudents);
        await State.reload();
        UI.hideSpinner();
        UI.toast(`${_csvStudents.length} students uploaded.`, 'success');
      } catch(e) {
        UI.hideSpinner();
        UI.toast('Upload failed: ' + e.message, 'error', 8000);
      }
    }
  });
}

// ── Seat number CSV upload ─────────────────────────────────────
let _csvSeats = [];
function _adminPreviewSeatCSV(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const lines = ev.target.result.split('\n').filter(l => l.trim());
    _csvSeats = lines.slice(1).map(line => {
      const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g,''));
      return { uin: cols[0], sessionId: cols[1], seatNumber: cols[2] };
    }).filter(s => s.uin && s.sessionId && s.seatNumber);

    const preview = document.getElementById('admin-seat-preview');
    if (preview) {
      preview.innerHTML = `<strong>${_csvSeats.length} seat entries parsed.</strong><br>
        Preview: ${_csvSeats.slice(0,3).map(s => UI.esc(s.uin + ' → ' + s.seatNumber)).join(', ')}`;
    }
    const btn = document.getElementById('admin-seat-upload-btn');
    if (btn) btn.disabled = false;
  };
  reader.readAsText(file);
}

async function _adminUploadSeats() {
  if (_csvSeats.length === 0) return;
  UI.showModal('Upload seat numbers', `Upload <strong>${_csvSeats.length} seat entries</strong> to SEAT_MASTER?`, {
    confirmLabel: 'Upload',
    onConfirm: async () => {
      UI.showSpinner('Uploading seat numbers…');
      try {
        await State.uploadSeats(_csvSeats);
        UI.hideSpinner();
        UI.toast(`${_csvSeats.length} seat entries uploaded.`, 'success');
        _csvSeats = [];
        const btn = document.getElementById('admin-seat-upload-btn');
        if (btn) btn.disabled = true;
      } catch(e) {
        UI.hideSpinner();
        UI.toast('Upload failed: ' + e.message, 'error', 8000);
      }
    }
  });
}

// ── Manual seat number entry ───────────────────────────────────
let _manualSeatStudent = null;

function _adminInitManualSeatEntry() {
  const searchEl   = document.getElementById('admin-seat-student-search');
  const resultsEl  = document.getElementById('admin-seat-student-results');
  const saveBtn    = document.getElementById('admin-seat-manual-save');
  if (!searchEl) return;

  UI.buildSelect('admin-seat-session-select', State.getSessions(), '— select session —', 'id', 'name');

  searchEl.addEventListener('input', _debounce(() => {
    const q = searchEl.value.trim();
    if (q.length < 2) { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; return; }
    const matches = State.searchStudents(q).slice(0, 10);
    resultsEl.innerHTML = matches.length
      ? matches.map(s => `<div class="search-result" data-uin="${UI.esc(s.uin)}">
          <strong>${UI.esc(s.name)}</strong>
          <span>${UI.esc(s.uin)} · PRN: ${UI.esc(s.prn || '—')} · ${UI.esc(s.branch)}</span>
        </div>`).join('')
      : '<div class="search-result muted">No students found.</div>';
    resultsEl.style.display = 'block';
    resultsEl.querySelectorAll('.search-result[data-uin]').forEach(el => {
      el.onclick = () => {
        _manualSeatStudent = State.getStudent(el.dataset.uin);
        searchEl.value = _manualSeatStudent.name;
        resultsEl.style.display = 'none';
        document.getElementById('admin-seat-student-name').textContent = _manualSeatStudent.name;
        document.getElementById('admin-seat-student-ids').textContent =
          `UIN: ${_manualSeatStudent.uin} · PRN: ${_manualSeatStudent.prn || '—'} · ${_manualSeatStudent.branch}`;
        document.getElementById('admin-seat-student-selected').style.display = '';
        _adminCheckManualSeatReady();
      };
    });
  }, 200));

  document.getElementById('admin-seat-session-select')?.addEventListener('change', _adminCheckManualSeatReady);
  document.getElementById('admin-seat-number-input')?.addEventListener('input', _adminCheckManualSeatReady);
  saveBtn?.addEventListener('click', _adminSaveManualSeat);
}

function _adminCheckManualSeatReady() {
  const sess   = document.getElementById('admin-seat-session-select')?.value;
  const seatNo = document.getElementById('admin-seat-number-input')?.value.trim();
  const btn    = document.getElementById('admin-seat-manual-save');
  if (btn) btn.disabled = !(_manualSeatStudent && sess && seatNo);
}

async function _adminSaveManualSeat() {
  if (!_manualSeatStudent) return;
  const sessionId = document.getElementById('admin-seat-session-select').value;
  const seatNo    = document.getElementById('admin-seat-number-input').value.trim();
  const session   = State.getSession(sessionId);
  if (!sessionId || !seatNo || !session) { UI.toast('Fill in all fields.', 'error'); return; }

  // Check if seat already exists for this student+session
  const existing = State.getSeatsForSession(sessionId).find(s => s.uin === _manualSeatStudent.uin);

  if (existing) {
    // Show conflict modal with 3 options
    UI.showModal(
      '⚠ Seat number conflict',
      `<strong>${UI.esc(_manualSeatStudent.name)}</strong> already has seat number
       <strong>${UI.esc(existing.seatNumber)}</strong> in session
       <strong>${UI.esc(session.name)}</strong>.<br><br>
       New value: <strong>${UI.esc(seatNo)}</strong><br><br>
       Which would you like to keep?`,
      {
        confirmLabel: 'Keep both (append)',
        onConfirm: async () => {
          await _doSaveSeat(_manualSeatStudent.uin, sessionId, seatNo);
        },
        extraButtons: [
          {
            label: 'Replace with new',
            action: async () => {
              UI.showSpinner('Updating…');
              try {
                await State.updateSeatNumber(_manualSeatStudent.uin, sessionId, seatNo);
                UI.hideSpinner();
                UI.toast('Seat number replaced.', 'success');
                _adminResetManualSeat();
              } catch(e) {
                UI.hideSpinner();
                UI.toast('Error: ' + e.message, 'error', 8000);
              }
            }
          },
          {
            label: 'Keep existing',
            action: () => {
              UI.toast('Kept existing seat number. No change made.', 'info');
            }
          },
        ],
      }
    );
  } else {
    await _doSaveSeat(_manualSeatStudent.uin, sessionId, seatNo);
  }
}

async function _doSaveSeat(uin, sessionId, seatNumber) {
  UI.showSpinner('Saving seat number…');
  try {
    await State.uploadSeats([{ uin, sessionId, seatNumber }]);
    UI.hideSpinner();
    UI.toast('Seat number saved.', 'success');
    _adminResetManualSeat();
  } catch(e) {
    UI.hideSpinner();
    UI.toast('Error saving: ' + e.message, 'error', 8000);
  }
}

function _adminResetManualSeat() {
  _manualSeatStudent = null;
  document.getElementById('admin-seat-student-search').value = '';
  document.getElementById('admin-seat-number-input').value   = '';
  document.getElementById('admin-seat-student-selected').style.display = 'none';
  document.getElementById('admin-seat-manual-save').disabled = true;
}

// ── Update session link (Final Gazette → Preliminary) ─────────
async function _adminUpdateSessionLink() {
  const finalId  = document.getElementById('admin-link-final-select')?.value;
  const prelimId = document.getElementById('admin-link-prelim-select')?.value || '';
  if (!finalId) { UI.toast('Select a Final Gazette session.', 'error'); return; }
  const finalSess  = State.getSession(finalId);
  const prelimSess = prelimId ? State.getSession(prelimId) : null;
  const desc = prelimSess
    ? `Link <strong>${UI.esc(finalSess.name)}</strong> to preliminary session <strong>${UI.esc(prelimSess.name)}</strong>?`
    : `Remove preliminary link from <strong>${UI.esc(finalSess.name)}</strong>? Reval detection will be disabled.`;
  UI.showModal('Update session link', desc, {
    confirmLabel: 'Update link',
    onConfirm: async () => {
      UI.showSpinner('Updating…');
      try {
        await State.linkPrelimSession(finalId, prelimId);
        UI.hideSpinner();
        UI.toast('Session link updated. Reval tags recompute automatically.', 'success');
        initAdmin();
      } catch(e) {
        UI.hideSpinner();
        UI.toast('Error: ' + e.message, 'error', 8000);
      }
    }
  });
}

function _adminRenderAudit() {
  const last50 = [...State.ledger].reverse().slice(0,50);
  const tbody  = document.getElementById('audit-tbody');
  if (!tbody) return;
  tbody.innerHTML = last50.map(r => {
    const tag = State.computeAttemptTag(r.uin, r.subjectCode, r.examSession);
    const tagHtml = tag
      ? `<span class="attempt-tag">${UI.esc(tag)}</span>`
      : '<span class="muted">—</span>';
    return `
    <tr>
      <td>${UI.esc(r.entryDateTime?.slice(0,16).replace('T',' ') || '')}</td>
      <td>${UI.esc(r.enteredBy)}</td>
      <td>${UI.esc(r.name)}</td>
      <td>${UI.esc(r.subjectCode)}</td>
      <td>${tagHtml}</td>
      <td>${UI.resultBadge(r.result)}</td>
    </tr>
  `}).join('');
}


// ═══════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════
function _debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
