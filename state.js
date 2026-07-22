// ============================================================
// state.js — Central app state + business logic
// ============================================================

const State = (() => {
  let students  = [];
  let sessions  = [];
  let ledger    = [];
  let seats     = [];   // [{ uin, sessionId, seatNumber }]
  let _loaded   = false;

  // ── Load all data ─────────────────────────────────────────
  async function loadAll() {
    [students, sessions, ledger, seats] = await Promise.all([
      Sheets.getStudents(),
      Sheets.getSessions(),
      Sheets.getLedger(),
      Sheets.getSeats(),
    ]);
    _loaded = true;
  }

  async function reload() { await loadAll(); }

  // ── Students ──────────────────────────────────────────────
  function getStudents({ branch, division, batchYear, gender } = {}) {
    return students.filter(s =>
      (!branch    || s.branch    === branch)   &&
      (!division  || s.division  === division) &&
      (!batchYear || s.batchYear === batchYear) &&
      (!gender    || s.gender    === gender)
    );
  }

  function getStudent(uin) {
    return students.find(s => s.uin === uin);
  }

  function searchStudents(query) {
    const q = query.toLowerCase().trim();
    return students.filter(s =>
      s.uin.toLowerCase().includes(q) ||
      s.prn.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q)
    );
  }

  // ── Sessions ──────────────────────────────────────────────
  function getSessions() { return sessions; }

  function getSession(id) { return sessions.find(s => s.id === id); }

  function getSessionsForBatch(batchYear) {
    return sessions.filter(s => s.batchYear === batchYear || s.status === 'Active');
  }

  function getExamGroups() {
    const map = {};
    for (const s of sessions) {
      const key = `${s.batchYear}_${s.month}_${s.semester}`;
      if (!map[key]) map[key] = {
        key,
        label: `${s.month} ${s.batchYear} — Sem ${s.semester === 1 ? 'I' : 'II'}`,
        semester:         s.semester,
        month:            s.month,
        year:             s.batchYear,
        prelimSessionId:  '',
        gazetteSessionId: '',
      };
      if (s.entryType === 'Final Gazette') map[key].gazetteSessionId = s.id;
      else                                  map[key].prelimSessionId  = s.id;
    }
    return Object.values(map).sort((a, b) => b.key.localeCompare(a.key));
  }
  async function addSession(year, month, semester, electives = {}, entryType = 'Preliminary', linkedPrelimSessionId = '') {
    const user      = Auth.getUser();
    const sem       = Number(semester);
    const name      = buildSessionName(year, month, sem, entryType);
    const batchYear = String(deriveFreshBatch(Number(year), month));

    // Duplicate check
    if (sessions.find(s => s.name === name)) {
      throw new Error(`Session "${name}" already exists.`);
    }

    if (sem === 2) {
      const required = ['physicsTheoryCode','physicsLabCode','chemTheoryCode','chemLabCode'];
      for (const key of required) {
        if (!electives[key]) throw new Error(`Missing elective: ${key}`);
      }
    }

    const session = {
      id:                    'SES-' + Date.now(),
      name,
      semester:              sem,
      batchYear,
      month,
      status:                'Active',
      createdBy:             user.email,
      physicsTheoryCode:     electives.physicsTheoryCode || '',
      physicsLabCode:        electives.physicsLabCode    || '',
      chemTheoryCode:        electives.chemTheoryCode    || '',
      chemLabCode:           electives.chemLabCode       || '',
      entryType:             entryType || 'Preliminary',
      linkedPrelimSessionId: linkedPrelimSessionId || '',
    };
    await Sheets.addSession(session);
    sessions.push(session);
    return session;
  }

  async function lockSession(sessionId) {
    await Sheets.updateSessionStatus(sessionId, 'Locked');
    const s = sessions.find(s => s.id === sessionId);
    if (s) s.status = 'Locked';
  }

  async function linkPrelimSession(finalSessionId, prelimSessionId) {
    await Sheets.updateSessionLinkedPrelim(finalSessionId, prelimSessionId);
    const s = sessions.find(s => s.id === finalSessionId);
    if (s) s.linkedPrelimSessionId = prelimSessionId;
  }

  // ── Seat numbers ──────────────────────────────────────────
  function getSeatNumber(uin, sessionId) {
  const seat = seats.find(s => s.uin === uin && s.sessionId === sessionId);
  if (seat) return seat.seatNumber;

  // Fall back to linked session's seats (Preliminary ↔ Final Gazette share seat numbers)
  const session = getSession(sessionId);
  const linkedId = session?.linkedPrelimSessionId;
  if (linkedId) {
    const linkedSeat = seats.find(s => s.uin === uin && s.sessionId === linkedId);
    if (linkedSeat) return linkedSeat.seatNumber;
  }
  return '—';
}

  function getSeatsForSession(sessionId) {
    return seats.filter(s => s.sessionId === sessionId);
  }
  function getSeatsForSessionWithFallback(sessionId) {
    const own = getSeatsForSession(sessionId);
    if (own.length > 0) return own;
    // Fall back to linked Preliminary session's seats
    const session = getSession(sessionId);
    if (session?.linkedPrelimSessionId) {
      return getSeatsForSession(session.linkedPrelimSessionId);
    }
    return [];
  }
  async function uploadSeats(seatList) {
    await Sheets.uploadSeats(seatList);
    seats.push(...seatList);
  }

  async function updateSeatNumber(uin, sessionId, seatNumber) {
    await Sheets.updateSeatNumber(uin, sessionId, seatNumber);
    // Update in-memory
    const existing = seats.find(s => s.uin === uin && s.sessionId === sessionId);
    if (existing) existing.seatNumber = seatNumber;
    else seats.push({ uin, sessionId, seatNumber });
  }

  // ── Computed attempt tags (never stored, always computed) ─
  // Returns a human-readable tag string for a given ledger entry
  // in the context of all ledger history.
  //
  // Tags:
  //   'Cleared in Regular attempt'
  //   'Cleared in Regular attempt after Reval'
  //   'Cleared in KT attempt'
  //   'Cleared in KT attempt after Reval'
  //   'Active KT'
  //   null — not yet cleared / still pending / AB with no prior
  function computeAttemptTag(uin, subjectCode, sessionId) {
    const student = getStudents().find(s => s.uin === uin);
    if (!student) return null;

    // All ledger rows for this student+subject, sorted chronologically
    const allRows = ledger
      .filter(r => r.uin === uin && r.subjectCode === subjectCode)
      .sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));

    if (allRows.length === 0) return null;

    // Resolve the target session — if gazette, resolve to its linked prelim
    const targetSess = getSession(sessionId);
    if (!targetSess) return null;
    const targetPrelimId = targetSess.entryType === 'Final Gazette'
      ? targetSess.linkedPrelimSessionId
      : sessionId;

    // No rows in this session — carry forward tag from the session where subject was cleared
    const sessionRows = allRows.filter(r => r.examSession === sessionId ||
      (targetSess.entryType === 'Final Gazette' && r.examSession === targetPrelimId));
    if (sessionRows.length === 0) {
      // Find the gazette or prelim session where this subject was last cleared
      const allSessIds = [...new Set(allRows.map(r => r.examSession))];
      const clearingSess = allSessIds
        .map(id => getSession(id))
        .filter(Boolean)
        .sort((a, b) => b.id.localeCompare(a.id)) // latest first
        .find(s => {
          const rows = allRows.filter(r => r.examSession === s.id);
          const last = rows[rows.length - 1];
          return last?.result === 'Pass';
        });
      if (!clearingSess) return null;
      // Recurse using gazette if one exists, else prelim
      const allSessions = getSessions();
      const gazette = allSessions.find(s =>
        s.entryType === 'Final Gazette' && s.linkedPrelimSessionId === clearingSess.id);
      return computeAttemptTag(uin, subjectCode, gazette?.id || clearingSess.id);
    }

    // Determine overall pass/fail for the target session (merge prelim+gazette)
    const prelimRows = allRows.filter(r => r.examSession === targetPrelimId)
      .sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));
    const gazetteRows = targetSess.entryType === 'Final Gazette'
      ? allRows.filter(r => r.examSession === sessionId)
          .sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime))
      : [];

    const prelimLatest  = prelimRows[prelimRows.length - 1];
    const gazetteLatest = gazetteRows[gazetteRows.length - 1];

    // Resolve final result and reval tag per Excel logic
    let resolvedResult, revalSuffix;
    if (gazetteLatest) {
      const pRes = prelimLatest?.result;
      const gRes = gazetteLatest.result;
      if      (pRes === 'Pass' && gRes === 'Fail') { resolvedResult = 'Fail'; revalSuffix = ' after Reval'; }
      else if (pRes === 'Fail' && gRes === 'Pass') { resolvedResult = 'Pass'; revalSuffix = ' after Reval'; }
      else if (pRes === 'Pass' && gRes === 'Pass') { resolvedResult = 'Pass'; revalSuffix = ': Marks changed'; }
      else if (pRes === 'Fail' && gRes === 'Fail') { resolvedResult = 'Fail'; revalSuffix = ': Marks changed'; }
      else { resolvedResult = gRes || pRes; revalSuffix = ''; }
    } else {
      resolvedResult = prelimLatest?.result;
      revalSuffix = '';
    }

    if (resolvedResult !== 'Pass') return null;

    // Count attempt number:
    // Walk ALL Preliminary sessions in chronological order,
    // scoped to this subject's semester and applicable to this student's batch.
    // Only count sessions where the student has a ledger row (No Record = skip).
    // Stop at targetPrelimId.
    const subjectSemester = Number(prelimLatest?.semester || allRows[0]?.semester);
    const allPrelimSessions = getSessions()
      .filter(s =>
        s.entryType === 'Preliminary' &&
        s.semester   === subjectSemester &&
        Number(s.batchYear) >= Number(student.batchYear)
      )
      .sort((a, b) => a.id.localeCompare(b.id));

    let attemptNumber = 0;
    for (const s of allPrelimSessions) {
      const hasRecord = allRows.some(r => r.examSession === s.id);
      if (!hasRecord) continue; // No Record = do not count this attempt
      attemptNumber++;
      if (s.id === targetPrelimId) break;
    }

    if (attemptNumber === 0) return null;

    const outcomeWord = resolvedResult === 'Pass' ? 'Cleared in' : 'Unsuccessful in';
    const attemptLabel = attemptNumber === 1 ? 'Regular attempt'
      : attemptNumber === 2 ? '2nd attempt'
      : attemptNumber === 3 ? '3rd attempt'
      : `${attemptNumber}th attempt`;

    return `${outcomeWord} ${attemptLabel}${revalSuffix}`;
  }

  // Detect reval: for a Final Gazette session, check if ESE differs from linked Preliminary session
  function _detectReval(uin, subjectCode, sessionId) {
    const session = getSession(sessionId);
    if (!session || session.entryType !== 'Final Gazette' || !session.linkedPrelimSessionId) {
      return false;
    }
    // Get ESE from Final Gazette
    const finalRows = ledger.filter(r =>
      r.uin === uin && r.subjectCode === subjectCode && r.examSession === sessionId
    ).sort((a, b) => b.entryDateTime.localeCompare(a.entryDateTime));
    const finalESE = finalRows[0]?.eseMarks;

    // Get ESE from Preliminary
    const prelimRows = ledger.filter(r =>
      r.uin === uin && r.subjectCode === subjectCode && r.examSession === session.linkedPrelimSessionId
    ).sort((a, b) => b.entryDateTime.localeCompare(a.entryDateTime));
    const prelimESE = prelimRows[0]?.eseMarks;

    if (finalESE === undefined || prelimESE === undefined) return false;
    return String(finalESE).trim() !== String(prelimESE).trim();
  }

  // ── KT eligibility ────────────────────────────────────────
  function getStudentResults(uin) {
    const rows = ledger.filter(r => r.uin === uin);
    const latest = {};
    for (const r of rows) {
      const key = r.subjectCode;
      if (!latest[key] || new Date(r.entryDateTime) > new Date(latest[key].entryDateTime)) {
        latest[key] = r;
      }
    }
    return latest;
  }

  function getActiveKTSubjects(uin) {
    const results = getStudentResults(uin);
    // Also include rows where result is '' (empty) but a prior row for the same
    // subject has a Fail/AB — meaning marks were entered across partial submissions
    // and the latest row has no computed result yet.
    return Object.values(results).filter(r => {
      if (r.result === 'Fail' || r.result === 'AB') return true;
      if (r.result === '') {
        // Check if any earlier ledger row for this subject was a Fail/AB
        return ledger.some(l =>
          l.uin === uin &&
          l.subjectCode === r.subjectCode &&
          (l.result === 'Fail' || l.result === 'AB')
        );
      }
      return false;
    });
  }

  function getKTEligibleStudents(semester, branch) {
    const allBranchStudents = students.filter(s => branch === 'All' || s.branch === branch);
    const result = [];

    for (const student of allBranchStudents) {
      const ktRows = getActiveKTSubjects(student.uin);

      const ktSubjects = ktRows.map(r => {
        const s1 = SEM1_SUBJECTS.find(s => s.code === r.subjectCode);
        if (s1) return s1;

        const allSem2Variants = [
          ...ELECTIVE_PHYSICS_THEORY, ...ELECTIVE_PHYSICS_LAB,
          ...ELECTIVE_CHEMISTRY_THEORY, ...ELECTIVE_CHEMISTRY_LAB,
        ];
        const elective = allSem2Variants.find(e => e.code === r.subjectCode);
        if (elective) {
          const marks = _marksStructureFromType(r.subjectType);
          return { code: r.subjectCode, name: r.subjectName, type: r.subjectType, credits: Number(r.creditsAssigned) || 0, marks };
        }

        const s2fixed = getSem2Subjects(student.branch, null).find(s => s.code === r.subjectCode);
        if (s2fixed) return s2fixed;

        return {
          code:    r.subjectCode,
          name:    r.subjectName,
          type:    r.subjectType,
          credits: Number(r.creditsAssigned) || 0,
          marks:   _marksStructureFromType(r.subjectType),
        };
      }).filter(Boolean);

      if (ktSubjects.length > 0) {
        result.push({ student, ktSubjects });
      }
    }
    return result;
  }

  function _marksStructureFromType(type) {
    switch (type) {
      case 'Theory+Tutorial': return { IAT:40, ESE:60, TW:25 };
      case 'Theory':          return { IAT:30, ESE:45 };
      case 'Practical':       return { TW:25 };
      case 'Practical+Oral':  return { TW:25, Oral:25 };
      default:                return { TW:25 };
    }
  }

  // ── Ledger helpers ─────────────────────────────────────────
  function getLatestEntryForSubject(uin, subjectCode, sessionId) {
    return ledger
      .filter(r => r.uin === uin && r.subjectCode === subjectCode && r.examSession === sessionId)
      .sort((a,b) => b.entryDateTime.localeCompare(a.entryDateTime))[0] || null;
  }

  function getLedgerForStudent(uin) {
    return ledger
      .filter(r => r.uin === uin)
      .sort((a,b) => a.entryDateTime.localeCompare(b.entryDateTime));
  }

  // ── Progress view helpers ──────────────────────────────────

  // Returns the total number of subjects expected for a student in a session
  function getExpectedSubjectCount(student, session) {
    try {
      return getSubjectsForSem(session.semester, student.branch, session).length;
    } catch(e) { return null; }
  }

  // Determine per-session status for a student:
  // 'successful'   — all subjects entered, all passed, all in first attempt (Regular only, no KT, no AB)
  // 'pending'      — not all subjects have been entered yet
  // 'multi-attempt'— all entered but had KT/Reval/AB somewhere → show per-component tags
  function getSessionStatus(uin, session) {
    const rows = ledger.filter(r => r.uin === uin && r.examSession === session.id);
    if (rows.length === 0) return 'pending';

    const student = getStudent(uin);
    if (!student) return 'pending';

    // KT session — always multi-attempt by definition
    const isKTSess = ledger.some(r =>
      r.uin === uin &&
      Number(r.semester) === session.semester &&
      r.examSession !== session.id &&
      r.entryDateTime < rows[0].entryDateTime
    );
    if (isKTSess) return 'multi-attempt';

    const expectedCount = getExpectedSubjectCount(student, session);

    // Latest entry per subject
    const latestBySubject = {};
    for (const r of rows) {
      if (!latestBySubject[r.subjectCode] || r.entryDateTime > latestBySubject[r.subjectCode].entryDateTime) {
        latestBySubject[r.subjectCode] = r;
      }
    }

    const enteredCount = Object.keys(latestBySubject).length;
    if (expectedCount && enteredCount < expectedCount) return 'pending';

    // Check if any row (not just latest) has a prior Fail/AB
    const hasMultiAttempt = rows.some(r => r.result === 'Fail' || r.result === 'AB');

    if (hasMultiAttempt) return 'multi-attempt';

    // All latest entries must be Pass
    const allPass = Object.values(latestBySubject).every(r => r.result === 'Pass');
    return allPass ? 'successful' : 'multi-attempt';
  }

  // ── Submit marks ──────────────────────────────────────────
  // For Preliminary sessions: all components editable, partial entry allowed.
  // For Final Gazette sessions: only ESE is submitted. If ESE is empty → skip.
  //   IAT/TW/Oral are pulled from the linked Preliminary session for result computation only.
  // attemptType is no longer stored — it is computed dynamically at query time.
  async function submitEntries(session, entries) {
    const user       = Auth.getUser();
    const now        = new Date().toISOString();
    const toAppend   = [];
    const duplicates = [];
    const isFinal    = session.entryType === 'Final Gazette';

    for (const entry of entries) {
      const student = getStudent(entry.uin);
      if (!student) continue;

      const semester = session.semester;
      const subjects = getSubjectsForSem(semester, student.branch, session);
      const subject  = subjects.find(s => s.code === entry.subjectCode);
      if (!subject) continue;

      // Partial entry: skip rows where no component has a value
      const hasAnyMark = Object.values(entry.marks).some(m => m && m.value !== null);
      if (!hasAnyMark) continue;

      let marksToStore = { ...entry.marks };

      if (isFinal) {
        // Final Gazette: only ESE is submitted/stored.
        // Skip if ESE is empty.
        const newESE = entry.marks.ESE;
        if (!newESE || newESE.value === null) continue;

        // For result computation, supplement with IAT/TW/Oral from linked Preliminary
        if (session.linkedPrelimSessionId) {
          const prelimEntry = getLatestEntryForSubject(entry.uin, entry.subjectCode, session.linkedPrelimSessionId);
          if (prelimEntry) {
            if (!marksToStore.IAT  && prelimEntry.iatMarks)  marksToStore.IAT  = parseMarkValue(prelimEntry.iatMarks);
            if (!marksToStore.TW   && prelimEntry.twMarks)   marksToStore.TW   = parseMarkValue(prelimEntry.twMarks);
            if (!marksToStore.Oral && prelimEntry.oralMarks) marksToStore.Oral = parseMarkValue(prelimEntry.oralMarks);
          }
        }

        // Only store ESE; clear other components so ledger only has ESE for Final Gazette rows
        marksToStore = {
          ESE:  entry.marks.ESE,
          IAT:  null,
          TW:   null,
          Oral: null,
        };
      }

      const allComps   = Object.keys(subject.marks);
      // For result computation, combine stored marks with pre-filled prelim marks
      const computeMarks = isFinal ? { ...entry.marks } : marksToStore;
      const hasAllComps  = allComps.every(c => computeMarks[c] && computeMarks[c].value !== null);
      const result       = hasAllComps ? computeResult(subject, computeMarks) : { total: null, result: '', creditsEarned: 0 };
      const grade        = '—';

      const row = {
        entryId:         Sheets.newEntryId(),
        uin:             student.uin,
        prn:             student.prn,
        name:            student.name,
        branch:          student.branch,
        division:        student.division,
        batchYear:       student.batchYear,
        examSession:     session.id,
        semester:        String(semester),
        subjectCode:     subject.code,
        subjectName:     subject.name,
        subjectType:     subject.type,
        creditsAssigned: String(subject.credits),
        attemptType:     '',   // intentionally blank — computed at query time
        iatMarks:        isFinal ? '' : _markStr(marksToStore.IAT),
        eseMarks:        _markStr(marksToStore.ESE),
        twMarks:         isFinal ? '' : _markStr(marksToStore.TW),
        oralMarks:       isFinal ? '' : _markStr(marksToStore.Oral),
        totalMarks:      result.total !== null ? String(result.total) : '',
        grade,
        creditsEarned:   result.creditsEarned !== undefined ? String(result.creditsEarned) : '0',
        result:          result.result || '',
        source:          'WebApp',
        enteredBy:       user.email,
        entryDateTime:   now,
        gender:          student.gender || '',
      };

      // ── Deduplication guard ──────────────────────────────────
      // Same uin + subjectCode + examSession + enteredBy within 30 seconds = skip
      const DEDUP_WINDOW_MS = 30 * 1000;
      const nowMs           = new Date(now).getTime();
      const isDuplicate     = ledger.some(r =>
        r.uin         === row.uin         &&
        r.subjectCode === row.subjectCode &&
        r.examSession === row.examSession &&
        r.enteredBy   === row.enteredBy   &&
        Math.abs(new Date(r.entryDateTime).getTime() - nowMs) < DEDUP_WINDOW_MS
      );

      if (isDuplicate) {
        duplicates.push(`${row.subjectCode} — ${row.name}`);
        continue;
      }

      toAppend.push(row);
    }

    if (duplicates.length > 0) {
      UI.toast(
        `⚠ ${duplicates.length} duplicate entr${duplicates.length > 1 ? 'ies' : 'y'} skipped (within 30s): ${duplicates.slice(0, 3).join(', ')}${duplicates.length > 3 ? '…' : ''}`,
        'warning'
      );
    }

    if (toAppend.length === 0) return 0;

    await Sheets.appendLedgerRows(toAppend);
    ledger.push(...toAppend);
    return toAppend.length;
  }

  function _markStr(m) {
    if (!m) return '';
    if (m.absent) return 'AB';
    if (m.grace)  return m.value + '*';
    return m.value !== null ? String(m.value) : '';
  }

  // ── Academic computation (grades, SGPA, CGPA, credits) ───
  //
  // All calculations use grace-adjusted values via computeDisplayResult.
  // Nothing stored — always recomputed from ledger component marks.
  //
  // Returns:
  // {
  //   sessionResults: [ { session, subjects: [ subjectResult ], sgpa, pendingCount } ],
  //   semCredits:     { 1: { earned, max, completedInSession }, 2: { ... } },
  //   consolidatedSGPA: { 1: number|null, 2: number|null },
  //   cgpa:           number|null,
  //   totalCredits:   { earned, max },
  //   feCompleted:    { done: bool, session: sessionName|null },
  // }
  function computeStudentAcademics(uin) {
    const student = getStudent(uin);
    if (!student) return null;

// ── Merge all ledger rows per subject per session ──────────
    // For each student+subject+session, scan ALL rows sorted ascending by entryDateTime.
    // Take the latest non-empty value per component across all rows.
    // This handles partial entries spread across multiple submissions.
    const mergedPerSessionSubject = {};   // key = sessionId+'||'+subjectCode → merged pseudo-row
    const allStudentRows = ledger.filter(r => r.uin === uin)
      .sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));

    for (const r of allStudentRows) {
      const key = r.examSession + '||' + r.subjectCode;
      if (!mergedPerSessionSubject[key]) {
        // First row for this subject+session — clone it as the base
        mergedPerSessionSubject[key] = { ...r };
      } else {
        // Subsequent rows — overwrite only non-empty components
        const m = mergedPerSessionSubject[key];
        if (r.iatMarks  !== '') m.iatMarks  = r.iatMarks;
        if (r.eseMarks  !== '') m.eseMarks  = r.eseMarks;
        if (r.twMarks   !== '') m.twMarks   = r.twMarks;
        if (r.oralMarks !== '') m.oralMarks = r.oralMarks;
        // Always take the latest entryDateTime and entryId as the canonical reference
        m.entryDateTime = r.entryDateTime;
        m.entryId       = r.entryId;
      }
    }
    // Alias so the rest of computeStudentAcademics can use the same name
    const latestPerSessionSubject = mergedPerSessionSubject;

