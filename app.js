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
  document.getElementById('me-roster-btn').onclick = () => _meSetMode('roster');
  _meSetMode(meMode);
}

function _meSetMode(mode, opts) {
  meMode = mode;
  document.getElementById('me-adhoc-btn').classList.toggle('active', mode === 'adhoc');
  document.getElementById('me-queue-btn').classList.toggle('active', mode === 'queue');
  document.getElementById('me-roster-btn').classList.toggle('active', mode === 'roster');
  document.getElementById('me-adhoc-panel').classList.toggle('hidden', mode !== 'adhoc');
  document.getElementById('me-queue-panel').classList.toggle('hidden', mode !== 'queue');
  document.getElementById('me-roster-panel').classList.toggle('hidden', mode !== 'roster');
  if (mode === 'adhoc' && !(opts && opts.skipInit)) _meInitAdhoc();
  if (mode === 'queue') _meInitQueue();
  if (mode === 'roster') _meInitRoster();
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
    if (q.length < 2) { resultsBox.style.display = 'none'; resultsBox.innerHTML = ''; return; }

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

// Don't show any future session for a semester already fully cleared
const acad = State.computeStudentAcademics(student.uin);
const semCredits = acad?.semCredits[session.semester];
if (semCredits && semCredits.max > 0 && semCredits.earned >= semCredits.max) return false;

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
      // AND session is not before the student's academics started.
      const studentBatchYear = Number(student.batchYear);
      const sem1Start = studentBatchYear * 12 + 12;
      const sem2Start = (studentBatchYear + 1) * 12 + 5;
      const sessionScore = Number(session.name.slice(0, 4)) * 12 +
        (session.name.includes('May') ? 5 : 12);
      const semStart = session.semester === 1 ? sem1Start : sem2Start;
      if (sessionScore < semStart) return false;

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
    s.status === 'Active' &&
    _isStudentEligibleForSession(student, s) &&
    (s.entryType !== 'Revaluation_Gazette' || Auth.isAdmin())
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
  const label  = seatNum
    ? `Session — auto-detected from seat ${UI.esc(String(seatNum))}`
    : `Session — selected from Roster`;
  picker.innerHTML = `
    <div class="session-picker">
      <div class="session-picker-label">${label}</div>
      <div class="session-option" style="cursor:default; border-color:var(--pass); background:var(--pass-bg);">
        <span class="session-option-name">${UI.esc(session.name)}</span>
        <span class="session-auto-badge">✓ Auto-selected</span>
      </div>
    </div>`;
}

function _meGetNextSession(student, sem, revalOverrides = {}) {
  // revalOverrides: { [revalSessionId]: 'Yes' | 'No' | 'Unknown' }
  // Allows UI toggle to override persisted decision without saving yet

  const allSessions = sortSessions(State.getSessions()).reverse(); // chronological ascending
  const semSessions = allSessions.filter(s =>
    s.semester === sem &&
    (s.entryType !== 'Revaluation_Gazette' || Auth.isAdmin())
  );

  // Sessions this student has a record in
  const recordSessionIds = new Set(
    State.ledger.filter(r => r.uin === student.uin).map(r => r.examSession)
  );

  // Chronological score helper
  const _score = s => Number(s.name.slice(0, 4)) * 12 + (s.name.includes('May') ? 5 : 12);

  // Find last session student has a record in, for this semester
  const attended = semSessions.filter(s => recordSessionIds.has(s.id));
  if (attended.length === 0) {
    // Fresh for this semester — find canonical first active Uni-Portal
    const studentBatchYear = Number(student.batchYear);
    const sem1Start = studentBatchYear * 12 + 12;
    const sem2Start = (studentBatchYear + 1) * 12 + 5;
    const semStart  = sem === 1 ? sem1Start : sem2Start;
    return semSessions.find(s => {
      const score = _score(s);
      return score >= semStart && s.status === 'Active' && s.entryType !== 'Revaluation_Gazette';
    }) || null;
  }

  // Last attended session chronologically
  const lastAttended = attended[attended.length - 1];

  // If last was a Uni-Portal → check if linked Reval exists and is Active
  if (lastAttended.entryType !== 'Revaluation_Gazette') {
    const linkedReval = semSessions.find(s =>
      s.entryType === 'Revaluation_Gazette' &&
      s.linkedPrelimSessionId === lastAttended.id &&
      s.status === 'Active'
    );

    if (linkedReval) {
      // Check decision: UI override takes priority, then persisted
      const decision = revalOverrides[linkedReval.id] !== undefined
        ? revalOverrides[linkedReval.id]
        : State.getRevalDecision(student.uin, linkedReval.id);

      // 'Yes' or 'Unknown' → show Reval as next
      // 'No' → skip Reval, fall through to next Uni-Portal
      if (decision !== 'No' && decision !== 'SkipForNow') return linkedReval;
    }
  }

  // Last was Reval, or Reval skipped/locked/missing → find next Uni-Portal
  const lastScore = _score(lastAttended);

  // If semester is already fully cleared, no next session needed
  const acad = State.computeStudentAcademics(student.uin);
  const semCredits = acad?.semCredits[sem];
  if (semCredits && semCredits.max > 0 && semCredits.earned >= semCredits.max) return null;

  // Walk forward chronologically — skip any Uni-Portal the student has an exam skip for
  return semSessions.find(s => {
    if (s.entryType === 'Revaluation_Gazette') return false;
    if (s.status !== 'Active') return false;
    if (_score(s) <= lastScore) return false;
    if (State.getExamSkipDecision(student.uin, s.id)) return false;
    return true;
  }) || null;
}

function _meAdhocShowSessionPicker(sessions) {
  const student = meAdhocState.student;
  const picker  = document.getElementById('me-adhoc-session-picker');

  // Per-render override map: revalSessionId → 'Yes'|'No'|'Unknown'|'SkipForNow'
  const revalOverrides = {};

  // All sessions student has a record in
  const recordSessionIds = new Set(
    State.ledger.filter(r => r.uin === student.uin).map(r => r.examSession)
  );

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

  function _statusTag(status) {
    if (status === 'cleared')      return `<span class="session-status-tag tag-cleared">✓ Successful</span>`;
    if (status === 'unsuccessful') return `<span class="session-status-tag tag-unsuccessful">✗ Unsuccessful</span>`;
    return `<span class="session-status-tag tag-pending">Marks entry pending</span>`;
  }

  function _renderSem(sem) {
    const nextSession = _meGetNextSession(student, sem, revalOverrides);

    // Sessions with records for this semester, chronological
    const attended = sortSessionsChronological(
      State.getSessions().filter(s =>
        s.semester === sem && recordSessionIds.has(s.id)
      )
    );

    // Also collect skipped Uni-Portals for this semester (no records, but skip persisted)
    const skippedSessions = sortSessionsChronological(
      State.getSessions().filter(s =>
        s.semester === sem &&
        s.entryType !== 'Revaluation_Gazette' &&
        !recordSessionIds.has(s.id) &&
        State.getExamSkipDecision(student.uin, s.id)
      )
    );

    if (attended.length === 0 && skippedSessions.length === 0 && !nextSession) return '';

    let html = `<div class="pv-sem-separator">Semester ${sem}</div>`;

    // ── Historical attended strips ────────────────────────────
    for (const s of attended) {
      const status = _sessionStatus(s);
      html += `
        <div class="session-strip session-strip-historical">
          <div class="session-strip-info">
            <span class="session-strip-name">${UI.esc(s.name)}</span>
            <span class="session-strip-meta">Sem ${s.semester} · ${UI.esc(s.batchYear)} · ${UI.esc(s.entryType)}</span>
          </div>
          <div class="session-strip-centre"></div>
          <div class="session-strip-right">${_statusTag(status)}</div>
        </div>`;
    }

    // ── Skipped Uni-Portal strips ─────────────────────────────
    for (const s of skippedSessions) {
      html += `
        <div class="session-strip session-strip-skipped">
          <div class="session-strip-info">
            <span class="session-strip-name">${UI.esc(s.name)}</span>
            <span class="session-strip-meta">Sem ${s.semester} · ${UI.esc(s.batchYear)} · ${UI.esc(s.entryType)}</span>
          </div>
          <div class="session-strip-centre"></div>
          <div class="session-strip-right">
            <span class="tag-skipped">⊘ Skipped exam</span>
            <button class="btn-exam-skip btn-exam-undo" data-session-id="${UI.esc(s.id)}">Undo</button>
          </div>
        </div>`;
    }

    // ── Active next session strip ─────────────────────────────
    if (nextSession) {
      const isReval = nextSession.entryType === 'Revaluation_Gazette';

      if (isReval) {
        const persistedDecision = State.getRevalDecision(student.uin, nextSession.id);
        const currentDecision   = revalOverrides[nextSession.id] !== undefined
          ? revalOverrides[nextSession.id]
          : persistedDecision;
        const isLocked = nextSession.status !== 'Active';

        const revalToggle = `
          <div class="reval-toggle-inline reval-toggle" data-sem="${sem}" data-reval-id="${UI.esc(nextSession.id)}">
            <button class="reval-tog-btn${currentDecision === 'Yes'        ? ' active' : ''}"
              data-val="Yes"        ${isLocked ? 'disabled' : ''}>Yes</button>
            <button class="reval-tog-btn${currentDecision === 'No'         ? ' active' : ''}"
              data-val="No"         ${isLocked ? 'disabled' : ''}>No</button>
            <button class="reval-tog-btn${currentDecision === 'Unknown'    ? ' active' : ''}"
              data-val="Unknown"    ${isLocked ? 'disabled' : ''}>Unknown</button>
            <button class="reval-tog-btn${currentDecision === 'SkipForNow' ? ' active' : ''}"
              data-val="SkipForNow" ${isLocked ? 'disabled' : ''}>Skip for now</button>
          </div>`;

        if (currentDecision === 'No') {
          // Opted out — greyed, no Enter marks
          html += `
            <div class="session-strip session-strip-historical">
              <div class="session-strip-info">
                <span class="session-strip-name">${UI.esc(nextSession.name)}</span>
                <span class="session-strip-meta">Sem ${nextSession.semester} · ${UI.esc(nextSession.batchYear)} · Revaluation Gazette</span>
              </div>
              <div class="session-strip-centre"></div>
              <div class="session-strip-right">
                <span class="session-status-tag tag-unsuccessful">✗ Opted out of Reval</span>
                ${revalToggle}
              </div>
            </div>`;
        } else {
          // Yes / Unknown / SkipForNow — active, Enter marks available
          html += `
            <div class="session-strip session-strip-active">
              <div class="session-strip-info">
                <span class="session-strip-name">${UI.esc(nextSession.name)}</span>
                <span class="session-strip-meta">Sem ${nextSession.semester} · ${UI.esc(nextSession.batchYear)} · Revaluation Gazette</span>
              </div>
              <div class="session-strip-centre">
                <button class="btn btn-primary btn-sm enter-marks-btn"
                  data-session-id="${UI.esc(nextSession.id)}">Enter marks →</button>
              </div>
              <div class="session-strip-right">${revalToggle}</div>
            </div>`;
        }

      } else {
        // Uni-Portal — active, Enter marks + Skip exam
        html += `
          <div class="session-strip session-strip-active">
            <div class="session-strip-info">
              <span class="session-strip-name">${UI.esc(nextSession.name)}</span>
              <span class="session-strip-meta">Sem ${nextSession.semester} · ${UI.esc(nextSession.batchYear)} · Uni Portal Gazette</span>
            </div>
            <div class="session-strip-centre">
              <button class="btn btn-primary btn-sm enter-marks-btn"
                data-session-id="${UI.esc(nextSession.id)}">Enter marks →</button>
            </div>
            <div class="session-strip-right">
              <button class="btn-exam-skip" data-session-id="${UI.esc(nextSession.id)}">⊘ Skip exam</button>
            </div>
          </div>`;
      }
    }

    return html;
  }

  function _rebuild() {
    picker.innerHTML = `
      <div class="session-picker">
        <div class="session-picker-label">Select session</div>
        ${_renderSem(1)}
        ${_renderSem(2)}
      </div>`;
    _wireToggle();
    _wireEnterMarks();
    _wireExamSkip();
  }

  function _wireToggle() {
    picker.querySelectorAll('.reval-toggle').forEach(toggleEl => {
      const revalId = toggleEl.dataset.revalId;
      toggleEl.querySelectorAll('.reval-tog-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const val = btn.dataset.val;
          revalOverrides[revalId] = val;
          if (val !== 'SkipForNow') {
            State.setRevalSkip(student.uin, revalId, val).catch(err => {
              UI.toast('Could not save reval decision: ' + err.message, 'error', 5000);
            });
          }
          _rebuild();
        });
      });
    });
  }

  function _wireEnterMarks() {
    picker.querySelectorAll('.enter-marks-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        meAdhocState.session = State.getSession(btn.dataset.sessionId);
        picker.querySelectorAll('.enter-marks-btn').forEach(b =>
          b.classList.toggle('btn-secondary', b !== btn)
        );
        _meAdhocRenderGrid();
      });
    });
  }

  function _wireExamSkip() {
    // Skip exam
    picker.querySelectorAll('.btn-exam-skip:not(.btn-exam-undo)').forEach(btn => {
      btn.addEventListener('click', async () => {
        const sessionId = btn.dataset.sessionId;
        const sess = State.getSession(sessionId);
        UI.showModal(
          'Skip exam session',
          `Mark <strong>${UI.esc(student.name)}</strong> as having skipped <strong>${UI.esc(sess?.name || sessionId)}</strong>?<br>
          <small style="color:var(--ink-3);">This can be undone. The next eligible session will be shown instead.</small>`,
          {
            confirmLabel: 'Skip exam',
            danger: true,
            onConfirm: async () => {
              UI.showSpinner('Saving…');
              try {
                await State.setExamSkip(student.uin, sessionId);
                UI.hideSpinner();
                UI.toast('Exam skip recorded.', 'success');
                _rebuild();
              } catch(err) {
                UI.hideSpinner();
                UI.toast('Could not save exam skip: ' + err.message, 'error', 5000);
              }
            }
          }
        );
      });
    });

    // Undo skip
    picker.querySelectorAll('.btn-exam-undo').forEach(btn => {
      btn.addEventListener('click', async () => {
        const sessionId = btn.dataset.sessionId;
        const sess = State.getSession(sessionId);
        UI.showModal(
          'Undo exam skip',
          `Undo skip for <strong>${UI.esc(student.name)}</strong> in <strong>${UI.esc(sess?.name || sessionId)}</strong>?`,
          {
            confirmLabel: 'Undo skip',
            onConfirm: async () => {
              UI.showSpinner('Saving…');
              try {
                await State.setExamSkip(student.uin, sessionId); // odd count = unskipped
                UI.hideSpinner();
                UI.toast('Exam skip undone.', 'success');
                _rebuild();
              } catch(err) {
                UI.hideSpinner();
                UI.toast('Could not undo exam skip: ' + err.message, 'error', 5000);
              }
            }
          }
        );
      });
    });
  }

  _rebuild();

}
function _meStudentInfoHtml(student, session) {
  const isKT = session
    ? State.getActiveKTSubjects(student.uin).some(r => Number(r.semester) === session.semester)
    : false;
  const isFinal = session?.entryType === 'Revaluation_Gazette';
  return `
    <div class="student-card">
      <div class="sc-name">${UI.esc(student.name)}
        ${session
          ? isKT
            ? '<span class="badge badge-kt" style="margin-left:8px;">KT Student</span>'
            : '<span class="badge badge-regular" style="margin-left:8px;">Regular Student</span>'
          : ''}
      </div>
      <div class="sc-meta">
        UIN: ${UI.esc(student.uin)} · PRN/ERN: ${UI.esc(student.prn || '—')} ·
        ${UI.esc(student.branch)} · Div ${UI.esc(student.division)} · Batch ${UI.esc(student.batchYear)}
      </div>
      ${session
        ? isFinal
          ? '<div style="margin-top:6px;"><span class="session-type-inline final-gazette">📋 Revaluation Gazette — only ESE editable</span></div>'
          : '<div style="margin-top:6px;"><span class="session-type-inline preliminary">📝 Uni Portal Gazette</span></div>'
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
      <span>${comp}<small>/${max}</small> <span class="lock-icon">🔒</span></span>
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
  const isFinal  = session.entryType === 'Revaluation_Gazette';
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
          // Try linked prelim first, then fall back to earlier sessions (same semester)
          let prelimVal = prelimEntry ? (prelimEntry[comp.toLowerCase() + 'Marks'] || '') : '';
          if (!prelimVal) {
            // Fall back to latest non-empty value from any earlier session, same semester
            const allPriorRows = State.ledger
              .filter(r =>
                r.uin === student.uin &&
                r.subjectCode === subj.code &&
                Number(r.semester) === session.semester &&
                r.examSession !== session.id
              )
              .sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));
            for (const pr of allPriorRows) {
              const v = pr[comp.toLowerCase() + 'Marks'];
              if (v && v !== '') { prelimVal = v; }
            }
          }
          html += _meLockedCompHtml(comp, subj.marks[comp], prelimVal || '—', subj.code);
        } else {
          // ESE: determine if editable (failed/AB in linked prelim) or locked (passed or no entry)
          const existingFinal = prevEntry ? (prevEntry.eseMarks || '') : '';
          const prelimESE     = prelimEntry ? (prelimEntry.eseMarks || '') : '';
          const eseMax        = subj.marks[comp];

          if (prelimEntry && prelimESE) {
            // Student sat this subject in linked prelim — check component-level pass
            const parsed = parseMarkValue(prelimESE, eseMax);
            const esePassed = parsed.valid && !parsed.absent &&
              (parsed.grace || (parsed.value / eseMax >= 0.40));
            if (esePassed) {
              // Passed ESE in linked prelim — lock it
              html += _meLockedCompHtml(comp, eseMax, existingFinal || prelimESE, subj.code);
            } else {
              // Failed/AB ESE in linked prelim — editable
              html += _meEditableCompHtml(comp, eseMax, subj.code, student.uin, existingFinal || prelimESE);
            }
          } else {
            // No entry in linked prelim — carry from earlier sessions, lock it
            let carriedESE = existingFinal;
            if (!carriedESE) {
              const allPriorRows = State.ledger
                .filter(r =>
                  r.uin === student.uin &&
                  r.subjectCode === subj.code &&
                  Number(r.semester) === session.semester &&
                  r.examSession !== session.id
                )
                .sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));
              for (const pr of allPriorRows) {
                if (pr.eseMarks && pr.eseMarks !== '') { carriedESE = pr.eseMarks; }
              }
            }
            html += _meLockedCompHtml(comp, eseMax, carriedESE || '—', subj.code);
          }
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

function _meValidateGrid(containerId) {
  const inputs = [...document.querySelectorAll(`#${containerId} .mark-input-single:not([disabled])`)];
  const overMax = inputs.filter(input => {
    const raw = input.value.trim();
    if (!raw || raw.toUpperCase() === 'AB') return false;
    if (raw.endsWith('*')) return false;
    const val = Number(raw);
    const max = Number(input.dataset.max);
    return !isNaN(val) && max > 0 && val > max;
  });
  if (overMax.length > 0) {
    overMax[0].focus();
    UI.toast(`${overMax.length} mark(s) exceed the maximum allowed. Please correct before saving.`, 'error', 5000);
    return false;
  }
  return true;
}

