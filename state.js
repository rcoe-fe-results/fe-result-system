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
    return seat ? seat.seatNumber : '—';
  }

  function getSeatsForSession(sessionId) {
    return seats.filter(s => s.sessionId === sessionId);
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
        gender:          student.gender || '',
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

          const dr = computeDisplayResult(subj, marksMap);

          if (dr.pending) {
            pendingCount++;
            subjectResults.push({ r: canonicalRow, subj, dr, pending: true, carriedMap });
            continue;
          }

          subjectResults.push({ r: canonicalRow, subj, dr, pending: false, carriedMap });

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
          if (sess.entryType === 'Final Gazette' && sess.linkedPrelimSessionId) {
            const prelimKey = sess.linkedPrelimSessionId + '||' + r.subjectCode;
            const prelimRow = latestPerSessionSubject[prelimKey];
            if (prelimRow) {
              if (!marksMap.IAT  && prelimRow.iatMarks)  marksMap.IAT  = prelimRow.iatMarks;
              if (!marksMap.TW   && prelimRow.twMarks)   marksMap.TW   = prelimRow.twMarks;
              if (!marksMap.Oral && prelimRow.oralMarks) marksMap.Oral = prelimRow.oralMarks;
            }
          }

          const dr = computeDisplayResult(subj, marksMap);

          if (dr.pending) {
            pendingCount++;
            subjectResults.push({ r, subj, dr, pending: true });
            continue;
          }

          subjectResults.push({ r, subj, dr, pending: false });

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
        if (sess.batchYear !== student.batchYear) {
          const priorSessRows = Object.values(latestPerSessionSubject).filter(pr =>
            pr.subjectCode === r.subjectCode &&
            pr.examSession !== sess.id &&
            Number(pr.semester) === Number(r.semester)
          ).sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));

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

  // Result Summary — filters: sessionId, branch?, subjectCode?, batchYear?, component?
function reportResultSummary({ sessionId, branch, batchYear, subjectCode, component, gender } = {}) {
    let rows = ledger;
    if (sessionId)   rows = rows.filter(r => r.examSession === sessionId);
    if (branch)      rows = rows.filter(r => r.branch === branch);
    if (batchYear)   rows = rows.filter(r => r.batchYear === batchYear);
    if (subjectCode) rows = rows.filter(r => r.subjectCode === subjectCode);
    if (gender)      rows = rows.filter(r => r.gender === gender);

    // Group by subject
    const bySubject = {};
    for (const r of rows) {
      if (!bySubject[r.subjectCode]) bySubject[r.subjectCode] = { code: r.subjectCode, name: r.subjectName, rows: [] };
      bySubject[r.subjectCode].rows.push(r);
    }

    return Object.values(bySubject).map(({ code, name, rows }) => {
      // ── Merge all rows per student per subject (same logic as computeStudentAcademics) ──
      // Sort ascending by entryDateTime, then last-non-empty-wins per component per student.
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
          // Use latest result and entryDateTime
          if (r.result        !== '') m.result        = r.result;
          if (r.totalMarks    !== '') m.totalMarks    = r.totalMarks;
          if (r.creditsEarned !== '') m.creditsEarned = r.creditsEarned;
          m.entryDateTime = r.entryDateTime;
        }
      }

      const entries = Object.values(mergedPerStudent);
      const total   = entries.length;
      const pass    = entries.filter(r => r.result === 'Pass').length;
      const fail    = entries.filter(r => r.result === 'Fail').length;
      const ab      = entries.filter(r => r.result === 'AB').length;

      // Average marks per component (across merged rows that have that component)
      const compSums  = { IAT: 0, ESE: 0, TW: 0, Oral: 0 };
      const compCount = { IAT: 0, ESE: 0, TW: 0, Oral: 0 };
      for (const r of entries) {
        if (r.iatMarks  !== '') { compSums.IAT  += Number(r.iatMarks)  || 0; compCount.IAT++;  }
        if (r.eseMarks  !== '') { compSums.ESE  += Number(r.eseMarks)  || 0; compCount.ESE++;  }
        if (r.twMarks   !== '') { compSums.TW   += Number(r.twMarks)   || 0; compCount.TW++;   }
        if (r.oralMarks !== '') { compSums.Oral += Number(r.oralMarks) || 0; compCount.Oral++; }
      }

      const avgMarks = {};
      for (const comp of ['IAT','ESE','TW','Oral']) {
        avgMarks[comp] = compCount[comp] > 0 ? (compSums[comp] / compCount[comp]) : null;
      }

      return { code, name, total, pass, fail, ab, passRate: total ? pass/total : 0, avgMarks };
    });
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
      for (const [, list] of Object.entries(byBranch)) {
        list.sort((a,b) => b.totalMarks - a.totalMarks || b.totalCredits - a.totalCredits);
        list.slice(0, topN).forEach((s, i) => result.push({ rank: i+1, ...s }));
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
      for (const [, branches] of Object.entries(bySubjBranch)) {
        for (const [, list] of Object.entries(branches)) {
          list.sort((a,b) => b.totalMarks - a.totalMarks);
          list.slice(0, 3).forEach((s, i) => result.push({ rank: i+1, ...s }));
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

  function reportKTFilter(n, mode, scope, gender) {
    const byStudent = {};
    for (const student of students) {
      if (gender && student.gender !== gender) continue;
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
            branch: student.branch, gender: student.gender || '',
            subjectCode: s.subjectCode,
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
    getSeatNumber, getSeatsForSession, uploadSeats, updateSeatNumber,
    computeAttemptTag,
    reportResultSummary, reportRevalImpact, reportToppers, reportCreditFilter, reportKTFilter, getMyEntries,
    getDivisions, getBatchYears, getAllSubjects,
    get ledger() { return ledger; },
  };
})();
