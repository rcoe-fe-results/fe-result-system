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
  attemptType: null, subjects: [], students: [],
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
  document.getElementById('be-attempt').onchange  = _beOnAttemptChange;
  document.getElementById('be-load-btn').onclick  = _beLoadGrid;
  document.getElementById('be-submit-btn').onclick = _beSubmit;
  document.getElementById('be-grid-area').innerHTML = '';
  document.getElementById('be-toolbar').classList.add('hidden');
  _beResetFilters();
}

function _beResetFilters() {
  ['be-semester','be-branch','be-division','be-attempt'].forEach(id => {
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
  _beEnableAttempt();
}

function _beOnDivisionChange() {
  const val = document.getElementById('be-division').value;
  bulkState.division = (val === 'All') ? null : (val || null);
}

function _beEnableAttempt() {
  document.getElementById('be-attempt').disabled = false;
  UI.buildSelect('be-attempt', ATTEMPT_TYPES, '— select attempt type —');
}

function _beOnAttemptChange() {
  bulkState.attemptType = document.getElementById('be-attempt').value;
  document.getElementById('be-load-btn').disabled = !bulkState.attemptType;
}

function _beLoadGrid() {
  const { session, semester, branch, division, attemptType } = bulkState;

  // FIX 2: Require division choice when multiple divisions exist
  const divs = State.getDivisions(bulkState.branch || '');
  const requireDivChoice = divs.length > 1;
  const divEl = document.getElementById('be-division');

  if (!session || !branch || !attemptType) {
    UI.toast('Select session, branch, and attempt type first.', 'error'); return;
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

  let students;
  if (attemptType === 'KT') {
    const ktData = State.getKTEligibleStudents(semester, branch);
    students = ktData
      .filter(d => !division || d.student.division === division)
      .map(d => ({ ...d.student, _ktSubjects: d.ktSubjects.map(s => s.code) }));
  } else {
    students = State.getStudents({ branch, division: division || undefined });
    if (session.batchYear) {
      students = students.filter(s => s.batchYear === session.batchYear);
    }
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
  bulkState.students = [...bulkState.students].sort((a, b) => {
    if (by === 'name')  return a.name.localeCompare(b.name);
    if (by === 'uin')   return a.uin.localeCompare(b.uin);
    if (by === 'prn')   return (a.prn||'').localeCompare(b.prn||'');
    if (by === 'batch') return (a.batchYear||'').localeCompare(b.batchYear||'');
    return 0;
  });
}

// ── Grid render ───────────────────────────────────────────────
function _beRenderGrid() {
  const { subjects, students, attemptType, activeComps } = bulkState;
  const container = document.getElementById('be-grid-area');

  const getVisibleComps = (subj) =>
    Object.keys(subj.marks).filter(c => activeComps.size === 0 || activeComps.has(c));

  const totalVisibleCols = subjects.reduce((n, s) => n + getVisibleComps(s).length, 0);

  if (totalVisibleCols === 0) {
    container.innerHTML = '<div class="empty-state">Select at least one column type above to show the grid.</div>';
    _setupMirrorScroll();
    return;
  }

  let html = `
  <div class="grid-info">
    <span>${students.length} students · ${subjects.length} subjects</span>
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
        <th class="col-branch">Branch</th>`;

  for (const subj of subjects) {
    const visComps = getVisibleComps(subj);
    if (visComps.length === 0) continue;
    html += `<th colspan="${visComps.length}" class="subj-header" title="${UI.esc(subj.name)}">${UI.esc(subj.code)}<br><small>${UI.esc(subj.name.length>20 ? subj.name.slice(0,18)+'…' : subj.name)}</small></th>`;
  }

  html += `</tr><tr><th class="sticky-col"></th><th></th>`;
  for (const subj of subjects) {
    const visComps = getVisibleComps(subj);
    for (const comp of visComps) {
      const isRevalLocked = attemptType === 'Reval' && comp !== 'ESE';
      html += `<th class="comp-header${isRevalLocked?' locked':''}">${comp}<br><small>/${subj.marks[comp]}</small></th>`;
    }
  }
  html += `</tr></thead><tbody>`;

  for (const student of students) {
    const isKT = attemptType === 'KT';
    html += `<tr data-uin="${UI.esc(student.uin)}">
      <td class="sticky-col student-cell">
        <div class="student-name">${UI.esc(student.name)}</div>
        <div class="student-ids">${UI.esc(student.uin)}${student.prn ? ' · ' + UI.esc(student.prn) : ''}</div>
        ${student.batchYear ? `<div class="student-batch">Batch ${UI.esc(student.batchYear)}</div>` : ''}
      </td>
      <td class="branch-cell">${UI.esc(student.branch)}</td>`;

    for (const subj of subjects) {
      const visComps = getVisibleComps(subj);
      if (visComps.length === 0) continue;

      const isKTSubject = isKT && student._ktSubjects && !student._ktSubjects.includes(subj.code);
      let prevEntry = null;
      if (attemptType === 'Reval' || attemptType === 'KT') {
        prevEntry = State.getLatestEntryForSubject(student.uin, subj.code, bulkState.session.id);
      }

      for (const comp of visComps) {
        const isRevalLocked = attemptType === 'Reval' && comp !== 'ESE';
        const locked = isRevalLocked || isKTSubject;
        const prevVal = prevEntry ? prevEntry[comp.toLowerCase() + 'Marks'] : '';

        if (locked) {
          html += `<td class="cell-locked"><span class="locked-val">${UI.esc(prevVal || '—')}</span></td>`;
        } else {
          html += `<td>
            <input type="text"
              class="mark-input"
              id="cell-${UI.esc(student.uin)}-${UI.esc(subj.code)}-${comp}"
              data-uin="${UI.esc(student.uin)}"
              data-code="${UI.esc(subj.code)}"
              data-comp="${comp}"
              data-max="${subj.marks[comp]}"
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

  container.querySelectorAll('.mark-input').forEach(input => {
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
  const { session, students, attemptType } = bulkState;

  const errorInputs = [...document.querySelectorAll('#entry-table .mark-input.cell-error, #entry-table .mark-input.cell-over-max')];
  if (errorInputs.length > 0) {
    errorInputs[0].focus();
    UI.toast(`Fix ${errorInputs.length} invalid cell(s) before submitting.`, 'error', 5000);
    return;
  }

  const inputs = [...document.querySelectorAll('#entry-table .mark-input:not([disabled])')].filter(i => i.value.trim() !== '');

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
    uin: e.uin, subjectCode: e.code, attemptType, marks: e.marks,
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
  document.getElementById('se-attempt').onchange = () => {
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

  const attemptType = document.getElementById('se-attempt').value || 'Regular';
  const subjects    = getSubjectsForSem(session.semester, student.branch, session);
  singleState.subjects = subjects;

  const info = document.getElementById('se-student-info');
  info.innerHTML = `
    <div class="student-card">
      <div class="sc-name">${UI.esc(student.name)}</div>
      <div class="sc-meta">UIN: ${UI.esc(student.uin)} · PRN: ${UI.esc(student.prn || '—')} · ${UI.esc(student.branch)} · Div ${UI.esc(student.division)} · Batch ${UI.esc(student.batchYear)}</div>
    </div>`;

  let html = `<div class="single-grid">`;
  for (const subj of subjects) {
    const comps    = Object.keys(subj.marks);
    const prevEntry = State.getLatestEntryForSubject(student.uin, subj.code, session.id);

    html += `
    <div class="subj-card">
      <div class="subj-card-header">
        <span class="subj-code">${UI.esc(subj.code)}</span>
        <span class="subj-name">${UI.esc(subj.name)}</span>
        <span class="subj-credits">${subj.credits} cr</span>
      </div>
      <div class="subj-inputs">`;

    for (const comp of comps) {
      const locked = attemptType === 'Reval' && comp !== 'ESE';
      const prevVal = prevEntry ? prevEntry[comp.toLowerCase() + 'Marks'] : '';
      html += `
        <label class="comp-label${locked ? ' locked' : ''}">
          <span>${comp}<small>/${subj.marks[comp]}</small></span>
          <input type="text"
            class="mark-input-single"
            data-code="${UI.esc(subj.code)}"
            data-comp="${comp}"
            data-max="${subj.marks[comp]}"
            value="${UI.esc(locked ? prevVal : '')}"
            ${locked ? 'disabled' : ''}
            autocomplete="off"
          >
        </label>`;
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

  const attemptType = document.getElementById('se-attempt').value || 'Regular';
  const inputs = [...document.querySelectorAll('.mark-input-single:not([disabled])')];

  const subjectMap = {};
  for (const input of inputs) {
    const { code, comp } = input.dataset;
    if (!subjectMap[code]) subjectMap[code] = {};
    subjectMap[code][comp] = parseMarkValue(input.value.trim());
  }

  const entries = Object.entries(subjectMap).map(([code, marks]) => ({ uin: student.uin, subjectCode: code, attemptType, marks }));

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
      const revalUINs = new Set(State.ledger.filter(r => r.attemptType === 'Reval').map(r => r.uin));
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
  const student = State.getStudent(uin);
  const ledger  = State.getLedgerForStudent(uin);
  document.getElementById('pv-results').innerHTML = '';
  document.getElementById('pv-search').value = student.name;

  // Build session map to get session object for each ledger group
  const sessionMap = {};
  State.getSessions().forEach(s => { sessionMap[s.id] = s; });

  // Group by session
  const bySession = {};
  for (const row of ledger) {
    const key = row.examSession + '|' + row.semester;
    if (!bySession[key]) bySession[key] = { sessionId: row.examSession, sessionName: row.examSession, semester: row.semester, rows: [] };
    // Try to resolve session name from session master
    const sess = sessionMap[row.examSession];
    if (sess) bySession[key].sessionName = sess.name;
    bySession[key].rows.push(row);
  }

  // Student info card — with overall status badge per session computed below
  // We'll build per-session status badges inline in the timeline

  let infoHTML = `
    <div class="student-card" style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
      <div>
        <div class="sc-name">${UI.esc(student.name)}</div>
        <div class="sc-meta">UIN: ${UI.esc(student.uin)} · PRN: ${UI.esc(student.prn || '—')} · ${UI.esc(student.branch)} · Div ${UI.esc(student.division)} · Batch ${UI.esc(student.batchYear)}</div>
      </div>
    </div>`;
  document.getElementById('pv-student-info').innerHTML = infoHTML;

  if (ledger.length === 0) {
    document.getElementById('pv-timeline').innerHTML = '<div class="empty-state">No entries found for this student.</div>';
    return;
  }

  // Component max marks lookup (from subject config via ledger type+code)
  function getCompMax(subjectCode, comp) {
    const allSubjects = [...SEM1_SUBJECTS];
    // Try to find in Sem1
    let subj = allSubjects.find(s => s.code === subjectCode);
    if (!subj) {
      // Try Sem2 fixed
      subj = getSem2Subjects(student.branch, null).find(s => s.code === subjectCode);
    }
    if (!subj) return null;
    return subj.marks[comp] || null;
  }

  let html = '';

  for (const [, group] of Object.entries(bySession)) {
    const sess = sessionMap[group.sessionId];

    // Latest row per subject
    const latestBySubject = {};
    for (const r of group.rows) {
      if (!latestBySubject[r.subjectCode] || r.entryDateTime > latestBySubject[r.subjectCode].entryDateTime) {
        latestBySubject[r.subjectCode] = r;
      }
    }
    const totalCredits  = Object.values(latestBySubject).reduce((a,r) => a + (Number(r.creditsEarned)||0), 0);
    const totalAssigned = Object.values(latestBySubject).reduce((a,r) => a + (Number(r.creditsAssigned)||0), 0);

    // Session-level status
    const sessionStatus = sess ? State.getSessionStatus(uin, sess) : 'pending';
    const showPerComp   = sessionStatus === 'multi-attempt';

    // Status badge for session header
    let sessionBadge = '';
    if (sessionStatus === 'successful') {
      sessionBadge = `<span class="pv-session-badge pv-session-success">🎉 Successful — First Attempt</span>`;
    } else if (sessionStatus === 'pending') {
      sessionBadge = `<span class="pv-session-badge pv-session-pending">⏳ Pending</span>`;
    }
    // multi-attempt: no session badge, show per-component tags instead

    html += `
    <div class="session-block">
      <div class="session-header">
        <span class="session-name">${UI.esc(group.sessionName)}</span>
        <span class="session-sem">Sem ${UI.esc(group.semester)}</span>
        ${sessionBadge}
        <span class="credit-pill">${totalCredits} / ${totalAssigned} credits</span>
      </div>
      <table class="progress-table">
        <thead><tr>
          <th>Subject</th><th>Type</th><th>Attempt</th>
          <th>IAT</th><th>ESE</th><th>TW</th><th>Oral</th>
          <th>Total</th><th>Result</th><th>Credits</th>
        </tr></thead>
        <tbody>`;

    for (const r of group.rows) {
      const isLatest = latestBySubject[r.subjectCode]?.entryId === r.entryId;

      // Build per-component cells with tags if multi-attempt
      const comps = ['IAT','ESE','TW','Oral'];
      const compFields = { IAT: r.iatMarks, ESE: r.eseMarks, TW: r.twMarks, Oral: r.oralMarks };
      const compMaxKeys = { IAT: 'iatMarks', ESE: 'eseMarks', TW: 'twMarks', Oral: 'oralMarks' };

      // Try to get max marks for this subject
      let subjConfig = SEM1_SUBJECTS.find(s => s.code === r.subjectCode);
      if (!subjConfig) subjConfig = getSem2Subjects(student.branch, null).find(s => s.code === r.subjectCode);

      const cells = comps.map(comp => {
        const val = compFields[comp] || '—';
        if (!showPerComp || !isLatest) {
          return `<td>${UI.esc(val)}</td>`;
        }
        const maxMark = subjConfig?.marks?.[comp];
        if (!maxMark) return `<td>${UI.esc(val)}</td>`; // comp not applicable for this subject
        return `<td class="pv-comp-cell">${UI.esc(val)} ${_pvMarkTag(val === '—' ? null : val, maxMark)}</td>`;
      }).join('');

      html += `
        <tr class="${isLatest ? '' : 'row-superseded'}" title="${isLatest ? 'Latest entry' : 'Superseded by later entry'}">
          <td><span class="subj-code-small">${UI.esc(r.subjectCode)}</span> ${UI.esc(r.subjectName)}</td>
          <td>${UI.esc(r.subjectType)}</td>
          <td>${UI.attemptBadge(r.attemptType)}</td>
          ${cells}
          <td>${UI.esc(r.totalMarks|| '—')}</td>
          <td>${UI.resultBadge(r.result)}</td>
          <td class="${r.creditsEarned > 0 ? 'credit-earned' : 'credit-zero'}">${UI.esc(r.creditsEarned)}</td>
        </tr>`;
    }
    html += `</tbody></table></div>`;
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
  UI.buildSelect('rpt-credit-session', sessions, '— select session —', 'id', 'name');
  UI.buildSelect('rpt-my-session',     sessions, '— all sessions —',   'id', 'name');

  // Export buttons
  document.getElementById('rpt-result-summary-csv').onclick  = _rptExportResultSummary;
  document.getElementById('rpt-reval-impact-csv').onclick    = _rptExportRevalImpact;
  document.getElementById('rpt-toppers-csv').onclick         = _rptExportToppers;
  document.getElementById('rpt-credit-filter').onclick       = _rptCreditFilter;
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

// ── Credit / KT / My Entries ──────────────────────────────────
function _rptCreditFilter() {
  const sessionId = document.getElementById('rpt-credit-session').value;
  if (!sessionId) { UI.toast('Select a session.', 'error'); return; }
  const x = Number(document.getElementById('rpt-credit-x').value);
  if (!x) { UI.toast('Enter minimum credits.', 'error'); return; }
  const data = State.reportCreditFilter(x, sessionId);
  UI.exportCSV(`CreditFilter_lt${x}`,
    ['UIN','PRN','Name','Branch','Credits Earned'],
    data.map(d => [d.uin, d.prn, d.name, d.branch, d.credits])
  );
  UI.toast(`Exported ${data.length} students with < ${x} credits.`, 'success');
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

  document.getElementById('admin-upload-btn').onclick = _adminUploadStudents;
  document.getElementById('admin-csv-file').onchange  = _adminPreviewCSV;

  const sessions = State.getSessions();
  UI.buildSelect('admin-session-lock-select', sessions.filter(s => s.status === 'Active'), '— select session to lock —', 'id', 'name');

  _adminRenderSessionList();
  _adminRenderAudit();
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
  const name     = document.getElementById('admin-session-name').value.trim();
  const semester = document.getElementById('admin-session-sem').value;
  const batch    = document.getElementById('admin-session-batch').value.trim();

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

  let confirmBody = `Create session <strong>${UI.esc(name)}</strong>?<br>
    Semester: <strong>${semester === '1' ? 'I' : 'II'}</strong> &nbsp;·&nbsp; Batch: <strong>${UI.esc(batch)}</strong>`;

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
        const s = await State.addSession(name, semester, batch, electives);
        UI.hideSpinner();
        UI.toast(`Session "${s.name}" created.`, 'success');
        ['admin-session-name','admin-session-batch'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('admin-session-sem').value = '';
        _adminToggleElectives();
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
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--ink-4);padding:16px;">No sessions yet.</td></tr>';
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

    return `<tr>
      <td>${UI.esc(s.name)}</td>
      <td>Sem ${UI.esc(String(s.semester))}</td>
      <td>${UI.esc(s.batchYear)}</td>
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

function _adminRenderAudit() {
  const last50 = [...State.ledger].reverse().slice(0,50);
  const tbody  = document.getElementById('audit-tbody');
  if (!tbody) return;
  tbody.innerHTML = last50.map(r => `
    <tr>
      <td>${UI.esc(r.entryDateTime?.slice(0,16).replace('T',' ') || '')}</td>
      <td>${UI.esc(r.enteredBy)}</td>
      <td>${UI.esc(r.name)}</td>
      <td>${UI.esc(r.subjectCode)}</td>
      <td>${UI.attemptBadge(r.attemptType)}</td>
      <td>${UI.resultBadge(r.result)}</td>
    </tr>
  `).join('');
}


// ═══════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════
function _debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