async function _meAdhocSubmit() {
  const { student, session } = meAdhocState;
  if (!student || !session) { UI.toast('Select a student and session.', 'error'); return; }
  if (!_meValidateGrid('me-adhoc-grid')) return;

  const isFinal = session.entryType === 'Revaluation_Gazette';
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
    // Navigate to Progress View to show updated results
    document.querySelector('[data-tab="progress"]')?.click();
    _pvShowStudent(student.uin);
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

let meRosterState = {
  loaded: false,
  sessionId: null, branch: null, division: null, batchYear: null,
  rows: null, session: null, seatLookup: null,
};

function _meInitQueue() {
  const sessions = sortSessions(State.getSessions().filter(s =>
    s.status === 'Active' &&
    (s.entryType !== 'Revaluation_Gazette' || Auth.isAdmin())
  ));
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
  const seatMap = State.getSeatsForSessionWithFallback(session.id);
  const seatLookup = {};
  // Fall back to linked Preliminary seats if this is a Final Gazette
  if (session.linkedPrelimSessionId) {
    for (const s of State.getSeatsForSession(session.linkedPrelimSessionId))
      seatLookup[s.uin] = s.seatNumber;
  }
  for (const s of seatMap) seatLookup[s.uin] = s.seatNumber; // own seats win

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
  const isFinal  = session.entryType === 'Revaluation_Gazette';
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
        ? '<span class="session-type-inline final-gazette" style="margin-left:auto;">📋 Revaluation Gazette</span>'
        : '<span class="session-type-inline preliminary" style="margin-left:auto;">📝 Uni Portal Gazette</span>'}
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
  if (!_meValidateGrid('me-queue-grid')) return;

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
          <span class="pv-stat-lbl">Total Students</span>
        </div>
        <div class="pv-stat">
          <span class="pv-stat-val" style="color:var(--brand);">${entered}</span>
          <span class="pv-stat-lbl">Marks Saved</span>
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

// ═══════════════════════════════════════════════════════════════
// MARK ENTRY — ROSTER MODE
// ═══════════════════════════════════════════════════════════════

function _meInitRoster() {
  const sessions = sortSessions(State.getSessions().filter(s =>
    s.status === 'Active' &&
    (s.entryType !== 'Revaluation_Gazette' || Auth.isAdmin())
  ));
  UI.buildSelect('me-roster-session', sessions, '— select session —', 'id', 'name');
  UI.buildSelect('me-roster-branch', BRANCHES, '— select branch —');

  document.getElementById('me-roster-session').onchange = _meRosterOnFilterChange;
  document.getElementById('me-roster-branch').onchange  = _meRosterOnBranchChange;
  document.getElementById('me-roster-division').onchange = _meRosterOnFilterChange;
  document.getElementById('me-roster-load-btn').onclick  = _meRosterLoad;

  // Populate batch year
  const batchYears = State.getBatchYears();
  const batchEl = document.getElementById('me-roster-batch');
  if (batchEl) {
    batchEl.innerHTML = '<option value="">— all batches —</option>' +
      batchYears.map(y => `<option value="${UI.esc(y)}">${UI.esc(y)}</option>`).join('');
    batchEl.onchange = _meRosterOnFilterChange;
  }

  document.getElementById('me-roster-load-btn').disabled = true;

  // Restore previous roster if available
  if (meRosterState.loaded) {
    if (meRosterState.sessionId)
      document.getElementById('me-roster-session').value = meRosterState.sessionId;
    if (meRosterState.branch)
      document.getElementById('me-roster-branch').value = meRosterState.branch;
    if (meRosterState.batchYear) {
      const batchEl = document.getElementById('me-roster-batch');
      if (batchEl) batchEl.value = meRosterState.batchYear;
    }
    // Repopulate division dropdown for this branch, then restore value
    if (meRosterState.branch) {
      _meRosterOnBranchChange();
      if (meRosterState.division)
        document.getElementById('me-roster-division').value = meRosterState.division;
    }
    document.getElementById('me-roster-load-btn').disabled = false;
    // Re-render saved roster
    const { rows, session, seatLookup } = meRosterState;
    const counts = { pending: 0, partial: 0, done: 0 };
    rows.forEach(r => counts[r.status]++);
    const pillsEl = document.getElementById('me-roster-pills');
    pillsEl.classList.remove('hidden');
    pillsEl.style.display = 'flex';
    document.getElementById('me-roster-pill-pending').textContent = `🔴 Pending: ${counts.pending}`;
    document.getElementById('me-roster-pill-partial').textContent  = `🟡 Partial: ${counts.partial}`;
    document.getElementById('me-roster-pill-done').textContent     = `🟢 Done: ${counts.done}`;
    document.getElementById('me-roster-session-label').textContent = session.name;
    _meRosterRenderTable(rows, session, seatLookup);
    return;
  }

  document.getElementById('me-roster-pills').classList.add('hidden');
  document.getElementById('me-roster-output').innerHTML = '';
}

function _meRosterOnFilterChange() {
  const sessId  = document.getElementById('me-roster-session').value;
  const branch  = document.getElementById('me-roster-branch').value;
  const ready   = !!(sessId && branch);
  document.getElementById('me-roster-load-btn').disabled = !ready;
  // Invalidate saved roster when filters change
  meRosterState.loaded = false;
}

function _meRosterOnBranchChange() {
  const branch = document.getElementById('me-roster-branch').value;
  const divEl  = document.getElementById('me-roster-division');
  divEl.innerHTML = '<option value="">— all divisions —</option>';
  if (branch) {
    const divs = State.getDivisions(branch);
    divs.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d; opt.textContent = d;
      divEl.appendChild(opt);
    });
  }
  _meRosterOnFilterChange();
}

// ── Build merged marks map for a student+subject across sessions ──
// Mirrors the KT carry-forward logic in computeStudentAcademics.
// Returns a marksMap { IAT, ESE, TW, Oral } combining current session
// entries with passing component values carried from prior sessions.
function _meRosterBuildMergedMarks(studentLedgerRows, subj, currentSessionId, semester) {
  // All rows for this subject sorted oldest first
  const subjRows = studentLedgerRows
    .filter(r => r.subjectCode === subj.code && Number(r.semester) === semester)
    .sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));

  if (subjRows.length === 0) return {};

  // Latest value per component per session
  const perSession = {}; // sessionId → { IAT, ESE, TW, Oral }
  for (const r of subjRows) {
    if (!perSession[r.examSession]) perSession[r.examSession] = {};
    const s = perSession[r.examSession];
    if (r.iatMarks  !== '') s.IAT  = r.iatMarks;
    if (r.eseMarks  !== '') s.ESE  = r.eseMarks;
    if (r.twMarks   !== '') s.TW   = r.twMarks;
    if (r.oralMarks !== '') s.Oral = r.oralMarks;
  }

  // Current session values
  const current = perSession[currentSessionId] || {};

  // Prior sessions — latest non-empty value per component
  const prior = {};
  for (const [sid, vals] of Object.entries(perSession)) {
    if (sid === currentSessionId) continue;
    for (const [comp, val] of Object.entries(vals)) {
      prior[comp] = val; // later sessions overwrite earlier (already sorted)
    }
  }

  // Build merged map
  const merged = {};
  for (const comp of Object.keys(subj.marks)) {
    if (current[comp] !== undefined) {
      // Has a value in current session — use it
      merged[comp] = current[comp];
    } else if (prior[comp] !== undefined) {
      // No current session value — check if prior was passing → carry forward
      const max    = subj.marks[comp];
      const parsed = parseMarkValue(prior[comp], max);
      const passed = parsed.valid && !parsed.absent &&
        (parsed.grace || (max && parsed.value / max >= 0.40));
      if (passed) merged[comp] = prior[comp];
      // If prior was failing → leave empty (student must re-enter)
    }
  }
  return merged;
}

// ── Build status for one student in a session ──────────────────
// Returns:
// {
//   status: 'done'|'partial'|'pending',
//   pendingSubjects: [{ code, name }],   // subjects genuinely not yet complete
//   doneSubjects:    [{ code, name }],
//   lastSession: string|null,            // name of last session with any entry this sem
//   isKT: bool,
//   totalExpected: number,
// }
function _meRosterBuildStudentStatus(student, session) {
  const sem      = session.semester;
  const subjects = getSubjectsForSem(sem, student.branch, session);

  // All ledger rows for this student
  const studentRows = State.ledger.filter(r => r.uin === student.uin);

  // Last session (excluding current) where student has any entry for this semester
  const priorSessIds = [...new Set(
    studentRows
      .filter(r => Number(r.semester) === sem && r.examSession !== session.id)
      .map(r => r.examSession)
  )];

  let lastSession = null;
  if (priorSessIds.length > 0) {
    // Find the chronologically latest one
    const _score = sid => {
      const s = State.getSession(sid);
      if (!s) return 0;
      const year  = Number((s.name || '').slice(0, 4));
      const month = (s.name || '').includes('May') ? 5 : 12;
      return year * 12 + month;
    };
    const latestId = priorSessIds.sort((a, b) => _score(b) - _score(a))[0];
    const latestSess = State.getSession(latestId);
    if (latestSess) lastSession = latestSess.name;
  }

  // KT = student had any prior ledger records in this semester BEFORE this session
  const sessionScore = (sid) => {
    const s = State.getSession(sid);
    if (!s) return 0;
    const year  = Number((s.name || '').slice(0, 4));
    const month = (s.name || '').includes('May') ? 5 : 12;
    return year * 12 + month;
  };
  const thisScore = sessionScore(session.id);
  const isKT = State.ledger.some(r =>
    r.uin === student.uin &&
    Number(r.semester) === session.semester &&
    r.examSession !== session.id &&
    sessionScore(r.examSession) < thisScore
  );

  const pendingSubjects = [];
  const doneSubjects    = [];

  for (const subj of subjects) {
    // For KT students: if this subject is not in their active KT list,
    // it means they already passed it — skip (not their concern this session)
    if (isKT) {
      const ktSubjs = State.getActiveKTSubjects(student.uin);
      const isKTSubject = ktSubjs.some(k => k.subjectCode === subj.code);
      if (!isKTSubject) {
        doneSubjects.push({ code: subj.code, name: subj.name });
        continue;
      }
    }

    const mergedMap = _meRosterBuildMergedMarks(studentRows, subj, session.id, sem);
    const dr        = computeDisplayResult(subj, mergedMap);

    if (dr.pending) {
      pendingSubjects.push({ code: subj.code, name: subj.name });
    } else {
      doneSubjects.push({ code: subj.code, name: subj.name });
    }
  }

  let status;
  if (pendingSubjects.length === 0) {
    status = 'done';
  } else if (doneSubjects.length === 0) {
    status = 'pending';
  } else {
    status = 'partial';
  }

  // Result status — only meaningful when entry is Done
  let result = null;
  if (status === 'done') {
    const studentRows = State.ledger.filter(r => r.uin === student.uin);
    const subjects = getSubjectsForSem(session.semester, student.branch, session);
    let unsuccessful = false;
    for (const subj of subjects) {
      if (isKT) {
        const ktSubjs = State.getActiveKTSubjects(student.uin);
        const isKTSubject = ktSubjs.some(k => k.subjectCode === subj.code);
        if (!isKTSubject) continue;
      }
      const mergedMap = _meRosterBuildMergedMarks(studentRows, subj, session.id, session.semester);
      const dr = computeDisplayResult(subj, mergedMap);
      if (!dr.pending && (dr.result === 'Fail' || dr.result === 'AB')) {
        unsuccessful = true;
        break;
      }
    }
    result = unsuccessful ? 'unsuccessful' : 'successful';
  }

  return { status, result, pendingSubjects, doneSubjects, lastSession, isKT, totalExpected: subjects.length };
}

function _meRosterLoad() {
  const sessId   = document.getElementById('me-roster-session').value;
  const branch   = document.getElementById('me-roster-branch').value;
  const division = document.getElementById('me-roster-division').value || null;
  const session  = State.getSession(sessId);

  if (!session || !branch) {
    UI.toast('Select session and branch.', 'error'); return;
  }

  UI.showSpinner('Building roster…');

  // Use setTimeout so spinner renders before heavy computation
  setTimeout(() => {
    try {
      let students = State.getEligibleStudents(session, branch);
      if (division) students = students.filter(s => s.division === division);

      if (students.length === 0) {
        UI.hideSpinner();
        document.getElementById('me-roster-output').innerHTML =
          '<div class="empty-state">No eligible students found for this selection.</div>';
        document.getElementById('me-roster-pills').classList.add('hidden');
        return;
      }

      // Build status for each student
      const rows = students.map(s => ({
        student: s,
        ...(_meRosterBuildStudentStatus(s, session)),
      }));

      // Sort: pending → partial → done, then seat↑ / name↑ within group
      const seatEntries = State.getSeatsForSessionWithFallback(session.id);
      const seatLookup  = {};
      for (const s of seatEntries) seatLookup[s.uin] = s.seatNumber;

      const statusOrder  = { pending: 0, partial: 1, done: 2 };
      const resultOrder  = { unsuccessful: 0, successful: 1 };

      rows.sort((a, b) => {
        const sa = seatLookup[a.student.uin] || '';
        const sb = seatLookup[b.student.uin] || '';
        const na = Number(sa), nb = Number(sb);

        if (_rosterSortCol === 'seat') {
          if (!isNaN(na) && !isNaN(nb)) return _rosterSortDir * (na - nb);
          if (sa && !sb) return -1;
          if (!sa && sb) return  1;
          return _rosterSortDir * sa.localeCompare(sb);
        }
        if (_rosterSortCol === 'name')
          return _rosterSortDir * a.student.name.localeCompare(b.student.name);
        if (_rosterSortCol === 'branch')
          return _rosterSortDir * a.student.branch.localeCompare(b.student.branch);
        if (_rosterSortCol === 'batch')
          return _rosterSortDir * a.student.batchYear.localeCompare(b.student.batchYear);
        if (_rosterSortCol === 'type')
          return _rosterSortDir * ((a.isKT ? 1 : 0) - (b.isKT ? 1 : 0));
        if (_rosterSortCol === 'status')
          return _rosterSortDir * ((statusOrder[a.status] ?? 0) - (statusOrder[b.status] ?? 0));
        if (_rosterSortCol === 'result')
          return _rosterSortDir * ((resultOrder[a.result] ?? 2) - (resultOrder[b.result] ?? 2));

        // Default: status order then seat
        const so = statusOrder[a.status] - statusOrder[b.status];
        if (so !== 0) return so;
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        if (sa && !sb) return -1;
        if (!sa && sb) return  1;
        return a.student.name.localeCompare(b.student.name);
      });

      // Count per status
      const counts = { pending: 0, partial: 0, done: 0 };
      rows.forEach(r => counts[r.status]++);

      // Pills
      const pillsEl = document.getElementById('me-roster-pills');
      pillsEl.classList.remove('hidden');
      pillsEl.style.display = 'flex';
      document.getElementById('me-roster-pill-pending').textContent = `🔴 Pending: ${counts.pending}`;
      document.getElementById('me-roster-pill-partial').textContent = `🟡 Partial: ${counts.partial}`;
      document.getElementById('me-roster-pill-done').textContent    = `🟢 Done: ${counts.done}`;
      document.getElementById('me-roster-session-label').textContent = session.name;

      // Save roster state for persistence
      meRosterState = {
        loaded: true,
        sessionId: sessId,
        branch,
        division,
        batchYear: document.getElementById('me-roster-batch')?.value || null,
        rows,
        session,
        seatLookup,
      };

      UI.hideSpinner();
      _meRosterRenderTable(rows, session, seatLookup);
    } catch(err) {
      UI.hideSpinner();
      UI.toast('Error building roster: ' + err.message, 'error', 8000);
      console.error('[_meRosterLoad]', err);
    }
  }, 30);
}

function _meRosterRenderTable(rows, session, seatLookup) {
  const out = document.getElementById('me-roster-output');

  if (rows.length === 0) {
    out.innerHTML = '<div class="empty-state">No students found.</div>';
    return;
  }

  const isFinal = session.entryType === 'Revaluation_Gazette';

  let html = `
    <div style="overflow-x:auto;">
    <table class="roster-table">
      <thead>
        <tr>
          <th style="min-width:52px; cursor:pointer;" onclick="_rosterSort('seat')">Seat ↕</th>
          <th style="min-width:180px; cursor:pointer;" onclick="_rosterSort('name')">Student ↕</th>
          <th style="min-width:80px; cursor:pointer;" onclick="_rosterSort('branch')">Branch ↕</th>
        <th style="min-width:80px; cursor:pointer;" onclick="_rosterSort('batch')">Batch ↕</th>
          <th style="min-width:80px; cursor:pointer;" onclick="_rosterSort('type')">Type ↕</th>
          <th style="min-width:90px; cursor:pointer;" onclick="_rosterSort('status')">Entry Status ↕</th>
          <th style="min-width:100px; cursor:pointer;" onclick="_rosterSort('result')">Result ↕</th>
          <th style="min-width:220px;">Pending Subjects</th>
          <th style="min-width:140px;">Last Session (this sem)</th>
          <th style="min-width:110px;">Action</th>
        </tr>
      </thead>
      <tbody>`;

  for (const { student, status, result, pendingSubjects, lastSession, isKT, totalExpected } of rows) {
    const seat = seatLookup[student.uin] || '—';

    const entryStatusBadge = status === 'done'
      ? '<span class="badge badge-pass">✓ Done</span>'
      : status === 'partial'
        ? '<span class="badge badge-grace">⚡ Partial</span>'
        : '<span class="badge badge-fail">⏳ Pending</span>';

    const resultBadge = result === 'successful'
      ? '<span class="badge badge-pass">✓ Successful</span>'
      : result === 'unsuccessful'
        ? '<span class="badge badge-fail">✗ Unsuccessful</span>'
        : '<span class="muted">—</span>';

    const typeBadge = isKT
      ? '<span class="badge badge-kt">KT</span>'
      : '<span class="badge badge-regular">Regular</span>';

    // Pending subjects cell
    let pendingCell = '';
    if (status === 'done') {
      pendingCell = '<span class="muted" style="font-size:11px;">—</span>';
    } else if (status === 'pending' && !isKT) {
      // Regular student, fully pending — don't list all subjects
      pendingCell = `<span class="roster-all-label">All ${totalExpected} subjects</span>`;
    } else {
      // Partial, or KT pending — show specific subject pills
      pendingCell = pendingSubjects.map(s =>
        `<span class="roster-subj-pill" title="${UI.esc(s.name)}">${UI.esc(s.code)}</span>`
      ).join('');
    }

    // Last session cell
    const lastSessCell = lastSession
      ? `<span style="font-size:11px; font-family:'DM Mono',monospace; color:var(--ink-3);">${UI.esc(lastSession)}</span>`
      : '<span class="muted" style="font-size:11px;">—</span>';

    // Action cell
    const actionCell = status === 'done'
      ? `<button class="btn btn-secondary btn-sm"
           onclick="_pvShowStudentFromRoster('${UI.esc(student.uin)}')">View →</button>`
      : `<button class="btn btn-primary btn-sm"
           onclick="_meRosterOpenAdhoc('${UI.esc(student.uin)}', '${UI.esc(session.id)}')">Enter Marks →</button>`;

    const rowCls = result === 'unsuccessful'
      ? 'roster-row-unsuccessful'
      : result === 'successful'
        ? 'roster-row-successful'
        : `roster-row-${status}`;

    html += `<tr class="${rowCls}">
      <td style="font-family:'DM Mono',monospace; font-weight:600; color:var(--brand); text-align:center;">
        ${UI.esc(seat)}
      </td>
      <td>
        <div style="font-weight:600;">${UI.esc(student.name)}</div>
        <div style="font-size:11px; font-family:'DM Mono',monospace; color:var(--ink-3);">
          ${UI.esc(student.uin)} · ${UI.esc(student.prn || '—')}
        </div>
      </td>
      <td>${UI.esc(student.branch)}</td>
      <td>
        <span style="font-size:12px; font-weight:600; background:var(--brand-light); color:var(--brand);
          border:1px solid #C7D7FF; border-radius:20px; padding:2px 10px; white-space:nowrap;">
          ${UI.esc(student.batchYear)}
        </span>
      </td>
      <td>${typeBadge}</td>
      <td>${entryStatusBadge}</td>
      <td>${resultBadge}</td>
      <td>${pendingCell}</td>
      <td>${lastSessCell}</td>
      <td>${actionCell}</td>
    </tr>`;
  }

  html += `</tbody></table></div>`;
  out.innerHTML = html;
}

let _rosterSortCol = 'seat';
let _rosterSortDir = 1;

function _rosterSort(col) {
  if (_rosterSortCol === col) {
    _rosterSortDir *= -1;
  } else {
    _rosterSortCol = col;
    _rosterSortDir = 1;
  }
  // Re-trigger roster load with current filters
  _meRosterLoad();
}