// ── Latest merged row per subject across ALL sessions ──────
    // Used for CGPA and consolidated semester SGPA.
    // KT entry for a subject supersedes Regular (latest entryDateTime wins).
    const latestPerSubject = {};
    for (const r of Object.values(latestPerSessionSubject)) {
      const code = r.subjectCode;
      if (!latestPerSubject[code] || r.entryDateTime > latestPerSubject[code].entryDateTime) {
        latestPerSubject[code] = r;
      }
    }

    // ── Helper: build marksMap from a ledger row ───────────────
    function _marksMapFromRow(r) {
      const m = {};
      if (r.iatMarks  !== '') m.IAT  = r.iatMarks;
      if (r.eseMarks  !== '') m.ESE  = r.eseMarks;
      if (r.twMarks   !== '') m.TW   = r.twMarks;
      if (r.oralMarks !== '') m.Oral = r.oralMarks;
      return m;
    }

    // ── Helper: get subject config for a ledger row ────────────
    function _subjectForRow(r) {
      const sess = getSession(r.examSession);
      const subjectList = getSubjectsForSem(Number(r.semester), r.branch || student.branch, sess);
      return subjectList.find(s => s.code === r.subjectCode) || null;
    }

    // ── Per-session results ────────────────────────────────────
    // Sort sessions chronologically (by session creation id, which embeds timestamp)
    const sessionOrder = sessions
      .filter(s => Object.values(latestPerSessionSubject).some(r => r.examSession === s.id))
      .sort((a, b) => a.id.localeCompare(b.id));

    const sessionResults = [];

   for (const sess of sessionOrder) {
      // A session is a KT session for this student if ANY earlier session
      // exists for the same semester — regardless of result or batchYear.
      const firstSessEntry = allStudentRows.find(r => r.examSession === sess.id);
      const isKTSess = firstSessEntry && allStudentRows.some(r =>
        Number(r.semester) === sess.semester &&
        r.examSession !== sess.id &&
        r.entryDateTime < firstSessEntry.entryDateTime
      );

      const subjectResults = [];
      let sumGxC       = 0;
      let sumC         = 0;
      let pendingCount = 0;

      if (isKTSess) {
        // ── KT session: synthesise a full subject list ─────────
        // For every subject in this semester, build a merged marksMap:
        //   - Per component: use the latest PASSING value from any prior session
        //     of this semester (carry forward '+'), OR the new value entered in
        //     this KT session (overrides only if the prior component was failing).
        //   - If this KT session has a new entry for the component → always use it
        //     (student may have improved a previously-passed component too).
        // Display note: carried marks are flagged with `carried: true` per component
        // so the Progress View can render them with a '+' indicator.

        const allSubjects = getSubjectsForSem(sess.semester, student.branch, sess);

        // Build per-subject latest prior component values (from ALL prior sessions of this sem)
        // Key: subjectCode → { IAT, ESE, TW, Oral } — latest non-empty value per component
        const priorCompValues = {}; // subjectCode → { comp → value string }
        for (const [key, row] of Object.entries(latestPerSessionSubject)) {
          if (row.examSession === sess.id) continue;
          if (Number(row.semester) !== sess.semester) continue;
          const code = row.subjectCode;
          if (!priorCompValues[code]) priorCompValues[code] = {};
          const p = priorCompValues[code];
          if (row.iatMarks  !== '') p.IAT  = row.iatMarks;
          if (row.eseMarks  !== '') p.ESE  = row.eseMarks;
          if (row.twMarks   !== '') p.TW   = row.twMarks;
          if (row.oralMarks !== '') p.Oral = row.oralMarks;
        }

        // This KT session's own entries per subject
        const ktEntries = {}; // subjectCode → merged row
        for (const [key, row] of Object.entries(latestPerSessionSubject)) {
          if (row.examSession !== sess.id) continue;
          ktEntries[row.subjectCode] = row;
        }

        for (const subj of allSubjects) {
          const prior   = priorCompValues[subj.code] || {};
          const ktRow   = ktEntries[subj.code] || null;
          const ktMarks = ktRow ? _marksMapFromRow(ktRow) : {};

          // Build merged marksMap and carried flags
          const marksMap  = {};
          const carriedMap = {}; // comp → true if carried from prior

          for (const comp of Object.keys(subj.marks)) {
            const priorVal = prior[comp] || '';
            const ktVal    = ktMarks[comp] || '';

            if (ktVal !== '') {
              // New value entered in this KT session — always use it
              marksMap[comp]   = ktVal;
              carriedMap[comp] = false;
            } else if (priorVal !== '') {
              // No new entry — carry forward from prior session
              marksMap[comp]   = priorVal;
              carriedMap[comp] = true;
            }
            // else: neither prior nor new → component absent from marksMap → pending
          }

          // Use ktRow as the canonical ledger row reference if available,
          // otherwise synthesise a minimal row from prior data for display
          const canonicalRow = ktRow || {
            ...Object.values(latestPerSessionSubject)
              .find(r => r.subjectCode === subj.code && Number(r.semester) === sess.semester) || {},
            examSession:  sess.id,
            subjectCode:  subj.code,
            subjectName:  subj.name,
            subjectType:  subj.type,
            iatMarks:     marksMap.IAT  || '',
            eseMarks:     marksMap.ESE  || '',
            twMarks:      marksMap.TW   || '',
            oralMarks:    marksMap.Oral || '',
          };

          // For Final Gazette KT sessions: flag components that changed vs prelim
          const revalMap = {};
          if (sess.entryType === 'Final Gazette' && sess.linkedPrelimSessionId) {
            const prelimKey = sess.linkedPrelimSessionId + '||' + subj.code;
            const prelimRow = latestPerSessionSubject[prelimKey];
            if (prelimRow) {
              const _revalFields = { IAT: 'iatMarks', ESE: 'eseMarks', TW: 'twMarks', Oral: 'oralMarks' };
              for (const [comp, field] of Object.entries(_revalFields)) {
                const gazVal    = marksMap[comp]   || '';
                const prelimVal = prelimRow[field] || '';
                if (gazVal && prelimVal && gazVal !== prelimVal) revalMap[comp] = true;
              }
            }
          }

          const dr = computeDisplayResult(subj, marksMap);

          if (dr.pending) {
            pendingCount++;
            subjectResults.push({ r: canonicalRow, subj, dr, pending: true, carriedMap, mergedMarks: marksMap, revalMap });
            continue;
          }

          subjectResults.push({ r: canonicalRow, subj, dr, pending: false, carriedMap, mergedMarks: marksMap, revalMap });

          if (dr.grade !== 'F' && dr.creditsEarned > 0) {
            sumGxC += dr.GxC;
            sumC   += subj.credits;
          }
        }

      } else {
        // ── Regular / Final Gazette session ────────────────────
        const sessRows = Object.values(latestPerSessionSubject)
          .filter(r => r.examSession === sess.id);

        for (const r of sessRows) {
          const subj = _subjectForRow(r);
          if (!subj) continue;

          // For Final Gazette sessions: supplement ESE-only rows with Prelim IAT/TW/Oral
          let marksMap = _marksMapFromRow(r);
          const revalMap = {}; // comp → true if gazette value differs from prelim
          if (sess.entryType === 'Final Gazette' && sess.linkedPrelimSessionId) {
            const prelimKey = sess.linkedPrelimSessionId + '||' + r.subjectCode;
            const prelimRow = latestPerSessionSubject[prelimKey];
            if (prelimRow) {
              if (!marksMap.IAT  && prelimRow.iatMarks)  marksMap.IAT  = prelimRow.iatMarks;
              if (!marksMap.TW   && prelimRow.twMarks)   marksMap.TW   = prelimRow.twMarks;
              if (!marksMap.Oral && prelimRow.oralMarks) marksMap.Oral = prelimRow.oralMarks;
              // Flag components whose gazette value differs from the prelim value
              const _revalFields = { IAT: 'iatMarks', ESE: 'eseMarks', TW: 'twMarks', Oral: 'oralMarks' };
              for (const [comp, field] of Object.entries(_revalFields)) {
                const gazVal    = marksMap[comp]      || '';
                const prelimVal = prelimRow[field]    || '';
                if (gazVal && prelimVal && gazVal !== prelimVal) revalMap[comp] = true;
              }
            }
          }

          const dr = computeDisplayResult(subj, marksMap);

          if (dr.pending) {
            pendingCount++;
            subjectResults.push({ r, subj, dr, pending: true, revalMap });
            continue;
          }

          subjectResults.push({ r, subj, dr, pending: false, revalMap });

          if (dr.grade !== 'F' && dr.creditsEarned > 0) {
            sumGxC += dr.GxC;
            sumC   += subj.credits;
          }
        }
      }

      const sgpa = sumC > 0 ? Math.round((sumGxC / sumC) * 100) / 100 : null;

      sessionResults.push({
        session:      sess,
        subjects:     subjectResults,
        sgpa,
        pendingCount,
      });
    }

    // ── Per-semester credit tracking ───────────────────────────
    // For each semester, compute earned vs max using LATEST result per subject
    // across ALL sessions. KT result overwrites Regular for same subject.
    const semCredits   = { 1: { earned: 0, max: 0, completedInSession: null },
                           2: { earned: 0, max: 0, completedInSession: null } };
    const semSubjects  = { 1: new Set(), 2: new Set() };

    // Compute max credits per semester for this student's branch
    for (const sem of [1, 2]) {
      // For Sem 2 we need a session to get branch-specific subjects
      // Use the first session for this semester that the student has results in
      const semSess = sessions.find(s =>
        s.semester === sem &&
        Object.values(latestPerSessionSubject).some(r => r.examSession === s.id)
      );
      if (!semSess && sem === 1) {
        // Fall back to SEM1_SUBJECTS for max
        semCredits[sem].max = SEM1_SUBJECTS.reduce((s, sub) => s + sub.credits, 0);
      } else if (semSess) {
        semCredits[sem].max = getSubjectsForSem(sem, student.branch, semSess)
          .reduce((s, sub) => s + sub.credits, 0);
      }
    }

    // Walk through all latest-per-subject rows and accumulate earned credits
    // Also track which session completed each semester
    // Process in session chronological order so we can find the completing session
    for (const sess of sessionOrder) {
      const sem = sess.semester;
      if (!semCredits[sem]) continue;

      const sessRows = Object.values(latestPerSessionSubject)
        .filter(r => r.examSession === sess.id);

      for (const r of sessRows) {
        const subj = _subjectForRow(r);
        if (!subj) continue;

        // Only count if this IS the latest result for this subject overall
        if (latestPerSubject[r.subjectCode]?.entryDateTime !== r.entryDateTime) continue;

        // For Final Gazette sessions: supplement ESE-only rows with Prelim IAT/TW/Oral
        let marksMap = _marksMapFromRow(r);
        if (sess.entryType === 'Final Gazette' && sess.linkedPrelimSessionId) {
          const prelimKey = sess.linkedPrelimSessionId + '||' + r.subjectCode;
          const prelimRow = latestPerSessionSubject[prelimKey];
          if (prelimRow) {
            if (!marksMap.IAT  && prelimRow.iatMarks)  marksMap.IAT  = prelimRow.iatMarks;
            if (!marksMap.TW   && prelimRow.twMarks)   marksMap.TW   = prelimRow.twMarks;
            if (!marksMap.Oral && prelimRow.oralMarks) marksMap.Oral = prelimRow.oralMarks;
          }
        }

        // For KT sessions (different batchYear from student): carry forward
        // passing component marks from prior sessions of the same semester.
        // Only failed components get new marks; passed ones are carried forward.
        const priorSessRows = Object.values(latestPerSessionSubject).filter(pr =>
          pr.subjectCode === r.subjectCode &&
          pr.examSession !== sess.id &&
          Number(pr.semester) === Number(r.semester)
        ).sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));

        if (priorSessRows.length > 0) {
          // Build latest prior component values
          const priorMarks = {};
          for (const pr of priorSessRows) {
            if (pr.iatMarks  !== '') priorMarks.IAT  = pr.iatMarks;
            if (pr.eseMarks  !== '') priorMarks.ESE  = pr.eseMarks;
            if (pr.twMarks   !== '') priorMarks.TW   = pr.twMarks;
            if (pr.oralMarks !== '') priorMarks.Oral = pr.oralMarks;
          }

          // Carry forward only components that were passing in prior attempts
          const subj = _subjectForRow(r);
          for (const [comp, priorVal] of Object.entries(priorMarks)) {
            if (marksMap[comp]) continue; // already has a value in this session
            const max = subj?.marks[comp];
            const parsed = parseMarkValue(priorVal, max);
            const priorPassed = parsed.valid && !parsed.absent &&
              (parsed.grace || (max && parsed.value / max >= 0.40));
            if (priorPassed) marksMap[comp] = priorVal;
          }
        }

        const dr = computeDisplayResult(subj, marksMap);
        if (!dr.pending && dr.creditsEarned > 0) {
          semSubjects[sem].add(r.subjectCode);
        }
      }

      // Recompute earned total for this semester after processing this session
      // (to detect the completing session)
      let earnedSoFar = 0;
      const allSemSubjects = semCredits[sem].max > 0
        ? getSubjectsForSem(sem, student.branch, sess)
        : [];

      for (const subj of allSemSubjects) {
        if (semSubjects[sem].has(subj.code)) earnedSoFar += subj.credits;
      }

      if (earnedSoFar >= semCredits[sem].max && semCredits[sem].max > 0 &&
          !semCredits[sem].completedInSession) {
        semCredits[sem].completedInSession = sess.name;
      }
    }

    // Final earned credits per semester
    for (const sem of [1, 2]) {
      const semSess = sessions.find(s => s.semester === sem &&
        Object.values(latestPerSessionSubject).some(r => r.examSession === s.id));
      if (!semSess) continue;
      const allSemSubjects = getSubjectsForSem(sem, student.branch, semSess);
      semCredits[sem].earned = allSemSubjects
        .filter(sub => semSubjects[sem].has(sub.code))
        .reduce((s, sub) => s + sub.credits, 0);
    }

    const totalEarned = semCredits[1].earned + semCredits[2].earned;
    const totalMax    = semCredits[1].max    + semCredits[2].max;

    // ── Consolidated Semester SGPA ─────────────────────────────
    // Computed once all credits for that semester are earned.
    // Uses latest result per subject across all sessions for that semester.
    const consolidatedSGPA = { 1: null, 2: null };
    for (const sem of [1, 2]) {
      if (semCredits[sem].earned < semCredits[sem].max) continue;  // not yet complete
      const semSess = sessions.find(s => s.semester === sem &&
        Object.values(latestPerSessionSubject).some(r => r.examSession === s.id));
      if (!semSess) continue;

      let sumGxC = 0, sumC = 0;
      const allSemSubjects = getSubjectsForSem(sem, student.branch, semSess);
      for (const subj of allSemSubjects) {
        const r = latestPerSubject[subj.code];
        if (!r) continue;
        const sess = getSession(r.examSession);
        let marksMap = _marksMapFromRow(r);
        if (sess?.entryType === 'Final Gazette' && sess.linkedPrelimSessionId) {
          const prelimKey = sess.linkedPrelimSessionId + '||' + r.subjectCode;
          const prelimRow = latestPerSessionSubject[prelimKey];
          if (prelimRow) {
            if (!marksMap.IAT  && prelimRow.iatMarks)  marksMap.IAT  = prelimRow.iatMarks;
            if (!marksMap.TW   && prelimRow.twMarks)   marksMap.TW   = prelimRow.twMarks;
            if (!marksMap.Oral && prelimRow.oralMarks) marksMap.Oral = prelimRow.oralMarks;
          }
        }
        const dr = computeDisplayResult(subj, marksMap);
        if (!dr.pending) {
          sumGxC += dr.GxC;
          sumC   += subj.credits;
        }
      }
      if (sumC > 0) consolidatedSGPA[sem] = Math.round((sumGxC / sumC) * 100) / 100;
    }

    // ── CGPA — live, all subjects, latest result ───────────────
    let cgpaSumGxC = 0, cgpaSumC = 0;
    for (const r of Object.values(latestPerSubject)) {
      const subj = _subjectForRow(r);
      if (!subj) continue;
      const sess = getSession(r.examSession);
      let marksMap = _marksMapFromRow(r);
      if (sess?.entryType === 'Final Gazette' && sess.linkedPrelimSessionId) {
        const prelimKey = sess.linkedPrelimSessionId + '||' + r.subjectCode;
        const prelimRow = latestPerSessionSubject[prelimKey];
        if (prelimRow) {
          if (!marksMap.IAT  && prelimRow.iatMarks)  marksMap.IAT  = prelimRow.iatMarks;
          if (!marksMap.TW   && prelimRow.twMarks)   marksMap.TW   = prelimRow.twMarks;
          if (!marksMap.Oral && prelimRow.oralMarks) marksMap.Oral = prelimRow.oralMarks;
        }
      }
      const dr = computeDisplayResult(subj, marksMap);
      if (!dr.pending) {
        cgpaSumGxC += dr.GxC;
        cgpaSumC   += subj.credits;
      }
    }
    const cgpa = cgpaSumC > 0 ? Math.round((cgpaSumGxC / cgpaSumC) * 100) / 100 : null;

    // ── FE Completed ───────────────────────────────────────────
    const feCompleted = semCredits[1].earned >= semCredits[1].max &&
                        semCredits[1].max > 0 &&
                        semCredits[2].earned >= semCredits[2].max &&
                        semCredits[2].max > 0;

    // Completing session = whichever semester was completed last
    let feSession = null;
    if (feCompleted) {
      const s1 = semCredits[1].completedInSession;
      const s2 = semCredits[2].completedInSession;
      // Find which was completed later by matching session names back to session ids
      const sess1 = sessions.find(s => s.name === s1);
      const sess2 = sessions.find(s => s.name === s2);
      if (sess1 && sess2) {
        feSession = sess1.id > sess2.id ? s1 : s2;
      } else {
        feSession = s1 || s2;
      }
    }

    return {
      sessionResults,
      semCredits,
      consolidatedSGPA,
      cgpa,
      totalCredits: { earned: totalEarned, max: totalMax },
      feCompleted:  { done: feCompleted, session: feSession },
    };
  }

  // ── Reports data ──────────────────────────────────────────

  // Result Summary — filters: prelimSessionId (required), gazetteSessionId (optional),
  //                           branch?, batchYear?, subjectCode?, gender?
  // When gazetteSessionId is provided, Gazette ESE overrides Prelim ESE per student
  // per subject. Result is recomputed. revalPass = students who were Fail in Prelim
  // but Pass after the Gazette merge.
  function reportResultSummary({ prelimSessionId, gazetteSessionId, branch, batchYear, subjectCode, gender } = {}) {
    if (!prelimSessionId) return [];

    // ── Collect and filter Prelim rows ───────────────────────
    let prelimRows = ledger.filter(r => r.examSession === prelimSessionId);
    if (branch)      prelimRows = prelimRows.filter(r => r.branch      === branch);
    if (batchYear)   prelimRows = prelimRows.filter(r => r.batchYear   === batchYear);
    if (subjectCode) prelimRows = prelimRows.filter(r => r.subjectCode === subjectCode);
    if (gender)      prelimRows = prelimRows.filter(r => r.gender      === gender);

    // ── Collect Gazette rows indexed by uin+subjectCode ──────
    const gazetteIndex = {}; // key: uin+'||'+subjectCode → merged gazette row
    if (gazetteSessionId) {
      let gazRows = ledger.filter(r => r.examSession === gazetteSessionId);
      if (branch)      gazRows = gazRows.filter(r => r.branch      === branch);
      if (batchYear)   gazRows = gazRows.filter(r => r.batchYear   === batchYear);
      if (subjectCode) gazRows = gazRows.filter(r => r.subjectCode === subjectCode);
      if (gender)      gazRows = gazRows.filter(r => r.gender      === gender);

      // Merge multiple gazette rows per student+subject (latest component wins)
      const sorted = [...gazRows].sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));
      for (const r of sorted) {
        const key = r.uin + '||' + r.subjectCode;
        if (!gazetteIndex[key]) {
          gazetteIndex[key] = { ...r };
        } else {
          const m = gazetteIndex[key];
          if (r.eseMarks  !== '') m.eseMarks  = r.eseMarks;
          if (r.iatMarks  !== '') m.iatMarks  = r.iatMarks;
          if (r.twMarks   !== '') m.twMarks   = r.twMarks;
          if (r.oralMarks !== '') m.oralMarks = r.oralMarks;
        }
      }
    }

    // ── Group Prelim rows by subject ──────────────────────────
    const bySubject = {};
    for (const r of prelimRows) {
      if (!bySubject[r.subjectCode]) bySubject[r.subjectCode] = { code: r.subjectCode, name: r.subjectName, rows: [] };
      bySubject[r.subjectCode].rows.push(r);
    }

    return Object.values(bySubject).map(({ code, name, rows }) => {
      // ── Merge Prelim rows per student (latest component wins) ─
      const sorted = [...rows].sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));
      const mergedPerStudent = {};
      for (const r of sorted) {
        if (!mergedPerStudent[r.uin]) {
          mergedPerStudent[r.uin] = { ...r };
        } else {
          const m = mergedPerStudent[r.uin];
          if (r.iatMarks  !== '') m.iatMarks  = r.iatMarks;
          if (r.eseMarks  !== '') m.eseMarks  = r.eseMarks;
          if (r.twMarks   !== '') m.twMarks   = r.twMarks;
          if (r.oralMarks !== '') m.oralMarks = r.oralMarks;
          if (r.result        !== '') m.result        = r.result;
          if (r.totalMarks    !== '') m.totalMarks    = r.totalMarks;
          if (r.creditsEarned !== '') m.creditsEarned = r.creditsEarned;
          m.entryDateTime = r.entryDateTime;
        }
      }

      // ── Resolve subject config for computeDisplayResult ───────
      const prelimSess  = getSession(prelimSessionId);
      const subjectList = prelimSess
        ? getSubjectsForSem(Number(prelimSess.semester), branch || 'Computer', prelimSess)
        : SEM1_SUBJECTS;
      const subj = subjectList.find(s => s.code === code);

      // ── Per-student: apply Gazette override if available ──────
      let pass = 0, fail = 0, ab = 0, revalPass = 0;

      const compSums  = { IAT: 0, ESE: 0, TW: 0, Oral: 0 };
      const compCount = { IAT: 0, ESE: 0, TW: 0, Oral: 0 };

      for (const prelim of Object.values(mergedPerStudent)) {
        const gazKey = prelim.uin + '||' + code;
        const gaz    = gazetteIndex[gazKey] || null;

        // Build merged marks: start from Prelim, Gazette ESE overrides
        let merged = { ...prelim };
        if (gaz) {
          if (gaz.eseMarks  !== '') merged.eseMarks  = gaz.eseMarks;
          if (gaz.iatMarks  !== '') merged.iatMarks  = gaz.iatMarks;
          if (gaz.twMarks   !== '') merged.twMarks   = gaz.twMarks;
          if (gaz.oralMarks !== '') merged.oralMarks = gaz.oralMarks;
        }

        // Recompute result from merged marks using subject config
        let result = merged.result; // fallback: stored string
        if (subj) {
          const marksMap = {};
          if (merged.iatMarks  !== '') marksMap.IAT  = merged.iatMarks;
          if (merged.eseMarks  !== '') marksMap.ESE  = merged.eseMarks;
          if (merged.twMarks   !== '') marksMap.TW   = merged.twMarks;
          if (merged.oralMarks !== '') marksMap.Oral = merged.oralMarks;
          const dr = computeDisplayResult(subj, marksMap);
          if (!dr.pending) result = dr.result;
        }

        // revalPass: was Fail/AB in Prelim, now Pass after Gazette merge
        const prelimResult = prelim.result;
        if (gaz && (prelimResult === 'Fail' || prelimResult === 'AB') && result === 'Pass') {
          revalPass++;
        }

        if      (result === 'Pass') pass++;
        else if (result === 'AB')   ab++;
        else                        fail++;

        // Average marks from merged row
        if (merged.iatMarks  !== '') { compSums.IAT  += Number(merged.iatMarks)  || 0; compCount.IAT++;  }
        if (merged.eseMarks  !== '') { compSums.ESE  += Number(merged.eseMarks)  || 0; compCount.ESE++;  }
        if (merged.twMarks   !== '') { compSums.TW   += Number(merged.twMarks)   || 0; compCount.TW++;   }
        if (merged.oralMarks !== '') { compSums.Oral += Number(merged.oralMarks) || 0; compCount.Oral++; }
      }

      const total = pass + fail + ab;
      const avgMarks = {};
      for (const comp of ['IAT','ESE','TW','Oral']) {
        avgMarks[comp] = compCount[comp] > 0 ? (compSums[comp] / compCount[comp]) : null;
      }

      return { code, name, total, pass, fail, ab, revalPass, passRate: total ? pass/total : 0, avgMarks };
    });
  }

  // Reval Impact — filters: sessionId, branch?, subjectCode?
  // Returns both Fail→Pass (positive) and Pass→Fail (warning)
  // Reval is now determined dynamically: compares ESE between Final Gazette and linked Preliminary.
  function reportRevalImpact({ gazetteSessionId, branch, subjectCode } = {}) {
    // Find Final Gazette sessions matching the filter
    let finalSessions = sessions.filter(s => s.entryType === 'Final Gazette' && s.linkedPrelimSessionId);
    if (gazetteSessionId) finalSessions = finalSessions.filter(s => s.id === gazetteSessionId);

    const result = [];

    for (const finalSess of finalSessions) {
      const prelimSess = sessions.find(s => s.id === finalSess.linkedPrelimSessionId);
      if (!prelimSess) continue;

      // All Final Gazette ledger rows for this session
      let finalRows = ledger.filter(r => r.examSession === finalSess.id);
      if (branch)      finalRows = finalRows.filter(r => r.branch === branch);
      if (subjectCode) finalRows = finalRows.filter(r => r.subjectCode === subjectCode);

      // Cache computed academics per UIN to avoid recomputing per row
      const acadCache = {};

      for (const finalRow of finalRows) {
        // Get corresponding Preliminary row
        const prelimRow = ledger
          .filter(p => p.uin === finalRow.uin &&
                       p.subjectCode === finalRow.subjectCode &&
                       p.examSession === finalSess.linkedPrelimSessionId)
          .sort((a,b) => b.entryDateTime.localeCompare(a.entryDateTime))[0];

        if (!prelimRow) continue;

        // Only include if ESE actually changed (gazette only enters ESE)
        const eseChanged = String(finalRow.eseMarks).trim() !== String(prelimRow.eseMarks).trim()
          && finalRow.eseMarks !== '' && prelimRow.eseMarks !== '';
        if (!eseChanged) continue;

        // Use computed results (not raw ledger result which is unreliable for gazette)
        if (!acadCache[finalRow.uin]) acadCache[finalRow.uin] = computeStudentAcademics(finalRow.uin);
        const acad = acadCache[finalRow.uin];

        const gazSessResult  = acad?.sessionResults.find(sr => sr.session.id === finalSess.id);
        const prelimSessResult = acad?.sessionResults.find(sr => sr.session.id === finalSess.linkedPrelimSessionId);

        const gazSubj    = gazSessResult?.subjects.find(s => s.r.subjectCode === finalRow.subjectCode);
        const prelimSubj = prelimSessResult?.subjects.find(s => s.r.subjectCode === finalRow.subjectCode);

        const gazResult   = gazSubj?.dr?.result   || finalRow.result   || '—';
        const prelimResult = prelimSubj?.dr?.result || prelimRow.result || '—';

        // Determine direction
        let direction;
        if (prelimResult === 'Fail' && gazResult === 'Pass')       direction = 'improved';
        else if (prelimResult === 'Pass' && gazResult === 'Fail')  direction = 'worsened';
        else if (prelimResult === 'Fail' && gazResult === 'Fail')  direction = 'fail-to-fail';
        else if (prelimResult === 'Pass' && gazResult === 'Pass')  direction = 'pass-to-pass';
        else direction = 'changed';

        // ESE mark direction for same-result cases
        const prelimESE = parseFloat(prelimRow.eseMarks) || 0;
        const gazESE    = parseFloat(finalRow.eseMarks)  || 0;
        const markDelta = gazESE - prelimESE;

        result.push({
          ...finalRow,
          prevResult: prelimResult,
          result:     gazResult,
          direction,
          markDelta,
          prelimEse:  prelimRow.eseMarks || '—',
          gazEse:     finalRow.eseMarks  || '—',
        });
      }
    }
    return result;
  }

  // Toppers — branch-wise (top N by total marks) or subject-wise (top 3 per branch)
  function reportToppers({ sessionId, gazetteSessionId, mode = 'branch', branch, subjectCode, topN = 10 } = {}) {
    // For each student+subject, prefer the Final Gazette row (corrected ESE/total)
    // over the Preliminary row. Students with no gazette row use their prelim row as-is.
    const prelimRows  = ledger.filter(r => r.examSession === sessionId);
    const gazetteRows = gazetteSessionId
      ? ledger.filter(r => r.examSession === gazetteSessionId)
      : [];

    // Build a map of gazette rows keyed by uin+subjectCode for fast lookup
    const gazetteMap = {};
    for (const r of gazetteRows) gazetteMap[r.uin + '||' + r.subjectCode] = r;

    // Merge: for each prelim row, substitute the gazette row if one exists
    const mergedRows = prelimRows.map(r => {
      const gz = gazetteMap[r.uin + '||' + r.subjectCode];
      return gz || r;
    });

    const sessionRows = mergedRows.filter(r => r.result === 'Pass');

    // Helper: build ranked list for a given gender filter ('Male', 'Female', or null = All)
    function _rankBranch(rows, genderFilter) {
      const byStudent = {};
      for (const r of rows) {
        if (branch && r.branch !== branch) continue;
        if (genderFilter && r.gender !== genderFilter) continue;
        const key = r.uin;
        if (!byStudent[key]) byStudent[key] = { uin:r.uin, prn:r.prn, name:r.name, branch:r.branch, gender:r.gender||'', totalCredits:0, totalMarks:0 };
        byStudent[key].totalCredits += Number(r.creditsEarned) || 0;
        byStudent[key].totalMarks   += Number(r.totalMarks)    || 0;
      }
      const byBranch = {};
      for (const s of Object.values(byStudent)) {
        if (!byBranch[s.branch]) byBranch[s.branch] = [];
        byBranch[s.branch].push(s);
      }
      const result = [];
      for (const [branchName, list] of Object.entries(byBranch)) {
        list.sort((a,b) => b.totalMarks - a.totalMarks || b.totalCredits - a.totalCredits);
        list.slice(0, topN).forEach((s, i) => result.push({ rank: i+1, branchGroup: branchName, ...s }));
      }
      return result;
    }

    function _rankSubject(rows, genderFilter) {
      const filtered = rows.filter(r =>
        (!subjectCode || r.subjectCode === subjectCode) &&
        (!branch || r.branch === branch) &&
        (!genderFilter || r.gender === genderFilter)
      );
      const bySubjBranch = {};
      for (const r of filtered) {
        const sk = r.subjectCode;
        const bk = r.branch;
        if (!bySubjBranch[sk]) bySubjBranch[sk] = {};
        if (!bySubjBranch[sk][bk]) bySubjBranch[sk][bk] = [];
        bySubjBranch[sk][bk].push({ uin:r.uin, prn:r.prn, name:r.name, branch:r.branch, gender:r.gender||'',
          subjectCode:r.subjectCode, subjectName:r.subjectName,
          totalMarks: Number(r.totalMarks)||0 });
      }
      const result = [];
      // Sort subjects by canonical syllabus order
      const sess         = sessions.find(s => s.id === sessionId);
      const canonicalList = sess
        ? getSubjectsForSem(Number(sess.semester), branch || 'Computer', sess)
        : SEM1_SUBJECTS;
      const subjOrder = {};
      canonicalList.forEach((s, i) => { subjOrder[s.code] = i; });

      const sortedSubjEntries = Object.entries(bySubjBranch)
        .sort(([a], [b]) => (subjOrder[a] ?? 999) - (subjOrder[b] ?? 999));

      for (const [sk, branches] of sortedSubjEntries) {
        for (const [bk, list] of Object.entries(branches)) {
          list.sort((a,b) => b.totalMarks - a.totalMarks);
          list.slice(0, 3).forEach((s, i) => result.push({ rank: i+1, subjectGroup: sk, branchGroup: bk, ...s }));
        }
      }
      return result;
    }

    const rankFn = mode === 'branch' ? _rankBranch : _rankSubject;
    return {
      all:    rankFn(sessionRows, null),
      male:   rankFn(sessionRows, 'Male'),
      female: rankFn(sessionRows, 'Female'),
    };
  }

  function reportCreditFilter(minCredits, sessionId) {
    const sessionRows = ledger.filter(r => r.examSession === sessionId);
    const byStudent = {};
    for (const r of sessionRows) {
      if (!byStudent[r.uin]) byStudent[r.uin] = { uin:r.uin, prn:r.prn, name:r.name, branch:r.branch, credits:0 };
      byStudent[r.uin].credits += Number(r.creditsEarned) || 0;
    }
    return Object.values(byStudent).filter(s => s.credits < minCredits);
  }
  function _deriveResultFromMarks(ledgerRow) {
    if (ledgerRow.result !== '') return ledgerRow.result;
    // Find subject definition to get component maxes
    const allSubjects = [...SEM1_SUBJECTS, ...ELECTIVE_PHYSICS_THEORY, ...ELECTIVE_PHYSICS_LAB,
                         ...ELECTIVE_CHEMISTRY_THEORY, ...ELECTIVE_CHEMISTRY_LAB];
    const subj = allSubjects.find(s => s.code === ledgerRow.subjectCode);
    if (!subj) return 'Fail'; // unknown subject — treat as fail (safe default)
    const components = [
      { val: ledgerRow.iatMarks,  max: subj.marks.IAT  },
      { val: ledgerRow.eseMarks,  max: subj.marks.ESE  },
      { val: ledgerRow.twMarks,   max: subj.marks.TW   },
      { val: ledgerRow.oralMarks, max: subj.marks.Oral },
    ].filter(c => c.max);
    for (const c of components) {
      const parsed = parseMarkValue(c.val, c.max); // use existing parseMarkValue
      if (!parsed.valid) return 'Fail';
      if (parsed.absent) return 'AB';
      if (!parsed.grace && parsed.value / c.max < 0.40) return 'Fail';
    }
    return 'Pass';
  }
  function _getActiveKTsForStudent(uin) {
    const student = getStudent(uin);
    if (!student) return [];

    // Step 1: Merge ledger rows per session+subject (latest component wins)
    const mergedPerSessionSubject = {};
    const allRows = ledger.filter(r => r.uin === uin)
      .sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));

    for (const r of allRows) {
      const key = r.examSession + '||' + r.subjectCode;
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

    // Step 2: For each subject, Gazette always wins over Prelim.
    // If Gazette exists for a subject → merge missing components from Prelim.
    // If no Gazette entry → use Prelim row as-is.
    const finalPerSubject = {}; // subjectCode → merged row to evaluate

    for (const row of Object.values(mergedPerSessionSubject)) {
      const sess = getSession(row.examSession);
      if (!sess) continue;
      const code = row.subjectCode;

      if (sess.entryType === 'Final Gazette') {
        // Gazette row — merge missing components from linked Prelim
        const merged = { ...row };
        if (sess.linkedPrelimSessionId) {
          const prelimKey = sess.linkedPrelimSessionId + '||' + code;
          const prelimRow = mergedPerSessionSubject[prelimKey];
          if (prelimRow) {
            if (!merged.iatMarks  && prelimRow.iatMarks)  merged.iatMarks  = prelimRow.iatMarks;
            if (!merged.eseMarks  && prelimRow.eseMarks)  merged.eseMarks  = prelimRow.eseMarks;
            if (!merged.twMarks   && prelimRow.twMarks)   merged.twMarks   = prelimRow.twMarks;
            if (!merged.oralMarks && prelimRow.oralMarks) merged.oralMarks = prelimRow.oralMarks;
          }
        }
        finalPerSubject[code] = merged; // Gazette always overwrites Prelim
      } else {
        // Prelim row — only use if no Gazette entry exists yet for this subject
        if (!finalPerSubject[code] ||
            (finalPerSubject[code].entryDateTime < row.entryDateTime)) {
          finalPerSubject[code] = row;
        }
      }
    }

    // Step 3: Compute pass/fail for each subject from merged marks
    const activeKTs = [];
    for (const row of Object.values(finalPerSubject)) {
      const sess = getSession(row.examSession);
      const subjectList = getSubjectsForSem(Number(row.semester), row.branch || student.branch, sess);
      const subj = subjectList.find(s => s.code === row.subjectCode);
      if (!subj) continue;

      const marksMap = {};
      if (row.iatMarks  !== '') marksMap.IAT  = row.iatMarks;
      if (row.eseMarks  !== '') marksMap.ESE  = row.eseMarks;
      if (row.twMarks   !== '') marksMap.TW   = row.twMarks;
      if (row.oralMarks !== '') marksMap.Oral = row.oralMarks;

      const dr = computeDisplayResult(subj, marksMap);
      // If pending, fall back to the stored result on the ledger row itself.
      // This handles the case where marks were entered across multiple partial
      // submissions — the merged row may be incomplete for computeDisplayResult
      // even though the student's overall result is a known Fail/AB.
      const effectiveResult = dr.pending
        ? (row.result || '')
        : dr.result;
      if (effectiveResult === 'Fail' || effectiveResult === 'AB') {
        activeKTs.push({ ...row, _dr: dr });
      }
    }

    return activeKTs;
  }
  function reportKTFilter(n, mode, scope, gender) {
    const byStudent = {};
    for (const student of students) {
      if (gender && student.gender !== gender) continue;
      const results = getStudentResults(student.uin);
      const allLedgerForStudent = ledger.filter(r => r.uin === student.uin);

      let activeKTs = _getActiveKTsForStudent(student.uin);

      let histKTs   = allLedgerForStudent.filter(r => r.result === 'Fail' || r.result === 'AB');

      let subjects = [];
      if (scope === 'Active') {
        subjects = activeKTs;
      } else if (scope === 'Historical') {
        // Must have zero active KTs — fully cleared
        if (activeKTs.length > 0){
          console.log(`[KT Filter] Skipped ${student.name} — active KTs:`, activeKTs.map(r => `${r.subjectCode} (${r.result}) @ ${r.entryDateTime}`)); 
          continue;
        }
        // Count unique subjects ever failed
        subjects = [...new Map(histKTs.map(r => [r.subjectCode, r])).values()];
      } else {
        subjects = [...new Map([...activeKTs,...histKTs].map(r => [r.subjectCode,r])).values()];
      }

      const uniqueCodes = [...new Set(subjects.map(r => r.subjectCode))];
      const matches = mode === 'Exactly' ? uniqueCodes.length === n : uniqueCodes.length >= n;

      if (matches && uniqueCodes.length > 0) {
        for (const s of subjects) {
          byStudent[student.uin + s.subjectCode] = {
            prn: student.prn, uin: student.uin, name: student.name,
            branch: student.branch, gender: student.gender || '',
            subjectCode: s.subjectCode,
            subjectName: s.subjectName, session: s.examSession, result: s.result
          };
        }
      }
    }
    return Object.values(byStudent);
  }

  function reportKTDistribution({ prelimSessionId, gazetteSessionId, branch, batchYear, gender } = {}) {
    if (!prelimSessionId) return [];

    // Collect prelim rows with same filters as reportResultSummary
    let prelimRows = ledger.filter(r => r.examSession === prelimSessionId);
    if (branch)    prelimRows = prelimRows.filter(r => r.branch    === branch);
    if (batchYear) prelimRows = prelimRows.filter(r => r.batchYear === batchYear);
    if (gender)    prelimRows = prelimRows.filter(r => r.gender    === gender);

    // Build gazette index (uin+subjectCode → gazette row)
    const gazetteIndex = {};
    if (gazetteSessionId) {
      let gazRows = ledger.filter(r => r.examSession === gazetteSessionId);
      if (branch)    gazRows = gazRows.filter(r => r.branch    === branch);
      if (batchYear) gazRows = gazRows.filter(r => r.batchYear === batchYear);
      if (gender)    gazRows = gazRows.filter(r => r.gender    === gender);
      for (const r of gazRows) gazetteIndex[r.uin + '||' + r.subjectCode] = r;
    }

    // Per student: collect latest prelim row per subject, then apply gazette override
    const byStudent = {};
    for (const r of prelimRows) {
      const key = r.uin + '||' + r.subjectCode;
      if (!byStudent[r.uin]) byStudent[r.uin] = { uin: r.uin, prn: r.prn, name: r.name, branch: r.branch, subjectRows: {} };
      // Latest prelim row wins per subject
      const existing = byStudent[r.uin].subjectRows[r.subjectCode];
      if (!existing || r.entryDateTime > existing.entryDateTime)
        byStudent[r.uin].subjectRows[r.subjectCode] = r;
    }

    // Apply gazette override, recompute result from merged marks
    const prelimSess = getSession(prelimSessionId);
    const buckets = {}; // ktCount → [{ uin, prn, name, branch, ktSubjects }]
    for (const { uin, prn, name, branch: br, subjectRows } of Object.values(byStudent)) {
      const ktSubjects = [];
      for (const [subjectCode, row] of Object.entries(subjectRows)) {
        const gz = gazetteIndex[uin + '||' + subjectCode];

        // Merge marks: prelim base, gazette overrides any component it has
        const mergedMarks = {};
        if (row.iatMarks  !== '') mergedMarks.IAT  = row.iatMarks;
        if (row.eseMarks  !== '') mergedMarks.ESE  = row.eseMarks;
        if (row.twMarks   !== '') mergedMarks.TW   = row.twMarks;
        if (row.oralMarks !== '') mergedMarks.Oral = row.oralMarks;
        if (gz) {
          if (gz.eseMarks  !== '') mergedMarks.ESE  = gz.eseMarks;
          if (gz.iatMarks  !== '') mergedMarks.IAT  = gz.iatMarks;
          if (gz.twMarks   !== '') mergedMarks.TW   = gz.twMarks;
          if (gz.oralMarks !== '') mergedMarks.Oral = gz.oralMarks;
        }

        // Recompute result from merged marks using subject config
        const subjectList = getSubjectsForSem(Number(row.semester), br, prelimSess);
        const subj = subjectList.find(s => s.code === subjectCode);
        let result;
        if (subj) {
          const dr = computeDisplayResult(subj, mergedMarks);
          result = dr.pending ? 'Pending' : dr.result;
        } else {
          result = gz ? (gz.result || row.result) : row.result; // fallback for unknown subject
        }

        if (result === 'Fail' || result === 'AB')
          ktSubjects.push({ subjectCode, subjectName: row.subjectName, result });
      }
      const ktCount = ktSubjects.length;
      if (!buckets[ktCount]) buckets[ktCount] = [];
      buckets[ktCount].push({ uin, prn, name, branch: br, ktSubjects });
    }

    // Return sorted by ktCount ascending
    return Object.entries(buckets)
      .map(([ktCount, students]) => ({ ktCount: Number(ktCount), students }))
      .sort((a, b) => a.ktCount - b.ktCount);
  }

  function getMyEntries(email, sessionId) {
    return ledger.filter(r => r.enteredBy === email && (!sessionId || r.examSession === sessionId));
  }

  // ── Session student eligibility ───────────────────────────
  // Returns all students eligible for a session, merged and flagged.
  // Fresh batch students (batchYear === derivedFreshBatch) are included.
  // Any student with an active KT in any subject of session.semester is included.
  // Flag: 'KT' if student has any active fail/AB in any sem-N subject,
  //       'Regular' otherwise.
  function getEligibleStudents(session, branch) {
    const freshBatch  = String(deriveFreshBatch(
      Number(session.name.slice(0, 4)),   // year from name prefix
      session.month || (session.name.includes('Dec') ? 'December' : 'May')
    ));
    const sem = session.semester;

    // All students for this branch
    const branchStudents = students.filter(s =>
      !branch || s.branch === branch
    );

    // Build set of subject codes for this semester
    // (use a neutral session ref for Sem-I; for Sem-II we need elective codes)
    const semSubjectCodes = new Set(
      getSubjectsForSem(sem, branch || 'Computer', session).map(s => s.code)
    );

    // For each student, compute active KT subjects in this semester
    const ktSubjectsByStudent = {};
    for (const s of branchStudents) {
      const activeKTs = getActiveKTSubjects(s.uin)
        .filter(r => {
          // Must belong to this semester's subject list
          // Check via stored semester on ledger row
          return Number(r.semester) === sem;
        });
      if (activeKTs.length > 0) {
        ktSubjectsByStudent[s.uin] = activeKTs;
      }
    }

    // Merge: fresh batch OR has KT in this semester
    const eligible = new Map();

    for (const s of branchStudents) {
      const isFresh = s.batchYear === freshBatch;
      const hasKT   = !!ktSubjectsByStudent[s.uin];

      if (!isFresh && !hasKT) continue;

      eligible.set(s.uin, {
        ...s,
        attemptFlag:  hasKT ? 'KT' : 'Regular',
        ktSubjects:   ktSubjectsByStudent[s.uin] || [],
      });
    }

    return [...eligible.values()];
  }

  // ── Divisions ─────────────────────────────────────────────
  function getDivisions(branch) {
    return [...new Set(students.filter(s => s.branch === branch).map(s => s.division))].sort();
  }

  function getBatchYears() {
    return [...new Set(students.map(s => s.batchYear))].sort().reverse();
  }

  // All unique subject codes+names in the ledger (for filter dropdowns)
  function getAllSubjects() {
    const map = {};
    for (const r of ledger) {
      if (!map[r.subjectCode]) map[r.subjectCode] = r.subjectName;
    }
    return Object.entries(map).map(([code, name]) => ({ code, name })).sort((a,b) => a.code.localeCompare(b.code));
  }

  return {
    loadAll, reload,
    getStudents, getStudent, searchStudents,
    getSessions, getSession, getSessionsForBatch, addSession, lockSession, linkPrelimSession,
    getEligibleStudents,
    computeStudentAcademics,
    getStudentResults, getActiveKTSubjects, getKTEligibleStudents,
    getLatestEntryForSubject, getLedgerForStudent,
    getSessionStatus, getExpectedSubjectCount,
    submitEntries,
    getSeatNumber, getSeatsForSession, uploadSeats, updateSeatNumber,getSeatsForSessionWithFallback,
    computeAttemptTag,
    reportResultSummary, reportRevalImpact, reportToppers, reportCreditFilter, reportKTFilter, getMyEntries,
    reportKTDistribution,
    getExamGroups,
    getDivisions, getBatchYears, getAllSubjects,
    get ledger() { return ledger; },
  };
})();
