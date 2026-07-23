// ============================================================
// state.js — Central app state + business logic
// ============================================================

const State = (() => {
  let students  = [];
  let sessions  = [];
  let ledger    = [];
  let seats     = [];   // [{ uin, sessionId, seatNumber }]
  let _ktCache  = {};   // built by _buildKTCache(), keyed by uin
  let _loaded   = false;

  // ── Applicable sessions per student per semester ──────────
  // Returns { sem1: [...], sem2: [...] } of Preliminary sessions
  // in chronological order, filtered by batch year rules:
  //   Sem-I  starts from the batch's admission December.
  //   Sem-II starts from the following May.
  // Sessions where the student has no ledger record are included
  // (caller decides whether to skip — "no record" = didn't sit).
  function _getApplicableSessions(student) {
    const batchYear = Number(student.batchYear);

    // Chronological score: year × 12 + month
    const _score = s => {
      const year  = Number((s.name || '').slice(0, 4));
      const month = (s.name || '').includes('May') ? 5 : 12;
      return year * 12 + month;
    };

    // Sem-I: batch's own December onwards (Dec of batchYear)
    const sem1Start = batchYear * 12 + 12;

    // Sem-II: following May onwards (May of batchYear + 1)
    const sem2Start = (batchYear + 1) * 12 + 5;

    const prelims = sessions
      .filter(s => s.entryType !== 'Final Gazette')
      .sort((a, b) => _score(a) - _score(b));

    return {
      sem1: prelims.filter(s => s.semester === 1 && _score(s) >= sem1Start),
      sem2: prelims.filter(s => s.semester === 2 && _score(s) >= sem2Start),
    };
  }

  // ── Attempt tag builder ───────────────────────────────────
  // Builds the human-readable attempt tag for a subject.
  // prelimResult / gazetteResult: 'Successful' | 'Unsuccessful' | 'Absent' | null
  // prelimESE / gazetteESE: raw mark strings for reval suffix comparison.
  function _resolveAttemptTag(attemptNumber, prelimResult, gazetteResult, prelimESE, gazetteESE) {
    const label = attemptNumber === 1 ? 'Regular Attempt'
                : attemptNumber === 2 ? '2nd Attempt'
                : attemptNumber === 3 ? '3rd Attempt'
                : `${attemptNumber}th Attempt`;

    // Effective result: gazette overrides prelim if gazette exists
    const effective = gazetteResult !== null ? gazetteResult : prelimResult;
    if (!effective || effective === 'Pending') return null;

    const successStr = effective === 'Successful'
      ? `Successful in ${label}`
      : `Unsuccessful in ${label}`;

    // No gazette → no reval suffix
    if (gazetteResult === null) return successStr;

    // Gazette exists — determine reval suffix
    if (prelimResult === 'Unsuccessful' && gazetteResult === 'Successful') {
      return `${successStr} after Reval`;
    }
    if (prelimResult === 'Successful' && gazetteResult === 'Unsuccessful') {
      return `${successStr} after Reval`;
    }

    // Same result — check if marks changed
    const pESE = parseFloat(String(prelimESE  || '').replace('*', '')) || 0;
    const gESE = parseFloat(String(gazetteESE || '').replace('*', '')) || 0;

    if (pESE === gESE) {
      // Pass/Pass unchanged = just successful, no suffix
      if (effective === 'Successful') return successStr;
      return `${successStr}: Marks Revaluated & Unchanged`;
    }
    const direction = gESE > pESE ? 'Increased' : 'Decreased';
    return `${successStr}: Marks Revaluated & ${direction}`;
  }

  // ── KT Cache builder ──────────────────────────────────────
  // Rebuilds _ktCache for ALL students from scratch.
  // Called after loadAll() and after submitEntries().
  function _buildKTCache() {
    _ktCache = {};

    for (const student of students) {
      const applicable = _getApplicableSessions(student);
      const allSems    = [
        ...applicable.sem1.map(s => ({ sess: s, sem: 1 })),
        ...applicable.sem2.map(s => ({ sess: s, sem: 2 })),
      ];

      // Per component tracking:
      // key = subjectCode + '||' + component
      // value = { latestResult, attemptNumber, subjectCode, subjectName, semester, component }
      const compTracker  = {};

      // Historical: distinct subject+component ever Unsuccessful/Absent
      const historicalSet = new Set(); // key = subjectCode + '||' + component

      // Attempt counter per semester
      const attemptCount = { 1: 0, 2: 0 };

      // Subject-level attempt tags: key = subjectCode → latest tag
      const subjectTags = {};

      for (const { sess, sem } of allSems) {
        // Get all ledger rows for this student in this session
        const sessRows = ledger.filter(r =>
          r.uin === student.uin && r.examSession === sess.id
        );

        // No record → student didn't sit → skip, don't count attempt
        if (sessRows.length === 0) continue;

        attemptCount[sem]++;
        const currentAttempt = attemptCount[sem];

        // Find paired gazette session if any
        const gazette = sessions.find(s =>
          s.entryType === 'Final Gazette' &&
          s.linkedPrelimSessionId === sess.id
        );

        // Gazette rows for this student (only if gazette exists)
        const gazetteRows = gazette
          ? ledger.filter(r => r.uin === student.uin && r.examSession === gazette.id)
          : [];
        const hasGazette = gazetteRows.length > 0;

        // Merge prelim rows per subject (latest component wins)
        const prelimBySubject = {};
        for (const r of sessRows.sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime))) {
          if (!prelimBySubject[r.subjectCode]) prelimBySubject[r.subjectCode] = { ...r };
          else {
            const m = prelimBySubject[r.subjectCode];
            if (r.iatMarks  !== '') m.iatMarks  = r.iatMarks;
            if (r.eseMarks  !== '') m.eseMarks  = r.eseMarks;
            if (r.twMarks   !== '') m.twMarks   = r.twMarks;
            if (r.oralMarks !== '') m.oralMarks = r.oralMarks;
          }
        }

        // Merge gazette rows per subject (latest component wins)
        const gazetteBySubject = {};
        for (const r of gazetteRows.sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime))) {
          if (!gazetteBySubject[r.subjectCode]) gazetteBySubject[r.subjectCode] = { ...r };
          else {
            const m = gazetteBySubject[r.subjectCode];
            if (r.iatMarks  !== '') m.iatMarks  = r.iatMarks;
            if (r.eseMarks  !== '') m.eseMarks  = r.eseMarks;
            if (r.twMarks   !== '') m.twMarks   = r.twMarks;
            if (r.oralMarks !== '') m.oralMarks = r.oralMarks;
          }
        }

        // Get subject list for this session
        const subjectList = getSubjectsForSem(sem, student.branch, sess);

        for (const subj of subjectList) {
          const prelim  = prelimBySubject[subj.code]  || null;
          const gaz     = gazetteBySubject[subj.code] || null;
          if (!prelim) continue; // subject not attempted

          const compFields = {
            IAT:  { prelim: prelim.iatMarks,  gazette: gaz?.iatMarks  ?? '' },
            ESE:  { prelim: prelim.eseMarks,  gazette: gaz?.eseMarks  ?? '' },
            TW:   { prelim: prelim.twMarks,   gazette: gaz?.twMarks   ?? '' },
            Oral: { prelim: prelim.oralMarks, gazette: gaz?.oralMarks ?? '' },
          };

          // Subject-level prelim and gazette results (for attempt tag)
          // Use worst-state priority across components
          const _worstState = results => {
            if (results.includes('Unsuccessful')) return 'Unsuccessful';
            if (results.includes('Absent'))       return 'Absent';
            if (results.includes('Pending'))      return 'Pending';
            return 'Successful';
          };

          const prelimCompResults  = [];
          const gazetteCompResults = [];

          for (const [comp, max] of Object.entries(subj.marks)) {
            const fields = compFields[comp];
            if (!fields) continue;

            const prelimVal  = fields.prelim  || '';
            const gazetteVal = hasGazette ? (fields.gazette || '') : null;

            const prelimRes  = resolveComponentResult(prelimVal,  max);
            // Gazette: if no gazette at all → null; if gazette but no value for this comp → use prelim
            const gazetteRes = gazetteVal === null ? null
                             : gazetteVal === ''   ? prelimRes
                             : resolveComponentResult(gazetteVal, max);

            // Effective = gazette overrides prelim if gazette exists
            const effectiveRes = gazetteRes !== null ? gazetteRes : prelimRes;

            prelimCompResults.push(prelimRes);
            if (gazetteRes !== null) gazetteCompResults.push(gazetteRes);

            const compKey = subj.code + '||' + comp;

            // Update component tracker with latest attempt
            compTracker[compKey] = {
              subjectCode:  subj.code,
              subjectName:  subj.name,
              semester:     sem,
              component:    comp,
              effectiveResult: effectiveRes,
              ktCount:      (effectiveRes === 'Unsuccessful' || effectiveRes === 'Absent') ? 1 : 0,
              pendingFlag:  effectiveRes === 'Pending',
              attemptNumber: currentAttempt,
            };

            // Historical: record if ever Unsuccessful or Absent
            if (effectiveRes === 'Unsuccessful' || effectiveRes === 'Absent') {
              historicalSet.add(compKey);
            }
          }

          // Build attempt tag for this subject
          const subjPrelimResult  = _worstState(prelimCompResults);
          const subjGazetteResult = hasGazette && gaz
            ? _worstState(gazetteCompResults)
            : null;

          const tag = _resolveAttemptTag(
            currentAttempt,
            subjPrelimResult,
            subjGazetteResult,
            prelim.eseMarks  || '',
            gaz?.eseMarks    || '',
          );
          if (tag) {
            if (!subjectTags[subj.code]) subjectTags[subj.code] = {};
            subjectTags[subj.code][sess.id] = tag;
            // Also store under gazette id if paired, so lookup works either way
            if (gazette) subjectTags[subj.code][gazette.id] = tag;
          }
        }
      }

      // ── Build per-component array ────────────────────────
      const components = Object.values(compTracker);

      // ── Build per-subject array ──────────────────────────
      const subjectMap = {};
      for (const c of components) {
        if (!subjectMap[c.subjectCode]) {
          subjectMap[c.subjectCode] = {
            subjectCode:    c.subjectCode,
            subjectName:    c.subjectName,
            semester:       c.semester,
            ktCount:        0,
            pendingCount:   0,
            effectiveResult: 'Successful',
            attemptTags:    subjectTags[c.subjectCode] || {},
          };
        }
        const s = subjectMap[c.subjectCode];
        s.ktCount      += c.ktCount;
        if (c.pendingFlag) s.pendingCount++;

        // Worst-state priority for subject effectiveResult
        const priority = { 'Unsuccessful': 4, 'Absent': 3, 'Pending': 2, 'Successful': 1 };
        if ((priority[c.effectiveResult] || 0) > (priority[s.effectiveResult] || 0)) {
          s.effectiveResult = c.effectiveResult;
        }
      }

      const subjects = Object.values(subjectMap);

      // ── Student-level aggregates ─────────────────────────
      const activeKTCount     = components.reduce((n, c) => n + c.ktCount, 0);
      const failingSubjectCount = subjects.filter(s =>
        s.effectiveResult === 'Unsuccessful' || s.effectiveResult === 'Absent'
      ).length;
      const pendingComponentCount = components.filter(c => c.pendingFlag).length;

      const historicalKTComponents = [...historicalSet].map(key => {
        const [subjectCode, component] = key.split('||');
        const comp = components.find(c => c.subjectCode === subjectCode && c.component === component);
        return {
          subjectCode,
          subjectName: comp?.subjectName || '',
          semester:    comp?.semester    || null,
          component,
        };
      });

      _ktCache[student.uin] = {
        components,
        subjects,
        activeKTCount,
        historicalKTCount:    historicalSet.size,
        failingSubjectCount,
        pendingComponentCount,
        historicalKTComponents,
      };
    }
  }

  // ── Load all data ─────────────────────────────────────────
  async function loadAll() {
    [students, sessions, ledger, seats] = await Promise.all([
      Sheets.getStudents(),
      Sheets.getSessions(),
      Sheets.getLedger(),
      Sheets.getSeats(),
    ]);
    _buildKTCache();
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

    // Helper: build marksMap from a merged ledger row
    function _marksMap(r) {
      const m = {};
      if (r.iatMarks  !== '') m.IAT  = r.iatMarks;
      if (r.eseMarks  !== '') m.ESE  = r.eseMarks;
      if (r.twMarks   !== '') m.TW   = r.twMarks;
      if (r.oralMarks !== '') m.Oral = r.oralMarks;
      return m;
    }

    // Helper: merge all ledger rows for a given sessionId into one pseudo-row,
    // carrying forward passing component marks from prior sessions when missing.
    function _mergedRow(sid) {
      const rows = allRows.filter(r => r.examSession === sid)
        .sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));
      if (!rows.length) return null;
      const base = { ...rows[0] };
      for (const r of rows.slice(1)) {
        if (r.iatMarks  !== '') base.iatMarks  = r.iatMarks;
        if (r.eseMarks  !== '') base.eseMarks  = r.eseMarks;
        if (r.twMarks   !== '') base.twMarks   = r.twMarks;
        if (r.oralMarks !== '') base.oralMarks = r.oralMarks;
      }

      // Carry forward passing component marks from prior sessions if missing here
      const priorRows = allRows
        .filter(r => r.examSession !== sid && r.entryDateTime < rows[0].entryDateTime)
        .sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));

      const priorMerged = {};
      for (const r of priorRows) {
        if (r.iatMarks  !== '') priorMerged.iatMarks  = r.iatMarks;
        if (r.eseMarks  !== '') priorMerged.eseMarks  = r.eseMarks;
        if (r.twMarks   !== '') priorMerged.twMarks   = r.twMarks;
        if (r.oralMarks !== '') priorMerged.oralMarks = r.oralMarks;
      }

      const subj = (() => {
        const sess = getSession(sid);
        const list = getSubjectsForSem(Number(base.semester), base.branch || student.branch, sess);
        return list.find(s => s.code === subjectCode) || null;
      })();

      for (const [field, comp] of [['iatMarks','IAT'],['eseMarks','ESE'],['twMarks','TW'],['oralMarks','Oral']]) {
        if (base[field] !== '') continue; // already has value
        if (!priorMerged[field]) continue; // no prior value
        if (!subj) continue;
        const max = subj.marks[comp];
        const parsed = parseMarkValue(priorMerged[field], max);
        const passed = parsed.valid && !parsed.absent &&
          (parsed.grace || (max && parsed.value / max >= 0.40));
        if (passed) base[field] = priorMerged[field];
      }

      return base;
    }

    // Helper: resolve subject config for a ledger row
    function _subjectFor(r) {
      const sess = getSession(r.examSession);
      const list = getSubjectsForSem(Number(r.semester), r.branch || student.branch, sess);
      return list.find(s => s.code === subjectCode) || null;
    }

    // Helper: compute pass/fail from marks (never trust stored result field)
    function _resolveResult(row) {
      if (!row) return null;
      const subj = _subjectFor(row);
      if (!subj) return null;
      const dr = computeDisplayResult(subj, _marksMap(row));
      if (dr.pending) return null;
      return dr.grade === 'F' ? 'Fail' : 'Pass';
    }

    // Helper: compute merged result for prelim+gazette pair
    function _resolveSessionResult(prelimId, gazId) {
      const prelimRow = _mergedRow(prelimId);
      const gazRow    = gazId ? _mergedRow(gazId) : null;

      if (!prelimRow) return { result: null, revalSuffix: '' };

      if (gazRow) {
        // Merge: gazette ESE overrides prelim ESE; prelim supplies IAT/TW/Oral
        const merged = { ...prelimRow };
        if (gazRow.eseMarks !== '') merged.eseMarks = gazRow.eseMarks;
        const mergedResult  = _resolveResult(merged);

        // Prelim-only result (without gazette ESE) for reval comparison
        const prelimResult  = _resolveResult(prelimRow);

        const prelimESE = parseFloat(prelimRow.eseMarks) || 0;
        const gazESE    = parseFloat(gazRow.eseMarks)    || 0;
        const marksTag  = prelimESE === gazESE ? ': Marks Revaluated & Unchanged'
                        : gazESE > prelimESE   ? ': Marks Revaluated & Increased'
                        :                        ': Marks Revaluated & Decreased';

        let revalSuffix = '';
        if      (prelimResult === 'Pass' && mergedResult === 'Fail') revalSuffix = ' after Reval';
        else if (prelimResult === 'Fail' && mergedResult === 'Pass') revalSuffix = ' after Reval';
        else if (prelimResult === 'Pass' && mergedResult === 'Pass') revalSuffix = gazESE === prelimESE ? '' : marksTag;
        else if (prelimResult === 'Fail' && mergedResult === 'Fail') revalSuffix = marksTag;

        return { result: mergedResult, revalSuffix };
      }

      return { result: _resolveResult(prelimRow), revalSuffix: '' };
    }

    // Resolve the target session
    const targetSess = getSession(sessionId);
    if (!targetSess) return null;
    const isGazette    = targetSess.entryType === 'Final Gazette';
    const targetPrelimId = isGazette ? targetSess.linkedPrelimSessionId : sessionId;
    const targetGazId    = isGazette ? sessionId : null;

    // No rows in this session at all — carry forward from clearing session
    const hasRowsHere = allRows.some(r =>
      r.examSession === sessionId || r.examSession === targetPrelimId);
    if (!hasRowsHere) {
      // Find the latest session where this subject was cleared
      const allSessIds = [...new Set(allRows.map(r => r.examSession))];
      const allSessList = allSessIds.map(id => getSession(id)).filter(Boolean)
        .sort((a, b) => b.id.localeCompare(a.id));

      for (const s of allSessList) {
        const isPrelim = s.entryType === 'Preliminary';
        const isGaz    = s.entryType === 'Final Gazette';
        const pId = isPrelim ? s.id : (isGaz ? s.linkedPrelimSessionId : null);
        const gId = isGaz ? s.id : getSessions().find(x =>
          x.entryType === 'Final Gazette' && x.linkedPrelimSessionId === s.id)?.id || null;
        if (!pId) continue;
        const { result } = _resolveSessionResult(pId, gId);
        if (result === 'Pass') {
          // Recurse from the gazette if exists, else prelim
          return computeAttemptTag(uin, subjectCode, gId || pId);
        }
      }
      return null;
    }

    // Resolve result and reval suffix for the target session
    const { result: resolvedResult, revalSuffix } =
      _resolveSessionResult(targetPrelimId, targetGazId);

    // Count attempt number by walking all Preliminary sessions for this semester+batch
    // in chronological order. Skip sessions with no record for this student+subject.
    const subjectSemester = Number(allRows[0]?.semester);
    const allPrelimSessions = getSessions()
      .filter(s =>
        s.entryType  === 'Preliminary' &&
        s.semester   === subjectSemester &&
        Number(s.batchYear) >= Number(student.batchYear)
      )
      .sort((a, b) => a.id.localeCompare(b.id));

    let attemptNumber = 0;
    for (const s of allPrelimSessions) {
      const hasRecord = allRows.some(r => r.examSession === s.id);
      if (!hasRecord) continue;
      attemptNumber++;
      if (s.id === targetPrelimId) break;
    }

    if (attemptNumber === 0) return null;

    const attemptLabel = attemptNumber === 1 ? 'Regular Attempt'
      : attemptNumber === 2 ? '2nd Attempt'
      : attemptNumber === 3 ? '3rd Attempt'
      : `${attemptNumber}th Attempt`;

    if (resolvedResult !== 'Pass') {
      if (resolvedResult !== 'Fail') return null; // AB, pending — no tag
      return `Unsuccessful in ${attemptLabel}${revalSuffix}`;
    }

    return `Successful in ${attemptLabel}${revalSuffix}`;
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
    const data = _ktCache[uin];
    if (!data) return [];
    // Return subjects with at least one active Unsuccessful/Absent component,
    // in a shape compatible with existing callers (subjectCode, subjectName, semester, result)
    return data.subjects
      .filter(s => s.effectiveResult === 'Unsuccessful' || s.effectiveResult === 'Absent')
      .map(s => ({
        uin,
        subjectCode:  s.subjectCode,
        subjectName:  s.subjectName,
        semester:     String(s.semester),
        result:       s.effectiveResult === 'Absent' ? 'AB' : 'Fail',
      }));
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
    _buildKTCache();
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

          // Carry forward passing component marks from prior sessions
          // (handles KT sessions where e.g. IAT was passed in an earlier attempt)
          if (Object.keys(marksMap).length < Object.keys(subj.marks).length) {
            const priorRows = ledger
              .filter(r =>
                r.uin         === prelim.uin &&
                r.subjectCode === code &&
                r.examSession !== prelimSessionId &&
                (!gazetteSessionId || r.examSession !== gazetteSessionId)
              )
              .sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));

            const priorMerged = {};
            for (const r of priorRows) {
              if (r.iatMarks  !== '') priorMerged.IAT  = r.iatMarks;
              if (r.eseMarks  !== '') priorMerged.ESE  = r.eseMarks;
              if (r.twMarks   !== '') priorMerged.TW   = r.twMarks;
              if (r.oralMarks !== '') priorMerged.Oral = r.oralMarks;
            }

            for (const [comp, val] of Object.entries(priorMerged)) {
              if (marksMap[comp] !== undefined) continue; // already have a value
              const max    = subj.marks[comp];
              const parsed = parseMarkValue(val, max);
              const passed = parsed.valid && !parsed.absent &&
                (parsed.grace || (max && parsed.value / max >= 0.40));
              if (passed) marksMap[comp] = val;
            }
          }

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
    return getActiveKTSubjects(uin);
  }
  function reportKTFilter(n, mode, scope, gender) {
    const byStudent = {};
    for (const student of students) {
      if (gender && student.gender !== gender) continue;
      const data = _ktCache[student.uin];
      if (!data) continue;

      let subjects = [];
      if (scope === 'Active') {
        subjects = data.subjects.filter(s =>
          s.effectiveResult === 'Unsuccessful' || s.effectiveResult === 'Absent'
        );
      } else if (scope === 'Historical') {
        // Must have zero active KTs to appear in historical-only
        if (data.activeKTCount > 0) continue;
        subjects = data.historicalKTComponents.map(h => ({
          subjectCode: h.subjectCode,
          subjectName: h.subjectName,
        }));
        // Deduplicate by subjectCode
        subjects = [...new Map(subjects.map(s => [s.subjectCode, s])).values()];
      } else {
        // Both: union of active subjects + historical subjects
        const activeSubjCodes = new Set(
          data.subjects
            .filter(s => s.effectiveResult === 'Unsuccessful' || s.effectiveResult === 'Absent')
            .map(s => s.subjectCode)
        );
        const allSubjCodes = new Set([
          ...activeSubjCodes,
          ...data.historicalKTComponents.map(h => h.subjectCode),
        ]);
        subjects = [...allSubjCodes].map(code => {
          const found = data.subjects.find(s => s.subjectCode === code)
            || data.historicalKTComponents.find(h => h.subjectCode === code);
          return { subjectCode: code, subjectName: found?.subjectName || '' };
        });
      }

      const uniqueCodes = [...new Set(subjects.map(s => s.subjectCode))];
      const matches = mode === 'Exactly' ? uniqueCodes.length === n : uniqueCodes.length >= n;

      if (matches && uniqueCodes.length > 0) {
        for (const s of subjects) {
          byStudent[student.uin + s.subjectCode] = {
            prn:         student.prn,
            uin:         student.uin,
            name:        student.name,
            branch:      student.branch,
            gender:      student.gender || '',
            subjectCode: s.subjectCode,
            subjectName: s.subjectName,
            result:      s.effectiveResult === 'Absent' ? 'AB'
                       : s.effectiveResult === 'Successful' ? 'Pass' : 'Fail',
          };
        }
      }
    }
    return Object.values(byStudent);
  }

  function reportKTDistribution({ prelimSessionId, gazetteSessionId, branch, batchYear, gender } = {}) {
    if (!prelimSessionId) return [];

    const prelimSess = getSession(prelimSessionId);
    if (!prelimSess) return [];
    const sem = prelimSess.semester;

    // Collect students who appeared in this prelim session
    const appearedUINs = new Set(
      ledger
        .filter(r => r.examSession === prelimSessionId)
        .map(r => r.uin)
    );

    const buckets = {};

    for (const student of students) {
      if (!appearedUINs.has(student.uin))          continue;
      if (branch    && student.branch    !== branch)    continue;
      if (batchYear && student.batchYear !== batchYear) continue;
      if (gender    && student.gender    !== gender)    continue;

      const data = _ktCache[student.uin];
      if (!data) continue;

      // Count active KT subjects for this semester only
      const semActiveSubjects = data.subjects.filter(s =>
        s.semester === sem &&
        (s.effectiveResult === 'Unsuccessful' || s.effectiveResult === 'Absent')
      );

      const ktSubjects = semActiveSubjects.map(s => ({
        subjectCode: s.subjectCode,
        subjectName: s.subjectName,
        result:      s.effectiveResult === 'Absent' ? 'AB' : 'Fail',
      }));

      const ktCount = ktSubjects.length;
      if (!buckets[ktCount]) buckets[ktCount] = [];
      buckets[ktCount].push({
        uin:        student.uin,
        prn:        student.prn,
        name:       student.name,
        branch:     student.branch,
        ktSubjects,
      });
    }

    return Object.entries(buckets)
      .map(([ktCount, students]) => ({ ktCount: Number(ktCount), students }))
      .sort((a, b) => a.ktCount - b.ktCount);
  }