// ── Open Ad-hoc entry for a specific student + session ─────────
function _meRosterOpenAdhoc(uin, sessionId) {
  const student = State.getStudent(uin);
  const session = State.getSession(sessionId);
  if (!student || !session) return;

  // Switch to adhoc mode WITHOUT resetting (skipInit: true)
  _meSetMode('adhoc', { skipInit: true });

  // Manually set adhoc state
  meAdhocState.student = student;
  meAdhocState.session = session;

  // Update search box to show student name
  document.getElementById('me-adhoc-search').value = student.name;
  document.getElementById('me-adhoc-results').innerHTML = '';

  // Show the auto-session indicator (same as seat-based auto-select)
  _meAdhocShowAutoSession(session, null);

  // Show student info + render grid
  document.getElementById('me-adhoc-student-info').innerHTML =
    _meStudentInfoHtml(student, session);
  document.getElementById('me-adhoc-grid').innerHTML =
    _meBuildSubjectGrid(student, session, 'adhoc');
  _meWireGrid('me-adhoc-grid');

  document.getElementById('me-adhoc-student-panel').classList.remove('hidden');

  // Scroll to top of entry area
  document.getElementById('me-adhoc-student-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── View progress from Roster ──────────────────────────────────
function _pvShowStudentFromRoster(uin) {
  showTab('progress');
  setTimeout(() => _pvShowStudent(uin), 80);
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
  const seatEntries = State.getSeatsForSessionWithFallback(session.id);
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
    const isFinal = session && session.entryType === 'Revaluation_Gazette';
    typeBadge.textContent = isFinal ? '📋 Revaluation Gazette' : '📝 University Portal Gazette';
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
  const isFinal   = session && session.entryType === 'Revaluation_Gazette';

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
    ? `<span class="session-type-inline final-gazette">📋 Revaluation Gazette${prelimSession ? ' · linked to: ' + UI.esc(prelimSession.name) : ' · no preliminary linked'}</span>`
    : `<span class="session-type-inline preliminary">📝 Uni Portal Gazette — all components editable</span>`;

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
              // Try linked prelim first, then fall back to earlier sessions (same semester)
              let prelimVal = prelimEntry ? (prelimEntry[comp.toLowerCase() + 'Marks'] || '') : '';
              if (!prelimVal) {
                const allPriorRows = State.ledger
                  .filter(r =>
                    r.uin === student.uin &&
                    r.subjectCode === subj.code &&
                    Number(r.semester) === session.semester &&
                    r.examSession !== session.id
                  )
                  .sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));
                for (const pr of allPriorRows) {
                  const v = pr[comp.toLowerCase() + 'Marks'];
                  if (v && v !== '') { prelimVal = v; }
                }
              }
              html += `<td class="cell-locked"><span class="locked-val">${UI.esc(prelimVal || '—')}</span></td>`;
          } else {
            // ESE: determine if editable (failed/AB in linked prelim) or locked (passed or no entry)
            const existingFinalESE = prevEntry ? (prevEntry.eseMarks || '') : '';
            const prelimESE        = prelimEntry ? (prelimEntry.eseMarks || '') : '';
            const eseMax           = subj.marks[comp];

            if (prelimEntry && prelimESE) {
              // Student sat this subject in linked prelim — check component-level pass
              const parsed = parseMarkValue(prelimESE, eseMax);
              const esePassed = parsed.valid && !parsed.absent &&
                (parsed.grace || (parsed.value / eseMax >= 0.40));
              if (esePassed) {
                // Passed ESE in linked prelim — lock it
                html += `<td class="cell-locked"><span class="locked-val">${UI.esc(existingFinalESE || prelimESE)}</span></td>`;
              } else {
                // Failed/AB ESE in linked prelim — editable
                const defaultVal = existingFinalESE || prelimESE;
                html += `<td>
                  <input type="text"
                    class="mark-input${defaultVal ? ' cell-prefilled' : ''}"
                    id="cell-${UI.esc(student.uin)}-${UI.esc(subj.code)}-${comp}"
                    data-uin="${UI.esc(student.uin)}"
                    data-code="${UI.esc(subj.code)}"
                    data-comp="${comp}"
                    data-max="${eseMax}"
                    data-prelim-ese="${UI.esc(prelimESE)}"
                    value="${UI.esc(defaultVal)}"
                    autocomplete="off" spellcheck="false"
                  >
                </td>`;
              }
            } else {
              // No entry in linked prelim — carry from earlier sessions, lock it
              let carriedESE = existingFinalESE;
              if (!carriedESE) {
                const allPriorRows = State.ledger
                  .filter(r =>
                    r.uin === student.uin &&
                    r.subjectCode === subj.code &&
                    Number(r.semester) === session.semester &&
                    r.examSession !== session.id
                  )
                  .sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));
                for (const pr of allPriorRows) {
                  if (pr.eseMarks && pr.eseMarks !== '') { carriedESE = pr.eseMarks; }
                }
              }
              html += `<td class="cell-locked"><span class="locked-val">${UI.esc(carriedESE || '—')}</span></td>`;
            }
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

  const isFinal = session && session.entryType === 'Revaluation_Gazette';

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
  const seatEntries = State.getSeatsForSessionWithFallback(session.id);
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

  if (searchInput._pvBound) return; // already wired — don't add duplicate listener
  searchInput._pvBound = true;

  searchInput.addEventListener('input', _debounce(() => {
    const q = searchInput.value.trim();
    if (q.length < 2) { resultsBox.innerHTML = ''; return; }

    let students;
    const ql = q.toLowerCase();
    if (ql === 'reval') {
      // Find students who have any Final Gazette ESE that differs from their Preliminary ESE
      const revalUINs = new Set();
      for (const sess of State.getSessions()) {
        if (sess.entryType !== 'Revaluation_Gazette' || !sess.linkedPrelimSessionId) continue;
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

    resultsBox.style.display = 'block';
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
  const data = State.getKTData(uin);
  const subj = data?.subjects.find(s => s.subjectCode === subjectCode);

  // Resolve the preliminary session id for this sessionId
  // (if sessionId is a gazette, its tag is stored under both gazette+prelim ids)
  let tag = subj?.attemptTags?.[sessionId] || null;

  // Fallback: if not found in cache (e.g. older session before cache),
  // try linked preliminary session id
  if (!tag) {
    const sess = State.getSession(sessionId);
    if (sess?.linkedPrelimSessionId) {
      tag = subj?.attemptTags?.[sess.linkedPrelimSessionId] || null;
    }
  }

  // Final fallback to old computeAttemptTag
  if (!tag) tag = State.computeAttemptTag(uin, subjectCode, sessionId);

  if (!tag) return '<span class="badge badge-pending">—</span>';

  const cls = tag.startsWith('Unsuccessful') ? 'badge-fail'
            : tag.includes('after Reval')    ? 'badge-reval'
            : tag.includes('Marks Reval')    ? 'badge-reval'
            : 'badge-pass';
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
  try {
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

  // Default to latest Preliminary; Gazette remains selectable but not the default
  function _latestPrelim(list) {
    if (!list.length) return null;
    const prelims = list.filter(s => s.entryType !== 'Revaluation_Gazette');
    return prelims.length
      ? prelims[prelims.length - 1].id
      : list[list.length - 1].id;
  }
  // Default to Final Gazette if present (merged/final marks); else latest Prelim/KT
  function _defaultSession(list) {
    if (!list.length) return null;
    const _score = s => {
      const year  = Number((s.name || '').slice(0, 4));
      const month = (s.name || '').includes('May') ? 5 : 12;
      const typeBonus = s.entryType === 'Revaluation_Gazette' ? 1 : 0;
      return (year * 12 + month) * 2 + typeBonus;
    };
    return [...list].sort((a, b) => _score(b) - _score(a))[0].id;
  }
  const selectedSessId = {
    1: _defaultSession(semSessions[1]),
    2: _defaultSession(semSessions[2]),
  };

  // ── Render helper: one semester table ─────────────────────────
  function _pvRenderSemTable(sem) {
    const sessions  = semSessions[sem];
    const sessId    = selectedSessId[sem];
    const sess      = sessId ? sessionMap[sessId] : null;
    const acadSess  = academics?.sessionResults.find(sr => sr.session.id === sessId);
    // For Final Gazette: also get the linked Prelim acadSess for full subject list
    const prelimAcadSess = (sess?.entryType === 'Revaluation_Gazette' && sess.linkedPrelimSessionId)
      ? academics?.sessionResults.find(sr => sr.session.id === sess.linkedPrelimSessionId)
      : null;

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
      sessionBadge = `<span class="pv-session-badge pv-session-success">🎉 Successful in Regular Attempt</span>`;
    } else if (sessionStatus === 'pending') {
      sessionBadge = `<span class="pv-session-badge pv-session-pending">⏳ Pending</span>`;
    }
    const pendingNote = acadSess?.pendingCount > 0
      ? `<span class="pv-pending-note">${acadSess.pendingCount} subject${acadSess.pendingCount > 1 ? 's' : ''} pending</span>`
      : '';
    const isFinal = sess?.entryType === 'Revaluation_Gazette';

    // Subject rows
    let rowsHtml = '';
    let footerTotalMarks = 0, footerGxC = 0, footerCredits = 0, footerHasTotal = false;

    if (!sess) {
      rowsHtml = `<tr><td colspan="14" class="muted" style="text-align:center;padding:16px;">No records yet.</td></tr>`;
    } else {
      // When Gazette is selected: use Prelim subject list as base (full list),
      // overlay Gazette entries (merged marks + revalMap) where they exist
      let displaySubjects = [];
      if (acadSess && prelimAcadSess) {
        // Build gazette subject lookup by subjectCode
        const gazMap = {};
        for (const s of acadSess.subjects) gazMap[s.r.subjectCode] = s;
        // Start from prelim full list, substitute gazette entry where present
        displaySubjects = prelimAcadSess.subjects.map(s =>
          gazMap[s.r.subjectCode] || s
        );
      } else {
        displaySubjects = acadSess ? acadSess.subjects : [];
      }

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
          const isReval   = (subjEntry.revalMap || {})[comp] === true;
          const revalPill = isReval ? '<span class="reval-pill">Reval</span>' : '';
          if (!maxMark) return `<td class="muted">—</td>`;
          if (showPerComp) {
            return `<td class="pv-comp-cell">${UI.esc(val)}${isCarried ? '<sup class="carried-mark">+</sup>' : ''}${revalPill} ${_pvMarkTag(val === '—' ? null : val, maxMark)}</td>`;
          }
          return `<td>${UI.esc(val)}${isCarried ? '<sup class="carried-mark">+</sup>' : ''}${revalPill}</td>`;
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
          ${isFinal ? '<span class="session-type-inline final-gazette">Revaluation Gazette</span>' : ''}
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
  } catch(e) {
    document.getElementById('pv-timeline').innerHTML =
      `<div style="color:red;padding:16px;font-size:12px;font-family:monospace;">
        ERROR: ${e.message}<br><pre>${e.stack}</pre>
      </div>`;
    console.error('[_pvShowStudent]', e);
  }
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
  let studentCount = 0;
  let componentCount = 0;
  for (const student of students) {
    const data = State.getKTData(student.uin);
    if (!data) continue;
    if (data.activeKTCount > 0) {
      studentCount++;
      componentCount += data.activeKTCount;
    }
  }
  document.getElementById('dash-kt-count').textContent = studentCount;
  document.getElementById('dash-kt-sub').textContent   =
    `students with active KT · ${componentCount} component${componentCount !== 1 ? 's' : ''} failing`;
}

function _dashBranchPassRates() {
  const el       = document.getElementById('dash-branch-pass');
  const students = State.getStudents();
  const years    = State.getBatchYears();

  const selHtml = `
    <select id="dash-branch-session" class="dash-filter-select" style="margin-bottom:12px;">
      <option value="">— Overall —</option>
      ${years.map(y => `<option value="${UI.esc(y)}">${UI.esc(y)}</option>`).join('')}
    </select>`;

  el.innerHTML = selHtml + `<div id="dash-branch-rows"></div>`;

  function _render() {
    const batchYear = document.getElementById('dash-branch-session').value;
    const rowsEl    = document.getElementById('dash-branch-rows');
    let   html      = '';

    for (const branch of BRANCHES) {
      const branchStudents = students.filter(s =>
        s.branch === branch &&
        (!batchYear || s.batchYear === batchYear)
      );
      if (!branchStudents.length) continue;

      const appeared = branchStudents.filter(s =>
        State.ledger.some(r => r.uin === s.uin)
      );
      if (!appeared.length) continue;

      const passed = appeared.filter(student => {
        const data = State.getKTData(student.uin);
        return data && data.activeKTCount === 0;
      }).length;

      const pct   = Math.round(passed / appeared.length * 100);
      const color = pct >= 80 ? 'var(--pass)' : pct >= 60 ? 'var(--kt)' : 'var(--fail)';
      html += `
        <div class="dash-branch-row">
          <span>${UI.esc(branch)}</span>
          <span class="dash-pass-pct" style="color:${color}">${pct}% <small>(${passed}/${appeared.length})</small></span>
        </div>`;
    }
    rowsEl.innerHTML = html || '<div class="muted">No data for selected batch year.</div>';
  }

  _render();
  document.getElementById('dash-branch-session').addEventListener('change', _render);
}

function _dashInitHeatmap() {
  const sel   = document.getElementById('dash-heatmap-session');
  const years = State.getBatchYears();
  sel.innerHTML = '<option value="">— all batches —</option>' +
    years.map(y => `<option value="${UI.esc(y)}">${UI.esc(y)}</option>`).join('');
  sel.addEventListener('change', _dashRenderHeatmap);
  _dashRenderHeatmap();
}

function _dashRenderHeatmap() {
  const batchYear = document.getElementById('dash-heatmap-session').value;
  const el        = document.getElementById('dash-heatmap');
  const students  = State.getStudents({ batchYear: batchYear || undefined });

  function _heatColor(pct) {
    if (pct == null) return 'var(--surface-2)';
    if (pct >= 90)   return '#D1FAE5';
    if (pct >= 75)   return '#FEF9C3';
    if (pct >= 60)   return '#FED7AA';
    return '#FEE2E2';
  }
  function _heatTextColor(pct) {
    if (pct == null) return 'var(--ink-4)';
    if (pct >= 75)   return '#065F46';
    if (pct >= 60)   return '#92400E';
    return '#991B1B';
  }

  function _computePassRates(subjects, sem) {
    return subjects.map(subj => {
      let pass = 0, total = 0;
      for (const student of students) {
        const rows = State.ledger.filter(r =>
          r.uin === student.uin &&
          r.subjectCode === subj.code &&
          String(r.semester) === String(sem)
        );
        if (!rows.length) continue;
        const latest = rows.sort((a, b) => b.entryDateTime.localeCompare(a.entryDateTime))[0];
        total++;
        if (latest.result === 'Pass') pass++;
      }
      const pct = total > 0 ? Math.round(pass / total * 100) : null;
      return { subj, pass, total, pct };
    }).filter(d => d.total > 0)
      .sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101));
  }

  function _renderGrid(passRates) {
    if (!passRates.length) return '<div class="muted" style="font-size:12px;">No data.</div>';
    return `<div class="dash-heatmap-grid">` +
      passRates.map(({ subj, pct, pass, total }) => `
        <div class="dash-heatmap-cell" style="background:${_heatColor(pct)}; color:${_heatTextColor(pct)}">
          <span class="dash-heatmap-subj">${UI.esc(subj.code)}</span>
          <span style="font-size:10px; color:inherit; opacity:0.75;">${UI.esc(subj.name)}</span>
          <span class="dash-heatmap-pct">${pct != null ? pct + '%' : '—'}</span>
          <span style="font-size:10px;">${pass}/${total} passed</span>
        </div>`
      ).join('') +
    `</div>`;
  }

  // Sem I — canonical subject list
  const sem1Rates = _computePassRates(SEM1_SUBJECTS, 1);

  // Sem II — derive unique subjects from ledger
  const sem2SubjectMap = {};
  for (const r of State.ledger) {
    if (String(r.semester) !== '2') continue;
    if (!sem2SubjectMap[r.subjectCode]) {
      sem2SubjectMap[r.subjectCode] = { code: r.subjectCode, name: r.subjectName };
    }
  }
  const sem2Subjects = Object.values(sem2SubjectMap);
  const sem2Rates    = _computePassRates(sem2Subjects, 2);

  const semHeader = (label) => `
    <div style="grid-column:1/-1; font-size:11px; font-weight:700; color:var(--ink-3);
                text-transform:uppercase; letter-spacing:.04em; padding:10px 0 4px;">
      ${label}
    </div>`;

  el.innerHTML = `
    <div class="dash-heatmap-grid">
      ${semHeader('Semester I')}
    </div>
    ${_renderGrid(sem1Rates)}
    <div class="dash-heatmap-grid" style="margin-top:8px;">
      ${semHeader('Semester II')}
    </div>
    ${_renderGrid(sem2Rates)}
  `;

  if (!sem1Rates.length && !sem2Rates.length) {
    el.innerHTML = '<div class="muted">No data for selected batch year.</div>';
  }
}


function initReports() {
  if (document.getElementById('tab-reports')._inited) return;
  document.getElementById('tab-reports')._inited = true;
  const sessions = sortSessions(State.getSessions());
  const subjects = State.getAllSubjects();

  // ── Shared filters ────────────────────────────────────────
  const allSessionYears = [...new Set(sessions.map(s => Number(s.name.slice(0,4))))].sort((a,b) => b-a);
  const yearEl = document.getElementById('rpt-year');
  yearEl.innerHTML = '<option value="">— all —</option>' +
    allSessionYears.map(y => `<option value="${y}">${y}</option>`).join('');
    UI.buildSelect('rpt-shared-branch', BRANCHES, '— all branches —');

  // Fire all three blocks on shared filter change
  const sharedIds = ['rpt-year','rpt-month','rpt-semester','rpt-shared-branch','rpt-shared-gender'];
  sharedIds.forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      _rptLiveResultSummary();
      _rptLiveRevalImpact();
      _rptLiveToppers();
    });
  });

  // ── Result Summary ────────────────────────────────────────
  const years = State.getBatchYears();
  UI.buildSelect('rpt-batch', years, '— all years —');
  const subjEl = document.getElementById('rpt-subject');
  subjEl.innerHTML = '<option value="">— all subjects —</option>' +
    subjects.map(s => `<option value="${UI.esc(s.code)}">${UI.esc(s.code)} — ${UI.esc(s.name)}</option>`).join('');
  ['rpt-batch','rpt-subject','rpt-component'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', _rptLiveResultSummary);
  });
  _rptLiveResultSummary();

  // ── Reval Impact ──────────────────────────────────────────
  UI.buildSelect('rpt-reval-subject', subjects, '— all subjects —', 'code', 'name');
  document.getElementById('rpt-reval-subject')?.addEventListener('change', _rptLiveRevalImpact);
  _rptLiveRevalImpact();

  // ── Topper List ───────────────────────────────────────────
  UI.buildSelect('rpt-topper-subject', subjects, '— all subjects —', 'code', 'name');
  UI.buildSelect('rpt-topper-batch', State.getBatchYears(), '— all —');
  UI.buildSelect('rpt-topper-branch', BRANCHES, '— all branches —');
  document.getElementById('rpt-topper-mode').onchange = _rptToggleTopperMode;
  _rptToggleTopperMode();
  ['rpt-topper-mode','rpt-topper-subject','rpt-topper-n','rpt-topper-batch','rpt-topper-branch'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', _rptLiveToppers);
    document.getElementById(id)?.addEventListener('input', _rptLiveToppers);
  });
  document.querySelectorAll('.topper-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _topperActiveTab = btn.dataset.tab;
      document.querySelectorAll('.topper-tab-btn').forEach(b => {
        b.style.color        = 'var(--ink-3)';
        b.style.fontWeight   = '500';
        b.style.borderBottom = '2px solid transparent';
      });
      btn.style.color        = 'var(--brand)';
      btn.style.fontWeight   = '600';
      btn.style.borderBottom = '2px solid var(--brand)';
      _rptLiveToppers();
    });
  });

  // Populate per-card session selects
  UI.buildSelect('rpt-my-session', sessions, '— all sessions —', 'id', 'name');

  // Shared eligibility branch dropdown
  UI.buildSelect('rpt-elig-branch', BRANCHES, '— all branches —');

  // Export buttons — top 3 blocks
  document.getElementById('rpt-result-summary-csv').onclick = _rptExportResultSummary;
  document.getElementById('rpt-reval-impact-csv').onclick   = _rptExportRevalImpact;
  document.getElementById('rpt-toppers-csv').onclick        = _rptExportToppers;

  // Student Eligibility Checks — Run + Export wiring
  document.getElementById('rpt-credit-run').onclick         = _rptCreditFilterRun;
  document.getElementById('rpt-credit-csv').onclick         = _rptCreditFilterExport;
  document.getElementById('rpt-total-credit-run').onclick   = _rptTotalCreditFilterRun;
  document.getElementById('rpt-total-credit-csv').onclick   = _rptTotalCreditFilterExport;
  document.getElementById('rpt-kt-run').onclick             = _rptKTFilterRun;
  document.getElementById('rpt-kt-csv').onclick             = _rptKTFilterExport;
  const myEntriesBtn = document.getElementById('rpt-my-entries');
  if (myEntriesBtn) myEntriesBtn.onclick = _rptMyEntries;

  document.getElementById('rpt-elig-download-all')?.addEventListener('click', _eligDownloadAll);

  // Batch comparison
  const bcYears = State.getBatchYears();
  UI.buildSelect('rpt-bc-batch-a', bcYears, '— select —');
  UI.buildSelect('rpt-bc-batch-b', bcYears, '— select —');
  UI.buildSelect('rpt-bc-branch',  BRANCHES, '— all branches —');
  document.getElementById('rpt-bc-batch-a').addEventListener('change', () => _bcPopulateSessions('a'));
  document.getElementById('rpt-bc-batch-b').addEventListener('change', () => _bcPopulateSessions('b'));
  // Cross-check: show warning if same session selected on both sides
  ['rpt-bc-session-a','rpt-bc-session-b'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', _bcCheckSameSession);
  });
  document.getElementById('rpt-bc-run').onclick = _rptBatchCompare;
  document.getElementById('rpt-bc-csv').onclick = _rptBatchCompareCsv;

  // Active KT Drill-down — populate subject dropdown from all known subjects
  _aktdPopulateSubjects();
  _aktdPopulateBatchYears();
  ['rpt-aktd-subject','rpt-aktd-component','rpt-aktd-batch','rpt-aktd-division'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', _aktdClearOutput);
  });
  document.getElementById('rpt-aktd-run').onclick  = _aktdRun;
  document.getElementById('rpt-aktd-csv').onclick  = _aktdExportCSV;

  // Cleared in N Attempts
  _ciaPopulateSubjects();
  _ciaPopulateBatchYears();
  ['rpt-cia-subject','rpt-cia-attempts','rpt-cia-batch','rpt-cia-division'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', _ciaClearOutput);
  });
  document.getElementById('rpt-cia-run').onclick = _ciaRun;
  document.getElementById('rpt-cia-csv').onclick = _ciaExportCSV;
}


// ── Batch Comparison ──────────────────────────────────────────
function _bcPopulateSessions(side) {
  const batchYear = document.getElementById(`rpt-bc-batch-${side}`).value;
  const semFilter = document.getElementById('rpt-bc-semester')?.value || '';
  const sessions  = sortSessions(State.getSessions().filter(s => {
    if (batchYear) {
      const year  = Number(s.name.slice(0, 4));
      const month = s.name.includes('May') ? 5 : 12;
      const score = year * 12 + month;
      const batch = Number(batchYear);
      const semStart = s.semester === 1
        ? batch * 12 + 12          // Sem I: Dec of batch year
        : (batch + 1) * 12 + 5;   // Sem II: May of following year
      if (score < semStart) return false;
    }
    if (semFilter && String(s.semester) !== semFilter) return false;
    return true;
  }));
  const el   = document.getElementById(`rpt-bc-session-${side}`);
  const hint = document.getElementById(`bc-hint-${side}`);
  if (!batchYear) {
    el.innerHTML = '<option value="">— select batch first —</option>';
    if (hint) hint.textContent = 'Select a batch year to load sessions';
    return;
  }
  el.innerHTML = '<option value="">— select session —</option>' +
    sessions.map(s => `<option value="${UI.esc(s.id)}">${UI.esc(s.name)}</option>`).join('');
  if (hint) hint.textContent = sessions.length
    ? `${sessions.length} session${sessions.length > 1 ? 's' : ''} available`
    : 'No sessions found for this batch';
  _bcCheckSameSession();
}

function _bcCheckSameSession() {
  const aId = document.getElementById('rpt-bc-session-a')?.value;
  const bId = document.getElementById('rpt-bc-session-b')?.value;
  const warn = document.getElementById('bc-same-warning');
  if (!warn) return;
  warn.style.display = (aId && bId && aId === bId) ? '' : 'none';
}

