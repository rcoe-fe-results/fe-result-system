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
    showTab('mark-entry');
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
  'mark-entry':   initMarkEntry,
  'progress':     initProgress,
  'reports':      initReports,
  'dashboard':    initDashboard,
  'admin':        initAdmin,
};

function _bindModalClose() {
  document.getElementById('modal-cancel')?.addEventListener('click', UI.hideModal);
  document.getElementById('modal')?.addEventListener('click', e => {
    if (e.target.id === 'modal') UI.hideModal();
  });
}

// ═══════════════════════════════════════════════════════════════
// TAB 1 — MARK ENTRY (Ad-hoc + Queue)

function _normalizeMarkInput(val) {
  if (!val) return val;
  const lower = val.toLowerCase().trim();
  if (lower === 'ab' || lower === 'absent' || lower === 'a.b.' || lower === 'abs') return 'AB';
  return val;
}
// ═══════════════════════════════════════════════════════════════
let meMode = 'adhoc'; // 'adhoc' | 'queue'

function initMarkEntry() {
  // Toggle buttons
  document.getElementById('me-adhoc-btn').onclick = () => _meSetMode('adhoc');
  document.getElementById('me-queue-btn').onclick = () => _meSetMode('queue');
  _meSetMode(meMode);
}

function _meSetMode(mode) {
  meMode = mode;
  document.getElementById('me-adhoc-btn').classList.toggle('active', mode === 'adhoc');
  document.getElementById('me-queue-btn').classList.toggle('active', mode === 'queue');
  document.getElementById('me-adhoc-panel').classList.toggle('hidden', mode !== 'adhoc');
  document.getElementById('me-queue-panel').classList.toggle('hidden', mode !== 'queue');
  if (mode === 'adhoc') _meInitAdhoc();
  if (mode === 'queue') _meInitQueue();
}

// ── AD-HOC MODE ───────────────────────────────────────────────
function _meInitAdhoc() {
  const searchInput = document.getElementById('me-adhoc-search');
  const resultsBox  = document.getElementById('me-adhoc-results');
  searchInput.value = '';
  resultsBox.innerHTML = '';
  meAdhocState = { student: null, session: null };
  document.getElementById('me-adhoc-student-panel').classList.add('hidden');
  document.getElementById('me-adhoc-session-picker').innerHTML = '';

  searchInput.addEventListener('input', _debounce(() => {
    const q = searchInput.value.trim();
    if (q.length < 2) { resultsBox.innerHTML = ''; return; }

    let matches = [];
    // Pure digits → try seat number first
    if (/^\d+$/.test(q)) {
      const seatMatches = _meSearchBySeat(q);
      if (seatMatches.length > 0) {
        matches = seatMatches;
      } else {
        matches = State.searchStudents(q).slice(0, 10);
      }
    } else {
      matches = State.searchStudents(q).slice(0, 10);
    }

    resultsBox.innerHTML = matches.length
      ? matches.map(s => `
          <div class="search-result" data-uin="${UI.esc(s.uin)}"
               data-seat="${UI.esc(s._matchedSeat || '')}">
            <strong>${UI.esc(s.name)}</strong>
            <span>${UI.esc(s.uin)} · ${UI.esc(s.branch)} · Batch ${UI.esc(s.batchYear)}
              ${s._matchedSeat ? `· <strong>Seat ${UI.esc(s._matchedSeat)}</strong>` : ''}
            </span>
          </div>`).join('')
      : '<div class="search-result muted">No students found.</div>';

    resultsBox.querySelectorAll('.search-result[data-uin]').forEach(el => {
      el.onclick = () => _meAdhocSelectStudent(el.dataset.uin, el.dataset.seat || null);
    });
  }, 250));

  document.getElementById('me-adhoc-submit-btn').onclick = _meAdhocSubmit;
}

// Search students by seat number across all sessions
function _meSearchBySeat(seatQuery) {
  const matches = [];
  const seen    = new Set();
  // Find all seat entries matching this seat number
  for (const sess of State.getSessions()) {
    const seats = State.getSeatsForSession(sess.id);
    for (const seat of seats) {
      if (String(seat.seatNumber) === seatQuery && !seen.has(seat.uin)) {
        const student = State.getStudent(seat.uin);
        if (student) {
          seen.add(seat.uin);
          matches.push({ ...student, _matchedSeat: seat.seatNumber, _matchedSessionId: sess.id });
        }
      }
    }
  }
  return matches;
}

// Check if a student is eligible for a given session
function _isStudentEligibleForSession(student, session) {
  const studentLedger = State.ledger.filter(r => r.uin === student.uin);
  const hasAnyEntries = studentLedger.length > 0;

  if (!hasAnyEntries) {
    // Fresh student — only show the single "canonical" own-batch session per semester:
    // the earliest Active own-batch session for Sem-I, and earliest for Sem-II.
    if (session.batchYear !== student.batchYear) return false;
    const allSessions = State.getSessions();
    const canonicalForSem = allSessions
      .filter(s => s.batchYear === student.batchYear &&
                   s.semester === session.semester &&
                   s.status === 'Active')
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    return canonicalForSem?.id === session.id;
  }

  // Student has entries — show sessions they actually sat
  const satThisSession = studentLedger.some(r => r.examSession === session.id);
  if (satThisSession) return true;

  // Show own-batch sessions for semesters not yet sat at all
  if (session.batchYear === student.batchYear) {
    const satThisSem = studentLedger.some(r => Number(r.semester) === session.semester);
    if (!satThisSem) {
      // Haven't sat this semester yet — show canonical session only
      const allSessions = State.getSessions();
      const canonicalForSem = allSessions
        .filter(s => s.batchYear === student.batchYear &&
                     s.semester === session.semester &&
                     s.status === 'Active')
        .sort((a, b) => a.id.localeCompare(b.id))[0];
      return canonicalForSem?.id === session.id;
    }
    // Has sat this semester — only show if they have active KTs in it
    const activeKTsInSem = State.getActiveKTSubjects(student.uin)
      .filter(r => Number(r.semester) === session.semester);
    return activeKTsInSem.length > 0;
  }

  // Different batch year — only if active KT in this semester
  const activeKTs = State.getActiveKTSubjects(student.uin);
  return activeKTs.some(r => Number(r.semester) === session.semester);
}

let meAdhocState = { student: null, session: null };

function _meAdhocSelectStudent(uin, matchedSeat) {
  const student = State.getStudent(uin);
  if (!student) return;
  meAdhocState.student = student;
  document.getElementById('me-adhoc-results').innerHTML = '';
  document.getElementById('me-adhoc-search').value = student.name;

  // Find eligible active sessions for this student
  const eligibleSessions = sortSessions(State.getSessions().filter(s =>
    s.status === 'Active' && _isStudentEligibleForSession(student, s)
  ));

  if (eligibleSessions.length === 0) {
    UI.toast('No active sessions found for this student.', 'error');
    return;
  }

  // If came via seat number and exactly one session → auto-select
  if (matchedSeat) {
    // Find which session(s) this seat belongs to for this student
    const seatSessions = State.getSessions().filter(sess => {
      const seats = State.getSeatsForSession(sess.id);
      return seats.some(s => s.uin === uin && String(s.seatNumber) === String(matchedSeat));
    }).filter(s => s.status === 'Active');

    if (seatSessions.length === 1) {
      meAdhocState.session = seatSessions[0];
      _meAdhocShowAutoSession(seatSessions[0], matchedSeat);
      _meAdhocRenderGrid();
      document.getElementById('me-adhoc-student-panel').classList.remove('hidden');
      return;
    }
  }

  // Multiple or no seat match → show session picker
  _meAdhocShowSessionPicker(eligibleSessions);
  document.getElementById('me-adhoc-student-panel').classList.remove('hidden');
  document.getElementById('me-adhoc-grid').innerHTML = '';
  document.getElementById('me-adhoc-student-info').innerHTML = _meStudentInfoHtml(student, null);
}

function _meAdhocShowAutoSession(session, seatNum) {
  const picker = document.getElementById('me-adhoc-session-picker');
  picker.innerHTML = `
    <div class="session-picker">
      <div class="session-picker-label">Session — auto-detected from seat ${UI.esc(String(seatNum))}</div>
      <div class="session-option" style="cursor:default; border-color:var(--pass); background:var(--pass-bg);">
        <span class="session-option-name">${UI.esc(session.name)}</span>
        <span class="session-auto-badge">✓ Auto-selected</span>
      </div>
    </div>`;
}

function _meAdhocShowSessionPicker(sessions) {
  const student = meAdhocState.student;
  const picker  = document.getElementById('me-adhoc-session-picker');

  // Tag is based on THIS SESSION's entries for this student — not overall KT status
  function _sessionStatus(session) {
    const acad = State.computeStudentAcademics(student.uin);
    const sessResult = acad?.sessionResults.find(sr => sr.session.id === session.id);

    if (!sessResult) return 'pending';

    const total = sessResult.subjects.length;
    if (total === 0) return 'pending';

    if (sessResult.pendingCount === total) return 'pending';

    const hasFailOrAB = sessResult.subjects.some(s =>
      !s.pending && (s.dr.result === 'Fail' || s.dr.result === 'AB')
    );
    if (hasFailOrAB) return 'unsuccessful';

    if (sessResult.pendingCount > 0) return 'pending';

    return 'cleared';
  }

  function _sessionTag(status) {
    if (status === 'cleared') {
      return `<span class="session-status-tag tag-cleared">✓ Cleared</span>`;
    }
    if (status === 'unsuccessful') {
      return `<span class="session-status-tag tag-unsuccessful">✗ Unsuccessful</span>`;
    }
    return `<span class="session-status-tag tag-pending">Marks entry pending</span>`;
  }

  picker.innerHTML = `
    <div class="session-picker">
      <div class="session-picker-label">Select session</div>
      ${sessions.map(s => {
        const status   = _sessionStatus(s);
        const readOnly = status === 'cleared' || status === 'unsuccessful';
        return `
        <div class="session-option${readOnly ? ' session-option-cleared' : ''}"
             ${readOnly ? '' : `data-session-id="${UI.esc(s.id)}"`}>
          <span class="session-option-name">${UI.esc(s.name)}</span>
          <span class="session-option-meta">Sem ${s.semester} · ${UI.esc(s.batchYear)} · ${UI.esc(s.entryType)}</span>
          ${_sessionTag(status)}
        </div>`;
      }).join('')}
    </div>`;

  picker.querySelectorAll('.session-option[data-session-id]').forEach(el => {
    el.onclick = () => {
      meAdhocState.session = State.getSession(el.dataset.sessionId);
      picker.querySelectorAll('.session-option').forEach(o =>
        o.style.borderColor = o === el ? 'var(--brand)' : ''
      );
      _meAdhocRenderGrid();
    };
  });
}

function _meStudentInfoHtml(student, session) {
  const isKT = session
    ? State.getActiveKTSubjects(student.uin).some(r => Number(r.semester) === session.semester)
    : false;
  const isFinal = session?.entryType === 'Final Gazette';
  return `
    <div class="student-card">
      <div class="sc-name">${UI.esc(student.name)}
        ${session
          ? isKT
            ? '<span class="badge badge-kt" style="margin-left:8px;">KT</span>'
            : '<span class="badge badge-regular" style="margin-left:8px;">Regular</span>'
          : ''}
      </div>
      <div class="sc-meta">
        UIN: ${UI.esc(student.uin)} · PRN/ERN: ${UI.esc(student.prn || '—')} ·
        ${UI.esc(student.branch)} · Div ${UI.esc(student.division)} · Batch ${UI.esc(student.batchYear)}
      </div>
      ${session
        ? isFinal
          ? '<div style="margin-top:6px;"><span class="session-type-inline final-gazette">📋 Final Gazette — only ESE editable</span></div>'
          : '<div style="margin-top:6px;"><span class="session-type-inline preliminary">📝 Preliminary</span></div>'
        : ''}
    </div>`;
}

function _meAdhocRenderGrid() {
  const { student, session } = meAdhocState;
  if (!student || !session) return;

  document.getElementById('me-adhoc-student-info').innerHTML =
    _meStudentInfoHtml(student, session);

  document.getElementById('me-adhoc-grid').innerHTML =
    _meBuildSubjectGrid(student, session, 'adhoc');

  _meWireGrid('me-adhoc-grid');
}

