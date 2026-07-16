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

    // Electives only applicable for Sem II
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
  // Returns: { [subjectCode]: latestResult } for a given UIN
  function getStudentResults(uin) {
    const rows = ledger.filter(r => r.uin === uin);
    // For each subject, latest entry wins
    const latest = {};
    for (const r of rows) {
      const key = r.subjectCode;
      if (!latest[key] || r.entryDateTime > latest[key].entryDateTime) {
        latest[key] = r;
      }
    }
    return latest;
  }

  // Returns subjects where latest result is Fail or AB (active KTs)
  function getActiveKTSubjects(uin) {
    const results = getStudentResults(uin);
    return Object.values(results).filter(r => r.result === 'Fail' || r.result === 'AB');
  }

  // For a given semester + branch, which students are KT-eligible?
  // Returns: [ { student, ktSubjects: [ subject config ] } ]
  //
  // KT subjects come from the student's OWN ledger history — the subject
  // name and code are already stored in the ledger row. We reconstruct a
  // lightweight config object from those ledger rows so the marks structure
  // is available for the entry grid. Electives from a prior session are
  // preserved correctly because we read from the ledger, not the current session.
  function getKTEligibleStudents(semester, branch) {
    const allBranchStudents = students.filter(s => branch === 'All' || s.branch === branch);
    const result = [];

    for (const student of allBranchStudents) {
      const ktRows = getActiveKTSubjects(student.uin);

      const ktSubjects = ktRows.map(r => {
        // 1. Try Sem I static list
        const s1 = SEM1_SUBJECTS.find(s => s.code === r.subjectCode);
        if (s1) return s1;

        // 2. Try all known Sem II elective variants
        //    (getSem2Subjects with no session gives fixed subjects;
        //     elective slots return stubs — supplement from ledger name)
        const allSem2Variants = [
          ...ELECTIVE_PHYSICS_THEORY, ...ELECTIVE_PHYSICS_LAB,
          ...ELECTIVE_CHEMISTRY_THEORY, ...ELECTIVE_CHEMISTRY_LAB,
        ];
        const elective = allSem2Variants.find(e => e.code === r.subjectCode);
        if (elective) {
          // Determine marks structure from subject type stored in ledger
          const marks = _marksStructureFromType(r.subjectType);
          return { code: r.subjectCode, name: r.subjectName, type: r.subjectType, credits: Number(r.creditsAssigned) || 0, marks };
        }

        // 3. Try fixed Sem II subjects (non-elective slots)
        const s2fixed = getSem2Subjects(student.branch, null).find(s => s.code === r.subjectCode);
        if (s2fixed) return s2fixed;

        // 4. Fallback — reconstruct from ledger row
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

  // Rebuild marks structure from stored subject type string
  function _marksStructureFromType(type) {
    switch (type) {
      case 'Theory+Tutorial': return { IAT:40, ESE:60, TW:25 };
      case 'Theory':          return { IAT:30, ESE:45 };       // default theory; override if needed
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

  // ── Submit marks ──────────────────────────────────────────
  // entries = [ { uin, subjectCode, attemptType, marks: {IAT,ESE,TW,Oral} } ]
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

      // Reval: only append if ESE marks changed
      if (entry.attemptType === 'Reval') {
        const prev = getLatestEntryForSubject(entry.uin, entry.subjectCode, session.id);
        const newESE = entry.marks.ESE?.value;
        const oldESE = prev ? Number(prev.eseMarks) : null;
        if (prev && newESE === oldESE) continue; // no change — skip
      }

      // Compute result
      const result = computeResult(subject, entry.marks);
      const grade  = '—'; // Pending MU gazette

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
    ledger.push(...toAppend); // update local cache
    return toAppend.length;
  }

  function _markStr(m) {
    if (!m) return '';
    if (m.absent) return 'AB';
    if (m.grace)  return m.value + '*';
    return m.value !== null ? String(m.value) : '';
  }

  // ── Reports data ──────────────────────────────────────────
  function reportResultSummary(sessionId) {
    const rows = ledger.filter(r => r.examSession === sessionId);
    const bySubject = {};
    for (const r of rows) {
      if (!bySubject[r.subjectCode]) bySubject[r.subjectCode] = { name:r.subjectName, pass:0, fail:0, ab:0, total:0 };
      bySubject[r.subjectCode].total++;
      if (r.result === 'Pass') bySubject[r.subjectCode].pass++;
      else if (r.result === 'Fail') bySubject[r.subjectCode].fail++;
      else if (r.result === 'AB')   bySubject[r.subjectCode].ab++;
    }
    return Object.entries(bySubject).map(([code, d]) => ({
      code, ...d,
      passPct: d.total ? Math.round(d.pass/d.total*100) : 0,
    }));
  }

  function reportRevalImpact(sessionId) {
    const revalRows = ledger.filter(r => r.examSession === sessionId && r.attemptType === 'Reval');
    const result = [];
    for (const r of revalRows) {
      const prev = ledger
        .filter(p => p.uin === r.uin && p.subjectCode === r.subjectCode && p.examSession === sessionId && p.attemptType !== 'Reval')
        .sort((a,b) => b.entryDateTime.localeCompare(a.entryDateTime))[0];
      if (prev && prev.result === 'Fail' && r.result === 'Pass') {
        result.push({ ...r, prevResult: prev.result });
      }
    }
    return result;
  }

  function reportToppers(sessionId, topN = 10) {
    const sessionRows = ledger.filter(r => r.examSession === sessionId && r.result === 'Pass');
    const byStudent = {};
    for (const r of sessionRows) {
      if (!byStudent[r.uin]) byStudent[r.uin] = { uin:r.uin, name:r.name, branch:r.branch, totalCredits:0, totalMarks:0 };
      byStudent[r.uin].totalCredits += Number(r.creditsEarned) || 0;
      byStudent[r.uin].totalMarks   += Number(r.totalMarks)    || 0;
    }
    return Object.values(byStudent)
      .sort((a,b) => b.totalCredits - a.totalCredits || b.totalMarks - a.totalMarks)
      .slice(0, topN);
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
    // scope: 'Active' | 'Historical' | 'Both'
    const byStudent = {};
    for (const student of students) {
      const results = getStudentResults(student.uin);
      const allLedgerForStudent = ledger.filter(r => r.uin === student.uin);

      let activeKTs = Object.values(results).filter(r => r.result === 'Fail' || r.result === 'AB');
      let histKTs   = allLedgerForStudent.filter(r => r.result === 'Fail' || r.result === 'AB');

      let subjects = [];
      if (scope === 'Active')    subjects = activeKTs;
      else if (scope === 'Historical') subjects = histKTs;
      else subjects = [...new Map([...activeKTs,...histKTs].map(r => [r.subjectCode,r])).values()];

      const count = mode === 'Exactly' ? subjects.filter((_, i, a) => {
        const codes = [...new Set(a.map(r => r.subjectCode))];
        return codes.length === n;
      }).length : 0;

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

  return {
    loadAll, reload,
    getStudents, getStudent, searchStudents,
    getSessions, getSession, getSessionsForBatch, addSession, lockSession,
    getStudentResults, getActiveKTSubjects, getKTEligibleStudents,
    getLatestEntryForSubject, getLedgerForStudent,
    submitEntries,
    reportResultSummary, reportRevalImpact, reportToppers, reportCreditFilter, reportKTFilter, getMyEntries,
    getDivisions, getBatchYears,
    get ledger() { return ledger; },
  };
})();
