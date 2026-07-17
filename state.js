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
  function getStudents({ branch, division, batchYear } = {}) {
    return students.filter(s =>
      (!branch    || s.branch    === branch)   &&
      (!division  || s.division  === division) &&
      (!batchYear || s.batchYear === batchYear)
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

  async function addSession(name, semester, batchYear, electives = {}, entryType = 'Preliminary', linkedPrelimSessionId = '') {
    const user = Auth.getUser();
    const sem  = Number(semester);

    if (sem === 2) {
      const required = ['physicsTheoryCode','physicsLabCode','chemTheoryCode','chemLabCode'];
      for (const key of required) {
        if (!electives[key]) throw new Error(`Missing elective: ${key}`);
      }
    }

    const session = {
      id:        'SES-' + Date.now(),
      name,
      semester:  sem,
      batchYear,
      status:    'Active',
      createdBy: user.email,
      physicsTheoryCode:     electives.physicsTheoryCode    || '',
      physicsLabCode:        electives.physicsLabCode       || '',
      chemTheoryCode:        electives.chemTheoryCode       || '',
      chemLabCode:           electives.chemLabCode          || '',
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
    return seat ? seat.seatNumber : '—';
  }

  function getSeatsForSession(sessionId) {
    return seats.filter(s => s.sessionId === sessionId);
  }

  async function uploadSeats(seatList) {
    await Sheets.uploadSeats(seatList);
    seats.push(...seatList);
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
    // All ledger rows for this student+subject, sorted chronologically
    const allRows = ledger
      .filter(r => r.uin === uin && r.subjectCode === subjectCode)
      .sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));

    if (allRows.length === 0) return null;

    // Latest row for this specific session
    const sessionRows = allRows.filter(r => r.examSession === sessionId);
    if (sessionRows.length === 0) return null;
    const latest = sessionRows[sessionRows.length - 1];

    // Active KT = latest result overall is Fail or AB
    const overallLatest = allRows[allRows.length - 1];
    if (overallLatest.result === 'Fail' || overallLatest.result === 'AB') {
      return 'Active KT';
    }

    if (latest.result !== 'Pass') return null;

    // Is this a KT attempt? — student had any prior Fail/AB for this subject in EARLIER session
    const session = getSession(sessionId);
    const priorFail = allRows.some(r => {
      if (r.examSession === sessionId) return false;
      const rSession = getSession(r.examSession);
      // Earlier in time = session created before current (compare session IDs as timestamps via prefix)
      // We compare entryDateTime as a proxy — any Fail/AB before the earliest entry in this session
      return (r.result === 'Fail' || r.result === 'AB') &&
             r.entryDateTime < (sessionRows[0]?.entryDateTime || '');
    });

    // Is this a Reval? — compare ESE between Preliminary and Final Gazette
    const isReval = _detectReval(uin, subjectCode, sessionId);

    if (priorFail) {
      return isReval ? 'Cleared in KT attempt after Reval' : 'Cleared in KT attempt';
    }
    return isReval ? 'Cleared in Regular attempt after Reval' : 'Cleared in Regular attempt';
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
      if (!latest[key] || r.entryDateTime > latest[key].entryDateTime) {
        latest[key] = r;
      }
    }
    return latest;
  }

  function getActiveKTSubjects(uin) {
    const results = getStudentResults(uin);
    return Object.values(results).filter(r => r.result === 'Fail' || r.result === 'AB');
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
    const user      = Auth.getUser();
    const now       = new Date().toISOString();
    const toAppend  = [];
    const isFinal   = session.entryType === 'Final Gazette';

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
      };

      toAppend.push(row);
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

  // ── Reports data ──────────────────────────────────────────

  // Result Summary — filters: sessionId, branch?, subjectCode?, batchYear?, component?
  function reportResultSummary({ sessionId, branch, subjectCode, batchYear, component } = {}) {
    let rows = ledger.filter(r => (!sessionId || r.examSession === sessionId));
    if (branch)      rows = rows.filter(r => r.branch === branch);
    if (batchYear)   rows = rows.filter(r => r.batchYear === batchYear);
    if (subjectCode) rows = rows.filter(r => r.subjectCode === subjectCode);

    const bySubject = {};
    for (const r of rows) {
      if (!bySubject[r.subjectCode]) {
        bySubject[r.subjectCode] = {
          name: r.subjectName, type: r.subjectType,
          pass:0, fail:0, ab:0, total:0,
          iatTotal:0, iatCount:0,
          eseTotal:0, eseCount:0,
          twTotal:0,  twCount:0,
          oralTotal:0,oralCount:0,
        };
      }
      const d = bySubject[r.subjectCode];
      d.total++;
      if (r.result === 'Pass') d.pass++;
      else if (r.result === 'Fail') d.fail++;
      else if (r.result === 'AB')   d.ab++;

      if (r.iatMarks  && r.iatMarks  !== 'AB') { d.iatTotal  += Number(r.iatMarks)  || 0; d.iatCount++;  }
      if (r.eseMarks  && r.eseMarks  !== 'AB') { d.eseTotal  += Number(r.eseMarks)  || 0; d.eseCount++;  }
      if (r.twMarks   && r.twMarks   !== 'AB') { d.twTotal   += Number(r.twMarks)   || 0; d.twCount++;   }
      if (r.oralMarks && r.oralMarks !== 'AB') { d.oralTotal += Number(r.oralMarks) || 0; d.oralCount++; }
    }

    return Object.entries(bySubject).map(([code, d]) => ({
      code, ...d,
      passPct:  d.total ? Math.round(d.pass/d.total*100) : 0,
      avgIAT:   d.iatCount  ? (d.iatTotal/d.iatCount).toFixed(1)   : '—',
      avgESE:   d.eseCount  ? (d.eseTotal/d.eseCount).toFixed(1)   : '—',
      avgTW:    d.twCount   ? (d.twTotal/d.twCount).toFixed(1)      : '—',
      avgOral:  d.oralCount ? (d.oralTotal/d.oralCount).toFixed(1)  : '—',
    }));
  }

  // Reval Impact — filters: sessionId, branch?, subjectCode?
  // Returns both Fail→Pass (positive) and Pass→Fail (warning)
  // Reval is now determined dynamically: compares ESE between Final Gazette and linked Preliminary.
  function reportRevalImpact({ sessionId, branch, subjectCode } = {}) {
    // Find Final Gazette sessions matching the filter
    let finalSessions = sessions.filter(s => s.entryType === 'Final Gazette' && s.linkedPrelimSessionId);
    if (sessionId) finalSessions = finalSessions.filter(s => s.id === sessionId);

    const result = [];

    for (const finalSess of finalSessions) {
      const prelimSess = sessions.find(s => s.id === finalSess.linkedPrelimSessionId);
      if (!prelimSess) continue;

      // All Final Gazette ledger rows for this session
      let finalRows = ledger.filter(r => r.examSession === finalSess.id);
      if (branch)      finalRows = finalRows.filter(r => r.branch === branch);
      if (subjectCode) finalRows = finalRows.filter(r => r.subjectCode === subjectCode);

      for (const finalRow of finalRows) {
        // Get corresponding Preliminary row
        const prelimRow = ledger
          .filter(p => p.uin === finalRow.uin &&
                       p.subjectCode === finalRow.subjectCode &&
                       p.examSession === finalSess.linkedPrelimSessionId)
          .sort((a,b) => b.entryDateTime.localeCompare(a.entryDateTime))[0];

        if (!prelimRow) continue;

        // Only a reval if ESE changed
        const eseChanged = String(finalRow.eseMarks).trim() !== String(prelimRow.eseMarks).trim();
        if (!eseChanged) continue;

        const changed = prelimRow.result !== finalRow.result;
        if (!changed) continue;

        result.push({
          ...finalRow,
          prevResult: prelimRow.result,
          direction: (prelimRow.result === 'Fail' && finalRow.result === 'Pass') ? 'improved' : 'worsened',
        });
      }
    }
    return result;
  }

  // Toppers — branch-wise (top N by total marks) or subject-wise (top 3 per branch)
  function reportToppers({ sessionId, mode = 'branch', branch, subjectCode, topN = 10 } = {}) {
    const sessionRows = ledger.filter(r =>
      r.examSession === sessionId && r.result === 'Pass'
    );

    if (mode === 'branch') {
      // Top N per branch by total marks
      const byStudentBranch = {};
      for (const r of sessionRows) {
        if (branch && r.branch !== branch) continue;
        const key = r.uin;
        if (!byStudentBranch[key]) byStudentBranch[key] = { uin:r.uin, prn:r.prn, name:r.name, branch:r.branch, totalCredits:0, totalMarks:0 };
        byStudentBranch[key].totalCredits += Number(r.creditsEarned) || 0;
        byStudentBranch[key].totalMarks   += Number(r.totalMarks)    || 0;
      }

      // Group by branch, sort, top N each
      const byBranch = {};
      for (const s of Object.values(byStudentBranch)) {
        if (!byBranch[s.branch]) byBranch[s.branch] = [];
        byBranch[s.branch].push(s);
      }
      const result = [];
      for (const [br, list] of Object.entries(byBranch)) {
        list.sort((a,b) => b.totalMarks - a.totalMarks || b.totalCredits - a.totalCredits);
        list.slice(0, topN).forEach((s, i) => result.push({ rank: i+1, ...s }));
      }
      return result;

    } else {
      // Subject-wise: top 3 per branch for a given subject (or all subjects)
      const filtered = sessionRows.filter(r =>
        (!subjectCode || r.subjectCode === subjectCode) &&
        (!branch || r.branch === branch)
      );

      // group by subjectCode → branch → students
      const bySubjBranch = {};
      for (const r of filtered) {
        const sk = r.subjectCode;
        const bk = r.branch;
        if (!bySubjBranch[sk]) bySubjBranch[sk] = {};
        if (!bySubjBranch[sk][bk]) bySubjBranch[sk][bk] = [];
        bySubjBranch[sk][bk].push({ uin:r.uin, prn:r.prn, name:r.name, branch:r.branch,
          subjectCode:r.subjectCode, subjectName:r.subjectName,
          totalMarks: Number(r.totalMarks)||0 });
      }

      const result = [];
      for (const [sk, branches] of Object.entries(bySubjBranch)) {
        for (const [bk, list] of Object.entries(branches)) {
          list.sort((a,b) => b.totalMarks - a.totalMarks);
          list.slice(0, 3).forEach((s, i) => result.push({ rank: i+1, ...s }));
        }
      }
      return result;
    }
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

  function reportKTFilter(n, mode, scope) {
    const byStudent = {};
    for (const student of students) {
      const results = getStudentResults(student.uin);
      const allLedgerForStudent = ledger.filter(r => r.uin === student.uin);

      let activeKTs = Object.values(results).filter(r => r.result === 'Fail' || r.result === 'AB');
      let histKTs   = allLedgerForStudent.filter(r => r.result === 'Fail' || r.result === 'AB');

      let subjects = [];
      if (scope === 'Active')     subjects = activeKTs;
      else if (scope === 'Historical') subjects = histKTs;
      else subjects = [...new Map([...activeKTs,...histKTs].map(r => [r.subjectCode,r])).values()];

      const uniqueCodes = [...new Set(subjects.map(r => r.subjectCode))];
      const matches = mode === 'Exactly' ? uniqueCodes.length === n : uniqueCodes.length >= n;

      if (matches && uniqueCodes.length > 0) {
        for (const s of subjects) {
          byStudent[student.uin + s.subjectCode] = {
            prn: student.prn, uin: student.uin, name: student.name,
            branch: student.branch, subjectCode: s.subjectCode,
            subjectName: s.subjectName, session: s.examSession, result: s.result
          };
        }
      }
    }
    return Object.values(byStudent);
  }

  function getMyEntries(email, sessionId) {
    return ledger.filter(r => r.enteredBy === email && (!sessionId || r.examSession === sessionId));
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
    getStudentResults, getActiveKTSubjects, getKTEligibleStudents,
    getLatestEntryForSubject, getLedgerForStudent,
    getSessionStatus,
    submitEntries,
    getSeatNumber, getSeatsForSession, uploadSeats,
    computeAttemptTag,
    reportResultSummary, reportRevalImpact, reportToppers, reportCreditFilter, reportKTFilter, getMyEntries,
    getDivisions, getBatchYears, getAllSubjects,
    get ledger() { return ledger; },
  };
})();