// Returns per-component pass status for a student+subject across all sessions of a semester
// { IAT: 'pass'|'fail'|'none', IAT_val: '31', ESE: ..., ... }
function _meGetCompPassStatus(uin, subjectCode, semester) {
  const allRows = State.ledger
    .filter(r => r.uin === uin && r.subjectCode === subjectCode && Number(r.semester) === semester)
    .sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));

  const status = {};
  const latest = {}; // latest non-empty value per component
  for (const r of allRows) {
    if (r.iatMarks  !== '') latest.IAT  = r.iatMarks;
    if (r.eseMarks  !== '') latest.ESE  = r.eseMarks;
    if (r.twMarks   !== '') latest.TW   = r.twMarks;
    if (r.oralMarks !== '') latest.Oral = r.oralMarks;
  }

  // Find subject config to get max marks
  const sess    = State.getSessions().find(s =>
    allRows.some(r => r.examSession === s.id)
  );
  const subjList = sess ? getSubjectsForSem(semester, allRows[0]?.branch || 'Computer', sess) : [];
  const subj     = subjList.find(s => s.code === subjectCode);

  for (const [comp, val] of Object.entries(latest)) {
    const max    = subj?.marks[comp];
    const parsed = parseMarkValue(val, max);
    status[comp + '_val'] = val;
    if (!parsed.valid)   { status[comp] = 'none'; continue; }
    if (parsed.absent)   { status[comp] = 'fail'; continue; }
    if (parsed.grace)    { status[comp] = 'pass'; continue; }
    if (max && parsed.value / max >= 0.40) status[comp] = 'pass';
    else status[comp] = 'fail';
  }
  return status;
}

function _meLockedCompHtml(comp, max, val) {
  return `
    <label class="comp-label locked">
      <span>${comp}<small>/${max}</small></span>
      <input type="text" class="mark-input-single" data-comp="${comp}"
        data-max="${max}" value="${UI.esc(val)}" disabled autocomplete="off">
    </label>`;
}

function _meEditableCompHtml(comp, max, code, uin, val) {
  return `
    <label class="comp-label">
      <span>${comp}<small>/${max}</small></span>
      <input type="text"
        class="mark-input-single${val ? ' cell-prefilled' : ''}"
        data-code="${UI.esc(code)}"
        data-comp="${comp}"
        data-max="${max}"
        data-uin="${UI.esc(uin)}"
        value="${UI.esc(val)}"
        autocomplete="off">
    </label>`;
}

// ── Shared subject grid builder ───────────────────────────────
// Builds the full single-grid HTML for a student+session.
// context = 'adhoc' | 'queue' — used for data-context attr on inputs
function _meBuildSubjectGrid(student, session, context) {
  const isFinal  = session.entryType === 'Final Gazette';
  const subjects = getSubjectsForSem(session.semester, student.branch, session);
  const isKT     = State.getActiveKTSubjects(student.uin)
    .some(r => Number(r.semester) === session.semester);

  let html = `<div class="single-grid">`;

  for (const subj of subjects) {
    const comps          = Object.keys(subj.marks);
    const prevEntry      = State.getLatestEntryForSubject(student.uin, subj.code, session.id);
    const prelimEntry    = isFinal && session.linkedPrelimSessionId
      ? State.getLatestEntryForSubject(student.uin, subj.code, session.linkedPrelimSessionId)
      : null;
    const compPassStatus = _meGetCompPassStatus(student.uin, subj.code, session.semester);

    html += `
      <div class="subj-card" data-subjcode="${UI.esc(subj.code)}" data-context="${context}">
        <div class="subj-card-header">
          <span class="subj-code">${UI.esc(subj.code)}</span>
          <span class="subj-name">${UI.esc(subj.name)}</span>
          <span class="subj-credits">${subj.credits} cr</span>
        </div>
        <div class="subj-inputs">`;

    for (const comp of comps) {
      const passedBefore = compPassStatus[comp] === 'pass';
      const prevVal      = compPassStatus[comp + '_val'] || '';

      if (isFinal) {
        if (comp !== 'ESE') {
          const prelimVal = prelimEntry
            ? (prelimEntry[comp.toLowerCase() + 'Marks'] || '—') : '—';
          html += _meLockedCompHtml(comp, subj.marks[comp], prelimVal, subj.code);
        } else {
          const existingFinal = prevEntry ? (prevEntry.eseMarks || '') : '';
          const prelimESE     = prelimEntry ? (prelimEntry.eseMarks || '') : '';
          html += _meEditableCompHtml(comp, subj.marks[comp], subj.code, student.uin, existingFinal || prelimESE);
        }
      } else if (isKT && passedBefore) {
        html += _meLockedCompHtml(comp, subj.marks[comp], prevVal, subj.code);
      } else {
        const existingVal = prevEntry ? (prevEntry[comp.toLowerCase() + 'Marks'] || '') : '';
        html += _meEditableCompHtml(comp, subj.marks[comp], subj.code, student.uin, existingVal);
      }
    }

    html += `
        </div>
        <div class="subj-summary incomplete" id="ss-${UI.esc(subj.code)}-${context}">
          Incomplete
        </div>
      </div>`;
  }

  html += `</div>`;
  return html;
}

// ── Wire grid inputs ──────────────────────────────────────────
function _meWireGrid(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.querySelectorAll('.mark-input-single').forEach(input => {
    input.addEventListener('input', e => {
      _beOnCellInput(e);
      _meLiveSummary(input, containerId);
    });
    // Trigger summary for pre-filled values on load
    if (input.value) _meLiveSummary(input, containerId);
  });
}

// ── Live subject summary ──────────────────────────────────────
function _meLiveSummary(triggerInput, containerId) {
  const card = triggerInput.closest('.subj-card');
  if (!card) return;

  const subjCode = card.dataset.subjcode;
  const context  = card.dataset.context;
  const summaryEl = document.getElementById(`ss-${subjCode}-${context}`);
  if (!summaryEl) return;

  // Find subject config
  const container = document.getElementById(containerId);
  const session   = context === 'adhoc' ? meAdhocState.session : meQueueState.session;
  const student   = context === 'adhoc' ? meAdhocState.student
                                        : meQueueState.students[meQueueState.currentIdx];
  if (!session || !student) return;

  const subjects = getSubjectsForSem(session.semester, student.branch, session);
  const subj     = subjects.find(s => s.code === subjCode);
  if (!subj) return;

  // Collect current values from ALL inputs in this card (editable + locked)
  const marksMap = {};
  card.querySelectorAll('.mark-input-single').forEach(input => {
    const comp = input.dataset.comp;
    if (!comp) return;
    const val = input.value.trim();
    if (val && val !== '—') marksMap[comp] = val;
  });

  // Compute display result
  const dr = computeDisplayResult(subj, marksMap);

  if (dr.pending) {
    summaryEl.className = 'subj-summary incomplete';
    summaryEl.textContent = 'Incomplete';
    return;
  }

  const passClass = dr.result === 'Pass' ? 'pass-state' : 'fail-state';
  summaryEl.className = `subj-summary ${passClass}`;

  const gradeCls = dr.grade === 'F' ? 'ss-fail' : dr.grade === 'O' ? 'ss-pass' : 'ss-grade';
  const resCls   = dr.result === 'Pass' ? 'ss-pass' : 'ss-fail';
  const resIcon  = dr.result === 'Pass' ? '✓ Pass' : '✗ Fail';

  summaryEl.innerHTML = `
    <span class="ss-pill ss-total">${dr.total} / ${dr.totalMax}</span>
    <span class="ss-pill ss-pct">${dr.pct.toFixed(1)}%</span>
    <span class="ss-pill ${gradeCls}">Grade: ${dr.grade}</span>
    <span class="ss-pill ss-gp">GP: ${dr.gradePoint}</span>
    <span class="ss-pill ss-credit">C: ${dr.creditsEarned}</span>
    <span class="ss-pill ${resCls}">${resIcon}</span>
    ${dr.grace ? '<span class="ss-pill" style="background:var(--grace-bg);color:var(--grace);border-color:var(--grace);">Grace</span>' : ''}
  `;
}

async function _meAdhocSubmit() {
  const { student, session } = meAdhocState;
  if (!student || !session) { UI.toast('Select a student and session.', 'error'); return; }

  const isFinal = session.entryType === 'Final Gazette';
  const inputs  = [...document.querySelectorAll('#me-adhoc-grid .mark-input-single:not([disabled])')];
  const subjectMap = {};
  for (const input of inputs) {
    const { code, comp } = input.dataset;
    const val = input.value.trim();
    if (!val) continue;
    if (!subjectMap[code]) subjectMap[code] = {};
    subjectMap[code][comp] = parseMarkValue(val);
  }
  const entries = Object.entries(subjectMap).map(([code, marks]) => ({ uin: student.uin, subjectCode: code, marks }));
  if (entries.length === 0) { UI.toast('No marks entered.', 'info'); return; }

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

// ── QUEUE MODE ────────────────────────────────────────────────
let meQueueState = {
  session: null, branch: null, sortBy: 'seat',
  students: [], currentIdx: 0,
  entered: 0, skipped: 0,
};

function _meInitQueue() {
  const sessions = sortSessions(State.getSessions().filter(s => s.status === 'Active'));
  UI.buildSelect('me-queue-session', sessions, '— select session —', 'id', 'name');
  UI.buildSelect('me-queue-branch', BRANCHES, '— select branch —');

  document.getElementById('me-queue-session').onchange = _meQueueOnFilterChange;
  document.getElementById('me-queue-branch').onchange  = _meQueueOnFilterChange;
  document.getElementById('me-queue-sort').onchange    = _meQueueOnFilterChange;
  document.getElementById('me-queue-load-btn').onclick = _meQueueLoad;
  document.getElementById('me-queue-skip-btn').onclick = _meQueueSkip;
  document.getElementById('me-queue-save-btn').onclick = _meQueueSaveAndNext;

  document.getElementById('me-queue-card').classList.add('hidden');
  document.getElementById('me-queue-summary').classList.add('hidden');
}

function _meQueueOnFilterChange() {
  meQueueState.session = State.getSession(document.getElementById('me-queue-session').value);
  meQueueState.branch  = document.getElementById('me-queue-branch').value || null;
  meQueueState.sortBy  = document.getElementById('me-queue-sort').value || 'seat';
  const ready = meQueueState.session && meQueueState.branch;
  document.getElementById('me-queue-load-btn').disabled = !ready;
}

function _meQueueLoad() {
  const { session, branch, sortBy } = meQueueState;
  if (!session || !branch) { UI.toast('Select session and branch.', 'error'); return; }

  let students = State.getEligibleStudents(session, branch);

  // Sort
  const seatMap = State.getSeatsForSession(session.id);
  const seatLookup = {};
  for (const s of seatMap) seatLookup[s.uin] = s.seatNumber;

  students = students.sort((a, b) => {
    if (sortBy === 'seat') {
      const sa = seatLookup[a.uin] || '';
      const sb = seatLookup[b.uin] || '';
      const na = Number(sa), nb = Number(sb);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return sa.localeCompare(sb);
    }
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'uin')  return a.uin.localeCompare(b.uin);
    if (sortBy === 'prn')  return (a.prn || '').localeCompare(b.prn || '');
    return 0;
  });

  if (students.length === 0) {
    UI.toast('No eligible students found for this session + branch.', 'error'); return;
  }

  meQueueState.students   = students;
  meQueueState.currentIdx = 0;
  meQueueState.entered    = 0;
  meQueueState.skipped    = 0;
  meQueueState.seatLookup = seatLookup;

  document.getElementById('me-queue-summary').classList.add('hidden');
  _meQueueRenderCard();
}