// ── Cleared-in-N-attempts helper ──────────────────────────
  // Returns { cleared, attemptCount, clearedInSession } for a student+subject
  function _getSubjectAttemptCount(uin, subjectCode) {
    const student = getStudent(uin);
    if (!student) return { cleared: false, attemptCount: 0, clearedInSession: null };

    const allRows = ledger
      .filter(r => r.uin === uin && r.subjectCode === subjectCode)
      .sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));

    if (allRows.length === 0) return { cleared: false, attemptCount: 0, clearedInSession: null };

    const subjectSemester = Number(allRows[0].semester);

    // Merge rows per session (latest component wins)
    const mergedPerSession = {};
    for (const r of allRows) {
      const sid = r.examSession;
      if (!mergedPerSession[sid]) {
        mergedPerSession[sid] = { ...r };
      } else {
        const m = mergedPerSession[sid];
        if (r.iatMarks  !== '') m.iatMarks  = r.iatMarks;
        if (r.eseMarks  !== '') m.eseMarks  = r.eseMarks;
        if (r.twMarks   !== '') m.twMarks   = r.twMarks;
        if (r.oralMarks !== '') m.oralMarks = r.oralMarks;
      }
    }

    // Session chronological score
    const _sessionScore = sess => {
      if (!sess) return 0;
      const year  = Number((sess.name || '').slice(0, 4));
      const month = (sess.name || '').includes('May') ? 5 : 12;
      return year * 12 + month;
    };

    // All Preliminary sessions for this subject's semester, chronologically
    const allPrelimSessions = getSessions()
      .filter(s =>
        s.entryType === 'Preliminary' &&
        s.semester  === subjectSemester &&
        Number(s.batchYear) >= Number(student.batchYear)
      )
      .sort((a, b) => _sessionScore(a) - _sessionScore(b));

    // Count attempts (only Prelim sessions where student has a record)
    let attemptCount    = 0;
    let clearedInSession = null;
    let cleared         = false;

    for (const prelim of allPrelimSessions) {
      const hasRecord = allRows.some(r => r.examSession === prelim.id);
      if (!hasRecord) continue;
      attemptCount++;

      // Find paired gazette if any
      const gazette = getSessions().find(s =>
        s.entryType === 'Final Gazette' &&
        s.linkedPrelimSessionId === prelim.id
      );

      // Build merged marks: prelim base, gazette ESE overrides
      const prelimRow = mergedPerSession[prelim.id];
      const gazRow    = gazette ? mergedPerSession[gazette.id] : null;

      const merged = { ...prelimRow };
      if (gazRow) {
        if (gazRow.eseMarks  !== '') merged.eseMarks  = gazRow.eseMarks;
        if (gazRow.iatMarks  !== '') merged.iatMarks  = gazRow.iatMarks;
        if (gazRow.twMarks   !== '') merged.twMarks   = gazRow.twMarks;
        if (gazRow.oralMarks !== '') merged.oralMarks = gazRow.oralMarks;
      }

      // Get subject config
      const sess = gazette || prelim;
      const subjectList = getSubjectsForSem(subjectSemester, student.branch, sess);
      const subj = subjectList.find(s => s.code === subjectCode);
      if (!subj) continue;

      const marksMap = {};
        if (merged.iatMarks  !== '') marksMap.IAT  = merged.iatMarks;
        if (merged.eseMarks  !== '') marksMap.ESE  = merged.eseMarks;
        if (merged.twMarks   !== '') marksMap.TW   = merged.twMarks;
        if (merged.oralMarks !== '') marksMap.Oral = merged.oralMarks;

        // Carry forward passing component marks from prior sessions
        // (mirrors computeStudentAcademics KT handling)
        const priorRows = allRows
          .filter(r => r.examSession !== prelim.id && (!gazette || r.examSession !== gazette.id))
          .sort((a, b) => a.entryDateTime.localeCompare(b.entryDateTime));
        const priorMerged = {};
        for (const r of priorRows) {
          if (r.iatMarks  !== '') priorMerged.IAT  = r.iatMarks;
          if (r.eseMarks  !== '') priorMerged.ESE  = r.eseMarks;
          if (r.twMarks   !== '') priorMerged.TW   = r.twMarks;
          if (r.oralMarks !== '') priorMerged.Oral = r.oralMarks;
        }
        for (const [comp, val] of Object.entries(priorMerged)) {
          if (marksMap[comp] !== undefined) continue; // already has value this session
          const max    = subj.marks[comp];
          const parsed = parseMarkValue(val, max);
          const priorPassed = parsed.valid && !parsed.absent &&
            (parsed.grace || (max && parsed.value / max >= 0.40));
          if (priorPassed) marksMap[comp] = val;
        }

        const dr = computeDisplayResult(subj, marksMap);
      if (!dr.pending && dr.result === 'Pass') {
        cleared          = true;
        clearedInSession = gazette ? gazette.name : prelim.name;
        break; // stop at first clearing attempt
      }
    }

    return { cleared, attemptCount, clearedInSession };
  }

  // ── Cleared-in-N-attempts report ──────────────────────────
  // subjectCode: specific code, or 'SEM1', 'SEM2', 'FY'
  function reportClearedInAttempts({ subjectCode, targetAttempts, branch, division, batchYear, gender } = {}) {
    if (!subjectCode || !targetAttempts) return [];

    const allStudents = getStudents({
      branch:    branch    || undefined,
      division:  division  || undefined,
      batchYear: batchYear || undefined,
      gender:    gender    || undefined,
    });

    const rows = [];

    for (const student of allStudents) {
      if (subjectCode === 'SEM1' || subjectCode === 'SEM2' || subjectCode === 'FY') {
        // Semester / FY mode
        const sems = subjectCode === 'SEM1' ? [1]
                   : subjectCode === 'SEM2' ? [2]
                   : [1, 2];

        // For each semester, find a session to get subject list
        const semResults = {};
        for (const sem of sems) {
          // Find a session this student has records in for this semester
          const semSession = getSessions().find(s =>
            s.semester === sem &&
            ledger.some(r => r.uin === student.uin && r.examSession === s.id)
          );
          if (!semSession) { semResults[sem] = null; continue; }

          const subjects = getSubjectsForSem(sem, student.branch, semSession);
          let allCleared  = true;
          let maxAttempts = 0;
          let lastSession = null;

          for (const subj of subjects) {
            const result = _getSubjectAttemptCount(student.uin, subj.code);
            if (!result.cleared) { allCleared = false; break; }
            if (result.attemptCount > maxAttempts) {
              maxAttempts = result.attemptCount;
              lastSession = result.clearedInSession;
            }
          }

          semResults[sem] = allCleared ? { maxAttempts, lastSession } : null;
        }

        if (subjectCode === 'FY') {
          const r1 = semResults[1];
          const r2 = semResults[2];
          if (!r1 || !r2) continue;
          const fyAttempts = Math.max(r1.maxAttempts, r2.maxAttempts);
          if (fyAttempts !== targetAttempts) continue;
          // Last session = whichever semester was completed later
          const sess1 = getSessions().find(s => s.name === r1.lastSession);
          const sess2 = getSessions().find(s => s.name === r2.lastSession);
          const _score = s => {
            if (!s) return 0;
            const y = Number((s.name||'').slice(0,4));
            const m = (s.name||'').includes('May') ? 5 : 12;
            return y * 12 + m;
          };
          const lastSession = _score(sess1) >= _score(sess2) ? r1.lastSession : r2.lastSession;
          rows.push({
            uin: student.uin, prn: student.prn, name: student.name,
            branch: student.branch, division: student.division,
            batchYear: student.batchYear, gender: student.gender || '',
            attemptCount: fyAttempts, clearedInSession: lastSession,
          });
        } else {
          const sem  = sems[0];
          const res  = semResults[sem];
          if (!res || res.maxAttempts !== targetAttempts) continue;
          rows.push({
            uin: student.uin, prn: student.prn, name: student.name,
            branch: student.branch, division: student.division,
            batchYear: student.batchYear, gender: student.gender || '',
            attemptCount: res.maxAttempts, clearedInSession: res.lastSession,
          });
        }

      } else {
        // Single subject mode
        const result = _getSubjectAttemptCount(student.uin, subjectCode);
        if (!result.cleared || result.attemptCount !== targetAttempts) continue;
        rows.push({
          uin: student.uin, prn: student.prn, name: student.name,
          branch: student.branch, division: student.division,
          batchYear: student.batchYear, gender: student.gender || '',
          attemptCount: result.attemptCount, clearedInSession: result.clearedInSession,
        });
      }
    }

    return rows.sort((a, b) => a.name.localeCompare(b.name));
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

    // For each student, get active KT subjects in this semester from cache
    const ktSubjectsByStudent = {};
    for (const s of branchStudents) {
      const data = _ktCache[s.uin];
      if (!data) continue;
      const activeKTs = data.subjects.filter(subj =>
        subj.semester === sem &&
        (subj.effectiveResult === 'Unsuccessful' || subj.effectiveResult === 'Absent')
      ).map(subj => ({
        uin:         s.uin,
        subjectCode: subj.subjectCode,
        subjectName: subj.subjectName,
        semester:    String(subj.semester),
        result:      subj.effectiveResult === 'Absent' ? 'AB' : 'Fail',
      }));
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
    getKTData:           (uin) => _ktCache[uin] || null,
    getKTCount:          (uin) => _ktCache[uin]?.activeKTCount    ?? 0,
    getHistoricalKTData: (uin) => _ktCache[uin]?.historicalKTComponents ?? [],
    reportResultSummary, reportRevalImpact, reportToppers, reportCreditFilter, reportKTFilter, getMyEntries,
    reportKTDistribution,
    getExamGroups,
    getDivisions, getBatchYears, getAllSubjects,reportClearedInAttempts,
    get ledger() { return ledger; },
  };
})();
