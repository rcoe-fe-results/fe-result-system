// ============================================================
// state.js — Central app state + business logic
// ============================================================

const State = (() => {
  let students  = [];
  let sessions  = [];
  let ledger    = [];
  let _loaded   = false;

  // ── Load all data ─────────────────────────────────────────
  async function loadAll() {
    [students, sessions, ledger] = await Promise.all([
      Sheets.getStudents(),
      Sheets.getSessions(),
      Sheets.getLedger(),
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

  async function addSession(name, semester, batchYear, electives = {}) {
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
      physicsTheoryCode: electives.physicsTheoryCode || '',
      physicsLabCode:    electives.physicsLabCode    || '',
      chemTheoryCode:    electives.chemTheoryCode    || '',
      chemLabCode:       electives.chemLabCode       || '',
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

    // Check if any row (not just latest) has KT, AB, or Reval attempt
    const hasMultiAttempt = rows.some(r =>
      r.attemptType === 'KT' || r.attemptType === 'Reval' ||
      r.result === 'AB' || r.result === 'Fail'
    );

    if (hasMultiAttempt) return 'multi-attempt';

    // All latest entries must be Pass
    const allPass = Object.values(latestBySubject).every(r => r.result === 'Pass');
    return allPass ? 'successful' : 'multi-attempt';
  }

  // ── Submit marks ──────────────────────────────────────────
  async function submitEntries(session, entries) {
    const user    = Auth.getUser();
    const now     = new Date().toISOString();
    const toAppend = [];

    for (const entry of entries) {
      const student = getStudent(entry.uin);
      if (!student) continue;

      const semester = session.semester;
      const subjects = getSubjectsForSem(semester, student.branch, session);
      const subject  = subjects.find(s => s.code === entry.subjectCode);
      if (!subject) continue;

      if (entry.attemptType === 'Reval') {
        const prev = getLatestEntryForSubject(entry.uin, entry.subjectCode, session.id);
        const newESE = entry.marks.ESE?.value;
        const oldESE = prev ? Number(prev.eseMarks) : null;
        if (prev && newESE === oldESE) continue;
      }

      const allComps = Object.keys(subject.marks);
      const hasAllComps = allComps.every(c => entry.marks[c] && entry.marks[c].value !== null);
      const result = hasAllComps ? computeResult(subject, entry.marks) : { total: null, result: '', creditsEarned: 0 };
      const grade  = '—';

      const row = {
        entryId:        Sheets.newEntryId(),
        uin:            student.uin,
        prn:            student.prn,
        name:           student.name,
        branch:         student.branch,
        division:       student.division,
        batchYear:      student.batchYear,
        examSession:    session.id,
        semester:       String(semester),
        subjectCode:    subject.code,
        subjectName:    subject.name,
        subjectType:    subject.type,
        creditsAssigned:String(subject.credits),
        attemptType:    entry.attemptType,
        iatMarks:       _markStr(entry.marks.IAT),
        eseMarks:       _markStr(entry.marks.ESE),
        twMarks:        _markStr(entry.marks.TW),
        oralMarks:      _markStr(entry.marks.Oral),
        totalMarks:     result.total !== null ? String(result.total) : '',
        grade,
        creditsEarned:  result.creditsEarned !== undefined ? String(result.creditsEarned) : '0',
        result:         result.result || '',
        source:         'WebApp',
        enteredBy:      user.email,
        entryDateTime:  now,
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
  function reportRevalImpact({ sessionId, branch, subjectCode } = {}) {
    let revalRows = ledger.filter(r => r.attemptType === 'Reval');
    if (sessionId)   revalRows = revalRows.filter(r => r.examSession === sessionId);
    if (branch)      revalRows = revalRows.filter(r => r.branch === branch);
    if (subjectCode) revalRows = revalRows.filter(r => r.subjectCode === subjectCode);

    const result = [];
    for (const r of revalRows) {
      const prev = ledger
        .filter(p => p.uin === r.uin && p.subjectCode === r.subjectCode &&
                     p.examSession === r.examSession && p.attemptType !== 'Reval')
        .sort((a,b) => b.entryDateTime.localeCompare(a.entryDateTime))[0];

      if (!prev) continue;
      const changed = prev.result !== r.result;
      if (!changed) continue;

      result.push({
        ...r,
        prevResult: prev.result,
        direction: (prev.result === 'Fail' && r.result === 'Pass') ? 'improved' : 'worsened',
      });
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
    getSessions, getSession, getSessionsForBatch, addSession, lockSession,
    getStudentResults, getActiveKTSubjects, getKTEligibleStudents,
    getLatestEntryForSubject, getLedgerForStudent,
    getSessionStatus,
    submitEntries,
    reportResultSummary, reportRevalImpact, reportToppers, reportCreditFilter, reportKTFilter, getMyEntries,
    getDivisions, getBatchYears, getAllSubjects,
    get ledger() { return ledger; },
  };
})();