function _meQueueRenderCard() {
  const { students, currentIdx, session, seatLookup } = meQueueState;
  const student = students[currentIdx];
  if (!student) { _meQueueShowSummary(); return; }

  const card    = document.getElementById('me-queue-card');
  card.classList.remove('hidden');

  const seatNum  = seatLookup[student.uin] || '—';
  const isFinal  = session.entryType === 'Final Gazette';
  const subjects = getSubjectsForSem(session.semester, student.branch, session);
  const isKT     = student.attemptFlag === 'KT';

  // Progress indicator
  document.getElementById('me-queue-progress').textContent =
    `Student ${currentIdx + 1} of ${students.length}`;
  document.getElementById('me-queue-progress-bar-fill').style.width =
    `${Math.round((currentIdx / students.length) * 100)}%`;

  // Student header
  document.getElementById('me-queue-student-header').innerHTML = `
    <div class="student-card" style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
      <div class="seat-badge">${UI.esc(seatNum)}</div>
      <div>
        <div class="sc-name">${UI.esc(student.name)}
          ${isKT
            ? '<span class="badge badge-kt" style="margin-left:8px;">KT</span>'
            : '<span class="badge badge-regular" style="margin-left:8px;">Regular</span>'}
        </div>
        <div class="sc-meta">UIN: ${UI.esc(student.uin)} · PRN/ERN: ${UI.esc(student.prn || '—')} · Batch ${UI.esc(student.batchYear)}</div>
      </div>
      ${isFinal
        ? '<span class="session-type-inline final-gazette" style="margin-left:auto;">📋 Final Gazette</span>'
        : '<span class="session-type-inline preliminary" style="margin-left:auto;">📝 Preliminary</span>'}
    </div>`;

  document.getElementById('me-queue-grid').innerHTML =
    _meBuildSubjectGrid(student, session, 'queue');

  _meWireGrid('me-queue-grid');

  // Focus first editable input
  const firstInput = document.querySelector('#me-queue-grid .mark-input-single:not([disabled])');
  if (firstInput) firstInput.focus();
}

function _meQueueSkip() {
  meQueueState.skipped++;
  meQueueState.currentIdx++;
  if (meQueueState.currentIdx >= meQueueState.students.length) {
    _meQueueShowSummary();
  } else {
    _meQueueRenderCard();
  }
}

async function _meQueueSaveAndNext() {
  const { session, students, currentIdx } = meQueueState;
  const student = students[currentIdx];
  if (!student) return;

  const inputs = [...document.querySelectorAll('#me-queue-grid .mark-input-single:not([disabled])')];
  const subjectMap = {};
  for (const input of inputs) {
    const { code, comp } = input.dataset;
    const val = input.value.trim();
    if (!val) continue;
    if (!subjectMap[code]) subjectMap[code] = {};
    subjectMap[code][comp] = parseMarkValue(val);
  }

  const entries = Object.entries(subjectMap).map(([code, marks]) => ({
    uin: student.uin, subjectCode: code, marks,
  }));

  if (entries.length > 0) {
    UI.showSpinner('Saving…');
    try {
      await State.submitEntries(session, entries);
      UI.hideSpinner();
      meQueueState.entered++;
    } catch (err) {
      UI.hideSpinner();
      UI.toast('Error saving: ' + err.message, 'error', 8000);
      return; // Don't advance on error
    }
  } else {
    meQueueState.skipped++;
  }

  meQueueState.currentIdx++;
  if (meQueueState.currentIdx >= meQueueState.students.length) {
    _meQueueShowSummary();
  } else {
    _meQueueRenderCard();
  }
}

function _meQueueShowSummary() {
  document.getElementById('me-queue-card').classList.add('hidden');
  const summary = document.getElementById('me-queue-summary');
  summary.classList.remove('hidden');

  const { students, entered, skipped } = meQueueState;

  // Find skipped students for follow-up list
  // (students where no marks were saved in this queue run)
  const skippedStudents = students.filter((s, i) => {
    // A rough proxy: no entry exists for this student in this session
    const hasEntry = State.ledger.some(r =>
      r.uin === s.uin && r.examSession === meQueueState.session.id
    );
    return !hasEntry;
  });

  summary.innerHTML = `
    <div class="card">
      <div class="card-title">✅ Queue Complete</div>
      <div style="display:flex; gap:24px; margin-bottom:16px; flex-wrap:wrap;">
        <div class="pv-stat">
          <span class="pv-stat-val" style="color:var(--pass);">${students.length}</span>
          <span class="pv-stat-lbl">Total students</span>
        </div>
        <div class="pv-stat">
          <span class="pv-stat-val" style="color:var(--brand);">${entered}</span>
          <span class="pv-stat-lbl">Saved</span>
        </div>
        <div class="pv-stat">
          <span class="pv-stat-val" style="color:var(--grace);">${skipped}</span>
          <span class="pv-stat-lbl">Skipped</span>
        </div>
      </div>
      ${skippedStudents.length > 0 ? `
        <div style="font-size:12px; font-weight:600; color:var(--ink-3); margin-bottom:8px;">
          Students with no entries yet (${skippedStudents.length}):
        </div>
        <div style="display:flex; flex-direction:column; gap:4px;">
          ${skippedStudents.map(s => `
            <div style="font-size:12px; padding:6px 10px; background:var(--surface-2);
                        border-radius:var(--radius); border:1px solid var(--border);">
              <strong>${UI.esc(s.name)}</strong>
              <span style="color:var(--ink-3); margin-left:8px;">${UI.esc(s.uin)}</span>
              ${s.attemptFlag === 'KT' ? '<span class="badge badge-kt" style="margin-left:6px;">KT</span>' : ''}
            </div>`).join('')}
        </div>` : ''}
      <div style="margin-top:16px; display:flex; gap:10px;">
        <button class="btn btn-primary" onclick="_meQueueLoad()">Start over</button>
        <button class="btn btn-secondary" onclick="_meSetMode('adhoc')">Switch to Ad-hoc</button>
      </div>
    </div>`;
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
  const genderFilter = document.getElementById('be-gender').value || null;
  let students = State.getStudents({ branch, division: division || undefined, gender: genderFilter });
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
    const rawVal = _normalizeMarkInput(input.value.trim());
    entriesByStudentSubject[key].marks[comp] = parseMarkValue(rawVal);
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
// ── Queue mode helpers ────────────────────────────────────────
function _queueLoad() {
  const session  = queueState.session;
  const semester = queueState.semester;
  const branch   = document.getElementById('se-q-branch').value;
  const divVal   = document.getElementById('se-q-division').value;
  const division = (divVal === 'All' || !divVal) ? null : divVal;
  const sortBy   = document.getElementById('se-q-sort').value;

  if (!session || !branch) {
    UI.toast('Select session and branch first.', 'error'); return;
  }
  if (session.semester === 2 && !sessionHasElectives(session)) {
    UI.toast('This Sem II session has no electives configured. Ask an Admin.', 'error', 6000); return;
  }

  let students = State.getStudents({ branch, division: division || undefined });
  if (session.batchYear) students = students.filter(s => s.batchYear === session.batchYear);

  if (students.length === 0) {
    UI.toast('No students found for this selection.', 'error'); return;
  }

  // Sort
  const seatEntries = State.getSeatsForSession(session.id);
  const seatMap = {};
  for (const s of seatEntries) seatMap[s.uin] = s.seatNumber;

  if (sortBy !== 'default') {
    students = [...students].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'uin')  return a.uin.localeCompare(b.uin);
      if (sortBy === 'prn')  return (a.prn||'').localeCompare(b.prn||'');
      if (sortBy === 'seat') {
        const sa = seatMap[a.uin] || '', sb = seatMap[b.uin] || '';
        const na = Number(sa), nb = Number(sb);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return sa.localeCompare(sb);
      }
      return 0;
    });
  }

  // Compute initial doneSet — students with all subjects entered
  const doneSet = new Set();
  for (const s of students) {
    const expected = State.getExpectedSubjectCount(s, session);
    const entered  = [...new Set(
      State.ledger
        .filter(r => r.uin === s.uin && r.examSession === session.id)
        .map(r => r.subjectCode)
    )].length;
    if (expected && entered >= expected) doneSet.add(s.uin);
  }

  queueState.active   = true;
  queueState.students = students;
  queueState.cursor   = 0;
  queueState.doneSet  = doneSet;

  document.getElementById('se-queue-progress').classList.remove('hidden');
  document.getElementById('se-student-panel').classList.remove('hidden');

  // Load the session into singleState so _seRenderGrid works
  singleState.session = session;

  _queueUpdateHeader();
  _seSelectStudent(students[0].uin);
}

function _queueAdvance(skip) {
  const { students, cursor } = queueState;
  const next = cursor + 1;
  if (next >= students.length) {
    UI.toast('🎉 End of queue — all students covered.', 'success', 5000);
    document.getElementById('se-queue-progress').classList.add('hidden');
    document.getElementById('se-student-panel').classList.add('hidden');
    queueState.active = false;
    return;
  }
  queueState.cursor = next;
  _queueUpdateHeader();
  _seSelectStudent(students[next].uin);
}

function _queueUpdateHeader() {
  const { students, cursor, doneSet } = queueState;
  const total   = students.length;
  const done    = doneSet.size;
  const pending = total - done;
  const student = students[cursor];

  document.getElementById('se-q-pos').textContent     = `${cursor + 1} / ${total}`;
  document.getElementById('se-q-done').textContent    = `${done} done`;
  document.getElementById('se-q-pending').textContent = ` · ${pending} pending`;
  document.getElementById('se-q-student-name').textContent = student ? student.name : '';
}

