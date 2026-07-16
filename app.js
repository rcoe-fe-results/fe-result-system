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

  // Show admin-only tabs
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
  activeComps: new Set(['IAT','ESE','TW','Oral']), // columns selected to enter
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

function _beOnBranchChange() {
  bulkState.branch = document.getElementById('be-branch').value;
  const divs = State.getDivisions(bulkState.branch);
  UI.buildSelect('be-division', divs, '— all divisions —');
  document.getElementById('be-division').disabled = false;
  _beEnableAttempt();
}

function _beOnDivisionChange() {
  bulkState.division = document.getElementById('be-division').value || null;
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
  if (!session || !branch || !attemptType) {
    UI.toast('Select session, branch, and attempt type first.', 'error'); return;
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
  bulkState.activeComps = new Set(['IAT','ESE','TW','Oral']); // reset to all on fresh load

  _beRenderToolbar();
  _beRenderGrid();
  document.getElementById('be-submit-btn').disabled = false;
}

// ── Toolbar: sort + column picker ────────────────────────────
function _beRenderToolbar() {
  const toolbar = document.getElementById('be-toolbar');
  toolbar.classList.remove('hidden');

  // Sort control
  const sortEl = document.getElementById('be-sort');
  sortEl.value = bulkState.sortBy;
  sortEl.onchange = () => {
    bulkState.sortBy = sortEl.value;
    _beSortStudents();
    _beRenderGrid();
  };

  // Column picker — figure out which comps actually appear in subjects
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
  if (by === 'default') return; // keep original order
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

  // Which comps to actually render (intersection of subject comps + selected)
  const getVisibleComps = (subj) =>
    Object.keys(subj.marks).filter(c => activeComps.size === 0 || activeComps.has(c));

  // Count total visible columns
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
  <div class="grid-scroll" id="be-scroll">
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

  html += `</tbody></table></div></div>`;
  container.innerHTML = html;

  // Bind input events
  container.querySelectorAll('.mark-input').forEach(input => {
    input.addEventListener('input', _beOnCellInput);
    input.addEventListener('keydown', _beOnCellKeydown);
  });

  // Sync mirror scrollbar width + scroll
  _setupMirrorScroll();
}

function _setupMirrorScroll() {
  const scroll  = document.getElementById('be-scroll');
  const mirror  = document.getElementById('be-mirror');
  const inner   = document.getElementById('be-mirror-inner');
  if (!scroll || !mirror || !inner) return;

  // Set inner width to match scrollable content
  const syncWidth = () => { inner.style.width = scroll.scrollWidth + 'px'; };
  syncWidth();
  new ResizeObserver(syncWidth).observe(scroll);

  // Sync scroll positions bidirectionally
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

  if (!raw) return; // empty = no highlight (partial entry allowed)
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

  // Block on over-max errors (invalid values are also blocked)
  const errorInputs = [...document.querySelectorAll('#entry-table .mark-input.cell-error, #entry-table .mark-input.cell-over-max')];
  if (errorInputs.length > 0) {
    errorInputs[0].focus();
    UI.toast(`Fix ${errorInputs.length} invalid cell(s) before submitting. Red = invalid, orange = over max.`, 'error', 5000);
    return;
  }

  // Collect only inputs that have a value (partial submit — empty = skip)
  const inputs = [...document.querySelectorAll('#entry-table .mark-input:not([disabled])')].filter(i => i.value.trim() !== '');

  if (inputs.length === 0) {
    UI.toast('No marks entered yet.', 'info'); return;
  }

  // Build entries — only subjects where at least one comp was filled
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

  // Session selectors
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
      // Students with at least one REVAL row
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

function _pvShowStudent(uin) {
  const student  = State.getStudent(uin);
  const ledger   = State.getLedgerForStudent(uin);
  document.getElementById('pv-results').innerHTML = '';
  document.getElementById('pv-search').value = student.name;

  document.getElementById('pv-student-info').innerHTML = `
    <div class="student-card">
      <div class="sc-name">${UI.esc(student.name)}</div>
      <div class="sc-meta">UIN: ${UI.esc(student.uin)} · PRN: ${UI.esc(student.prn || '—')} · ${UI.esc(student.branch)} · Div ${UI.esc(student.division)} · Batch ${UI.esc(student.batchYear)}</div>
    </div>`;

  if (ledger.length === 0) {
    document.getElementById('pv-timeline').innerHTML = '<div class="empty-state">No entries found for this student.</div>';
    return;
  }

  // Group by session → semester
  const bySession = {};
  for (const row of ledger) {
    const key = row.examSession + '|' + row.semester;
    if (!bySession[key]) bySession[key] = { sessionName: row.examSession, semester: row.semester, rows: [] };
    bySession[key].rows.push(row);
  }

  // Compute credits per session
  let html = '';
  for (const [, group] of Object.entries(bySession)) {
    // Latest row per subject
    const latestBySubject = {};
    for (const r of group.rows) {
      if (!latestBySubject[r.subjectCode] || r.entryDateTime > latestBySubject[r.subjectCode].entryDateTime) {
        latestBySubject[r.subjectCode] = r;
      }
    }
    const totalCredits  = Object.values(latestBySubject).reduce((a,r) => a + (Number(r.creditsEarned)||0), 0);
    const totalAssigned = Object.values(latestBySubject).reduce((a,r) => a + (Number(r.creditsAssigned)||0), 0);

    html += `
    <div class="session-block">
      <div class="session-header">
        <span class="session-name">${UI.esc(group.sessionName)}</span>
        <span class="session-sem">Sem ${UI.esc(group.semester)}</span>
        <span class="credit-pill">${totalCredits} / ${totalAssigned} credits</span>
      </div>
      <table class="progress-table">
        <thead><tr>
          <th>Subject</th><th>Type</th><th>Attempt</th>
          <th>IAT</th><th>ESE</th><th>TW</th><th>Oral</th>
          <th>Total</th><th>Result</th><th>Credits</th>
        </tr></thead>
        <tbody>`;

    // Show all rows (timeline), latest highlighted
    for (const r of group.rows) {
      const isLatest = latestBySubject[r.subjectCode]?.entryId === r.entryId;
      html += `
        <tr class="${isLatest ? '' : 'row-superseded'}" title="${isLatest ? 'Latest entry' : 'Superseded by later entry'}">
          <td><span class="subj-code-small">${UI.esc(r.subjectCode)}</span> ${UI.esc(r.subjectName)}</td>
          <td>${UI.esc(r.subjectType)}</td>
          <td>${UI.attemptBadge(r.attemptType)}</td>
          <td>${UI.esc(r.iatMarks  || '—')}</td>
          <td>${UI.esc(r.eseMarks  || '—')}</td>
          <td>${UI.esc(r.twMarks   || '—')}</td>
          <td>${UI.esc(r.oralMarks || '—')}</td>
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
  UI.buildSelect('rpt-session', sessions, '— select session —', 'id', 'name');

  document.getElementById('rpt-result-summary').onclick   = _rptResultSummary;
  document.getElementById('rpt-reval-impact').onclick     = _rptRevalImpact;
  document.getElementById('rpt-toppers').onclick          = _rptToppers;
  document.getElementById('rpt-credit-filter').onclick    = _rptCreditFilter;
  document.getElementById('rpt-kt-filter').onclick        = _rptKTFilter;
  document.getElementById('rpt-my-entries').onclick       = _rptMyEntries;
}

function _rptSession() {
  const id = document.getElementById('rpt-session').value;
  if (!id) { UI.toast('Select a session.', 'error'); return null; }
  return State.getSession(id);
}

function _rptResultSummary() {
  const session = _rptSession(); if (!session) return;
  const data = State.reportResultSummary(session.id);
  UI.exportCSV(`ResultSummary_${session.name}`,
    ['Subject Code','Subject Name','Total','Pass','Fail','AB','Pass %'],
    data.map(d => [d.code, d.name, d.total, d.pass, d.fail, d.ab, d.passPct + '%'])
  );
  UI.toast(`Exported result summary for ${session.name}.`, 'success');
}

function _rptRevalImpact() {
  const session = _rptSession(); if (!session) return;
  const data = State.reportRevalImpact(session.id);
  UI.exportCSV(`RevalImpact_${session.name}`,
    ['UIN','PRN','Name','Branch','Subject Code','Subject Name','Prev Result','New Result','Entry Date'],
    data.map(d => [d.uin, d.prn, d.name, d.branch, d.subjectCode, d.subjectName, d.prevResult, d.result, d.entryDateTime])
  );
  UI.toast(`Exported reval impact for ${session.name}.`, 'success');
}

function _rptToppers() {
  const session = _rptSession(); if (!session) return;
  const n = Number(document.getElementById('rpt-toppers-n').value || 10);
  const data = State.reportToppers(session.id, n);
  UI.exportCSV(`Toppers_${session.name}`,
    ['Rank','UIN','Name','Branch','Credits Earned','Total Marks'],
    data.map((d,i) => [i+1, d.uin, d.name, d.branch, d.totalCredits, d.totalMarks])
  );
  UI.toast(`Exported top ${n} students.`, 'success');
}

function _rptCreditFilter() {
  const session = _rptSession(); if (!session) return;
  const x = Number(document.getElementById('rpt-credit-x').value);
  if (!x) { UI.toast('Enter minimum credits.', 'error'); return; }
  const data = State.reportCreditFilter(x, session.id);
  UI.exportCSV(`CreditFilter_lt${x}_${session.name}`,
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
  UI.toast(`Exported KT filter results.`, 'success');
}

function _rptMyEntries() {
  const user = Auth.getUser();
  const session = document.getElementById('rpt-session').value;
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

  // Session management
  document.getElementById('admin-add-session').onclick  = _adminAddSession;
  document.getElementById('admin-lock-session').onclick = _adminLockSession;

  // Show/hide elective dropdowns when semester changes
  const semEl = document.getElementById('admin-session-sem');
  semEl.onchange = _adminToggleElectives;
  _adminToggleElectives(); // run once on init to set correct initial state

  // Populate elective dropdowns from config pools
  _buildElectiveSelects();

  // Student upload
  document.getElementById('admin-upload-btn').onclick = _adminUploadStudents;
  document.getElementById('admin-csv-file').onchange  = _adminPreviewCSV;

  // Populate lock session dropdown
  const sessions = State.getSessions();
  UI.buildSelect('admin-session-lock-select', sessions.filter(s => s.status === 'Active'), '— select session to lock —', 'id', 'name');

  // Session list table
  _adminRenderSessionList();

  // Audit log
  _adminRenderAudit();
}

function _adminToggleElectives() {
  const sem     = document.getElementById('admin-session-sem').value;
  const section = document.getElementById('admin-electives-section');
  if (section) section.classList.toggle('hidden', sem !== '2');
}

function _buildElectiveSelects() {
  // Physics Theory
  const pt = document.getElementById('admin-phys-theory');
  if (pt) {
    pt.innerHTML = '<option value="">— select —</option>' +
      ELECTIVE_PHYSICS_THEORY.map(e => `<option value="${UI.esc(e.code)}">${UI.esc(e.code)} — ${UI.esc(e.name)}</option>`).join('');
  }
  // Physics Lab
  const pl = document.getElementById('admin-phys-lab');
  if (pl) {
    pl.innerHTML = '<option value="">— select —</option>' +
      ELECTIVE_PHYSICS_LAB.map(e => `<option value="${UI.esc(e.code)}">${UI.esc(e.code)} — ${UI.esc(e.name)}</option>`).join('');
  }
  // Chem Theory
  const ct = document.getElementById('admin-chem-theory');
  if (ct) {
    ct.innerHTML = '<option value="">— select —</option>' +
      ELECTIVE_CHEMISTRY_THEORY.map(e => `<option value="${UI.esc(e.code)}">${UI.esc(e.code)} — ${UI.esc(e.name)}</option>`).join('');
  }
  // Chem Lab
  const cl = document.getElementById('admin-chem-lab');
  if (cl) {
    cl.innerHTML = '<option value="">— select —</option>' +
      ELECTIVE_CHEMISTRY_LAB.map(e => `<option value="${UI.esc(e.code)}">${UI.esc(e.code)} — ${UI.esc(e.name)}</option>`).join('');
  }

  // Auto-pair: when Physics Theory changes, auto-select the matching lab
  document.getElementById('admin-phys-theory')?.addEventListener('change', e => {
    const code    = e.target.value;                       // e.g. BSC2021
    const labCode = code.replace('BSC202', 'BSL201');     // → BSL2011
    const labEl   = document.getElementById('admin-phys-lab');
    if (labEl && labCode && labEl.querySelector(`option[value="${labCode}"]`)) {
      labEl.value = labCode;
    }
  });

  // Auto-pair: when Chem Theory changes, auto-select the matching lab
  document.getElementById('admin-chem-theory')?.addEventListener('change', e => {
    const code    = e.target.value;                       // e.g. BSC2031
    const labCode = code.replace('BSC203', 'BSL202');     // → BSL2021
    const labEl   = document.getElementById('admin-chem-lab');
    if (labEl && labCode && labEl.querySelector(`option[value="${labCode}"]`)) {
      labEl.value = labCode;
    }
  });
}

async function _adminAddSession() {
  const name     = document.getElementById('admin-session-name').value.trim();
  const semester = document.getElementById('admin-session-sem').value;
  const batch    = document.getElementById('admin-session-batch').value.trim();

  if (!name || !semester || !batch) {
    UI.toast('Fill in session name, semester, and batch year.', 'error'); return;
  }

  // Collect electives for Sem II
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

  // Build confirmation message
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
        // Clear form
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