function _bcSwapBatches() {
  const batchA   = document.getElementById('rpt-bc-batch-a');
  const batchB   = document.getElementById('rpt-bc-batch-b');
  const sessA    = document.getElementById('rpt-bc-session-a');
  const sessB    = document.getElementById('rpt-bc-session-b');

  // Swap batch year values
  const tmpBatch = batchA.value;
  batchA.value   = batchB.value;
  batchB.value   = tmpBatch;

  // Repopulate session dropdowns for new batch values, then restore session selections
  const tmpSessAVal = sessA.value;
  const tmpSessBVal = sessB.value;

  _bcPopulateSessions('a');
  _bcPopulateSessions('b');

  // Restore session selections (they may still be valid after swap)
  sessA.value = tmpSessBVal;
  sessB.value = tmpSessAVal;

  _bcCheckSameSession();
  UI.toast('Batches swapped.', 'info', 1800);
}

function _bcGetData(batchYear, sessionId, branch, semesterOverride) {
  // Returns { students, sessionResults } for the given batch+session+branch
  let students = State.getStudents({ branch: branch || undefined });
  if (batchYear) students = students.filter(s => s.batchYear === batchYear);

  const sess = sessionId ? State.getSession(sessionId) : null;
  const sem  = semesterOverride ? Number(semesterOverride) : (sess?.semester || 1);

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
  const semester = document.getElementById('rpt-bc-semester')?.value || '';
  const output   = document.getElementById('rpt-bc-output');

  if (!sessAId || !sessBId) {
    UI.toast('Please select sessions for both batches.', 'error'); return;
  }
  if (sessAId === sessBId) {
    UI.toast('Both sides point to the same session — please select different sessions.', 'error', 5000);
    return;
  }

  const A = _bcGetData(batchA, sessAId, branch, semester);
  const B = _bcGetData(batchB, sessBId, branch, semester);

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
function _rptGetSharedExamGroup() {
  const year     = document.getElementById('rpt-year').value     || null;
  const month    = document.getElementById('rpt-month').value    || null;
  const semester = document.getElementById('rpt-semester').value || null;
  if (!year || !month || !semester) return null;
  const allSessions = State.getSessions();
  const mo     = month === 'December' ? 'Dec' : 'May';
  const sem    = semester === '1' ? 'Sem-I' : 'Sem-II';
  const prefix = `${year}_${mo}_${sem}_`;
  const prelim  = allSessions.find(s => s.name === prefix + 'Uni-Portal-Gazette');
  const gazette = allSessions.find(s => s.name === prefix + 'Revaluation-Gazette');
  if (!prelim) return null;
  return {
    prelimSessionId:  prelim.id,
    gazetteSessionId: (gazette?.linkedPrelimSessionId === prelim.id ? gazette.id : null),
  };
}

function _rptGetSummaryFilters() {
  return {
    year:        document.getElementById('rpt-year').value      || null,
    month:       document.getElementById('rpt-month').value     || null,
    semester:    document.getElementById('rpt-semester').value  || null,
    branch:      document.getElementById('rpt-shared-branch').value || null,
    batchYear:   document.getElementById('rpt-batch').value     || null,
    subjectCode: document.getElementById('rpt-subject').value   || null,
    component:   document.getElementById('rpt-component').value || null,
    gender:      document.getElementById('rpt-shared-gender').value || null,
  };
}

function _rptExportKTBucket(ktCount, students) {
  const label  = ktCount === 0 ? '0_KT_AllClear' : `${ktCount}_KT`;
  const header = ['PRN','UIN','Name','Branch','KT Subjects'];
  const rows   = students.map(s => [
    s.prn, s.uin, s.name, s.branch,
    s.ktSubjects.map(k => k.subjectCode).join(', ') || '—',
  ]);
  UI.downloadCSV(`KT_Distribution_${label}.csv`, [header, ...rows]);
}

function _rptRenderKTStrip(distribution, { prelimSessionId, gazetteSessionId, branch, batchYear, gender }) {
  const strip = document.getElementById('rpt-kt-strip');
  if (!strip) return;
  if (!distribution || distribution.length === 0) { strip.style.display = 'none'; return; }

  let activeKey = null; // which bucket is expanded

  function render() {
    const pills = distribution.map(({ ktCount, students }) => {
      const label  = ktCount === 0 ? '0 KT — All Clear' : `${ktCount} KT${ktCount > 1 ? 's' : ''}`;
      const isOpen = activeKey === ktCount;
      const color  = ktCount === 0 ? 'var(--pass)' : ktCount <= 2 ? 'var(--grace)' : 'var(--fail)';
      return `<button class="kt-pill${isOpen ? ' kt-pill-open' : ''}" data-kt="${ktCount}"
        style="border-color:${color};color:${color};">
        ${UI.esc(label)}: <strong>${students.length}</strong> ${isOpen ? '▲' : '▼'}
      </button>`;
    }).join('');

    const openBucket = activeKey !== null ? distribution.find(b => b.ktCount === activeKey) : null;
    let detail = '';
    if (openBucket) {
      const { ktCount, students } = openBucket;
      const heading = ktCount === 0 ? 'All Clear Students' : `${ktCount} KT${ktCount > 1 ? 's' : ''} — ${students.length} Student${students.length > 1 ? 's' : ''}`;
      const rows = students.map(s => `<tr>
        <td>${UI.esc(s.prn)}</td>
        <td><span class="subj-code-small">${UI.esc(s.uin)}</span></td>
        <td>${UI.esc(s.name)}</td>
        <td>${UI.esc(s.branch)}</td>
        <td>${ktCount === 0 ? '—' : s.ktSubjects.map(k =>
  `<span class="subj-code-small">${UI.esc(k.subjectCode)}</span> ${UI.esc(k.subjectName)}`).join('<br>')}</td>
      </tr>`).join('');
      detail = `<div class="kt-detail-wrap">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <span style="font-weight:600;font-size:13px;">${UI.esc(heading)}</span>
          <button class="btn btn-secondary btn-sm" id="kt-export-btn">⬇ Export CSV</button>
        </div>
        <div class="report-table-wrap" style="max-height:320px;overflow-y:auto;">
          <table class="report-table">
            <thead><tr><th>PRN</th><th>UIN</th><th>Name</th><th>Branch</th><th>KT Subjects</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
    }

    strip.style.display = '';
    strip.innerHTML = `<div class="kt-pill-row">${pills}</div>${detail}`;

    // Wire pill clicks
    strip.querySelectorAll('.kt-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = Number(btn.dataset.kt);
        activeKey = activeKey === k ? null : k; // toggle
        render();
      });
    });

    // Wire export
    const exportBtn = strip.querySelector('#kt-export-btn');
    if (exportBtn && openBucket) {
      exportBtn.addEventListener('click', () => _rptExportKTBucket(openBucket.ktCount, openBucket.students));
    }
  }

  render();
}

function _rptLiveResultSummary() {
  const filters = _rptGetSummaryFilters();
  const tbody   = document.getElementById('rpt-summary-tbody');
  const banner  = document.getElementById('rpt-summary-banner');
  if (!tbody) return;

  // ── Resolve Prelim + Gazette session pair from year/month/semester ──
  const { year, month, semester } = filters;
  let prelimSessionId  = null;
  let gazetteSessionId = null;
  let bannerMode       = 'no-filter'; // 'no-filter'|'no-data'|'prelim-only'|'merged'

  if (year && month && semester) {
    const allSessions = State.getSessions();
    // Match sessions by name pattern: "YYYY_Mon_Sem-N_*"
    const mo  = month === 'December' ? 'Dec' : 'May';
    const sem = semester === '1' ? 'Sem-I' : 'Sem-II';
    const prefix = `${year}_${mo}_${sem}_`;

    const prelim  = allSessions.find(s => s.name === prefix + 'Uni-Portal-Gazette');
    const gazette = allSessions.find(s => s.name === prefix + 'Revaluation-Gazette');

    if (!prelim && !gazette) {
      bannerMode = 'no-data';
    } else if (prelim && gazette && gazette.linkedPrelimSessionId === prelim.id) {
      prelimSessionId  = prelim.id;
      gazetteSessionId = gazette.id;
      bannerMode = 'merged';
    } else if (prelim) {
      prelimSessionId = prelim.id;
      bannerMode = gazette ? 'unlinked' : 'prelim-only';
    }
  }

  // ── Banner ────────────────────────────────────────────────
  const bannerStyles = {
    'no-filter':  null,
    'no-data':    { bg: 'var(--fail-bg)',   color: 'var(--fail)',  text: 'No sessions found for this combination.' },
    'prelim-only':{ bg: 'var(--grace-bg)',  color: 'var(--grace)', text: '⏳ Revaluation_Gazette results awaited — showing Uni-Portal-Gazette results only.' },
    'unlinked':   { bg: 'var(--grace-bg)',  color: 'var(--grace)', text: '⏳ A Revaluation_Gazette exists but is not linked to this Uni-Portal-Gazette — showing Uni-Portal-Gazette results only.' },
    'merged':     { bg: 'var(--pass-bg)',   color: 'var(--pass)',  text: '✓ Revaluation_Gazette results included — table reflects Final Gazette outcomes.' },
  };
  const bs = bannerStyles[bannerMode];
  if (bs) {
    banner.style.display     = '';
    banner.style.background  = bs.bg;
    banner.style.color       = bs.color;
    banner.textContent       = bs.text;
  } else {
    banner.style.display = 'none';
  }

  // ── No session resolved → show prompt ────────────────────
  if (!prelimSessionId) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--ink-4);padding:12px;">Select Year, Month and Semester to view results.</td></tr>';
    return;
  }

  // ── Fetch data ────────────────────────────────────────────
  const data = State.reportResultSummary({
    prelimSessionId,
    gazetteSessionId,
    branch:      filters.branch      || undefined,
    batchYear:   filters.batchYear   || undefined,
    subjectCode: filters.subjectCode || undefined,
    gender:      filters.gender      || undefined,
  });

  const comp = filters.component;

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--ink-4);padding:12px;">No data for this filter.</td></tr>';
    document.getElementById('rpt-kt-strip').style.display = 'none';
    return;
  }

  // ── KT Distribution strip ─────────────────────────────────
  // Only meaningful when no subject filter is active (KT count = across all subjects)
  if (!filters.subjectCode) {
    const ktDist = State.reportKTDistribution({
      prelimSessionId,
      gazetteSessionId,
      branch:    filters.branch    || undefined,
      batchYear: filters.batchYear || undefined,
      gender:    filters.gender    || undefined,
    });
    _rptRenderKTStrip(ktDist, { prelimSessionId, gazetteSessionId });
  } else {
    document.getElementById('rpt-kt-strip').style.display = 'none';
  }

  tbody.innerHTML = data.map(d => {
    const passPct = Math.round(d.passRate * 100);
    const fmtAvg  = (v) => v != null ? v.toFixed(1) : '—';
    const avgCell = comp === 'IAT'  ? fmtAvg(d.avgMarks.IAT)
                  : comp === 'ESE'  ? fmtAvg(d.avgMarks.ESE)
                  : comp === 'TW'   ? fmtAvg(d.avgMarks.TW)
                  : comp === 'Oral' ? fmtAvg(d.avgMarks.Oral)
                  : '—';

    // Reval tag — only shown when gazette is merged and at least 1 student cleared via reval
    const revalTag = (gazetteSessionId && d.revalPass > 0)
      ? `<br><small style="color:var(--reval);font-weight:500;">${d.revalPass} via reval</small>`
      : '';

    return `<tr>
      <td><span class="subj-code-small">${UI.esc(d.code)}</span></td>
      <td>${UI.esc(d.name)}</td>
      <td>${d.total}</td>
      <td style="color:var(--pass);font-weight:600;">${d.pass}${revalTag}</td>
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
  const filters  = _rptGetSummaryFilters();
  const { year, month, semester } = filters;

  // Resolve session pair (same logic as _rptLiveResultSummary)
  let prelimSessionId  = null;
  let gazetteSessionId = null;
  if (year && month && semester) {
    const mo     = month === 'December' ? 'Dec' : 'May';
    const sem    = semester === '1' ? 'Sem-I' : 'Sem-II';
    const prefix = `${year}_${mo}_${sem}_`;
    const all    = State.getSessions();
    const prelim  = all.find(s => s.name === prefix + 'Uni-Portal-Gazette');
    const gazette = all.find(s => s.name === prefix + 'Revaluation-Gazette');
    if (prelim) prelimSessionId = prelim.id;
    if (prelim && gazette && gazette.linkedPrelimSessionId === prelim.id) gazetteSessionId = gazette.id;
  }

  if (!prelimSessionId) { UI.toast('Select Year, Month and Semester first.', 'error'); return; }

  const data = State.reportResultSummary({
    prelimSessionId,
    gazetteSessionId,
    branch:      filters.branch      || undefined,
    batchYear:   filters.batchYear   || undefined,
    subjectCode: filters.subjectCode || undefined,
    gender:      filters.gender      || undefined,
  });

  UI.exportCSV(`ResultSummary`,
    ['Subject Code','Subject Name','Total','Pass','Via Reval','Fail','AB','Pass %','Avg IAT','Avg ESE','Avg TW','Avg Oral'],
    data.map(d => [d.code, d.name, d.total, d.pass, d.revalPass || 0, d.fail, d.ab,
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
  const group = _rptGetSharedExamGroup();
  return {
    gazetteSessionId: group?.gazetteSessionId || null,
    branch:           document.getElementById('rpt-shared-branch').value  || null,
    subjectCode:      document.getElementById('rpt-reval-subject').value  || null,
  };
}

// ── Reval Impact state ────────────────────────────────────
let _revalData        = [];   // full result from State
let _revalSortCol     = 'change';
let _revalSortDir     = 1;    // 1 = asc, -1 = desc
let _revalDirFilter   = 'all';
let _topperActiveTab  = 'sem1';

function _rptLiveRevalImpact() {
  const filters = _rptGetRevalFilters();
  _revalData    = State.reportRevalImpact(filters);
  _revalDirFilter = 'all';
  _revalSortCol   = 'change';
  _revalSortDir   = 1;
  _revalRender();
}

function _revalRender() {
  const wrap = document.getElementById('rpt-reval-wrap');
  if (!wrap) return;

  // ── Summary counts ────────────────────────────────────
  const total     = _revalData.length;
  const improved  = _revalData.filter(d => d.direction === 'improved').length;
  const worsened  = _revalData.filter(d => d.direction === 'worsened').length;
  const unchanged = total - improved - worsened;

  // ── Direction filter ──────────────────────────────────
  const filterPills = [
    { key: 'all',          label: `All (${total})` },
    { key: 'improved',     label: `↑ Improved (${improved})` },
    { key: 'worsened',     label: `⚠ Worsened (${worsened})` },
    { key: 'fail-to-fail', label: `Fail → Fail` },
    { key: 'pass-to-pass', label: `Pass → Pass` },
  ];

  const pillsHtml = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
      ${filterPills.map(p => `
        <button class="col-pill${_revalDirFilter === p.key ? ' active' : ''}"
          onclick="_revalSetFilter('${p.key}')">${UI.esc(p.label)}</button>
      `).join('')}
    </div>`;

  const summaryHtml = `
    <div style="font-size:12px;color:var(--ink-3);margin-bottom:8px;">
      <strong>${total}</strong> students revaluated ·
      <span style="color:var(--pass);font-weight:600;">${improved} improved</span> ·
      <span style="color:var(--fail);font-weight:600;">${worsened} worsened</span> ·
      <span style="color:var(--ink-3);">${unchanged} result unchanged</span>
    </div>`;

  // ── Filter + sort data ────────────────────────────────
  let rows = _revalDirFilter === 'all'
    ? [..._revalData]
    : _revalData.filter(d => d.direction === _revalDirFilter);

  // Group by branch
  const branchOrder = [...new Set(rows.map(d => d.branch))].sort();

  rows.sort((a, b) => {
    let va, vb;
    const col = _revalSortCol;
    if (col === 'uin')     { va = a.uin;         vb = b.uin; }
    else if (col === 'name')    { va = a.name;        vb = b.name; }
    else if (col === 'subject') { va = a.subjectName; vb = b.subjectName; }
    else if (col === 'delta')   {
      // numeric sort by absolute delta
      return _revalSortDir * (Math.abs(b.markDelta) - Math.abs(a.markDelta));
    }
    else if (col === 'session') { va = a.sessionName; vb = b.sessionName; }
    else {
      // 'change' — alphabetically by direction label, then by |delta| desc
      const dirOrder = { improved:1, worsened:2, 'pass-to-pass':3, 'fail-to-fail':4 };
      const da = dirOrder[a.direction] || 5;
      const db = dirOrder[b.direction] || 5;
      if (da !== db) return _revalSortDir * (da - db);
      return _revalSortDir * (Math.abs(b.markDelta) - Math.abs(a.markDelta));
    }
    return _revalSortDir * String(va).localeCompare(String(vb));
  });

  // ── Build table ───────────────────────────────────────
  function _sortTh(label, col) {
    const active = _revalSortCol === col;
    const arrow  = active ? (_revalSortDir === 1 ? ' ↑' : ' ↓') : ' ↕';
    return `<th style="cursor:pointer;white-space:nowrap;user-select:none;"
      onclick="_revalSort('${col}')">${UI.esc(label)}${arrow}</th>`;
  }

  function _dirBadge(d) {
    if (d.direction === 'improved')
      return '<span class="badge badge-pass">↑ Unsuccessful → Successful</span>';
    if (d.direction === 'worsened')
      return '<span class="badge badge-fail">⚠ Successful → Unsuccessful</span>';
    if (d.direction === 'fail-to-fail')
      return `<span class="badge badge-kt">Unsuccessful → Unsuccessful</span>`;
    if (d.direction === 'pass-to-pass')
      return `<span class="badge badge-regular">Successful → Successful</span>`;
    return '<span class="badge">Changed</span>';
  }

  function _deltaBadge(d) {
    if (d.markDelta === 0) return `<span style="color:var(--ink-4);">±0</span>`;
    const color = d.markDelta > 0 ? 'var(--pass)' : 'var(--fail)';
    return `<span style="font-weight:700;color:${color};">${d.markDelta > 0 ? '+' : ''}${d.markDelta}</span>`;
  }

  // Check if single-branch view (branch filter applied from shared filters)
  const multiBranch = branchOrder.length > 1;

  let tableRows = '';
  let lastBranch = null;

  for (const row of rows) {
    if (multiBranch && row.branch !== lastBranch) {
      tableRows += `
        <tr>
          <td colspan="7" style="background:var(--surface-2);font-weight:700;font-size:11px;
            letter-spacing:.05em;padding:6px 10px;color:var(--ink-2);">
            ${UI.esc(row.branch)}
          </td>
        </tr>`;
      lastBranch = row.branch;
    }
    tableRows += `
      <tr class="${row.direction === 'worsened' ? 'reval-worsened' : ''}">
        <td><span class="subj-code-small">${UI.esc(row.uin)}</span></td>
        <td>${UI.esc(row.name)}</td>
        <td><span class="subj-code-small">${UI.esc(row.subjectCode)}</span><br>
            <span style="font-size:11px;color:var(--ink-3);">${UI.esc(row.subjectName)}</span></td>
        <td>${_dirBadge(row)}</td>
        <td style="text-align:center;">${_deltaBadge(row)}</td>
        <td style="font-size:11px;color:var(--ink-3);">${UI.esc(row.sessionName || '')}</td>
      </tr>`;
  }

  if (rows.length === 0) {
    tableRows = `<tr><td colspan="7" style="text-align:center;color:var(--ink-4);padding:12px;">No entries for this filter.</td></tr>`;
  }

  wrap.innerHTML = summaryHtml + pillsHtml + `
    <div class="report-table-wrap">
      <table class="report-table">
        <thead>
          <tr>
            ${_sortTh('UIN', 'uin')}
            ${_sortTh('Name', 'name')}
            ${_sortTh('Subject', 'subject')}
            ${_sortTh('Change', 'change')}
            ${_sortTh('±ESE', 'delta')}
            ${_sortTh('Reval Session', 'session')}
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;
}

function _revalSetFilter(key) {
  _revalDirFilter = key;
  _revalRender();
}

function _revalSort(col) {
  if (_revalSortCol === col) {
    _revalSortDir *= -1;
  } else {
    _revalSortCol = col;
    _revalSortDir = 1;
  }
  _revalRender();
}

function _rptExportRevalImpact() {
  if (!_revalData.length) { UI.toast('No data to export.', 'error'); return; }
  const rows = _revalDirFilter === 'all'
    ? [..._revalData]
    : _revalData.filter(d => d.direction === _revalDirFilter);
  UI.exportCSV('RevalImpact',
    ['UIN','PRN/ERN','Name','Branch','Subject Code','Subject Name','Change','±ESE','Reval Session'],
    rows.map(d => [
      d.uin, d.prn, d.name, d.branch,
      d.subjectCode, d.subjectName,
      d.direction,
      d.markDelta >= 0 ? '+' + d.markDelta : String(d.markDelta),
      d.sessionName || '',
    ])
  );
  UI.toast('Reval impact exported.', 'success');
}

// ── Toppers (live) ────────────────────────────────────────────
function _rptToggleTopperMode() {
  const mode   = document.getElementById('rpt-topper-mode').value;
  const tabBtn = document.querySelector('.topper-tab-btn.active') ||
                 document.querySelector('.topper-tab-btn[data-tab="sem1"]');
  const tabMode = tabBtn?.dataset.tab || 'sem1';
  // Subject-wise disabled for FY tab
  const isFY = tabMode === 'fy';
  document.getElementById('rpt-topper-subject-row').style.display = (mode === 'subject' && !isFY) ? '' : 'none';
  document.getElementById('rpt-topper-n-row').style.display       = mode === 'branch' ? '' : 'none';
  if (isFY && mode === 'subject') {
    document.getElementById('rpt-topper-mode').value = 'branch';
  }
  _rptLiveToppers();
}

function _rptGetTopperTab() {
  return _topperActiveTab || 'sem1';
}

function _rptLiveToppers() {
  const toppersWrap = document.getElementById('rpt-toppers-wrap');
  const tabMode     = _rptGetTopperTab();
  const mode        = document.getElementById('rpt-topper-mode').value || 'branch';
  const branch      = document.getElementById('rpt-topper-branch').value || null;
  const batchYear   = document.getElementById('rpt-topper-batch').value  || null;
  const subjectCode = document.getElementById('rpt-topper-subject').value || null;
  const topN        = Number(document.getElementById('rpt-topper-n').value || 10);
  const gender      = document.getElementById('rpt-shared-gender').value || null;

  // Disable subject-wise for FY
  const modeEl = document.getElementById('rpt-topper-mode');
  if (tabMode === 'fy' && modeEl.value === 'subject') {
    modeEl.value = 'branch';
  }
  document.getElementById('rpt-topper-subject-row').style.display =
    (mode === 'subject' && tabMode !== 'fy') ? '' : 'none';
  document.getElementById('rpt-topper-n-row').style.display = mode === 'branch' ? '' : 'none';

  if (!batchYear) {
    toppersWrap.innerHTML = '<div style="text-align:center;color:var(--ink-4);padding:16px;font-size:12px;">Select a batch year to view toppers.</div>';
    return;
  }

  let data;
  try {
    data = State.reportToppers({ tabMode, mode, branch, batchYear, subjectCode, topN, gender });
  } catch(e) {
    console.error('[_rptLiveToppers]', e);
    toppersWrap.innerHTML = '<div style="text-align:center;color:var(--fail);padding:16px;font-size:12px;">Error loading toppers: ' + UI.esc(e.message) + '</div>';
    return;
  }

  function _renderBranchTable(list) {
    if (!list || list.length === 0) {
      return '<div style="text-align:center;color:var(--ink-4);padding:16px;font-size:12px;">No data for this selection.</div>';
    }
    let rows = '';
    let lastBranch = null;
    for (const d of list) {
      if (d.branchGroup !== lastBranch) {
        rows += `<tr><td colspan="9" style="background:var(--brand-light);font-weight:700;font-size:11px;
          letter-spacing:.05em;padding:6px 10px;color:var(--brand);">${UI.esc(d.branchGroup)}</td></tr>`;
        lastBranch = d.branchGroup;
      }
      const sem1Total = d.sem1Total != null ? d.sem1Total : '—';
      const sem1Sgpa  = d.sem1Sgpa  != null ? d.sem1Sgpa.toFixed(2)  : '—';
      const sem2Total = d.sem2Total != null ? d.sem2Total : '—';
      const sem2Sgpa  = d.sem2Sgpa  != null ? d.sem2Sgpa.toFixed(2)  : '—';
      const cgpa      = d.cgpa      != null ? d.cgpa.toFixed(2)      : '—';
      rows += `<tr>
        <td style="font-weight:700;color:var(--brand);">#${d.rank}</td>
        <td><span class="subj-code-small">${UI.esc(d.uin)}</span></td>
        <td>${UI.esc(d.name)}</td>
        <td>${UI.esc(d.gender || '—')}</td>
        <td style="text-align:center;">${UI.esc(String(sem1Total))}</td>
        <td style="text-align:center;font-weight:600;color:var(--brand);">${UI.esc(String(sem1Sgpa))}</td>
        <td style="text-align:center;">${UI.esc(String(sem2Total))}</td>
        <td style="text-align:center;font-weight:600;color:var(--brand);">${UI.esc(String(sem2Sgpa))}</td>
        <td style="text-align:center;font-weight:700;color:var(--pass);">${UI.esc(String(cgpa))}</td>
      </tr>`;
    }
    return `<div class="report-table-wrap"><table class="report-table">
      <thead><tr>
        <th>Rank</th><th>UIN</th><th>Name</th><th>Gender</th>
        <th>Sem I Total</th><th>Sem I SGPA</th>
        <th>Sem II Total</th><th>Sem II SGPA</th>
        <th>CGPA</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  function _renderSubjectTable(list) {
    if (!list || list.length === 0) {
      return '<div style="text-align:center;color:var(--ink-4);padding:16px;font-size:12px;">No data for this selection.</div>';
    }
    const multiSubject = new Set(list.map(d => d.subjectGroup)).size > 1;
    const multiBranch  = new Set(list.map(d => d.branchGroup)).size  > 1;
    let rows = '';
    let lastSubj = null;
    let lastBranch = null;
    for (const d of list) {
      if (multiSubject && d.subjectGroup !== lastSubj) {
        const maxStr = d.subjectMax != null ? ` / ${d.subjectMax}` : '';
        rows += `<tr><td colspan="6" style="background:var(--brand);color:#fff;font-weight:700;
          font-size:12px;letter-spacing:.04em;padding:7px 10px;">
          ${UI.esc(d.subjectName)} — <span style="opacity:.85;font-size:11px;">${UI.esc(d.subjectCode)}</span>
          <span style="opacity:.7;font-size:11px;margin-left:8px;">${UI.esc(maxStr)}</span>
        </td></tr>`;
        lastSubj   = d.subjectGroup;
        lastBranch = null;
      }
      if (multiBranch && d.branchGroup !== lastBranch) {
        rows += `<tr><td colspan="6" style="background:var(--surface-2);font-weight:700;font-size:11px;
          letter-spacing:.05em;padding:6px 10px;color:var(--ink-2);">${UI.esc(d.branchGroup)}</td></tr>`;
        lastBranch = d.branchGroup;
      }
      const maxStr = d.subjectMax != null ? `<small style="color:var(--ink-3);">/${d.subjectMax}</small>` : '';
      rows += `<tr>
        <td style="font-weight:700;color:var(--brand);">#${d.rank}</td>
        <td><span class="subj-code-small">${UI.esc(d.uin)}</span></td>
        <td>${UI.esc(d.name)}</td>
        <td>${UI.esc(d.branch)}</td>
        <td>${UI.esc(d.gender || '—')}</td>
        <td style="font-weight:600;">${d.totalMarks}${maxStr}</td>
      </tr>`;
    }
    return `<div class="report-table-wrap"><table class="report-table">
      <thead><tr><th>Rank</th><th>UIN</th><th>Name</th><th>Branch</th><th>Gender</th><th>Total Marks</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  const renderFn = mode === 'branch' ? _renderBranchTable : _renderSubjectTable;
  toppersWrap.innerHTML = renderFn(data.all);
}

function _rptExportToppers() {
  const tabMode     = _rptGetTopperTab();
  const mode        = document.getElementById('rpt-topper-mode').value || 'branch';
  const branch      = document.getElementById('rpt-topper-branch').value || null;
  const batchYear   = document.getElementById('rpt-topper-batch').value  || null;
  const subjectCode = document.getElementById('rpt-topper-subject').value || null;
  const topN        = Number(document.getElementById('rpt-topper-n').value || 10);
  if (!batchYear) {
    toppersWrap.innerHTML = '<div style="text-align:center;color:var(--ink-4);padding:16px;font-size:12px;">Select a batch year to view toppers.</div>';
    return;
  }
  let data;
  try {
    data = State.reportToppers({ tabMode, mode, branch, batchYear, subjectCode, topN, gender });
  } catch(e) {
    console.error('[_rptLiveToppers]', e);
    toppersWrap.innerHTML = '<div style="text-align:center;color:var(--fail);padding:16px;font-size:12px;">Error: ' + UI.esc(e.message) + '</div>';
    return;
  }

  const allRows = [
    ...data.all.map(d    => ({ ...d, genderGroup: 'All' })),
    ...data.male.map(d   => ({ ...d, genderGroup: 'Male' })),
    ...data.female.map(d => ({ ...d, genderGroup: 'Female' })),
  ];

  if (mode === 'branch') {
    UI.exportCSV(`Toppers_${tabMode.toUpperCase()}_Branch`,
      ['Gender Group','Rank','UIN','PRN','Name','Branch','Gender',
       'Sem I Total','Sem I SGPA','Sem II Total','Sem II SGPA','CGPA'],
      allRows.map(d => [
        d.genderGroup, d.rank, d.uin, d.prn, d.name, d.branch, d.gender||'',
        d.sem1Total??'', d.sem1Sgpa!=null?d.sem1Sgpa.toFixed(2):'',
        d.sem2Total??'', d.sem2Sgpa!=null?d.sem2Sgpa.toFixed(2):'',
        d.cgpa!=null?d.cgpa.toFixed(2):'',
      ])
    );
  } else {
    UI.exportCSV(`Toppers_${tabMode.toUpperCase()}_Subject`,
      ['Gender Group','Rank','UIN','PRN','Name','Branch','Gender','Subject Code','Subject Name','Total Marks','Subject Max'],
      allRows.map(d => [
        d.genderGroup, d.rank, d.uin, d.prn, d.name, d.branch, d.gender||'',
        d.subjectCode, d.subjectName, d.totalMarks, d.subjectMax??'',
      ])
    );
  }
  UI.toast('Toppers exported.', 'success');
}

// ── Credit Eligibility Filters ────────────────────────────────

// Filter 1: Students who have not completed Sem N credits
// ── Shared helper: enable/disable Export CSV button ───────────
function _eligSetCsvEnabled(btnId, enabled) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled       = !enabled;
  btn.style.opacity  = enabled ? '1'            : '0.4';
  btn.style.cursor   = enabled ? 'pointer'      : 'not-allowed';
}

let _creditFilterLastResult = [];
let _creditFilterLastMeta   = {};
let _creditSortCol = 'pending';
let _creditSortDir = -1;

function _rptCreditFilterRun() {
  const sem    = Number(document.getElementById('rpt-credit-sem').value || 0);
  const branch = document.getElementById('rpt-elig-branch').value || null;
  const gender = document.getElementById('rpt-elig-gender').value || null;
  if (!sem) { UI.toast('Select a semester.', 'error'); return; }

  const students = State.getStudents({ branch: branch || undefined, gender: gender || undefined });
  const rows = [];

  for (const s of students) {
    const acad = State.computeStudentAcademics(s.uin);
    if (!acad) continue;
    const sc = acad.semCredits[sem];
    if (!sc || sc.max === 0) continue;
    if (sc.earned >= sc.max) continue;

    rows.push({
      uin:        s.uin,
      prn:        s.prn,
      name:       s.name,
      branch:     s.branch,
      division:   s.division,
      batchYear:  s.batchYear,
      gender:     s.gender || '',
      semEarned:  sc.earned,
      semMax:     sc.max,
      semPending: sc.max - sc.earned,
      cgpa:       acad.cgpa != null ? acad.cgpa.toFixed(2) : '—',
    });
  }

  _creditFilterLastResult = rows;
  _creditFilterLastMeta   = { sem };
  _creditSortCol = 'pending';
  _creditSortDir = -1;

  // Update Run button label
  const btn = document.getElementById('rpt-credit-run');
  if (btn) btn.textContent = rows.length > 0 ? `Run (${rows.length} students)` : 'Run';

  _rptRenderCreditBranchSummary(rows, sem);
  _rptRenderCreditFilterTable(rows, sem);
  _eligSetCsvEnabled('rpt-credit-csv', rows.length > 0);
}

function _rptRenderCreditBranchSummary(rows, sem) {
  const el = document.getElementById('rpt-credit-branch-summary');
  if (!el) return;
  if (!rows.length) { el.innerHTML = ''; return; }

  const byBranch = {};
  for (const r of rows) {
    if (!byBranch[r.branch]) byBranch[r.branch] = 0;
    byBranch[r.branch]++;
  }

  el.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
      ${Object.entries(byBranch).sort((a,b) => b[1]-a[1]).map(([br, count]) => `
        <span style="background:var(--brand-light);color:var(--brand);border:1px solid #C7D7FF;
          border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600;">
          ${UI.esc(br)}: ${count}
        </span>`).join('')}
      <span style="background:var(--surface-2);color:var(--ink-3);border:1px solid var(--border);
        border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600;">
        Total: ${rows.length}
      </span>
    </div>`;
}

function _creditSortAndRender() {
  _rptRenderCreditFilterTable(_creditFilterLastResult, _creditFilterLastMeta.sem);
}

function _rptRenderCreditFilterTable(rows, sem) {
  const out = document.getElementById('rpt-credit-filter-output');
  if (!out) return;
  if (!rows.length) {
    out.innerHTML = '<div class="empty-state">No students found matching this filter.</div>';
    return;
  }

  // Sort
  const sorted = [...rows].sort((a, b) => {
    let va, vb;
    if (_creditSortCol === 'pending')   { return _creditSortDir * (b.semPending - a.semPending); }
    if (_creditSortCol === 'earned')    { return _creditSortDir * (b.semEarned  - a.semEarned); }
    if (_creditSortCol === 'cgpa')      { return _creditSortDir * (parseFloat(b.cgpa) - parseFloat(a.cgpa)); }
    if (_creditSortCol === 'name')      { va = a.name;     vb = b.name; }
    else if (_creditSortCol === 'uin')  { va = a.uin;      vb = b.uin; }
    else if (_creditSortCol === 'branch'){ va = a.branch;  vb = b.branch; }
    else if (_creditSortCol === 'batch'){ va = a.batchYear;vb = b.batchYear; }
    else if (_creditSortCol === 'gender'){ va = a.gender;  vb = b.gender; }
    else { va = ''; vb = ''; }
    return _creditSortDir * String(va).localeCompare(String(vb));
  });

  function _th(label, col) {
    const active = _creditSortCol === col;
    const arrow  = active ? (_creditSortDir === 1 ? ' ↑' : ' ↓') : ' ↕';
    return `<th style="cursor:pointer;white-space:nowrap;user-select:none;position:sticky;top:0;background:var(--surface-2);"
      onclick="_creditSortCol='${col}';_creditSortDir=_creditSortCol==='${col}'&&_creditSortDir===1?-1:1;_creditSortCol='${col}';_creditSortAndRender()">
      ${UI.esc(label)}${arrow}</th>`;
  }

  out.innerHTML = `
    <table class="audit-table" style="width:100%;">
      <thead><tr>
        ${_th('UIN','uin')}
        ${_th('Name','name')}
        ${_th('Branch','branch')}
        ${_th('Batch','batch')}
        ${_th('Gender','gender')}
        ${_th(`Sem ${sem} Credits`,'earned')}
        ${_th('Pending','pending')}
        ${_th('CGPA','cgpa')}
      </tr></thead>
      <tbody>
        ${sorted.map(r => `<tr>
          <td><span class="subj-code-small">${UI.esc(r.uin)}</span></td>
          <td>${UI.esc(r.name)}</td>
          <td>${UI.esc(r.branch)}</td>
          <td>${UI.esc(r.batchYear)}</td>
          <td>${UI.esc(r.gender || '—')}</td>
          <td>${r.semEarned} / ${r.semMax}</td>
          <td class="credit-zero" style="font-weight:700;">${r.semPending}</td>
          <td><strong>${UI.esc(r.cgpa)}</strong></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function _rptCreditFilterExport() {
  if (!_creditFilterLastResult.length) { UI.toast('Run the filter first.', 'error'); return; }
  const { sem } = _creditFilterLastMeta;
  UI.exportCSV(`Sem${sem}_IncompleteCredits`,
    ['UIN','PRN/ERN','Name','Branch','Division','Batch Year','Gender',`Sem ${sem} Earned`,`Sem ${sem} Max`,'Pending Credits','CGPA'],
    _creditFilterLastResult.map(r => [r.uin, r.prn, r.name, r.branch, r.division, r.batchYear, r.gender, r.semEarned, r.semMax, r.semPending, r.cgpa])
  );
  UI.toast(`${_creditFilterLastResult.length} students exported.`, 'success');
}

// Filter 2: Students with total cumulative credits < X
let _totalCreditLastResult = [];
let _totalCreditLastMeta   = {};
let _totalCreditSortCol    = 'totalEarned';
let _totalCreditSortDir    = 1;

function _tcSetThreshold(val) {
  const el = document.getElementById('rpt-credit-x');
  if (el) { el.value = val; el.focus(); }
}

function _rptTotalCreditFilterRun() {
  const threshold = Number(document.getElementById('rpt-credit-x').value || 0);
  const branch    = document.getElementById('rpt-elig-branch').value || null;
  const gender    = document.getElementById('rpt-elig-gender').value || null;
  if (!threshold) { UI.toast('Enter a credit threshold.', 'error'); return; }

  const students = State.getStudents({ branch: branch || undefined, gender: gender || undefined });
  const rows = [];

  for (const s of students) {
    const acad = State.computeStudentAcademics(s.uin);
    if (!acad) continue;
    const { earned, max } = acad.totalCredits;
    if (earned >= threshold) continue;

    rows.push({
      uin:         s.uin,
      prn:         s.prn,
      name:        s.name,
      branch:      s.branch,
      division:    s.division,
      batchYear:   s.batchYear,
      gender:      s.gender || '',
      sem1Earned:  acad.semCredits[1].earned,
      sem1Max:     acad.semCredits[1].max,
      sem2Earned:  acad.semCredits[2].earned,
      sem2Max:     acad.semCredits[2].max,
      totalEarned: earned,
      totalMax:    max,
      cgpa:        acad.cgpa != null ? acad.cgpa.toFixed(2) : '—',
    });
  }

  _totalCreditLastResult = rows;
  _totalCreditLastMeta   = { threshold };
  _totalCreditSortCol    = 'totalEarned';
  _totalCreditSortDir    = 1;

  const btn = document.getElementById('rpt-total-credit-run');
  if (btn) btn.textContent = rows.length > 0 ? `Run (${rows.length} students)` : 'Run';

  _rptRenderTotalCreditBranchSummary(rows, threshold);
  _rptRenderTotalCreditFilterTable(rows, threshold);
  _eligSetCsvEnabled('rpt-total-credit-csv', rows.length > 0);
}

function _rptRenderTotalCreditBranchSummary(rows, threshold) {
  const el = document.getElementById('rpt-total-credit-branch-summary');
  if (!el) return;
  if (!rows.length) { el.innerHTML = ''; return; }

  const byBranch = {};
  for (const r of rows) {
    if (!byBranch[r.branch]) byBranch[r.branch] = 0;
    byBranch[r.branch]++;
  }

  el.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
      ${Object.entries(byBranch).sort((a,b) => b[1]-a[1]).map(([br, count]) => `
        <span style="background:var(--brand-light);color:var(--brand);border:1px solid #C7D7FF;
          border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600;">
          ${UI.esc(br)}: ${count}
        </span>`).join('')}
      <span style="background:var(--surface-2);color:var(--ink-3);border:1px solid var(--border);
        border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600;">
        Total: ${rows.length} · below ${threshold} credits
      </span>
    </div>`;
}

function _totalCreditSortAndRender() {
  _rptRenderTotalCreditFilterTable(_totalCreditLastResult, _totalCreditLastMeta.threshold);
}

function _rptRenderTotalCreditFilterTable(rows, threshold) {
  const out = document.getElementById('rpt-total-credit-filter-output');
  if (!out) return;
  if (!rows.length) {
    out.innerHTML = '<div class="empty-state">No students found matching this filter.</div>';
    return;
  }

  const sorted = [...rows].sort((a, b) => {
    const col = _totalCreditSortCol;
    if (col === 'totalEarned') return _totalCreditSortDir * (a.totalEarned - b.totalEarned);
    if (col === 'sem1')        return _totalCreditSortDir * (a.sem1Earned  - b.sem1Earned);
    if (col === 'sem2')        return _totalCreditSortDir * (a.sem2Earned  - b.sem2Earned);
    if (col === 'cgpa')        return _totalCreditSortDir * (parseFloat(a.cgpa) - parseFloat(b.cgpa));
    let va, vb;
    if (col === 'name')   { va = a.name;      vb = b.name; }
    else if (col === 'uin')    { va = a.uin;       vb = b.uin; }
    else if (col === 'branch') { va = a.branch;    vb = b.branch; }
    else if (col === 'batch')  { va = a.batchYear; vb = b.batchYear; }
    else if (col === 'gender') { va = a.gender;    vb = b.gender; }
    else { va = ''; vb = ''; }
    return _totalCreditSortDir * String(va).localeCompare(String(vb));
  });

  function _th(label, col) {
    const active = _totalCreditSortCol === col;
    const arrow  = active ? (_totalCreditSortDir === 1 ? ' ↑' : ' ↓') : ' ↕';
    return `<th style="cursor:pointer;white-space:nowrap;user-select:none;position:sticky;top:0;background:var(--surface-2);"
      onclick="_totalCreditSortCol='${col}';_totalCreditSortDir=_totalCreditSortCol==='${col}'&&_totalCreditSortDir===1?-1:1;_totalCreditSortCol='${col}';_totalCreditSortAndRender()">
      ${UI.esc(label)}${arrow}</th>`;
  }

  out.innerHTML = `
    <table class="audit-table" style="width:100%;">
      <thead><tr>
        ${_th('UIN','uin')}
        ${_th('Name','name')}
        ${_th('Branch','branch')}
        ${_th('Batch','batch')}
        ${_th('Gender','gender')}
        ${_th('Sem I','sem1')}
        ${_th('Sem II','sem2')}
        ${_th('Total Credits','totalEarned')}
        ${_th('CGPA','cgpa')}
      </tr></thead>
      <tbody>
        ${sorted.map(r => `<tr>
          <td><span class="subj-code-small">${UI.esc(r.uin)}</span></td>
          <td>${UI.esc(r.name)}</td>
          <td>${UI.esc(r.branch)}</td>
          <td>${UI.esc(r.batchYear)}</td>
          <td>${UI.esc(r.gender || '—')}</td>
          <td>${r.sem1Earned}/${r.sem1Max}</td>
          <td>${r.sem2Earned}/${r.sem2Max}</td>
          <td class="${r.totalEarned < threshold ? 'credit-zero' : 'credit-earned'}" style="font-weight:700;">
            ${r.totalEarned} / ${r.totalMax}
          </td>
          <td><strong>${UI.esc(r.cgpa)}</strong></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function _rptTotalCreditFilterExport() {
  if (!_totalCreditLastResult.length) { UI.toast('Run the filter first.', 'error'); return; }
  const { threshold } = _totalCreditLastMeta;
  UI.exportCSV(`TotalCredits_lt${threshold}`,
    ['UIN','PRN/ERN','Name','Branch','Division','Batch Year','Gender','Sem 1 Earned','Sem 1 Max','Sem 2 Earned','Sem 2 Max','Total Earned','Total Max','CGPA'],
    _totalCreditLastResult.map(r => [r.uin, r.prn, r.name, r.branch, r.division, r.batchYear, r.gender, r.sem1Earned, r.sem1Max, r.sem2Earned, r.sem2Max, r.totalEarned, r.totalMax, r.cgpa])
  );
  UI.toast(`${_totalCreditLastResult.length} students exported.`, 'success');
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
    <div style="overflow-x:auto; max-height:400px; overflow-y:auto;">
    <table class="audit-table">
      <thead><tr>
        <th>UIN</th><th>Name</th><th>Branch</th><th>Batch</th><th>Gender</th>
        <th>Sem ${sem} Credits</th><th>Pending</th><th>CGPA</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `<tr>
          <td><span class="subj-code-small">${UI.esc(r.uin)}</span></td>
          <td>${UI.esc(r.name)}</td>
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
        <th>UIN</th><th>Name</th><th>Branch</th><th>Batch</th>
        <th>Sem 1</th><th>Sem 2</th><th>Total Credits</th><th>CGPA</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `<tr>
          <td><span class="subj-code-small">${UI.esc(r.uin)}</span></td>
          <td>${UI.esc(r.name)}</td>
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

let _ktFilterLastResult = [];
let _ktFilterLastMeta   = {};
let _ktSortCol          = 'ktCount';
let _ktSortDir          = -1;

function _rptKTFilterRun() {
  const n      = Number(document.getElementById('rpt-kt-n').value || 1);
  const mode   = document.getElementById('rpt-kt-mode').value  || 'At least';
  const scope  = document.getElementById('rpt-kt-scope').value || 'Active';
  const branch = document.getElementById('rpt-elig-branch').value || null;
  const gender = document.getElementById('rpt-elig-gender').value || null;
  const raw    = State.reportKTFilter(n, mode, scope, gender);

  // Group into one row per student with KT subjects as array
  const byStudent = {};
  for (const d of raw) {
    if (branch && d.branch !== branch) continue;
    if (!byStudent[d.uin]) byStudent[d.uin] = {
      prn: d.prn, uin: d.uin, name: d.name,
      branch: d.branch, gender: d.gender || '', ktSubjects: [],
    };
    byStudent[d.uin].ktSubjects.push({
      code:   d.subjectCode,
      name:   d.subjectName,
      result: d.result,
    });
  }
  const rows = Object.values(byStudent)
    .filter(r => r.ktSubjects.length > 0)
    .map(r => ({ ...r, ktCount: r.ktSubjects.length }));

  _ktFilterLastResult = rows;
  _ktFilterLastMeta   = { n, mode, scope };
  _ktSortCol          = 'ktCount';
  _ktSortDir          = -1;

  const btn = document.getElementById('rpt-kt-run');
  if (btn) btn.textContent = rows.length > 0 ? `Run (${rows.length} students)` : 'Run';

  _rptRenderKTBranchSummary(rows);
  _rptRenderKTFilterTable(rows);
  _eligSetCsvEnabled('rpt-kt-csv', rows.length > 0);
}

function _rptRenderKTBranchSummary(rows) {
  const el = document.getElementById('rpt-kt-branch-summary');
  if (!el) return;
  if (!rows.length) { el.innerHTML = ''; return; }

  const byBranch = {};
  for (const r of rows) {
    if (!byBranch[r.branch]) byBranch[r.branch] = 0;
    byBranch[r.branch]++;
  }

  el.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
      ${Object.entries(byBranch).sort((a,b) => b[1]-a[1]).map(([br, count]) => `
        <span style="background:var(--kt-bg);color:var(--kt);border:1px solid #FCD34D;
          border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600;">
          ${UI.esc(br)}: ${count}
        </span>`).join('')}
      <span style="background:var(--surface-2);color:var(--ink-3);border:1px solid var(--border);
        border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600;">
        Total: ${rows.length}
      </span>
    </div>`;
}

function _ktSortAndRender() {
  _rptRenderKTFilterTable(_ktFilterLastResult);
}

function _rptRenderKTFilterTable(rows) {
  const out = document.getElementById('rpt-kt-filter-output');
  if (!out) return;
  if (!rows.length) {
    out.innerHTML = '<div class="empty-state">No students found for this filter.</div>';
    return;
  }

  const sorted = [...rows].sort((a, b) => {
    const col = _ktSortCol;
    if (col === 'ktCount') return _ktSortDir * (b.ktCount - a.ktCount);
    let va, vb;
    if      (col === 'uin')    { va = a.uin;      vb = b.uin; }
    else if (col === 'name')   { va = a.name;     vb = b.name; }
    else if (col === 'branch') { va = a.branch;   vb = b.branch; }
    else if (col === 'gender') { va = a.gender;   vb = b.gender; }
    else { va = ''; vb = ''; }
    return _ktSortDir * String(va).localeCompare(String(vb));
  });

  function _th(label, col) {
    const active = _ktSortCol === col;
    const arrow  = active ? (_ktSortDir === 1 ? ' ↑' : ' ↓') : ' ↕';
    return `<th style="cursor:pointer;white-space:nowrap;user-select:none;position:sticky;top:0;background:var(--surface-2);"
      onclick="_ktSortCol='${col}';_ktSortDir=_ktSortCol==='${col}'&&_ktSortDir===1?-1:1;_ktSortCol='${col}';_ktSortAndRender()">
      ${UI.esc(label)}${arrow}</th>`;
  }

  out.innerHTML = `
    <table class="audit-table" style="width:100%;">
      <thead><tr>
        ${_th('UIN','uin')}
        ${_th('Name','name')}
        ${_th('Branch','branch')}
        ${_th('Gender','gender')}
        ${_th('KT Count','ktCount')}
        <th style="position:sticky;top:0;background:var(--surface-2);">KT Subjects</th>
      </tr></thead>
      <tbody>
        ${sorted.map(r => `<tr>
          <td><span class="subj-code-small">${UI.esc(r.uin)}</span></td>
          <td>${UI.esc(r.name)}</td>
          <td>${UI.esc(r.branch)}</td>
          <td>${UI.esc(r.gender || '—')}</td>
          <td style="text-align:center;">
            <span class="badge badge-kt">${r.ktCount}</span>
          </td>
          <td>
            <details>
              <summary style="cursor:pointer;font-size:11px;color:var(--brand);font-weight:600;">
                ${r.ktCount} subject${r.ktCount !== 1 ? 's' : ''} — click to expand
              </summary>
              <div style="margin-top:6px;display:flex;flex-direction:column;gap:3px;">
                ${r.ktSubjects.map(s => `
                  <div style="font-size:11px;padding:3px 6px;background:var(--kt-bg);
                    border-radius:4px;border-left:3px solid var(--kt);">
                    <span class="subj-code-small">${UI.esc(s.code)}</span>
                    ${UI.esc(s.name)}
                    ${s.result === 'AB'
                      ? '<span class="badge badge-ab" style="margin-left:4px;">AB</span>'
                      : '<span class="badge badge-fail" style="margin-left:4px;">Fail</span>'}
                  </div>`).join('')}
              </div>
            </details>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function _rptKTFilterExport() {
  if (!_ktFilterLastResult.length) { UI.toast('Run the filter first.', 'error'); return; }
  const { n, mode, scope } = _ktFilterLastMeta;
  UI.exportCSV(`KTFilter_${mode.replace(' ','')}_${n}_${scope}`,
    ['UIN','PRN/ERN','Name','Branch','Gender','KT Count','KT Subjects'],
    _ktFilterLastResult.map(r => [
      r.uin, r.prn, r.name, r.branch, r.gender,
      r.ktCount,
      r.ktSubjects.map(s => `${s.code} — ${s.name}${s.result === 'AB' ? ' (AB)' : ''}`).join('; '),
    ])
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


// ── Eligibility: Download All (Excel) ─────────────────────
function _eligDownloadAll() {
  const branch = document.getElementById('rpt-elig-branch').value || null;
  const gender = document.getElementById('rpt-elig-gender').value || null;
  const students = State.getStudents({ branch: branch || undefined, gender: gender || undefined });

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Incomplete Sem I Credits ─────────────────
  const sem1Rows = [];
  const sem2Rows = [];
  for (const s of students) {
    const acad = State.computeStudentAcademics(s.uin);
    if (!acad) continue;
    for (const sem of [1, 2]) {
      const sc = acad.semCredits[sem];
      if (!sc || sc.max === 0 || sc.earned >= sc.max) continue;
      const row = {
        uin:        s.uin,
        prn:        s.prn,
        name:       s.name,
        branch:     s.branch,
        division:   s.division,
        batchYear:  s.batchYear,
        gender:     s.gender || '',
        semEarned:  sc.earned,
        semMax:     sc.max,
        semPending: sc.max - sc.earned,
        cgpa:       acad.cgpa != null ? acad.cgpa.toFixed(2) : '—',
      };
      if (sem === 1) sem1Rows.push(row);
      else           sem2Rows.push(row);
    }
  }

  const _semHeaders = (sem) => [
    'UIN','PRN/ERN','Name','Branch','Division','Batch Year','Gender',
    `Sem ${sem} Earned`,`Sem ${sem} Max`,'Pending Credits','CGPA',
  ];
  const _semRow = (r, sem) => [
    r.uin, r.prn, r.name, r.branch, r.division, r.batchYear, r.gender,
    r.semEarned, r.semMax, r.semPending, r.cgpa,
  ];

  const ws1 = XLSX.utils.aoa_to_sheet([
    _semHeaders(1),
    ...sem1Rows.map(r => _semRow(r, 1)),
  ]);
  ws1['!cols'] = [8,12,24,10,8,8,8,10,8,10,8].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws1, 'Sem I Incomplete');

  const ws2 = XLSX.utils.aoa_to_sheet([
    _semHeaders(2),
    ...sem2Rows.map(r => _semRow(r, 2)),
  ]);
  ws2['!cols'] = [8,12,24,10,8,8,8,10,8,10,8].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws2, 'Sem II Incomplete');

  // ── Sheet 2: Total Credits Below Common Thresholds ────
  const thresholds = [10, 20, 30, 40];
  for (const threshold of thresholds) {
    const tcRows = [];
    for (const s of students) {
      const acad = State.computeStudentAcademics(s.uin);
      if (!acad) continue;
      const { earned, max } = acad.totalCredits;
      if (earned >= threshold) continue;
      tcRows.push([
        s.uin, s.prn, s.name, s.branch, s.division, s.batchYear, s.gender || '',
        acad.semCredits[1].earned, acad.semCredits[1].max,
        acad.semCredits[2].earned, acad.semCredits[2].max,
        earned, max,
        acad.cgpa != null ? acad.cgpa.toFixed(2) : '—',
      ]);
    }
    const wsTc = XLSX.utils.aoa_to_sheet([
      ['UIN','PRN/ERN','Name','Branch','Division','Batch Year','Gender',
       'Sem I Earned','Sem I Max','Sem II Earned','Sem II Max',
       'Total Earned','Total Max','CGPA'],
      ...tcRows,
    ]);
    wsTc['!cols'] = [8,12,24,10,8,8,8,8,6,8,6,10,8,8].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsTc, `Credits < ${threshold}`);
  }

  // ── Sheet 3: Active KT Students ───────────────────────
  const ktRaw  = State.reportKTFilter(1, 'At least', 'Active', gender || undefined);
  const ktByStudent = {};
  for (const d of ktRaw) {
    if (branch && d.branch !== branch) continue;
    if (!ktByStudent[d.uin]) ktByStudent[d.uin] = {
      prn: d.prn, uin: d.uin, name: d.name,
      branch: d.branch, gender: d.gender || '', ktSubjects: [],
    };
    ktByStudent[d.uin].ktSubjects.push(
      `${d.subjectCode} — ${d.subjectName}${d.result === 'AB' ? ' (AB)' : ''}`
    );
  }
  const ktRows = Object.values(ktByStudent).map(r => [
    r.uin, r.prn, r.name, r.branch, r.gender,
    r.ktSubjects.length,
    r.ktSubjects.join('; '),
  ]);
  const wsKT = XLSX.utils.aoa_to_sheet([
    ['UIN','PRN/ERN','Name','Branch','Gender','KT Count','KT Subjects'],
    ...ktRows,
  ]);
  wsKT['!cols'] = [8,12,24,10,8,8,40].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, wsKT, 'Active KT Students');

  // ── Export ─────────────────────────────────────────────
  const suffix = branch ? `_${branch}` : '';
  const filename = `EligibilityReport${suffix}_${new Date().toISOString().slice(0,10)}.xlsx`;
  XLSX.writeFile(wb, filename);
  UI.toast(`✓ Exported: ${filename}`, 'success');
}

// ── Active KT Drill-down ──────────────────────────────────────

function _aktdAllSubjects() {
  // Merge Sem I + fixed Sem II + all elective pools, deduplicated by code
  const all = [
    ...SEM1_SUBJECTS,
    ...getSem2Subjects('Computer', null),   // fixed Sem II subjects (branch-neutral codes)
    ...ELECTIVE_PHYSICS_THEORY,
    ...ELECTIVE_PHYSICS_LAB,
    ...ELECTIVE_CHEMISTRY_THEORY,
    ...ELECTIVE_CHEMISTRY_LAB,
  ];
  // Deduplicate by code; keep first occurrence
  const seen = new Set();
  return all.filter(s => { if (seen.has(s.code)) return false; seen.add(s.code); return true; });
}

function _aktdComponentKeys(component) {
  // Returns the ledger field names and display label for each component option
  if (component === 'ESE')     return { fields: ['eseMarks'],           label: 'ESE' };
  if (component === 'TW_Oral') return { fields: ['twMarks','oralMarks'], label: 'TW / Oral' };
  if (component === 'IAT')     return { fields: ['iatMarks'],            label: 'IAT' };
  return { fields: [], label: '' };
}

function _aktdSubjectHasComponent(subject, component) {
  if (!subject?.marks) return false;
  if (component === 'ESE')     return !!subject.marks.ESE;
  if (component === 'TW_Oral') return !!(subject.marks.TW || subject.marks.Oral);
  if (component === 'IAT')     return !!subject.marks.IAT;
  return false;
}

function _aktdPopulateSubjects() {
  const el = document.getElementById('rpt-aktd-subject');
  const subjects = _aktdAllSubjects();
  el.innerHTML = '<option value="">— select subject —</option>' +
    subjects.map(s => `<option value="${UI.esc(s.code)}">${UI.esc(s.code)} — ${UI.esc(s.name)}</option>`).join('');
}

function _aktdPopulateBatchYears() {
  const years = State.getBatchYears();
  const el = document.getElementById('rpt-aktd-batch');
  el.innerHTML = '<option value="">— all batches —</option>' +
    years.map(y => `<option value="${UI.esc(y)}">${UI.esc(y)}</option>`).join('');
}

function _aktdClearOutput() {
  document.getElementById('rpt-aktd-output').innerHTML = '';
  document.getElementById('rpt-aktd-summary').textContent = '';
  _eligSetCsvEnabled('rpt-aktd-csv', false);
}

// Stores last result for CSV export
let _aktdLastResult = [];
let _aktdLastMeta   = {};

function _aktdRun() {
  const subjectCode = document.getElementById('rpt-aktd-subject').value;
  const component   = document.getElementById('rpt-aktd-component').value;
  const batchYear   = document.getElementById('rpt-aktd-batch').value;
  const division    = document.getElementById('rpt-aktd-division').value;
  const branch      = document.getElementById('rpt-elig-branch').value  || null;
  const gender      = document.getElementById('rpt-elig-gender').value  || null;
  const output      = document.getElementById('rpt-aktd-output');
  const summary     = document.getElementById('rpt-aktd-summary');

  if (!subjectCode) { UI.toast('Please select a subject.', 'error'); return; }

  const allSubjects = _aktdAllSubjects();
  const subject     = allSubjects.find(s => s.code === subjectCode);
  if (!subject) { UI.toast('Subject not found.', 'error'); return; }

  if (!_aktdSubjectHasComponent(subject, component)) {
    output.innerHTML = `<div class="empty-state">This subject does not have a <strong>${_aktdComponentKeys(component).label}</strong> component.</div>`;
    summary.textContent = '';
    _eligSetCsvEnabled('rpt-aktd-csv', false);
    return;
  }

  const { fields, label } = _aktdComponentKeys(component);
  const ktValues = CONFIG.KT_RESULT_VALUES;

  // Gather all students, optionally filter
  let students = State.getStudents({
    branch:    branch    || undefined,
    batchYear: batchYear || undefined,
    division:  division  || undefined,
    gender:    gender    || undefined,
  });

  const rows = [];

  for (const student of students) {
    // Get all ledger rows for this student + subject, oldest first
    const allRows = State.ledger
      .filter(r => r.uin === student.uin && r.subjectCode === subjectCode)
      .sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));

    if (allRows.length === 0) continue;

    // Session chronology score — year × 12 + month from session name, never from entryDateTime
    const _sessionScore = sess => {
      if (!sess) return 0;
      const year  = Number((sess.name || '').slice(0, 4));
      const month = (sess.name || '').includes('May') ? 5 : 12;
      return year * 12 + month;
    };

    // Step 1: merge multiple ledger rows within the same session
    // (latest component value wins within a session, same as _getActiveKTsForStudent)
    const mergedPerSessionSubject = {};
    for (const r of allRows) {
      const key = r.examSession;
      if (!mergedPerSessionSubject[key]) {
        mergedPerSessionSubject[key] = { ...r };
      } else {
        const m = mergedPerSessionSubject[key];
        if (r.iatMarks  !== '') m.iatMarks  = r.iatMarks;
        if (r.eseMarks  !== '') m.eseMarks  = r.eseMarks;
        if (r.twMarks   !== '') m.twMarks   = r.twMarks;
        if (r.oralMarks !== '') m.oralMarks = r.oralMarks;
      }
    }

    // Count attempts — Prelim sittings only; paired Gazette = same attempt.
    // Sort session IDs chronologically by session name so attempts are counted oldest-first.
    const attemptSessionIds = [...new Set(allRows.map(r => r.examSession))]
      .sort((a, b) => _sessionScore(State.getSession(a)) - _sessionScore(State.getSession(b)));
    let attemptCount = 0;
    let hasUnsuccessfulReval = false;
    for (const sid of attemptSessionIds) {
      const sess = State.getSession(sid);
      if (!sess) continue;
      if (sess.entryType === 'Revaluation_Gazette' && sess.linkedPrelimSessionId &&
          attemptSessionIds.includes(sess.linkedPrelimSessionId)) {
        // Paired Gazette — same attempt as its Prelim; check if still failing → Unsuccessful Reval
        const gazetteRow = mergedPerSessionSubject[sid];
        if (gazetteRow) {
          const pr = mergedPerSessionSubject[sess.linkedPrelimSessionId];
          const gMarksMap = {};
          if (pr) {
            if (pr.iatMarks)  gMarksMap.IAT  = pr.iatMarks;
            if (pr.twMarks)   gMarksMap.TW   = pr.twMarks;
            if (pr.oralMarks) gMarksMap.Oral = pr.oralMarks;
            if (pr.eseMarks)  gMarksMap.ESE  = pr.eseMarks;
          }
          if (gazetteRow.eseMarks  !== '') gMarksMap.ESE  = gazetteRow.eseMarks;
          if (gazetteRow.twMarks   !== '') gMarksMap.TW   = gazetteRow.twMarks;
          if (gazetteRow.oralMarks !== '') gMarksMap.Oral = gazetteRow.oralMarks;
          if (gazetteRow.iatMarks  !== '') gMarksMap.IAT  = gazetteRow.iatMarks;
          const gdr = computeDisplayResult(subject, gMarksMap);
          if (CONFIG.KT_RESULT_VALUES.includes(gdr.result)) hasUnsuccessfulReval = true;
        }
        continue; // don't increment attempt count
      }
      attemptCount++;
    }

    // Step 2: Determine effective row — latest Gazette (with Prelim components filled)
    // or latest Prelim, always by session name chronology, never by entryDateTime.
    let gazetteCandidate = null;
    let prelimCandidate  = null;

    for (const row of Object.values(mergedPerSessionSubject)) {
      const sess = State.getSession(row.examSession);
      if (!sess) continue;

      if (sess.entryType === 'Revaluation_Gazette') {
        const candidate = { ...row, _sess: sess };
        if (sess.linkedPrelimSessionId) {
          const pr = mergedPerSessionSubject[sess.linkedPrelimSessionId];
          if (pr) {
            if (!candidate.iatMarks  && pr.iatMarks)  candidate.iatMarks  = pr.iatMarks;
            if (!candidate.twMarks   && pr.twMarks)   candidate.twMarks   = pr.twMarks;
            if (!candidate.oralMarks && pr.oralMarks) candidate.oralMarks = pr.oralMarks;
          }
        }
        if (!gazetteCandidate || _sessionScore(sess) > _sessionScore(gazetteCandidate._sess)) {
          gazetteCandidate = candidate;
        }
      } else {
        if (!prelimCandidate || _sessionScore(sess) > _sessionScore(prelimCandidate._sess)) {
          prelimCandidate = { ...row, _sess: sess };
        }
      }
    }

    // Gazette wins only if it is at least as recent as the latest Prelim
    let effectiveRow = null;
    if (gazetteCandidate && prelimCandidate) {
      effectiveRow = _sessionScore(gazetteCandidate._sess) >= _sessionScore(prelimCandidate._sess)
        ? gazetteCandidate
        : prelimCandidate;
    } else {
      effectiveRow = gazetteCandidate || prelimCandidate;
    }

    if (!effectiveRow) continue;

    // Build marks map from the fully merged effective row,
    // supplementing any missing components from earlier sessions.
    // This handles the case where e.g. IAT was entered in Dec Prelim
    // and ESE in May Prelim — two separate sessions for the same subject.
    const marksMap = {};
    for (const r of Object.values(mergedPerSessionSubject)) {
      if (r.iatMarks  !== '' && !marksMap.IAT)  marksMap.IAT  = r.iatMarks;
      if (r.eseMarks  !== '' && !marksMap.ESE)  marksMap.ESE  = r.eseMarks;
      if (r.twMarks   !== '' && !marksMap.TW)   marksMap.TW   = r.twMarks;
      if (r.oralMarks !== '' && !marksMap.Oral) marksMap.Oral = r.oralMarks;
    }
    // Effective row always wins (most recent values override earlier ones)
    if (effectiveRow.iatMarks  !== '') marksMap.IAT  = effectiveRow.iatMarks;
    if (effectiveRow.eseMarks  !== '') marksMap.ESE  = effectiveRow.eseMarks;
    if (effectiveRow.twMarks   !== '') marksMap.TW   = effectiveRow.twMarks;
    if (effectiveRow.oralMarks !== '') marksMap.Oral = effectiveRow.oralMarks;

    const dr = computeDisplayResult(subject, marksMap);
    if (dr.pending || !ktValues.includes(dr.result)) continue;

    // Extract component mark(s) for display
    const compMarks = {};
    for (const f of fields) {
      compMarks[f] = effectiveRow[f] || '—';
    }

    // Last session name
    const lastSession = effectiveRow._sess?.name || effectiveRow.examSession;

    rows.push({
      uin:         student.uin,
      prn:         student.prn,
      name:        student.name,
      branch:      student.branch,
      division:    student.division,
      batchYear:   student.batchYear,
      gender:      student.gender || '',
      attemptCount,
      hasUnsuccessfulReval,
      lastSession,
      compMarks,
      result:      dr.result,
    });
  }

  // Sort: attempt count descending, then name
  rows.sort((a, b) => b.attemptCount - a.attemptCount || a.name.localeCompare(b.name));

  _aktdLastResult = rows;
  _aktdLastMeta   = { subjectCode, subjectName: subject.name, component, label, fields, batchYear, division, branch, gender };

  // Summary bar
  const batchLabel    = batchYear || 'All Batches';
  const divLabel      = division  || 'All Divisions';
  const genderLabel   = gender    || 'All';
  const branchLabel   = branch    || 'All Branches';
  summary.textContent = `${rows.length} student${rows.length !== 1 ? 's' : ''} with Active KT · ${subject.code} — ${subject.name} · ${label} · ${branchLabel} · ${batchLabel} · ${divLabel} · ${genderLabel}`;

  if (rows.length === 0) {
    output.innerHTML = '<div class="empty-state">No students with an Active KT for this selection.</div>';
    _eligSetCsvEnabled('rpt-aktd-csv', false);
    return;
  }

  // Build mark column headers
  const markHeaders = fields.map(f => {
    if (f === 'eseMarks')  return `ESE <span class="muted">(max ${subject.marks.ESE ?? '—'})</span>`;
    if (f === 'twMarks')   return `TW <span class="muted">(max ${subject.marks.TW ?? '—'})</span>`;
    if (f === 'oralMarks') return `Oral <span class="muted">(max ${subject.marks.Oral ?? '—'})</span>`;
    if (f === 'iatMarks')  return `IAT <span class="muted">(max ${subject.marks.IAT ?? '—'})</span>`;
    return f;
  }).join('</th><th>');

  let html = `
    <table class="progress-table" style="width:100%; font-size:12px;">
      <thead><tr>
        <th>#</th>
        <th>UIN</th>
        <th>Name</th>
        <th>Branch</th>
        <th>Div</th>
        <th>Batch</th>
        <th>Gender</th>
        <th>Attempts</th>
        <th>Last Session</th>
        <th>${markHeaders}</th>
        <th>Result</th>
        <th></th>
      </tr></thead>
      <tbody>`;

  rows.forEach((r, i) => {
    const markCells = fields.map(f => `<td>${UI.esc(r.compMarks[f])}</td>`).join('');
    html += `<tr>
      <td class="muted">${i + 1}</td>
      <td class="muted"><span class="subj-code-small">${UI.esc(r.uin)}</span><br>${UI.esc(r.prn)}</td>
      <td><strong>${UI.esc(r.name)}</strong></td>
      <td>${UI.esc(r.branch)}</td>
      <td>${UI.esc(r.division)}</td>
      <td>${UI.esc(r.batchYear)}</td>
      <td>${UI.esc(r.gender)}</td>
      <td>${r.lastSessionId ? (() => { const t = State.computeAttemptTag(r.uin, _aktdLastMeta.subjectCode, r.lastSessionId); return t ? `<span class="badge ${t.startsWith('Unsuccessful') ? 'badge-fail' : t.includes('after Reval') || t.includes('Marks Reval') ? 'badge-reval' : 'badge-pass'}" title="${UI.esc(t)}">${UI.esc(t)}</span>` : '—'; })() : '—'}</td>
      <td class="muted" style="font-size:11px;">${UI.esc(r.lastSession)}</td>
      ${markCells}
      <td><span class="badge ${r.result === 'AB' ? 'badge-warning' : 'badge-kt'}">${UI.esc(r.result)}</span></td>
      <td><button class="btn btn-secondary btn-sm" onclick="_aktdOpenProgress('${UI.esc(r.uin)}')">More Details</button></td>
    </tr>`;
  });

  html += '</tbody></table>';
  output.innerHTML = html;
  _eligSetCsvEnabled('rpt-aktd-csv', true);
}

function _aktdOpenProgress(uin) {
  showTab('progress');
  // Small delay to let the tab render before populating
  setTimeout(() => _pvShowStudent(uin), 80);
}

function _aktdExportCSV() {
  if (_aktdLastResult.length === 0) { UI.toast('Nothing to export.', 'error'); return; }
  const { subjectCode, subjectName, label, fields, batchYear } = _aktdLastMeta;
  const markColHeaders = fields.map(f => {
    if (f === 'eseMarks')  return 'ESE Marks';
    if (f === 'twMarks')   return 'TW Marks';
    if (f === 'oralMarks') return 'Oral Marks';
    if (f === 'iatMarks')  return 'IAT Marks';
    return f;
  });
  const headers = ['#','PRN','UIN','Name','Branch','Division','Batch Year','Gender','Attempts','Unsuccessful Reval','Last Session',...markColHeaders,'Result'];
  const data = _aktdLastResult.map((r, i) => [
    i + 1, r.prn, r.uin, r.name, r.branch, r.division, r.batchYear, r.gender,
    r.attemptCount, r.hasUnsuccessfulReval ? 'Yes' : '', r.lastSession,
    ...fields.map(f => r.compMarks[f] || ''),
    r.result,
  ]);
  const filename = `ActiveKT_${subjectCode}_${label.replace(/\s*\/\s*/g,'_')}_${batchYear || 'AllBatches'}`;
  UI.exportCSV(filename, headers, data);
  UI.toast(`Exported ${_aktdLastResult.length} rows.`, 'success');
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
  initGazetteExport();

  _adminRenderSessionList();
  _adminRenderAudit();
}

function _adminToggleLinkedPrelim() {
  const entryType = document.getElementById('admin-session-entry-type')?.value;
  const section   = document.getElementById('admin-linked-prelim-section');
  if (section) section.classList.toggle('hidden', entryType !== 'Revaluation_Gazette');
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
    s.entryType !== 'Revaluation_Gazette' &&
    (sem === 0   || s.semester  === sem) &&
    (batch === '' || s.batchYear === batch)
  ));
  selEl.innerHTML = '<option value="">— none (skip reval detection) —</option>' +
    prelims.map(s => `<option value="${UI.esc(s.id)}">${UI.esc(s.name)}</option>`).join('');
}

function _adminPopulateLinkDropdowns() {
  // For the "update link" section
  const finalSessions = sortSessions(State.getSessions().filter(s => s.entryType === 'Revaluation_Gazette'));
  const finalSelEl    = document.getElementById('admin-link-final-select');
  if (finalSelEl) {
    finalSelEl.innerHTML = '<option value="">— select Revaluation Gazette session —</option>' +
      finalSessions.map(s => `<option value="${UI.esc(s.id)}">${UI.esc(s.name)} (Sem ${s.semester}, ${s.batchYear})</option>`).join('');
    finalSelEl.onchange = () => {
      const sess = State.getSession(finalSelEl.value);
      const prelimSelEl = document.getElementById('admin-link-prelim-select');
      if (!prelimSelEl || !sess) return;
      const prelims = sortSessions(State.getSessions().filter(s =>
        s.entryType !== 'Revaluation_Gazette' &&
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
  const type  = document.getElementById('admin-session-entry-type')?.value || 'Uni_Portal_Gazette';
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
  const entryType = document.getElementById('admin-session-entry-type')?.value || 'Uni_Portal_Gazette';
  const linkedPrelimSessionId = entryType === 'Revaluation_Gazette'
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
        document.getElementById('admin-session-entry-type').value = 'Uni_Portal_Gazette';
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

    const typeCls   = s.entryType === 'Revaluation_Gazette' ? 'badge-reval' : 'badge-regular';
const typeLabel = s.entryType ? s.entryType.replace(/_/g, ' ') : 'Uni Portal Gazette';

    let linkedInfo = '—';
    if (s.entryType === 'Revaluation_Gazette') {
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
  const existing = State.getSeatsForSessionWithFallback(sessionId).find(s => s.uin === _manualSeatStudent.uin);

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
  if (!finalId) { UI.toast('Select a Revaluation Gazette session.', 'error'); return; }
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
      <td><span class="subj-code-small">${UI.esc(r.uin)}</span></td>
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

function initGazetteExport() {
  const yearEl    = document.getElementById('gaz-year');
  const monthEl   = document.getElementById('gaz-month');
  const semEl     = document.getElementById('gaz-semester');
  const modeEl    = document.getElementById('gaz-mode');
  const infoEl    = document.getElementById('gaz-session-info');
  const previewBtn = document.getElementById('gaz-preview-btn');
  if (!yearEl) return;

  // Populate year dropdown
  const years = [...new Set(State.getSessions().map(s => s.name.slice(0,4)))].sort().reverse();
  yearEl.innerHTML = '<option value="">—</option>' +
    years.map(y => `<option value="${y}">${y}</option>`).join('');

  function _resolve() {
    const year  = yearEl.value;
    const month = monthEl.value;
    const sem   = semEl.value;
    if (!year || !month || !sem) {
      infoEl.textContent = '';
      previewBtn.disabled = true;
      return;
    }
    const mo     = month === 'December' ? 'Dec' : 'May';
    const semStr = sem === '1' ? 'Sem-I' : 'Sem-II';
    const prefix = `${year}_${mo}_${semStr}_`;
    const all    = State.getSessions();
    const upg    = all.find(s => s.name === prefix + 'Uni-Portal-Gazette');
    const reval  = all.find(s => s.name === prefix + 'Revaluation-Gazette');

    if (!upg) {
      infoEl.innerHTML = `<span style="color:var(--fail);">No Uni Portal Gazette session found for this period.</span>`;
      previewBtn.disabled = true;
      return;
    }

    const revalLinked = reval && reval.linkedPrelimSessionId === upg.id;
    let info = `<span style="color:var(--pass);">✓ ${upg.name}</span>`;
    if (revalLinked) {
      info += ` &nbsp;+&nbsp; <span style="color:var(--reval);">✓ ${reval.name}</span>`;
    } else {
      info += ` &nbsp;·&nbsp; <span style="color:var(--ink-4);">No linked Revaluation Gazette</span>`;
      // Disable reval/merged modes if no gazette
      if (modeEl.value === 'reval' || modeEl.value === 'merged') modeEl.value = 'upg';
    }
    infoEl.innerHTML = info;
    previewBtn.disabled = false;
    previewBtn._upg   = upg;
    previewBtn._reval = revalLinked ? reval : null;
  }

  [yearEl, monthEl, semEl, modeEl].forEach(el => el.addEventListener('change', _resolve));
  previewBtn.onclick = _gazettePreview;
}

function _gazettePreview() {
  const previewBtn = document.getElementById('gaz-preview-btn');
  const upg        = previewBtn._upg;
  const reval      = previewBtn._reval;
  const mode       = document.getElementById('gaz-mode').value;
  const format     = document.getElementById('gaz-format').value;
  if (!upg) return;

  // Branch-wise stats
  let tableRows = '';
  let grandTotal = 0, grandPass = 0, grandFail = 0, grandAB = 0, grandReval = 0;

  for (const branch of BRANCHES) {
    const students = State.getEligibleStudents(upg, branch);
    if (!students.length) continue;

    let pass = 0, fail = 0, ab = 0, revalCount = 0;

    for (const student of students) {
      const acad    = State.computeStudentAcademics(student.uin);
      const sessId  = mode === 'reval' && reval ? reval.id : upg.id;
      const sessRes = acad?.sessionResults.find(sr => sr.session.id === sessId);
      if (!sessRes) continue;

      const anyAB   = sessRes.subjects.some(s => !s.pending && s.dr?.result === 'AB');
      const anyFail = sessRes.subjects.some(s => !s.pending && s.dr?.result === 'Fail');
      if (anyAB)        ab++;
      else if (anyFail) fail++;
      else              pass++;

      // Reval count — students whose ESE changed
      if (reval && mode !== 'upg') {
        const changed = State.ledger.some(r =>
          r.uin === student.uin &&
          r.examSession === reval.id &&
          (() => {
            const pr = State.ledger.filter(p =>
              p.uin === student.uin &&
              p.examSession === upg.id
            ).sort((a,b) => b.entryDateTime.localeCompare(a.entryDateTime))[0];
            return pr && String(r.eseMarks).trim() !== String(pr.eseMarks).trim();
          })()
        );
        if (changed) revalCount++;
      }
    }

    const total = pass + fail + ab;
    grandTotal += total; grandPass += pass; grandFail += fail; grandAB += ab; grandReval += revalCount;
    const pct = total ? Math.round(pass / total * 100) : 0;

    tableRows += `<tr>
      <td>${UI.esc(branch)}</td>
      <td>${total}</td>
      <td style="color:var(--pass);font-weight:600;">${pass}</td>
      <td style="color:var(--fail);font-weight:600;">${fail}</td>
      <td style="color:var(--ab);font-weight:600;">${ab}</td>
      <td><span class="badge ${pct >= 60 ? 'badge-pass' : 'badge-fail'}">${pct}%</span></td>
      ${reval && mode !== 'upg' ? `<td style="color:var(--reval);font-weight:600;">${revalCount}</td>` : ''}
    </tr>`;
  }

  const revalCol = reval && mode !== 'upg' ? '<th>Reval</th>' : '';
  const grandPct = grandTotal ? Math.round(grandPass / grandTotal * 100) : 0;

  const body = `
    <p style="font-size:12px;color:var(--ink-3);margin-bottom:12px;">
      <strong>${upg.name}</strong>${reval && mode !== 'upg' ? ` + ${reval.name}` : ''}<br>
      Mode: <strong>${mode === 'upg' ? 'Uni Portal Gazette' : mode === 'reval' ? 'Revaluation Gazette' : 'Merged Semester Gazette'}</strong>
      &nbsp;·&nbsp; Format: <strong>${format === 'uni' ? 'Uni Format' : 'Single Row'}</strong>
    </p>
    <div style="overflow-x:auto;">
    <table class="report-table">
      <thead><tr><th>Branch</th><th>Total</th><th>Pass</th><th>Fail</th><th>AB</th><th>Pass%</th>${revalCol}</tr></thead>
      <tbody>
        ${tableRows}
        <tr style="font-weight:700;background:var(--surface-2);">
          <td>All Branches</td>
          <td>${grandTotal}</td>
          <td style="color:var(--pass);">${grandPass}</td>
          <td style="color:var(--fail);">${grandFail}</td>
          <td style="color:var(--ab);">${grandAB}</td>
          <td><span class="badge ${grandPct >= 60 ? 'badge-pass' : 'badge-fail'}">${grandPct}%</span></td>
          ${reval && mode !== 'upg' ? `<td style="color:var(--reval);">${grandReval}</td>` : ''}
        </tr>
      </tbody>
    </table></div>`;

  UI.showModal(
    'Gazette Preview',
    body,
    {
      confirmLabel: '⬇ Export Excel',
      onConfirm: () => _gazetteExport(upg, reval, mode, format),
    }
  );
}

function _gazetteExport(upg, reval, mode, format) {
  if (format === 'uni') {
    _exportUniFormat(upg, reval, mode);
  } else {
    _exportSingleRow(upg, reval, mode);
  }
}

function _exportSingleRow(upg, reval, mode) {
  // Resolve which session drives the export
  const session = mode === 'reval' && reval ? reval
                : mode === 'merged' && reval ? reval
                : upg;
  const linkedPrelimId = mode === 'merged' && reval
    ? upg.id
    : session.linkedPrelimSessionId || null;
  const isFinal = mode !== 'upg' && !!reval;

  const wb = XLSX.utils.book_new();

  for (const branch of BRANCHES) {
    let students = State.getEligibleStudents(upg, branch);

    // For reval mode — only students whose ESE changed
    if (mode === 'reval' && reval) {
      students = students.filter(s =>
        State.ledger.some(r =>
          r.uin === s.uin && r.examSession === reval.id && (() => {
            const pr = State.ledger
              .filter(p => p.uin === s.uin && p.examSession === upg.id)
              .sort((a,b) => b.entryDateTime.localeCompare(a.entryDateTime))[0];
            return pr && String(r.eseMarks).trim() !== String(pr.eseMarks).trim();
          })()
        )
      );
    }

    if (!students.length) continue;

    // Seat lookup
    const seatEntries = State.getSeatsForSessionWithFallback(upg.id);
    const seatLookup  = {};
    for (const s of seatEntries) seatLookup[s.uin] = s.seatNumber;

    // Sort by seat
    students.sort((a, b) => {
      const sa = seatLookup[a.uin] || '', sb = seatLookup[b.uin] || '';
      const na = Number(sa), nb = Number(sb);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return sa.localeCompare(sb);
    });

    const subjects = getSubjectsForSem(upg.semester, branch, upg);
    const FIXED_COLS  = ['Seat No', 'UIN', 'Batch', 'Status'];
    const FIXED_COUNT = FIXED_COLS.length;

    const subjCols = [];
    for (const subj of subjects) {
      for (const [comp, max] of Object.entries(subj.marks)) {
        subjCols.push({ subj, comp, max });
      }
      subjCols.push({ subj, comp: 'Total', max: null, isTotal: true });
      subjCols.push({ subj, comp: 'Grade', max: null, isGrade: true });
    }
    const SUMMARY_COLS = ['Total Marks', 'ΣC', 'ΣCG', 'SGPA', 'Result'];

    const titleRow = [`${upg.name}${reval && mode !== 'upg' ? ' + ' + reval.name : ''} — ${branch} — ${mode === 'upg' ? 'Uni Portal Gazette' : mode === 'reval' ? 'Revaluation Gazette' : 'Merged'}`, ...Array(FIXED_COUNT - 1 + subjCols.length + SUMMARY_COLS.length - 1).fill('')];

    const subjectHeaderRow = [...FIXED_COLS];
    for (const subj of subjects) {
      const compCount = Object.keys(subj.marks).length + 2;
      subjectHeaderRow.push(subj.code);
      for (let i = 1; i < compCount; i++) subjectHeaderRow.push('');
    }
    subjectHeaderRow.push(...SUMMARY_COLS);

    const compHeaderRow = [...Array(FIXED_COUNT).fill('')];
    for (const { comp } of subjCols) compHeaderRow.push(comp);
    compHeaderRow.push(...Array(SUMMARY_COLS.length).fill(''));

    const maxRow = [...Array(FIXED_COUNT).fill('')];
    for (const { max, isGrade } of subjCols) {
      maxRow.push(isGrade ? '' : (max !== null ? `/${max}` : ''));
    }
    maxRow.push(...Array(SUMMARY_COLS.length).fill(''));

    const wsData = [titleRow, subjectHeaderRow, compHeaderRow, maxRow];

    for (const student of students) {
      const seatNum = seatLookup[student.uin] || '—';
      const acad    = State.computeStudentAcademics(student.uin);
      const sessResult = acad?.sessionResults.find(sr => sr.session.id === session.id);

      const row = [seatNum, student.uin, student.batchYear, student.attemptFlag || 'Regular'];

      let studentTotalMarks = 0, studentCredits = 0, studentAllPass = true, studentAnyAB = false;

      for (const subj of subjects) {
        const dr = sessResult?.subjects.find(s => s.r.subjectCode === subj.code)?.dr;
        const latestEntry = State.getLatestEntryForSubject(student.uin, subj.code, session.id);

        let iatVal = '', eseVal = '', twVal = '', oralVal = '';
        if (latestEntry) {
          iatVal  = latestEntry.iatMarks  || '';
          eseVal  = latestEntry.eseMarks  || '';
          twVal   = latestEntry.twMarks   || '';
          oralVal = latestEntry.oralMarks || '';
        }
        if (isFinal && upg.id) {
          const prelim = State.getLatestEntryForSubject(student.uin, subj.code, upg.id);
          if (prelim) {
            if (!iatVal)  iatVal  = prelim.iatMarks  || '';
            if (!twVal)   twVal   = prelim.twMarks   || '';
            if (!oralVal) oralVal = prelim.oralMarks || '';
          }
        }
        const compValMap = { IAT: iatVal, ESE: eseVal, TW: twVal, Oral: oralVal };
        for (const comp of Object.keys(subj.marks)) row.push(compValMap[comp] || '—');

        if (dr && !dr.pending) {
          row.push(dr.total);
          row.push(dr.grade);
          studentTotalMarks += dr.total;
          studentCredits    += dr.creditsEarned;
          if (dr.result === 'Fail') studentAllPass = false;
          if (dr.result === 'AB')   { studentAllPass = false; studentAnyAB = true; }
        } else {
          row.push('—'); row.push('—');
          studentAllPass = false;
        }
      }

      const sessAcad  = acad?.sessionResults.find(sr => sr.session.id === session.id);
      const sgpaStr   = sessAcad?.sgpa != null ? sessAcad.sgpa.toFixed(2) : '—';
      const resultStr = studentAnyAB ? 'AB' : studentAllPass ? 'Pass' : 'Fail';
      const sumGxC    = sessAcad?.subjects.reduce((s, sub) => s + (sub.dr?.GxC || 0), 0) ?? 0;

      row.push(studentTotalMarks || '—');
      row.push(studentCredits    || '—');
      row.push(sumGxC ? sumGxC.toFixed(1) : '—');
      row.push(sgpaStr);
      row.push(resultStr);

      wsData.push(row);
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [
      { wch: 8 }, { wch: 14 }, { wch: 8 }, { wch: 9 },
      ...subjCols.map(({ comp }) => comp === 'Grade' ? { wch: 6 } : comp === 'Total' ? { wch: 7 } : { wch: 6 }),
      { wch: 12 }, { wch: 6 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
    ];

    const merges = [];
    let colIdx = FIXED_COUNT;
    for (const subj of subjects) {
      const span = Object.keys(subj.marks).length + 2;
      if (span > 1) merges.push({ s: { r: 1, c: colIdx }, e: { r: 1, c: colIdx + span - 1 } });
      colIdx += span;
    }
    ws['!merges'] = merges;
    XLSX.utils.book_append_sheet(wb, ws, branch.slice(0, 31));
  }

  _appendGazetteSummarySheet(wb, upg, reval, mode);
  const filename = `${upg.name}${mode !== 'upg' ? '_' + mode : ''}_SingleRow.xlsx`;
  XLSX.writeFile(wb, filename);
  UI.toast(`✓ Exported: ${filename}`, 'success');
}

function _exportUniFormat(upg, reval, mode) {
  const wb = XLSX.utils.book_new();

  for (const branch of BRANCHES) {
    let students = State.getEligibleStudents(upg, branch);

    // Reval mode — only students whose ESE changed
    if (mode === 'reval' && reval) {
      students = students.filter(s =>
        State.ledger.some(r =>
          r.uin === s.uin && r.examSession === reval.id && (() => {
            const pr = State.ledger
              .filter(p => p.uin === s.uin && p.examSession === upg.id)
              .sort((a,b) => b.entryDateTime.localeCompare(a.entryDateTime))[0];
            return pr && String(r.eseMarks).trim() !== String(pr.eseMarks).trim();
          })()
        )
      );
    }

    if (!students.length) continue;

    // Seat lookup
    const seatEntries = State.getSeatsForSessionWithFallback(upg.id);
    const seatLookup  = {};
    for (const s of seatEntries) seatLookup[s.uin] = s.seatNumber;

    students.sort((a, b) => {
      const sa = seatLookup[a.uin] || '', sb = seatLookup[b.uin] || '';
      const na = Number(sa), nb = Number(sb);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return sa.localeCompare(sb);
    });

    const subjects  = getSubjectsForSem(upg.semester, branch, upg);
    const isMerged  = mode !== 'upg' && !!reval;
    const sessId    = isMerged ? reval.id : upg.id;

    // ── Fixed columns ─────────────────────────────────────
    // Seat, Name, UIN, Batch, Status — merged across 5 rows per student
    const FIXED = ['Seat', 'Name', 'UIN', 'Batch', 'Status'];
    const FC    = FIXED.length;

    // ── Subject columns ───────────────────────────────────
    // Each subject expands to its components + one TOT col
    // subjColMap[subjCode] = [comp, comp, ..., 'TOT']
    const subjCols = []; // { subj, comp } — one entry per Excel column
    for (const subj of subjects) {
      for (const comp of Object.keys(subj.marks)) {
        subjCols.push({ subj, comp, isTot: false });
      }
      subjCols.push({ subj, comp: 'TOT', isTot: true });
    }

    // ── Summary columns ───────────────────────────────────
    const SUMM = ['Total', 'ΣC', 'ΣCG', 'SGPA', 'Result'];

    // ── Header rows ───────────────────────────────────────
    // Row 0: title
    const titleRow = [
      `${upg.name}${reval && mode !== 'upg' ? ' + ' + reval.name : ''} — ${branch} — ${mode === 'upg' ? 'Uni Portal Gazette' : mode === 'reval' ? 'Revaluation Gazette' : 'Merged'} — Uni Format`,
      ...Array(FC - 1 + subjCols.length + SUMM.length - 1).fill(''),
    ];

    // Row 1: fixed col names + subject codes (spanning)
    const subjectHeaderRow = [...FIXED];
    for (const subj of subjects) {
      const span = Object.keys(subj.marks).length + 1; // comps + TOT
      subjectHeaderRow.push(`${subj.code} — ${subj.name} (${subj.credits}cr)`);
      for (let i = 1; i < span; i++) subjectHeaderRow.push('');
    }
    subjectHeaderRow.push(...SUMM);

    // Row 2: component headers + max marks
    const compHeaderRow = [...Array(FC).fill('')];
    for (const { comp, subj, isTot } of subjCols) {
      if (isTot) {
        compHeaderRow.push('TOT · G · GP · C · G×C');
      } else {
        const max = subj.marks[comp];
        compHeaderRow.push(`${comp} (/${max})`);
      }
    }
    compHeaderRow.push(...Array(SUMM.length).fill(''));

    const wsData = [titleRow, subjectHeaderRow, compHeaderRow];

    // ── Student rows ──────────────────────────────────────
    // 4 component rows + 1 TOT row = 5 rows per student
    const COMP_ROWS = ['TW', 'Oral', 'ESE', 'IAT'];

    for (const student of students) {
      const seatNum = seatLookup[student.uin] || '—';
      const acad    = State.computeStudentAcademics(student.uin);
      const sessRes = acad?.sessionResults.find(sr => sr.session.id === sessId);
      // For merged: also get UPG session result for carried mark detection
      const upgRes  = isMerged
        ? acad?.sessionResults.find(sr => sr.session.id === upg.id)
        : sessRes;

      // Build marks map per subject: { subjCode: { TW, Oral, ESE, IAT, carried:{comp:bool} } }
      const marksPerSubj = {};
      for (const subj of subjects) {
        const revalEntry = isMerged && reval
          ? State.getLatestEntryForSubject(student.uin, subj.code, reval.id)
          : null;
        const upgEntry   = State.getLatestEntryForSubject(student.uin, subj.code, upg.id);

        const marks   = {};
        const carried = {};

        for (const comp of Object.keys(subj.marks)) {
          const field = comp.toLowerCase() + 'Marks';
          // For ESE in merged/reval mode: prefer reval entry
          if (isMerged && comp === 'ESE' && revalEntry?.eseMarks) {
            marks[comp]   = revalEntry.eseMarks;
            carried[comp] = false;
          } else if (upgEntry?.[field]) {
            marks[comp]   = upgEntry[field];
            carried[comp] = false;
          } else {
            // Check prior sessions for carried mark
            const prior = State.ledger
              .filter(r =>
                r.uin === student.uin &&
                r.subjectCode === subj.code &&
                r.examSession !== upg.id &&
                (!reval || r.examSession !== reval.id)
              )
              .sort((a,b) => b.entryDateTime.localeCompare(a.entryDateTime))[0];
            if (prior?.[field]) {
              const max    = subj.marks[comp];
              const parsed = parseMarkValue(prior[field], max);
              const passed = parsed.valid && !parsed.absent &&
                (parsed.grace || (max && parsed.value / max >= 0.40));
              if (passed) {
                marks[comp]   = prior[field] + '+';
                carried[comp] = true;
              }
            }
          }
        }
        marksPerSubj[subj.code] = { marks, carried };
      }

      // Build 4 component rows
      const compRows = COMP_ROWS.map(compName => {
        const row = ['', '', '', '', '']; // fixed cols blank except merged later
        for (const { subj, comp, isTot } of subjCols) {
          if (isTot) {
            row.push(''); // TOT col blank in component rows
          } else if (comp === compName) {
            row.push(marksPerSubj[subj.code]?.marks[comp] ?? '—');
          } else {
            row.push('');
          }
        }
        row.push(...Array(SUMM.length).fill(''));
        return row;
      });

      // Build TOT row
      const totRow = ['', '', '', '', ''];
      let studentTotal = 0, studentSumC = 0, studentSumCG = 0;
      let anyFail = false, anyAB = false;

      for (const { subj, comp, isTot } of subjCols) {
        if (!isTot) { totRow.push(''); continue; }
        // Compute display result for this subject
        const subjEntry = sessRes?.subjects.find(s => s.r.subjectCode === subj.code);
        const dr = subjEntry?.dr;
        if (dr && !dr.pending) {
          totRow.push(`${dr.total} · ${dr.grade} · ${dr.gradePoint} · ${dr.creditsEarned} · ${dr.GxC.toFixed(1)}`);
          studentTotal  += dr.total;
          studentSumC   += dr.creditsEarned;
          studentSumCG  += dr.GxC;
          if (dr.result === 'Fail') anyFail = true;
          if (dr.result === 'AB')   anyAB   = true;
        } else {
          totRow.push('—');
        }
      }

      const sgpa      = sessRes?.sgpa != null ? sessRes.sgpa.toFixed(2) : '—';
      const resultStr = anyAB ? 'AB' : anyFail ? 'Fail' : 'Pass';

      totRow.push(studentTotal || '—');
      totRow.push(studentSumC  || '—');
      totRow.push(studentSumCG ? studentSumCG.toFixed(1) : '—');
      totRow.push(sgpa);
      totRow.push(resultStr);

      // Set fixed info in first component row (TW row)
      compRows[0][0] = seatNum;
      compRows[0][1] = student.name;
      compRows[0][2] = student.uin;
      compRows[0][3] = student.batchYear;
      compRows[0][4] = student.attemptFlag || 'Regular';

      wsData.push(...compRows, totRow);
    }

    // ── Create worksheet ──────────────────────────────────
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Column widths
    ws['!cols'] = [
      { wch: 8 },  // Seat
      { wch: 26 }, // Name
      { wch: 14 }, // UIN
      { wch: 8 },  // Batch
      { wch: 9 },  // Status
      ...subjCols.map(({ isTot }) => isTot ? { wch: 28 } : { wch: 8 }),
      { wch: 8 }, { wch: 6 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
    ];

    // Merges: subject header row (row index 1) — span per subject
    const merges = [];
    let colIdx = FC;
    for (const subj of subjects) {
      const span = Object.keys(subj.marks).length + 1;
      if (span > 1) merges.push({ s: { r: 1, c: colIdx }, e: { r: 1, c: colIdx + span - 1 } });
      colIdx += span;
    }

    // Merges: fixed info cells per student (5 rows merged per student)
    const HEADER_ROWS = 3;
    const ROWS_PER_STUDENT = 5; // 4 comp rows + 1 TOT row
    for (let i = 0; i < students.length; i++) {
      const startRow = HEADER_ROWS + i * ROWS_PER_STUDENT;
      const endRow   = startRow + ROWS_PER_STUDENT - 1;
      for (let c = 0; c < FC; c++) {
        merges.push({ s: { r: startRow, c }, e: { r: endRow, c } });
      }
      // Also merge summary cols across all 5 rows per student
      for (let c = FC + subjCols.length; c < FC + subjCols.length + SUMM.length; c++) {
        merges.push({ s: { r: startRow, c }, e: { r: endRow, c } });
      }
    }

    ws['!merges'] = merges;
    XLSX.utils.book_append_sheet(wb, ws, branch.slice(0, 31));
  }

  _appendGazetteSummarySheet(wb, upg, reval, mode);
  const filename = `${upg.name}${mode !== 'upg' ? '_' + mode : ''}_UniFormat.xlsx`;
  XLSX.writeFile(wb, filename);
  UI.toast(`✓ Exported: ${filename}`, 'success');
}

function _appendGazetteSummarySheet(wb, upg, reval, mode) {
  const sessId = (mode !== 'upg' && reval) ? reval.id : upg.id;

  const summaryData = [
    [`Gazette Summary — ${upg.name}${reval && mode !== 'upg' ? ' + ' + reval.name : ''} — ${mode}`],
    ['Branch', 'Total', 'Pass', 'Fail', 'AB', 'Pass %', 'Topper', 'Topper Marks'],
  ];

  for (const branch of BRANCHES) {
    let students = State.getEligibleStudents(upg, branch);
    if (!students.length) continue;

    if (mode === 'reval' && reval) {
      students = students.filter(s =>
        State.ledger.some(r =>
          r.uin === s.uin && r.examSession === reval.id && (() => {
            const pr = State.ledger
              .filter(p => p.uin === s.uin && p.examSession === upg.id)
              .sort((a,b) => b.entryDateTime.localeCompare(a.entryDateTime))[0];
            return pr && String(r.eseMarks).trim() !== String(pr.eseMarks).trim();
          })()
        )
      );
    }

    let pass = 0, fail = 0, ab = 0, topper = null;
    for (const student of students) {
      const acad    = State.computeStudentAcademics(student.uin);
      const sessRes = acad?.sessionResults.find(sr => sr.session.id === sessId);
      if (!sessRes) continue;

      const anyAB   = sessRes.subjects.some(s => !s.pending && s.dr?.result === 'AB');
      const anyFail = sessRes.subjects.some(s => !s.pending && (s.dr?.result === 'Fail' || s.pending));
      const total   = sessRes.subjects.reduce((s, sub) => s + (sub.dr?.total || 0), 0);
      const result  = anyAB ? 'AB' : anyFail ? 'Fail' : 'Pass';

      if (result === 'Pass') { pass++; if (!topper || total > topper.marks) topper = { name: student.name, marks: total }; }
      else if (result === 'AB') ab++;
      else fail++;
    }

    const t = students.length;
    summaryData.push([
      branch, t, pass, fail, ab,
      t ? Math.round(pass / t * 100) + '%' : '—',
      topper?.name || '—',
      topper?.marks ?? '—',
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(summaryData);
  ws['!cols'] = [
    { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 6 },
    { wch: 8 }, { wch: 28 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Summary');
}

// ═══════════════════════════════════════════════════════════════
// REPORTS — Cleared in N Attempts
// ═══════════════════════════════════════════════════════════════
function _ciaPopulateSubjects() {
  const el = document.getElementById('rpt-cia-subject');
  if (!el) return;

  const allSubjects = _aktdAllSubjects();

  el.innerHTML =
    '<option value="">— select —</option>' +
    '<option value="SEM1">— Semester I (all subjects) —</option>' +
    '<option value="SEM2">— Semester II (all subjects) —</option>' +
    '<option value="FY">— First Year (both sems) —</option>' +
    '<optgroup label="Individual Subjects">' +
    allSubjects.map(s =>
      `<option value="${UI.esc(s.code)}">${UI.esc(s.code)} — ${UI.esc(s.name)}</option>`
    ).join('') +
    '</optgroup>';
}

function _ciaPopulateBatchYears() {
  const el = document.getElementById('rpt-cia-batch');
  if (!el) return;
  const years = State.getBatchYears();
  el.innerHTML = '<option value="">— all batches —</option>' +
    years.map(y => `<option value="${UI.esc(y)}">${UI.esc(y)}</option>`).join('');
}

function _ciaClearOutput() {
  document.getElementById('rpt-cia-output').innerHTML  = '';
  document.getElementById('rpt-cia-summary').textContent = '';
  _eligSetCsvEnabled('rpt-cia-csv', false);
}

let _ciaLastResult = [];
let _ciaLastMeta   = {};

function _ciaRun() {
  const subjectCode     = document.getElementById('rpt-cia-subject').value;
  const targetAttempts  = Number(document.getElementById('rpt-cia-attempts').value);
  const batchYear       = document.getElementById('rpt-cia-batch').value;
  const division        = document.getElementById('rpt-cia-division').value;
  const branch          = document.getElementById('rpt-elig-branch').value  || null;
  const gender          = document.getElementById('rpt-elig-gender').value  || null;
  const output          = document.getElementById('rpt-cia-output');
  const summary         = document.getElementById('rpt-cia-summary');

  if (!subjectCode)    { UI.toast('Please select a subject or scope.', 'error'); return; }
  if (!targetAttempts) { UI.toast('Please select number of attempts.', 'error'); return; }

  const rows = State.reportClearedInAttempts({
    subjectCode, targetAttempts, branch, division: division || undefined,
    batchYear: batchYear || undefined, gender: gender || undefined,
  });

  _ciaLastResult = rows;
  _ciaLastMeta   = { subjectCode, targetAttempts, branch, division, batchYear, gender };

  // Summary label
  const scopeLabel = subjectCode === 'SEM1' ? 'Semester I'
                   : subjectCode === 'SEM2' ? 'Semester II'
                   : subjectCode === 'FY'   ? 'First Year'
                   : subjectCode;
  const attemptLabel = targetAttempts === 1 ? '1st attempt'
                     : targetAttempts === 2 ? '2nd attempt'
                     : targetAttempts === 3 ? '3rd attempt'
                     : `${targetAttempts}th attempt`;
  const branchLabel  = branch    || 'All Branches';
  const divLabel     = division  || 'All Divisions';
  const batchLabel   = batchYear || 'All Batches';
  const genderLabel  = gender    || 'All';

  summary.textContent = `${rows.length} student${rows.length !== 1 ? 's' : ''} cleared ${scopeLabel} in ${attemptLabel} · ${branchLabel} · ${divLabel} · ${batchLabel} · ${genderLabel}`;

  if (rows.length === 0) {
    output.innerHTML = '<div class="empty-state">No students found for this selection.</div>';
    _eligSetCsvEnabled('rpt-cia-csv', false);
    return;
  }

  const ordinal = n => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;

  let html = `
    <table class="progress-table" style="width:100%; font-size:12px;">
      <thead><tr>
        <th>#</th>
        <th>UIN</th>
        <th>Name</th>
        <th>Branch</th>
        <th>Div</th>
        <th>Batch</th>
        <th>Gender</th>
        <th>Attempts</th>
        <th>Cleared In Session</th>
        <th></th>
      </tr></thead>
      <tbody>`;

  rows.forEach((r, i) => {
    const attemptBadgeCls = r.attemptCount === 1 ? 'badge-pass'
                          : r.attemptCount === 2 ? 'badge-regular'
                          : r.attemptCount <= 4  ? 'badge-pending'
                          : 'badge-kt';
    html += `<tr>
      <td class="muted">${i + 1}</td>
      <td class="muted"><span class="subj-code-small">${UI.esc(r.uin)}</span><br>${UI.esc(r.prn)}</td>
      <td><strong>${UI.esc(r.name)}</strong></td>
      <td>${UI.esc(r.branch)}</td>
      <td>${UI.esc(r.division)}</td>
      <td>${UI.esc(r.batchYear)}</td>
      <td>${UI.esc(r.gender)}</td>
      <td><span class="badge ${attemptBadgeCls}">${ordinal(r.attemptCount)} attempt</span></td>
      <td class="muted" style="font-size:11px;">${UI.esc(r.clearedInSession || '—')}</td>
      <td><button class="btn btn-secondary btn-sm"
            onclick="_aktdOpenProgress('${UI.esc(r.uin)}')">More Details</button></td>
    </tr>`;
  });

  html += '</tbody></table>';
  output.innerHTML = html;
  _eligSetCsvEnabled('rpt-cia-csv', true);
}

function _ciaExportCSV() {
  if (!_ciaLastResult.length) { UI.toast('Nothing to export.', 'error'); return; }
  const { subjectCode, targetAttempts } = _ciaLastMeta;
  const scopeLabel = subjectCode === 'SEM1' ? 'Sem1'
                   : subjectCode === 'SEM2' ? 'Sem2'
                   : subjectCode === 'FY'   ? 'FirstYear'
                   : subjectCode;
  const headers = ['#', 'PRN', 'UIN', 'Name', 'Branch', 'Division',
                   'Batch Year', 'Gender', 'Attempts', 'Cleared In Session'];
  const data = _ciaLastResult.map((r, i) => [
    i + 1, r.prn, r.uin, r.name, r.branch, r.division,
    r.batchYear, r.gender, r.attemptCount, r.clearedInSession || '',
  ]);
  UI.exportCSV(`ClearedIn_${targetAttempts}Attempts_${scopeLabel}`, headers, data);
  UI.toast(`Exported ${_ciaLastResult.length} rows.`, 'success');
}


// ═══════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════
function _debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