// ═══════════════════════════════════════════════════════════════
// TAB 2 — STUDENT PROGRESS VIEW
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

  const academics = State.computeStudentAcademics(uin);

  // Student info card
  const cgpaStr = academics?.cgpa != null ? academics.cgpa.toFixed(2) : '—';
  const credStr = academics
    ? `${academics.totalCredits.earned} / ${academics.totalCredits.max}`
    : '—';
  const feHTML = academics?.feCompleted?.done
    ? `<span class="fe-completed-badge">🎓 FE Completed — ${UI.esc(academics.feCompleted.session || '')}</span>`
    : '';

  document.getElementById('pv-student-info').innerHTML = `
    <div class="student-card" style="display:flex; align-items:center; gap:16px; flex-wrap:wrap; justify-content:space-between;">
      <div>
        <div class="sc-name">${UI.esc(student.name)}</div>
        <div class="sc-meta">UIN: ${UI.esc(student.uin)} · PRN/ERN: ${UI.esc(student.prn || '—')} · ${UI.esc(student.branch)} · Div ${UI.esc(student.division)} · Batch ${UI.esc(student.batchYear)} · ${UI.esc(student.gender || '—')}</div>
      </div>
      <div class="pv-quick-stats">
        <div class="pv-stat"><span class="pv-stat-val">${UI.esc(cgpaStr)}</span><span class="pv-stat-lbl">CGPA</span></div>
        <div class="pv-stat"><span class="pv-stat-val">${UI.esc(credStr)}</span><span class="pv-stat-lbl">Credits</span></div>
        ${feHTML}
      </div>
    </div>`;

  // ── Build per-semester session lists ──────────────────────────
  const sessionMap = {};
  State.getSessions().forEach(s => { sessionMap[s.id] = s; });

  // Sessions this student has records in, grouped by semester, chronological
  const studentSessionIds = [...new Set(ledger.map(r => r.examSession))];
  const sessionsWithData  = studentSessionIds
    .map(id => sessionMap[id])
    .filter(Boolean);

  const semSessions = {
    1: sortSessionsChronological(sessionsWithData.filter(s => s.semester === 1)),
    2: sortSessionsChronological(sessionsWithData.filter(s => s.semester === 2)),
  };

  // Track selected session per sem (default: latest = last in chronological)
  const selectedSessId = {
    1: semSessions[1].length > 0 ? semSessions[1][semSessions[1].length - 1].id : null,
    2: semSessions[2].length > 0 ? semSessions[2][semSessions[2].length - 1].id : null,
  };

  // ── Render helper: one semester table ─────────────────────────
  function _pvRenderSemTable(sem) {
    const sessions  = semSessions[sem];
    const sessId    = selectedSessId[sem];
    const sess      = sessId ? sessionMap[sessId] : null;
    const acadSess  = academics?.sessionResults.find(sr => sr.session.id === sessId);

    // Session selector — hidden if only one session
    const selectorHtml = sessions.length <= 1
      ? sessions.length === 1
        ? `<span class="pv-sess-label">${UI.esc(sessions[0].name)}</span>`
        : ''
      : `<select class="pv-sem-sess-select" data-sem="${sem}">
          ${sessions.map(s =>
            `<option value="${UI.esc(s.id)}" ${s.id === sessId ? 'selected' : ''}>${UI.esc(s.name)}</option>`
          ).join('')}
        </select>`;

    // Header stats
    const creditsEarned = acadSess
      ? acadSess.subjects.filter(s => !s.pending && s.dr.creditsEarned > 0).reduce((a, s) => a + s.dr.creditsEarned, 0)
      : 0;
    const creditsMax = sess
      ? getSubjectsForSem(sem, student.branch, sess).reduce((a, s) => a + s.credits, 0)
      : 0;
    const sgpaStr    = acadSess?.sgpa != null ? acadSess.sgpa.toFixed(2)
                     : acadSess?.pendingCount > 0 ? 'Partial' : '—';
    const sessionStatus = sess ? State.getSessionStatus(uin, sess) : 'pending';
    const showPerComp   = sessionStatus === 'multi-attempt';

    let sessionBadge = '';
    if (sessionStatus === 'successful') {
      sessionBadge = `<span class="pv-session-badge pv-session-success">🎉 First Attempt</span>`;
    } else if (sessionStatus === 'pending') {
      sessionBadge = `<span class="pv-session-badge pv-session-pending">⏳ Pending</span>`;
    }
    const pendingNote = acadSess?.pendingCount > 0
      ? `<span class="pv-pending-note">${acadSess.pendingCount} subject${acadSess.pendingCount > 1 ? 's' : ''} pending</span>`
      : '';
    const isFinal = sess?.entryType === 'Final Gazette';

    // Subject rows
    let rowsHtml = '';
    let footerTotalMarks = 0, footerGxC = 0, footerCredits = 0, footerHasTotal = false;

    if (!sess) {
      rowsHtml = `<tr><td colspan="14" class="muted" style="text-align:center;padding:16px;">No records yet.</td></tr>`;
    } else {
      const displaySubjects = acadSess
        ? acadSess.subjects
        : [];

      for (const subjEntry of displaySubjects) {
        const r        = subjEntry.r;
        const dr       = subjEntry.dr;
        const carriedMap = subjEntry.carriedMap || {};
        const mm       = subjEntry.mergedMarks;

        let subjConfig = SEM1_SUBJECTS.find(s => s.code === r.subjectCode);
        if (!subjConfig) subjConfig = getSem2Subjects(student.branch, sess).find(s => s.code === r.subjectCode);
        if (!subjConfig) subjConfig = getSem2Subjects(student.branch, null).find(s => s.code === r.subjectCode);

        const comps      = ['IAT', 'ESE', 'TW', 'Oral'];
        const compFields = {
          IAT:  mm?.IAT  ?? r.iatMarks,
          ESE:  mm?.ESE  ?? r.eseMarks,
          TW:   mm?.TW   ?? r.twMarks,
          Oral: mm?.Oral ?? r.oralMarks,
        };

        const cells = comps.map(comp => {
          const val       = compFields[comp] || '—';
          const maxMark   = subjConfig?.marks?.[comp];
          const isCarried = carriedMap[comp] === true;
          if (!maxMark) return `<td class="muted">—</td>`;
          if (showPerComp) {
            return `<td class="pv-comp-cell">${UI.esc(val)}${isCarried ? '<sup class="carried-mark">+</sup>' : ''} ${_pvMarkTag(val === '—' ? null : val, maxMark)}</td>`;
          }
          return `<td>${UI.esc(val)}${isCarried ? '<sup class="carried-mark">+</sup>' : ''}</td>`;
        }).join('');

        let gradeCell  = '<td class="muted">—</td>';
        let gpCell     = '<td class="muted">—</td>';
        let creditCell = '<td class="muted">—</td>';
        let gxcCell    = '<td class="muted">—</td>';
        let pctCell    = '<td class="muted">—</td>';
        let totalCell  = `<td class="muted">—</td>`;
        let resultCell = `<td>${UI.resultBadge(r.result)}</td>`;

        if (dr && !dr.pending) {
          const gradeCls = dr.grade === 'F' ? 'grade-f' : dr.grade === 'O' ? 'grade-o' : '';
          gradeCell  = `<td class="grade-cell ${gradeCls}">${UI.esc(dr.grade)}</td>`;
          gpCell     = `<td class="gp-cell">${dr.gradePoint}</td>`;
          const creditCls = dr.creditsEarned > 0 ? 'credit-earned' : 'credit-zero';
          creditCell = `<td class="${creditCls}">${dr.creditsEarned}</td>`;
          gxcCell    = `<td class="gxc-cell">${dr.GxC.toFixed(1)}</td>`;
          pctCell    = `<td>${dr.pct.toFixed(1)}%</td>`;
          totalCell  = `<td>${dr.total}<small>/${dr.totalMax}</small></td>`;
          resultCell = `<td>${UI.resultBadge(dr.result)}</td>`;
          footerTotalMarks += dr.total;
          footerGxC        += dr.GxC;
          footerCredits    += dr.creditsEarned;
          footerHasTotal    = true;
        } else if (dr?.pending) {
          gradeCell  = `<td class="muted">Pending</td>`;
          resultCell = `<td>${UI.resultBadge('Pending')}</td>`;
        }

        rowsHtml += `
          <tr>
            <td><span class="subj-code-small">${UI.esc(r.subjectCode)}</span> ${UI.esc(r.subjectName)}</td>
            <td>${UI.esc(r.subjectType)}</td>
            <td>${_pvAttemptTag(r.uin, r.subjectCode, r.examSession)}</td>
            ${cells}
            ${totalCell}${pctCell}${gradeCell}${gpCell}${creditCell}${gxcCell}
            ${resultCell}
          </tr>`;
      }

      // Footer row
      const footerTotal   = footerHasTotal ? String(footerTotalMarks) : '—';
      const footerGxCStr  = footerHasTotal ? footerGxC.toFixed(1) : '—';
      const footerCredStr = footerHasTotal ? String(footerCredits)  : '—';
      rowsHtml += `
        <tr class="sgpa-row">
          <td colspan="7" style="text-align:right; font-weight:600; color:var(--ink-2); padding-right:12px;">Total</td>
          <td style="font-weight:700;">${UI.esc(footerTotal)}</td>
          <td></td><td></td><td></td>
          <td class="credit-earned" style="font-weight:700;">${UI.esc(footerCredStr)}</td>
          <td class="gxc-cell" style="font-weight:700;">${UI.esc(footerGxCStr)}</td>
          <td class="sgpa-val">SGPA: ${UI.esc(sgpaStr)}</td>
        </tr>`;
    }

    return `
      <div class="pv-sem-block" id="pv-sem-block-${sem}">
        <div class="session-header">
          <span class="session-name">Semester ${sem}</span>
          ${isFinal ? '<span class="session-type-inline final-gazette">Final Gazette</span>' : ''}
          ${sessionBadge}
          ${pendingNote}
          <span class="credit-pill">${creditsEarned} / ${creditsMax} cr</span>
          <span class="sgpa-pill">SGPA: <strong>${UI.esc(sgpaStr)}</strong></span>
          <span class="pv-sess-selector">${selectorHtml}</span>
        </div>
        <div style="overflow-x:auto;">
          <table class="progress-table">
            <thead><tr>
              <th>Subject</th><th>Type</th><th>Attempt</th>
              <th>IAT</th><th>ESE</th><th>TW</th><th>Oral</th>
              <th>Total</th><th>%</th><th>Grade</th><th>GP</th><th>Credits</th><th>G×C</th>
              <th>Result</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ── Build full HTML ───────────────────────────────────────────
  let html = _pvRenderSemTable(1) + _pvRenderSemTable(2);

  // ── Academics summary ─────────────────────────────────────────
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

  // ── Wire session dropdowns via delegation ─────────────────────
  const timeline = document.getElementById('pv-timeline');
  timeline.addEventListener('change', e => {
    const sel = e.target.closest('.pv-sem-sess-select');
    if (!sel) return;
    const sem = Number(sel.dataset.sem);
    selectedSessId[sem] = sel.value;
    const block = document.getElementById(`pv-sem-block-${sem}`);
    if (block) block.outerHTML = _pvRenderSemTable(sem);
  });
}


// ═══════════════════════════════════════════════════════════════
// TAB 4 — REPORTS
// ═══════════════════════════════════════════════════════════════
// ── Dashboard ─────────────────────────────────────────────────
function initDashboard() {
  _dashSessionCompletion();
  _dashActiveKTs();
  _dashBranchPassRates();
  _dashInitHeatmap();
}

function _dashSessionCompletion() {
  const sessions = sortSessions(State.getSessions().filter(s => s.status === 'Active'));
  const students  = State.getStudents();
  const el        = document.getElementById('dash-session-completion');
  if (!sessions.length) { el.innerHTML = '<div class="muted">No active sessions.</div>'; return; }

  let html = '';
  for (const sess of sessions) {
    const semStudents = students.filter(s => s.batchYear === sess.batchYear);
    const total       = semStudents.length;
    if (total === 0) continue;

    const subjects = getSubjectsForSem(sess.semester, null, sess);
    let   entered  = 0;
    for (const student of semStudents) {
      const rows = State.ledger.filter(r => r.uin === student.uin && r.examSession === sess.id);
      const uniqueSubjs = new Set(rows.map(r => r.subjectCode)).size;
      if (uniqueSubjs >= subjects.length) entered++;
    }
    const pct = Math.round(entered / total * 100);
    html += `
      <div class="dash-completion-row">
        <span class="dash-completion-label">${UI.esc(sess.name)}</span>
        <div class="dash-progress-bar"><div class="dash-progress-fill" style="width:${pct}%"></div></div>
        <span class="dash-completion-pct">${pct}%</span>
        <span class="dash-sub-label" style="min-width:60px;">${entered}/${total}</span>
      </div>`;
  }
  el.innerHTML = html || '<div class="muted">No data.</div>';
}

function _dashActiveKTs() {
  const students = State.getStudents();
  let   ktCount  = 0;
  for (const student of students) {
    if (State.getActiveKTSubjects(student.uin).length > 0) ktCount++;
  }
  document.getElementById('dash-kt-count').textContent = ktCount;
  document.getElementById('dash-kt-sub').textContent   = `students with active KT / backlog`;
}

function _dashBranchPassRates() {
  const el       = document.getElementById('dash-branch-pass');
  const students = State.getStudents();
  let   html     = '';

  for (const branch of BRANCHES) {
    const branchStudents = students.filter(s => s.branch === branch);
    if (!branchStudents.length) continue;
    const passed = branchStudents.filter(s => State.getActiveKTSubjects(s.uin).length === 0).length;
    const pct    = Math.round(passed / branchStudents.length * 100);
    const color  = pct >= 80 ? 'var(--pass)' : pct >= 60 ? 'var(--kt)' : 'var(--fail)';
    html += `
      <div class="dash-branch-row">
        <span>${UI.esc(branch)}</span>
        <span class="dash-pass-pct" style="color:${color}">${pct}% <small>(${passed}/${branchStudents.length})</small></span>
      </div>`;
  }
  el.innerHTML = html || '<div class="muted">No data.</div>';
}

function _dashInitHeatmap() {
  const sel = document.getElementById('dash-heatmap-session');
  const sessions = sortSessions(State.getSessions());
  sel.innerHTML = '<option value="">— all sessions —</option>' +
    sessions.map(s => `<option value="${UI.esc(s.id)}">${UI.esc(s.name)}</option>`).join('');
  sel.addEventListener('change', _dashRenderHeatmap);
  _dashRenderHeatmap();
}

function _dashRenderHeatmap() {
  const sessId   = document.getElementById('dash-heatmap-session').value;
  const sess     = sessId ? State.getSession(sessId) : null;
  const el       = document.getElementById('dash-heatmap');
  const students = State.getStudents();

  // Collect all subjects across sessions or for specific session
  const subjects = sess
    ? getSubjectsForSem(sess.semester, null, sess)
    : [...SEM1_SUBJECTS];

  const passRates = subjects.map(subj => {
    let pass = 0, total = 0;
    for (const student of students) {
      const rows = State.ledger.filter(r =>
        r.uin === student.uin &&
        r.subjectCode === subj.code &&
        (!sessId || r.examSession === sessId)
      );
      if (!rows.length) continue;
      const latest = rows.sort((a, b) => b.entryDateTime.localeCompare(a.entryDateTime))[0];
      total++;
      if (latest.result === 'Pass') pass++;
    }
    const pct = total > 0 ? Math.round(pass / total * 100) : null;
    return { subj, pass, total, pct };
  }).filter(d => d.total > 0)
    .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101)); // worst first

  function _heatColor(pct) {
    if (pct == null)  return 'var(--surface-2)';
    if (pct >= 90)    return '#D1FAE5';
    if (pct >= 75)    return '#FEF9C3';
    if (pct >= 60)    return '#FED7AA';
    return '#FEE2E2';
  }
  function _heatTextColor(pct) {
    if (pct == null)  return 'var(--ink-4)';
    if (pct >= 75)    return '#065F46';
    if (pct >= 60)    return '#92400E';
    return '#991B1B';
  }

  el.innerHTML = `<div class="dash-heatmap-grid">` +
    passRates.map(({ subj, pct, pass, total }) => `
      <div class="dash-heatmap-cell" style="background:${_heatColor(pct)}; color:${_heatTextColor(pct)}">
        <span class="dash-heatmap-subj">${UI.esc(subj.code)}</span>
        <span class="dash-heatmap-pct">${pct != null ? pct + '%' : '—'}</span>
        <span style="font-size:10px;">${pass}/${total} passed</span>
      </div>`
    ).join('') +
  `</div>`;

  if (!passRates.length) el.innerHTML = '<div class="muted">No data for selected session.</div>';
}

function initReports() {
  const sessions = sortSessions(State.getSessions());
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
  ['rpt-session','rpt-branch','rpt-batch','rpt-subject','rpt-component','rpt-gender'].forEach(id => {
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

  // Segmented control for topper gender panels
  document.querySelectorAll('.topper-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => _rptSwitchTopperPanel(btn.dataset.panel));
  });

  // Populate per-card session selects
  UI.buildSelect('rpt-my-session', sessions, '— all sessions —', 'id', 'name');

  // Credit filter branch + gender dropdowns
  UI.buildSelect('rpt-credit-branch', BRANCHES, '— all branches —');
  UI.buildSelect('rpt-total-credit-branch', BRANCHES, '— all branches —');
  // (gender selects are static HTML — no buildSelect needed)

  // Export buttons
  document.getElementById('rpt-result-summary-csv').onclick  = _rptExportResultSummary;
  document.getElementById('rpt-reval-impact-csv').onclick    = _rptExportRevalImpact;
  document.getElementById('rpt-toppers-csv').onclick         = _rptExportToppers;
  document.getElementById('rpt-credit-filter').onclick       = _rptCreditFilter;
  document.getElementById('rpt-total-credit-filter').onclick = _rptTotalCreditFilter;
  document.getElementById('rpt-kt-filter').onclick           = _rptKTFilter;
  document.getElementById('rpt-my-entries').onclick          = _rptMyEntries;

  // Batch comparison
  const bcYears = State.getBatchYears();
  UI.buildSelect('rpt-bc-batch-a', bcYears, '— select —');
  UI.buildSelect('rpt-bc-batch-b', bcYears, '— select —');
  UI.buildSelect('rpt-bc-branch',  BRANCHES, '— all branches —');
  // Session selects are populated when batch is chosen
  document.getElementById('rpt-bc-batch-a').addEventListener('change', () => _bcPopulateSessions('a'));
  document.getElementById('rpt-bc-batch-b').addEventListener('change', () => _bcPopulateSessions('b'));
  document.getElementById('rpt-bc-run').onclick = _rptBatchCompare;
  document.getElementById('rpt-bc-csv').onclick = _rptBatchCompareCsv;
}

// ── Batch Comparison ──────────────────────────────────────────
function _bcPopulateSessions(side) {
  const batchYear = document.getElementById(`rpt-bc-batch-${side}`).value;
  const sessions  = sortSessions(State.getSessions().filter(s =>
    !batchYear || s.batchYear === batchYear
  ));
  const el = document.getElementById(`rpt-bc-session-${side}`);
  el.innerHTML = '<option value="">— select session —</option>' +
    sessions.map(s => `<option value="${UI.esc(s.id)}">${UI.esc(s.name)}</option>`).join('');
}

function _bcGetData(batchYear, sessionId, branch) {
  // Returns { students, sessionResults } for the given batch+session+branch
  let students = State.getStudents({ branch: branch || undefined });
  if (batchYear) students = students.filter(s => s.batchYear === batchYear);

  const sess = sessionId ? State.getSession(sessionId) : null;
  const sem  = sess?.semester || 1;

  const subjects = sess
    ? getSubjectsForSem(sem, null, sess)
    : SEM1_SUBJECTS;

  // Per-student academics
  const studentData = students.map(student => {
    const acad    = State.computeStudentAcademics(student.uin);
    const sessRes = acad?.sessionResults.find(sr => sr.session.id === sessionId);
    const activeKTs = State.getActiveKTSubjects(student.uin);
    const cleared   = activeKTs.filter(r => Number(r.semester) === sem).length === 0 &&
                      (sessRes?.subjects.length > 0);
    return { student, acad, sessRes, cleared };
  }).filter(d => d.sessRes); // only students with data in this session

  return { studentData, subjects, sess, sem };
}

function _bcSubjectPassRates(studentData, subjects, sessionId) {
  // Per-subject pass rates
  const result = {};
  for (const subj of subjects) {
    let pass = 0, fail = 0, ab = 0;
    for (const { sessRes } of studentData) {
      const subjEntry = sessRes?.subjects.find(s => s.r.subjectCode === subj.code);
      if (!subjEntry || subjEntry.pending) continue;
      if (subjEntry.dr.result === 'Pass') pass++;
      else if (subjEntry.dr.result === 'AB') ab++;
      else fail++;
    }
    const total = pass + fail + ab;
    result[subj.code] = { name: subj.name, pass, fail, ab, total, pct: total > 0 ? Math.round(pass / total * 100) : null };
  }
  return result;
}

function _bcAvgMarks(studentData, subjects, sessionId) {
  // Per-subject per-component average marks
  const result = {};
  for (const subj of subjects) {
    const comps = Object.keys(subj.marks);
    result[subj.code] = { name: subj.name, comps: {} };
    for (const comp of comps) {
      const vals = [];
      for (const { sessRes } of studentData) {
        const subjEntry = sessRes?.subjects.find(s => s.r.subjectCode === subj.code);
        if (!subjEntry) continue;
        const mm  = subjEntry.mergedMarks || {};
        const val = mm[comp] || subjEntry.r[comp.toLowerCase() + 'Marks'];
        if (val && val !== '' && val !== 'AB') {
          const n = parseFloat(String(val).replace('*', ''));
          if (!isNaN(n)) vals.push(n);
        }
      }
      result[subj.code].comps[comp] = vals.length > 0
        ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10
        : null;
    }
  }
  return result;
}

function _bcCgpaDistribution(studentData) {
  const ranges = ['< 5', '5–6', '6–7', '7–8', '8–9', '9–10'];
  const counts = { '< 5': 0, '5–6': 0, '6–7': 0, '7–8': 0, '8–9': 0, '9–10': 0 };
  let sum = 0, n = 0;
  for (const { acad } of studentData) {
    const cgpa = acad?.cgpa;
    if (cgpa == null) continue;
    sum += cgpa; n++;
    if      (cgpa < 5)  counts['< 5']++;
    else if (cgpa < 6)  counts['5–6']++;
    else if (cgpa < 7)  counts['6–7']++;
    else if (cgpa < 8)  counts['7–8']++;
    else if (cgpa < 9)  counts['8–9']++;
    else                counts['9–10']++;
  }
  return { ranges, counts, avg: n > 0 ? Math.round(sum / n * 100) / 100 : null, total: n };
}

function _bcOverallPassRate(studentData, sem) {
  // % students who cleared ALL subjects in this semester
  let pass = 0;
  for (const { cleared } of studentData) {
    if (cleared) pass++;
  }
  return { pass, total: studentData.length, pct: studentData.length > 0 ? Math.round(pass / studentData.length * 100) : null };
}

function _rptBatchCompare() {
  const batchA   = document.getElementById('rpt-bc-batch-a').value;
  const batchB   = document.getElementById('rpt-bc-batch-b').value;
  const sessAId  = document.getElementById('rpt-bc-session-a').value;
  const sessBId  = document.getElementById('rpt-bc-session-b').value;
  const branch   = document.getElementById('rpt-bc-branch').value;
  const output   = document.getElementById('rpt-bc-output');

  if (!sessAId || !sessBId) {
    UI.toast('Please select sessions for both batches.', 'error'); return;
  }

  const A = _bcGetData(batchA, sessAId, branch);
  const B = _bcGetData(batchB, sessBId, branch);

  if (A.studentData.length === 0 && B.studentData.length === 0) {
    output.innerHTML = '<div class="empty-state">No data found for selected filters.</div>'; return;
  }

  // Merge subject list from both sessions
  const allSubjCodes = [...new Set([...A.subjects, ...B.subjects].map(s => s.code))];
  const allSubjects  = allSubjCodes.map(code =>
    A.subjects.find(s => s.code === code) || B.subjects.find(s => s.code === code)
  );

  const passA    = _bcSubjectPassRates(A.studentData, allSubjects, sessAId);
  const passB    = _bcSubjectPassRates(B.studentData, allSubjects, sessBId);
  const avgA     = _bcAvgMarks(A.studentData, allSubjects, sessAId);
  const avgB     = _bcAvgMarks(B.studentData, allSubjects, sessBId);
  const cgpaA    = _bcCgpaDistribution(A.studentData);
  const cgpaB    = _bcCgpaDistribution(B.studentData);
  const overallA = _bcOverallPassRate(A.studentData, A.sem);
  const overallB = _bcOverallPassRate(B.studentData, B.sem);

  const sessAName = A.sess?.name || sessAId;
  const sessBName = B.sess?.name || sessBId;
  const labelA    = `${batchA || 'Batch A'} — ${sessAName}`;
  const labelB    = `${batchB || 'Batch B'} — ${sessBName}`;

  function _pctCell(pct, otherPct) {
    if (pct == null) return `<td class="muted">—</td>`;
    const better = otherPct != null && pct > otherPct;
    const worse  = otherPct != null && pct < otherPct;
    const cls    = better ? 'bc-better' : worse ? 'bc-worse' : '';
    return `<td class="${cls}">${pct}%</td>`;
  }

  // Section 1: Subject-level pass %
  let html = `
    <div class="bc-section">
      <div class="bc-section-title">Subject-level Pass %</div>
      <div class="bc-overall-row">
        <span>Overall semester pass rate — <strong>${labelA}</strong>: ${overallA.pct != null ? overallA.pct + '%' : '—'} (${overallA.pass}/${overallA.total})</span>
        <span style="margin-left:24px;">— <strong>${labelB}</strong>: ${overallB.pct != null ? overallB.pct + '%' : '—'} (${overallB.pass}/${overallB.total})</span>
      </div>
      <div style="overflow-x:auto;">
      <table class="progress-table bc-table">
        <thead><tr>
          <th>Subject</th>
          <th colspan="3">${UI.esc(labelA)}</th>
          <th colspan="3">${UI.esc(labelB)}</th>
        </tr>
        <tr>
          <th></th>
          <th>Pass%</th><th>Pass</th><th>Fail/AB</th>
          <th>Pass%</th><th>Pass</th><th>Fail/AB</th>
        </tr></thead>
        <tbody>`;

  for (const subj of allSubjects) {
    const a = passA[subj.code] || {};
    const b = passB[subj.code] || {};
    html += `<tr>
      <td><span class="subj-code-small">${UI.esc(subj.code)}</span> ${UI.esc(subj.name)}</td>
      ${_pctCell(a.pct ?? null, b.pct ?? null)}
      <td>${a.pass ?? '—'}</td><td>${(a.fail ?? 0) + (a.ab ?? 0) || '—'}</td>
      ${_pctCell(b.pct ?? null, a.pct ?? null)}
      <td>${b.pass ?? '—'}</td><td>${(b.fail ?? 0) + (b.ab ?? 0) || '—'}</td>
    </tr>`;
  }
  html += `</tbody></table></div></div>`;

  // Section 2: Average marks
  const allComps = [...new Set(allSubjects.flatMap(s => Object.keys(s.marks || {})))];
  html += `
    <div class="bc-section">
      <div class="bc-section-title">Average Marks per Subject</div>
      <div style="overflow-x:auto;">
      <table class="progress-table bc-table">
        <thead><tr>
          <th>Subject</th>
          ${allComps.map(c => `<th colspan="2">${UI.esc(c)}</th>`).join('')}
        </tr>
        <tr>
          <th></th>
          ${allComps.map(() => `<th>${UI.esc(labelA.slice(0,12))}…</th><th>${UI.esc(labelB.slice(0,12))}…</th>`).join('')}
        </tr></thead>
        <tbody>`;

  for (const subj of allSubjects) {
    html += `<tr><td><span class="subj-code-small">${UI.esc(subj.code)}</span> ${UI.esc(subj.name)}</td>`;
    for (const comp of allComps) {
      const a = avgA[subj.code]?.comps[comp] ?? null;
      const b = avgB[subj.code]?.comps[comp] ?? null;
      const max = subj.marks?.[comp];
      html += `<td>${a != null ? `${a}${max ? `<small>/${max}</small>` : ''}` : '—'}</td>`;
      html += `<td>${b != null ? `${b}${max ? `<small>/${max}</small>` : ''}` : '—'}</td>`;
    }
    html += `</tr>`;
  }
  html += `</tbody></table></div></div>`;

  // Section 3: CGPA Distribution
  html += `
    <div class="bc-section">
      <div class="bc-section-title">CGPA Distribution</div>
      <div style="overflow-x:auto;">
      <table class="progress-table bc-table">
        <thead><tr>
          <th>CGPA Range</th>
          <th>${UI.esc(labelA)}</th>
          <th>${UI.esc(labelB)}</th>
        </tr></thead>
        <tbody>`;

  for (const range of cgpaA.ranges) {
    const a = cgpaA.counts[range] || 0;
    const b = cgpaB.counts[range] || 0;
    html += `<tr><td>${UI.esc(range)}</td><td>${a}</td><td>${b}</td></tr>`;
  }
  html += `
        <tr class="sgpa-row">
          <td><strong>Avg CGPA</strong></td>
          <td><strong>${cgpaA.avg ?? '—'}</strong></td>
          <td><strong>${cgpaB.avg ?? '—'}</strong></td>
        </tr>
        <tr>
          <td><strong>Students</strong></td>
          <td>${cgpaA.total}</td>
          <td>${cgpaB.total}</td>
        </tr>
        </tbody></table></div></div>`;

  output.innerHTML = html;

  // Store for CSV export
  window._bcLastResult = { A, B, allSubjects, passA, passB, avgA, avgB, cgpaA, cgpaB,
    overallA, overallB, labelA, labelB, allComps };
}

function _rptBatchCompareCsv() {
  const d = window._bcLastResult;
  if (!d) { UI.toast('Run a comparison first.', 'error'); return; }

  const rows = [];

  // Section 1: Subject pass %
  rows.push(['SUBJECT PASS RATES']);
  rows.push(['Subject', `${d.labelA} Pass%`, `${d.labelA} Pass`, `${d.labelA} Fail/AB`,
                        `${d.labelB} Pass%`, `${d.labelB} Pass`, `${d.labelB} Fail/AB`]);
  for (const subj of d.allSubjects) {
    const a = d.passA[subj.code] || {};
    const b = d.passB[subj.code] || {};
    rows.push([subj.name,
      a.pct ?? '', a.pass ?? '', (a.fail ?? 0) + (a.ab ?? 0),
      b.pct ?? '', b.pass ?? '', (b.fail ?? 0) + (b.ab ?? 0)]);
  }
  rows.push(['Overall Pass%', d.overallA.pct ?? '', '', '', d.overallB.pct ?? '']);
  rows.push([]);

  // Section 2: Avg marks
  rows.push(['AVERAGE MARKS']);
  const compHeader = ['Subject'];
  for (const comp of d.allComps) {
    compHeader.push(`${d.labelA} ${comp}`, `${d.labelB} ${comp}`);
  }
  rows.push(compHeader);
  for (const subj of d.allSubjects) {
    const row = [subj.name];
    for (const comp of d.allComps) {
      row.push(d.avgA[subj.code]?.comps[comp] ?? '');
      row.push(d.avgB[subj.code]?.comps[comp] ?? '');
    }
    rows.push(row);
  }
  rows.push([]);

  // Section 3: CGPA distribution
  rows.push(['CGPA DISTRIBUTION']);
  rows.push(['Range', d.labelA, d.labelB]);
  for (const range of d.cgpaA.ranges) {
    rows.push([range, d.cgpaA.counts[range] || 0, d.cgpaB.counts[range] || 0]);
  }
  rows.push(['Avg CGPA', d.cgpaA.avg ?? '', d.cgpaB.avg ?? '']);
  rows.push(['Total Students', d.cgpaA.total, d.cgpaB.total]);

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `batch_comparison_${Date.now()}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ── Result Summary (live) ─────────────────────────────────────
function _rptGetSummaryFilters() {
  return {
    sessionId:   document.getElementById('rpt-session').value   || null,
    branch:      document.getElementById('rpt-branch').value    || null,
    batchYear:   document.getElementById('rpt-batch').value     || null,
    subjectCode: document.getElementById('rpt-subject').value   || null,
    component:   document.getElementById('rpt-component').value || null,
    gender:      document.getElementById('rpt-gender').value    || null,
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
    const passPct  = Math.round(d.passRate * 100);
    const fmtAvg   = (v) => v != null ? v.toFixed(1) : '—';
    const avgCell  = comp === 'IAT'  ? fmtAvg(d.avgMarks.IAT)
                   : comp === 'ESE'  ? fmtAvg(d.avgMarks.ESE)
                   : comp === 'TW'   ? fmtAvg(d.avgMarks.TW)
                   : comp === 'Oral' ? fmtAvg(d.avgMarks.Oral)
                   : '—';
    return `<tr>
      <td><span class="subj-code-small">${UI.esc(d.code)}</span></td>
      <td>${UI.esc(d.name)}</td>
      <td>${d.total}</td>
      <td style="color:var(--pass);font-weight:600;">${d.pass}</td>
      <td style="color:var(--fail);font-weight:600;">${d.fail}</td>
      <td style="color:var(--ab);font-weight:600;">${d.ab}</td>
      <td><span class="badge ${passPct >= 60 ? 'badge-pass' : passPct >= 40 ? 'badge-pending' : 'badge-fail'}">${passPct}%</span></td>
      <td>${comp && comp !== 'All' ? avgCell : [
        d.avgMarks.IAT  != null ? `IAT:${fmtAvg(d.avgMarks.IAT)}`   : null,
        d.avgMarks.ESE  != null ? `ESE:${fmtAvg(d.avgMarks.ESE)}`   : null,
        d.avgMarks.TW   != null ? `TW:${fmtAvg(d.avgMarks.TW)}`     : null,
        d.avgMarks.Oral != null ? `Oral:${fmtAvg(d.avgMarks.Oral)}` : null,
      ].filter(Boolean).join(' ')}</td>
    </tr>`;
  }).join('');
}

function _rptExportResultSummary() {
  const filters = _rptGetSummaryFilters();
  const data    = State.reportResultSummary(filters);
  UI.exportCSV(`ResultSummary`,
    ['Subject Code','Subject Name','Total','Pass','Fail','AB','Pass %','Avg IAT','Avg ESE','Avg TW','Avg Oral'],
    data.map(d => [d.code, d.name, d.total, d.pass, d.fail, d.ab,
      Math.round(d.passRate * 100) + '%',
      d.avgMarks.IAT  != null ? d.avgMarks.IAT.toFixed(1)  : '—',
      d.avgMarks.ESE  != null ? d.avgMarks.ESE.toFixed(1)  : '—',
      d.avgMarks.TW   != null ? d.avgMarks.TW.toFixed(1)   : '—',
      d.avgMarks.Oral != null ? d.avgMarks.Oral.toFixed(1) : '—',
    ])
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
    ['UIN','PRN/ERN','Name','Branch','Subject Code','Subject Name','Prev Result','New Result','Direction','Entry Date'],
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
  const sessionId   = document.getElementById('rpt-topper-session').value || null;
  const toppersWrap = document.getElementById('rpt-toppers-wrap');
  if (!sessionId) {
    if (toppersWrap) toppersWrap.innerHTML = '<div style="text-align:center;color:var(--ink-4);padding:12px;font-size:12px;">Select a session.</div>';
    return;
  }
  const mode        = document.getElementById('rpt-topper-mode').value || 'branch';
  const branch      = document.getElementById('rpt-topper-branch').value || null;
  const subjectCode = document.getElementById('rpt-topper-subject').value || null;
  const topN        = Number(document.getElementById('rpt-topper-n').value || 10);

  const data = State.reportToppers({ sessionId, mode, branch, subjectCode, topN });
  // data = { all: [...], male: [...], female: [...] }

  // Active panel from segmented control
  const activePanel = document.querySelector('.topper-seg-btn.active')?.dataset.panel || 'all';

  function _renderPanel(list) {
    if (!list || list.length === 0) {
      return '<div style="text-align:center;color:var(--ink-4);padding:16px;font-size:12px;">No data for this selection.</div>';
    }
    if (mode === 'branch') {
      return `<div class="report-table-wrap"><table class="report-table">
        <thead><tr><th>Rank</th><th>Name</th><th>UIN</th><th>Branch</th><th>Gender</th><th>Total Marks</th><th>Credits</th></tr></thead>
        <tbody>${list.map(d => `<tr>
          <td style="font-weight:700;color:var(--brand);">#${d.rank}</td>
          <td>${UI.esc(d.name)}</td>
          <td><span class="subj-code-small">${UI.esc(d.uin)}</span></td>
          <td>${UI.esc(d.branch)}</td>
          <td>${UI.esc(d.gender || '—')}</td>
          <td style="font-weight:600;">${d.totalMarks}</td>
          <td>${d.totalCredits}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
    } else {
      return `<div class="report-table-wrap"><table class="report-table">
        <thead><tr><th>Rank</th><th>Name</th><th>UIN</th><th>Branch</th><th>Gender</th><th>Subject</th><th>Total Marks</th></tr></thead>
        <tbody>${list.map(d => `<tr>
          <td style="font-weight:700;color:var(--brand);">#${d.rank}</td>
          <td>${UI.esc(d.name)}</td>
          <td><span class="subj-code-small">${UI.esc(d.uin)}</span></td>
          <td>${UI.esc(d.branch)}</td>
          <td>${UI.esc(d.gender || '—')}</td>
          <td><span class="subj-code-small">${UI.esc(d.subjectCode)}</span></td>
          <td style="font-weight:600;">${d.totalMarks}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
    }
  }

  // Store data on wrapper for panel switching without re-querying State
  toppersWrap._toppersData = data;
  toppersWrap._toppersMode = mode;
  toppersWrap.innerHTML = _renderPanel(data[activePanel]);
}

function _rptSwitchTopperPanel(panel) {
  document.querySelectorAll('.topper-seg-btn').forEach(b => b.classList.toggle('active', b.dataset.panel === panel));
  const wrap = document.getElementById('rpt-toppers-wrap');
  if (!wrap || !wrap._toppersData) return;
  const mode = wrap._toppersMode || 'branch';
  const list = wrap._toppersData[panel] || [];
  if (list.length === 0) {
    wrap.innerHTML = '<div style="text-align:center;color:var(--ink-4);padding:16px;font-size:12px;">No data for this selection.</div>';
    return;
  }
  if (mode === 'branch') {
    wrap.innerHTML = `<div class="report-table-wrap"><table class="report-table">
      <thead><tr><th>Rank</th><th>Name</th><th>UIN</th><th>Branch</th><th>Gender</th><th>Total Marks</th><th>Credits</th></tr></thead>
      <tbody>${list.map(d => `<tr>
        <td style="font-weight:700;color:var(--brand);">#${d.rank}</td>
        <td>${UI.esc(d.name)}</td>
        <td><span class="subj-code-small">${UI.esc(d.uin)}</span></td>
        <td>${UI.esc(d.branch)}</td>
        <td>${UI.esc(d.gender || '—')}</td>
        <td style="font-weight:600;">${d.totalMarks}</td>
        <td>${d.totalCredits}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  } else {
    wrap.innerHTML = `<div class="report-table-wrap"><table class="report-table">
      <thead><tr><th>Rank</th><th>Name</th><th>UIN</th><th>Branch</th><th>Gender</th><th>Subject</th><th>Total Marks</th></tr></thead>
      <tbody>${list.map(d => `<tr>
        <td style="font-weight:700;color:var(--brand);">#${d.rank}</td>
        <td>${UI.esc(d.name)}</td>
        <td><span class="subj-code-small">${UI.esc(d.uin)}</span></td>
        <td>${UI.esc(d.branch)}</td>
        <td>${UI.esc(d.gender || '—')}</td>
        <td><span class="subj-code-small">${UI.esc(d.subjectCode)}</span></td>
        <td style="font-weight:600;">${d.totalMarks}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  }
}

function _rptExportToppers() {
  const sessionId   = document.getElementById('rpt-topper-session').value || null;
  const mode        = document.getElementById('rpt-topper-mode').value || 'branch';
  const branch      = document.getElementById('rpt-topper-branch').value || null;
  const subjectCode = document.getElementById('rpt-topper-subject').value || null;
  const topN        = Number(document.getElementById('rpt-topper-n').value || 10);
  const data = State.reportToppers({ sessionId, mode, branch, subjectCode, topN });
  // Export all three panels combined with a Gender Group column
  const allRows = [
    ...data.all.map(d    => ({ ...d, genderGroup: 'All' })),
    ...data.male.map(d   => ({ ...d, genderGroup: 'Male' })),
    ...data.female.map(d => ({ ...d, genderGroup: 'Female' })),
  ];
  if (mode === 'branch') {
    UI.exportCSV('Toppers_Branch',
      ['Gender Group','Rank','Name','UIN','Branch','Gender','Total Marks','Credits Earned'],
      allRows.map(d => [d.genderGroup, d.rank, d.name, d.uin, d.branch, d.gender||'', d.totalMarks, d.totalCredits])
    );
  } else {
    UI.exportCSV('Toppers_Subject',
      ['Gender Group','Rank','Name','UIN','Branch','Gender','Subject Code','Total Marks'],
      allRows.map(d => [d.genderGroup, d.rank, d.name, d.uin, d.branch, d.gender||'', d.subjectCode, d.totalMarks])
    );
  }
  UI.toast('Toppers exported.', 'success');
}

// ── Credit Eligibility Filters ────────────────────────────────

// Filter 1: Students who have not completed Sem N credits
function _rptCreditFilter() {
  const sem    = Number(document.getElementById('rpt-credit-sem').value || 0);
  const branch = document.getElementById('rpt-credit-branch').value || null;
  const gender = document.getElementById('rpt-credit-gender').value || null;
  if (!sem) { UI.toast('Select a semester.', 'error'); return; }

  const students = State.getStudents({ branch: branch || undefined, gender: gender || undefined });
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
      gender:  s.gender || '',
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
    ['UIN','PRN/ERN','Name','Branch','Division','Batch Year','Gender',`Sem ${sem} Earned`,`Sem ${sem} Max`,'Pending Credits','CGPA'],
    rows.map(r => [r.uin, r.prn, r.name, r.branch, r.division, r.batchYear, r.gender, r.semEarned, r.semMax, r.semPending, r.cgpa])
  );
  UI.toast(`${rows.length} students with incomplete Sem ${sem} credits exported.`, 'success');
}

// Filter 2: Students with total cumulative credits < X
function _rptTotalCreditFilter() {
  const threshold = Number(document.getElementById('rpt-credit-x').value || 0);
  const branch    = document.getElementById('rpt-total-credit-branch').value || null;
  const gender    = document.getElementById('rpt-total-credit-gender').value || null;
  if (!threshold) { UI.toast('Enter a credit threshold.', 'error'); return; }

  const students = State.getStudents({ branch: branch || undefined, gender: gender || undefined });
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
    ['UIN','PRN/ERN','Name','Branch','Division','Batch Year','Sem 1 Earned','Sem 1 Max','Sem 2 Earned','Sem 2 Max','Total Earned','Total Max','CGPA'],
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
        <th>Name</th><th>UIN</th><th>Branch</th><th>Batch</th><th>Gender</th>
        <th>Sem ${sem} Credits</th><th>Pending</th><th>CGPA</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `<tr>
          <td>${UI.esc(r.name)}</td>
          <td><span class="subj-code-small">${UI.esc(r.uin)}</span></td>
          <td>${UI.esc(r.branch)}</td>
          <td>${UI.esc(r.batchYear)}</td>
          <td>${UI.esc(r.gender || '—')}</td>
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
  const n      = Number(document.getElementById('rpt-kt-n').value || 1);
  const mode   = document.getElementById('rpt-kt-mode').value  || 'At least';
  const scope  = document.getElementById('rpt-kt-scope').value || 'Active';
  const gender = document.getElementById('rpt-kt-gender').value || null;
  const data = State.reportKTFilter(n, mode, scope, gender);
  UI.exportCSV(`KTFilter_${mode.replace(' ','')}_${n}_${scope}`,
    ['PRN/ERN','UIN','Name','Branch','Gender','Subject Code','Subject Name','Session','Result'],
    data.map(d => [d.prn, d.uin, d.name, d.branch, d.gender||'', d.subjectCode, d.subjectName, d.session, d.result])
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

  // Session form — all fields update preview on change
  ['admin-session-year','admin-session-month','admin-session-sem','admin-session-entry-type'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', _adminUpdateSessionPreview);
  });

  const semEl = document.getElementById('admin-session-sem');
  semEl.onchange = _adminToggleElectives;
  _adminToggleElectives();

  _buildElectiveSelects();

  // Entry type dropdown — show/hide linked prelim selector
  const entryTypeEl = document.getElementById('admin-session-entry-type');
  if (entryTypeEl) {
    entryTypeEl.onchange = () => { _adminToggleLinkedPrelim(); _adminUpdateSessionPreview(); };
    _adminToggleLinkedPrelim();
  }

  // Initial preview state
  _adminUpdateSessionPreview();

  document.getElementById('admin-upload-btn').onclick = _adminUploadStudents;
  document.getElementById('admin-csv-file').onchange  = _adminPreviewCSV;

  // Seat number CSV upload
  document.getElementById('admin-seat-csv-file')?.addEventListener('change', _adminPreviewSeatCSV);
  document.getElementById('admin-seat-upload-btn')?.addEventListener('click', _adminUploadSeats);

  // Manual seat entry
  _adminInitManualSeatEntry();

  // Session link update (for existing Final Gazette sessions)
  document.getElementById('admin-link-session-btn')?.addEventListener('click', _adminUpdateSessionLink);

  const sessions = sortSessions(State.getSessions());
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
  const sem    = Number(document.getElementById('admin-session-sem')?.value) || 0;
  const year   = document.getElementById('admin-session-year')?.value || '';
  const month  = document.getElementById('admin-session-month')?.value || '';
  const selEl  = document.getElementById('admin-linked-prelim-select');
  if (!selEl) return;

  // Derive fresh batch to match sessions of same semester + academic year
  const batch = (year && month) ? String(deriveFreshBatch(Number(year), month)) : '';

  const prelims = sortSessions(State.getSessions().filter(s =>
    s.entryType !== 'Final Gazette' &&
    (sem === 0   || s.semester  === sem) &&
    (batch === '' || s.batchYear === batch)
  ));
  selEl.innerHTML = '<option value="">— none (skip reval detection) —</option>' +
    prelims.map(s => `<option value="${UI.esc(s.id)}">${UI.esc(s.name)}</option>`).join('');
}

function _adminPopulateLinkDropdowns() {
  // For the "update link" section
  const finalSessions = sortSessions(State.getSessions().filter(s => s.entryType === 'Final Gazette'));
  const finalSelEl    = document.getElementById('admin-link-final-select');
  if (finalSelEl) {
    finalSelEl.innerHTML = '<option value="">— select Final Gazette session —</option>' +
      finalSessions.map(s => `<option value="${UI.esc(s.id)}">${UI.esc(s.name)} (Sem ${s.semester}, ${s.batchYear})</option>`).join('');
    finalSelEl.onchange = () => {
      const sess = State.getSession(finalSelEl.value);
      const prelimSelEl = document.getElementById('admin-link-prelim-select');
      if (!prelimSelEl || !sess) return;
      const prelims = sortSessions(State.getSessions().filter(s =>
        s.entryType !== 'Final Gazette' &&
        s.semester === sess.semester &&
        s.batchYear === sess.batchYear
      ));
      prelimSelEl.innerHTML = '<option value="">— none —</option>' +
        prelims.map(s => `<option value="${UI.esc(s.id)}" ${s.id === sess.linkedPrelimSessionId ? 'selected' : ''}>${UI.esc(s.name)} (${s.batchYear})</option>`).join('');
    };
  }
}

function _adminToggleElectives() {
  const sem     = document.getElementById('admin-session-sem').value;
  const section = document.getElementById('admin-electives-section');
  if (section) section.classList.toggle('hidden', sem !== '2');
  // Update preview name and derived batch whenever any field changes
  _adminUpdateSessionPreview();
}

function _adminUpdateSessionPreview() {
  const year  = document.getElementById('admin-session-year')?.value  || '';
  const month = document.getElementById('admin-session-month')?.value || '';
  const sem   = document.getElementById('admin-session-sem')?.value   || '';
  const type  = document.getElementById('admin-session-entry-type')?.value || 'Preliminary';
  const previewEl = document.getElementById('admin-session-preview');
  const batchEl   = document.getElementById('admin-session-batch-derived');
  if (!previewEl) return;

  if (!year || !month || !sem) {
    previewEl.textContent = '—';
    if (batchEl) batchEl.textContent = '—';
    return;
  }

  const name  = buildSessionName(Number(year), month, Number(sem), type);
  const batch = deriveFreshBatch(Number(year), month);
  previewEl.textContent = name;
  if (batchEl) batchEl.textContent = batch;
  _adminPopulateLinkedPrelimSelect();
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
  const year      = document.getElementById('admin-session-year')?.value || '';
  const month     = document.getElementById('admin-session-month')?.value || '';
  const semester  = document.getElementById('admin-session-sem').value;
  const entryType = document.getElementById('admin-session-entry-type')?.value || 'Preliminary';
  const linkedPrelimSessionId = entryType === 'Final Gazette'
    ? (document.getElementById('admin-linked-prelim-select')?.value || '')
    : '';

  if (!year || !month || !semester) {
    UI.toast('Select year, month and semester.', 'error'); return;
  }

  const name  = buildSessionName(Number(year), month, Number(semester), entryType);
  const batch = String(deriveFreshBatch(Number(year), month));

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
    Semester: <strong>${semester === '1' ? 'I' : 'II'}</strong> &nbsp;·&nbsp;
    Fresh batch: <strong>${UI.esc(batch)}</strong> &nbsp;·&nbsp;
    Type: <strong>${UI.esc(entryType)}</strong>`;

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
        const s = await State.addSession(year, month, semester, electives, entryType, linkedPrelimSessionId);
        UI.hideSpinner();
        UI.toast(`Session "${s.name}" created.`, 'success');
        // Reset form
        ['admin-session-year','admin-session-month','admin-session-sem'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = '';
        });
        document.getElementById('admin-session-entry-type').value = 'Preliminary';
        document.getElementById('admin-session-preview').textContent = '—';
        document.getElementById('admin-session-batch-derived').textContent = '—';
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
  const sessions = sortSessions(State.getSessions());
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
      <td>
        ${s.status === 'Locked'
          ? `<button class="btn btn-secondary btn-sm" onclick="exportGazette('${UI.esc(s.id)}')">⬇ Gazette</button>`
          : ''}
      </td>
      <td class="muted" style="font-size:11px;">${UI.esc(s.createdBy)}</td>
    </tr>`;
  }).join('');
}

async function _adminLockSession() {
  const id = document.getElementById('admin-session-lock-select').value;
  if (!id) { UI.toast('Select a session to lock.', 'error'); return; }
  const session = State.getSession(id);
  UI.showModal(
    'Lock session',
    `Lock <strong>${UI.esc(session.name)}</strong>? No further entries will be accepted.<br><br>
     <span style="font-size:12px; color:var(--ink-3);">
       The gazette Excel file will be generated and downloaded automatically on lock.
     </span>`,
    {
      confirmLabel: 'Lock &amp; Export Gazette', danger: true,
      onConfirm: async () => {
        UI.showSpinner('Locking session…');
        try {
          await State.lockSession(id);
          UI.hideSpinner();
          UI.toast(`Session "${session.name}" locked.`, 'success');
          // Small delay so toast is visible before file download dialog
          setTimeout(() => exportGazette(id), 400);
          initAdmin();
        } catch(e) {
          UI.hideSpinner();
          UI.toast('Error: ' + e.message, 'error');
        }
      }
    }
  );
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
      return { uin:cols[0], prn:cols[1], name:cols[2], branch:cols[3], division:cols[4], batchYear:cols[5], gender:cols[6]||'' };
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

  UI.buildSelect('admin-seat-session-select', sortSessions(State.getSessions()), '— select session —', 'id', 'name');

  searchEl.addEventListener('input', _debounce(() => {
    const q = searchEl.value.trim();
    if (q.length < 2) { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; return; }
    const matches = State.searchStudents(q).slice(0, 10);
    resultsEl.innerHTML = matches.length
      ? matches.map(s => `<div class="search-result" data-uin="${UI.esc(s.uin)}">
          <strong>${UI.esc(s.name)}</strong>
          <span>${UI.esc(s.uin)} · PRN/ERN: ${UI.esc(s.prn || '—')} · ${UI.esc(s.branch)}</span>
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
          `UIN: ${_manualSeatStudent.uin} · PRN/ERN: ${_manualSeatStudent.prn || '—'} · ${_manualSeatStudent.branch}`;
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
// GAZETTE EXPORT
// ═══════════════════════════════════════════════════════════════
function exportGazette(sessionId) {
  const session = State.getSession(sessionId);
  if (!session) { UI.toast('Session not found.', 'error'); return; }

  const wb = XLSX.utils.book_new();

  for (const branch of BRANCHES) {
    const students = State.getEligibleStudents(session, branch);
    if (students.length === 0) continue;

    // Seat lookup
    const seatEntries = State.getSeatsForSession(sessionId);
    const seatLookup  = {};
    for (const s of seatEntries) seatLookup[s.uin] = s.seatNumber;

    // Sort by seat number
    students.sort((a, b) => {
      const sa = seatLookup[a.uin] || '';
      const sb = seatLookup[b.uin] || '';
      const na = Number(sa), nb = Number(sb);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return sa.localeCompare(sb);
    });

    const subjects = getSubjectsForSem(session.semester, branch, session);

    // ── Build header rows ──────────────────────────────────
    // Row 1: session info
    // Row 2: fixed cols + subject code spanning (Seat, UIN, PRN, Name, Status)
    // Row 3: component headers per subject + summary headers
    // Row 4: max marks per component

    const FIXED_COLS  = ['Seat No', 'UIN', 'PRN/ERN', 'Name', 'Batch', 'Status'];
    const FIXED_COUNT = FIXED_COLS.length;

    // Per-subject component columns
    const subjCols = []; // [{ subj, comp, max }]
    for (const subj of subjects) {
      for (const [comp, max] of Object.entries(subj.marks)) {
        subjCols.push({ subj, comp, max });
      }
      // Total per subject
      subjCols.push({ subj, comp: 'Total', max: Object.values(subj.marks).reduce((a, b) => a + b, 0), isTotal: true });
      subjCols.push({ subj, comp: 'Grade', max: null, isGrade: true });
    }

    const SUMMARY_COLS = ['Total Marks', 'Credits Earned', 'SGPA', 'Result'];

    // Row 1 — title
    const titleRow = [
      `${session.name} — ${branch}`,
      ...Array(FIXED_COUNT - 1 + subjCols.length + SUMMARY_COLS.length - 1).fill(''),
    ];

    // Row 2 — fixed col names + subject codes (merged header)
    const subjectHeaderRow = [...FIXED_COLS];
    for (const subj of subjects) {
      const compCount = Object.keys(subj.marks).length + 2; // comps + Total + Grade
      subjectHeaderRow.push(subj.code);
      for (let i = 1; i < compCount; i++) subjectHeaderRow.push('');
    }
    subjectHeaderRow.push(...SUMMARY_COLS);

    // Row 3 — component headers
    const compHeaderRow = [...Array(FIXED_COUNT).fill('')];
    for (const { comp } of subjCols) compHeaderRow.push(comp);
    compHeaderRow.push(...Array(SUMMARY_COLS.length).fill(''));

    // Row 4 — max marks
    const maxRow = [...Array(FIXED_COUNT).fill('')];
    for (const { max, isGrade } of subjCols) {
      maxRow.push(isGrade ? '' : (max !== null ? `/${max}` : ''));
    }
    maxRow.push(...Array(SUMMARY_COLS.length).fill(''));

    const wsData = [titleRow, subjectHeaderRow, compHeaderRow, maxRow];

    // ── Build student rows ─────────────────────────────────
    let branchPass = 0, branchFail = 0, branchAB = 0, branchTopper = null;

    for (const student of students) {
      const seatNum = seatLookup[student.uin] || '—';
      const acad    = State.computeStudentAcademics(student.uin);

      // Find this session's result in academics
      const sessResult = acad?.sessionResults.find(sr => sr.session.id === sessionId);

      const row = [
        seatNum,
        student.uin,
        student.prn || '—',
        student.name,
        student.batchYear,
        student.attemptFlag || 'Regular',
      ];

      let studentTotalMarks  = 0;
      let studentCredits     = 0;
      let studentAllPass     = true;
      let studentAnyAB       = false;

      for (const subj of subjects) {
        const dr = sessResult?.subjects.find(s => s.r.subjectCode === subj.code)?.dr;

        // Fill component marks from ledger
        const latestEntry = State.getLatestEntryForSubject(student.uin, subj.code, sessionId);

        // For Final Gazette — supplement with prelim
        let iatVal = '', eseVal = '', twVal = '', oralVal = '';
        if (latestEntry) {
          iatVal  = latestEntry.iatMarks  || '';
          eseVal  = latestEntry.eseMarks  || '';
          twVal   = latestEntry.twMarks   || '';
          oralVal = latestEntry.oralMarks || '';
        }
        if (session.entryType === 'Final Gazette' && session.linkedPrelimSessionId) {
          const prelim = State.getLatestEntryForSubject(student.uin, subj.code, session.linkedPrelimSessionId);
          if (prelim) {
            if (!iatVal)  iatVal  = prelim.iatMarks  || '';
            if (!twVal)   twVal   = prelim.twMarks   || '';
            if (!oralVal) oralVal = prelim.oralMarks || '';
          }
        }

        const compValMap = { IAT: iatVal, ESE: eseVal, TW: twVal, Oral: oralVal };

        for (const comp of Object.keys(subj.marks)) {
          row.push(compValMap[comp] || '—');
        }

        // Total + Grade per subject
        if (dr && !dr.pending) {
          row.push(dr.total);
          row.push(dr.grade);
          studentTotalMarks += dr.total;
          studentCredits    += dr.creditsEarned;
          if (dr.result === 'Fail') studentAllPass = false;
          if (dr.result === 'AB')   { studentAllPass = false; studentAnyAB = true; }
        } else {
          row.push('—');
          row.push('—');
          studentAllPass = false;
        }
      }

      // Summary columns
      const sessAcad  = acad?.sessionResults.find(sr => sr.session.id === sessionId);
      const sgpaStr   = sessAcad?.sgpa != null ? sessAcad.sgpa.toFixed(2) : '—';
      const resultStr = studentAnyAB ? 'AB' : studentAllPass ? 'Pass' : 'Fail';

      row.push(studentTotalMarks || '—');
      row.push(studentCredits    || '—');
      row.push(sgpaStr);
      row.push(resultStr);

      wsData.push(row);

      // Branch stats
      if (resultStr === 'Pass') branchPass++;
      else if (resultStr === 'AB') branchAB++;
      else branchFail++;

      if (resultStr === 'Pass') {
        if (!branchTopper || studentTotalMarks > branchTopper.totalMarks) {
          branchTopper = { name: student.name, uin: student.uin, totalMarks: studentTotalMarks };
        }
      }
    }

    // ── Summary footer rows ────────────────────────────────
    wsData.push(Array(FIXED_COUNT + subjCols.length + SUMMARY_COLS.length).fill(''));

    const total = students.length;
    wsData.push([
      'Summary', '', '', '', '', '',
      ...Array(subjCols.length).fill(''),
      `Total: ${total}`,
      `Pass: ${branchPass} (${total ? Math.round(branchPass/total*100) : 0}%)`,
      `Fail: ${branchFail}`,
      `AB: ${branchAB}`,
    ]);

    if (branchTopper) {
      wsData.push([
        'Topper', '', '', branchTopper.name, '', branchTopper.uin,
        ...Array(subjCols.length).fill(''),
        branchTopper.totalMarks, '', '', '',
      ]);
    }

    // ── Create worksheet ───────────────────────────────────
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Column widths
    const colWidths = [
      { wch: 8 },  // Seat
      { wch: 12 }, // UIN
      { wch: 12 }, // PRN
      { wch: 28 }, // Name
      { wch: 8 },  // Batch
      { wch: 9 },  // Status
      ...subjCols.map(({ comp }) =>
        comp === 'Grade' ? { wch: 6 } : comp === 'Total' ? { wch: 7 } : { wch: 6 }
      ),
      { wch: 12 }, // Total Marks
      { wch: 10 }, // Credits
      { wch: 8 },  // SGPA
      { wch: 8 },  // Result
    ];
    ws['!cols'] = colWidths;

    // Merge subject header cells (row 2, index 1)
    const merges = [];
    let colIdx = FIXED_COUNT;
    for (const subj of subjects) {
      const span = Object.keys(subj.marks).length + 2; // comps + Total + Grade
      if (span > 1) {
        merges.push({
          s: { r: 1, c: colIdx },
          e: { r: 1, c: colIdx + span - 1 },
        });
      }
      colIdx += span;
    }
    ws['!merges'] = merges;

    XLSX.utils.book_append_sheet(wb, ws, branch.slice(0, 31));
  }

  // ── Summary sheet ──────────────────────────────────────
  const summaryData = [
    [`Gazette Summary — ${session.name}`],
    ['Branch', 'Total Students', 'Pass', 'Fail', 'AB', 'Pass %', 'Topper', 'Topper Marks'],
  ];

  for (const branch of BRANCHES) {
    const students = State.getEligibleStudents(session, branch);
    if (students.length === 0) continue;

    const seatEntries = State.getSeatsForSession(sessionId);
    const seatLookup  = {};
    for (const s of seatEntries) seatLookup[s.uin] = s.seatNumber;

    let pass = 0, fail = 0, ab = 0, topper = null;
    for (const student of students) {
      const acad     = State.computeStudentAcademics(student.uin);
      const sessAcad = acad?.sessionResults.find(sr => sr.session.id === sessionId);
      if (!sessAcad) continue;

      const allSubjs  = sessAcad.subjects;
      const anyAB     = allSubjs.some(s => s.dr?.result === 'AB');
      const anyFail   = allSubjs.some(s => s.dr?.result === 'Fail' || s.dr?.pending);
      const result    = anyAB ? 'AB' : anyFail ? 'Fail' : 'Pass';
      const total     = allSubjs.reduce((s, sub) => s + (sub.dr?.total || 0), 0);

      if (result === 'Pass') { pass++; if (!topper || total > topper.marks) topper = { name: student.name, marks: total }; }
      else if (result === 'AB') ab++;
      else fail++;
    }

    const t = students.length;
    summaryData.push([
      branch, t, pass, fail, ab,
      t ? Math.round(pass/t*100) + '%' : '—',
      topper?.name || '—',
      topper?.marks ?? '—',
    ]);
  }

  // KT sheet — students with remaining active KTs after this session
  const ktData = [
    [`Active KTs after — ${session.name}`],
    ['UIN', 'PRN/ERN', 'Name', 'Branch', 'Batch', 'Subject Code', 'Subject Name', 'Component', 'Last Mark'],
  ];

  for (const branch of BRANCHES) {
    const students = State.getEligibleStudents(session, branch);
    for (const student of students) {
      const activeKTs = State.getActiveKTSubjects(student.uin)
        .filter(r => Number(r.semester) === session.semester);
      for (const kt of activeKTs) {
        // List which components are still failing
        const compStatus = _meGetCompPassStatus(student.uin, kt.subjectCode, session.semester);
        for (const comp of ['IAT', 'ESE', 'TW', 'Oral']) {
          if (compStatus[comp] && compStatus[comp] !== 'pass') {
            ktData.push([
              student.uin, student.prn || '—', student.name,
              student.branch, student.batchYear,
              kt.subjectCode, kt.subjectName,
              comp, compStatus[comp + '_val'] || '—',
            ]);
          }
        }
      }
    }
  }

  const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
  summaryWs['!cols'] = [
    { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 6 },
    { wch: 8 }, { wch: 28 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

  const ktWs = XLSX.utils.aoa_to_sheet(ktData);
  ktWs['!cols'] = [
    { wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 12 },
    { wch: 8 }, { wch: 12 }, { wch: 32 }, { wch: 8 }, { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, ktWs, 'Active KTs');

  // ── Write file ─────────────────────────────────────────
  const filename = `${session.name}_Gazette.xlsx`;
  XLSX.writeFile(wb, filename);
  UI.toast(`✓ Gazette exported: ${filename}`, 'success');
}

// ═══════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════
function _debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
