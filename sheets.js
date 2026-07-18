// ============================================================
// sheets.js — Google Sheets API wrapper
// All reads are batched. Writes append only (never edit/delete).
// ============================================================

const Sheets = (() => {
  const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

  // ── Auth header ──────────────────────────────────────────
  async function _headers() {
    const token = await Auth.requestToken();
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

  // ── Low-level GET ────────────────────────────────────────
  async function getRange(tab, range) {
    const token = Auth.getToken();
    let url = `${BASE}/${CONFIG.SHEET_ID}/values/${encodeURIComponent(tab + '!' + range)}`;
    let headers = {};
    if (token) {
      headers = { 'Authorization': `Bearer ${token}` };
    } else {
      url += `?key=${encodeURIComponent(CONFIG.API_KEY)}`;
    }
    const r = await fetch(url, { headers });
    if (!r.ok) {
      let detail = '';
      try { const body = await r.json(); detail = body?.error?.message || ''; } catch(_) {}
      throw new Error(`Sheets GET failed: ${r.status}${detail ? ' — ' + detail : ''} (tab: ${tab})`);
    }
    const d = await r.json();
    return d.values || [];
  }

  // ── Low-level APPEND ────────────────────────────────────
  async function appendRows(tab, rows) {
    const url = `${BASE}/${CONFIG.SHEET_ID}/values/${encodeURIComponent(tab + '!A1')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const body = { values: rows };
    const r = await fetch(url, { method:'POST', headers: await _headers(), body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`Sheets APPEND failed: ${r.status}`);
    return r.json();
  }

  // ── STUDENT_MASTER ───────────────────────────────────────
  async function getStudents() {
    const rows = await getRange(CONFIG.TABS.STUDENT, 'A2:G');
    return rows.map(r => ({
      uin:       r[0] || '',
      prn:       r[1] || '',
      name:      r[2] || '',
      branch:    r[3] || '',
      division:  r[4] || '',
      batchYear: r[5] || '',
      gender:    r[6] || '',
    })).filter(s => s.uin);
  }

  async function uploadStudents(students) {
    // Header row assumed already present; just appends
    const rows = students.map(s => [s.uin, s.prn, s.name, s.branch, s.division, s.batchYear, s.gender || '']);
    return appendRows(CONFIG.TABS.STUDENT, rows);
  }

  // ── EXAM_MASTER ──────────────────────────────────────────
  // Columns: A=Session ID, B=Name, C=Semester, D=Batch Year,
  //          E=Status, F=Created By,
  //          G=Physics Theory Code, H=Physics Lab Code,
  //          I=Chem Theory Code,   J=Chem Lab Code,
  //          K=Entry Type (Preliminary|Final Gazette),
  //          L=Linked Preliminary Session ID
  async function getSessions() {
    const rows = await getRange(CONFIG.TABS.EXAM, 'A2:M');
    return rows.map(r => ({
      id:                      r[0]  || '',
      name:                    r[1]  || '',
      semester:                Number(r[2]) || 1,
      batchYear:               r[3]  || '',
      status:                  r[4]  || 'Active',
      createdBy:               r[5]  || '',
      physicsTheoryCode:       r[6]  || '',
      physicsLabCode:          r[7]  || '',
      chemTheoryCode:          r[8]  || '',
      chemLabCode:             r[9]  || '',
      entryType:               r[10] || 'Preliminary',
      linkedPrelimSessionId:   r[11] || '',
      month:                   r[12] || _inferMonthFromName(r[1] || ''),
    })).filter(s => s.id);
  }

  async function addSession(session) {
    return appendRows(CONFIG.TABS.EXAM, [[
      session.id, session.name, session.semester, session.batchYear,
      session.status, session.createdBy,
      session.physicsTheoryCode      || '',
      session.physicsLabCode         || '',
      session.chemTheoryCode         || '',
      session.chemLabCode            || '',
      session.entryType              || 'Preliminary',
      session.linkedPrelimSessionId  || '',
      session.month                  || '',
    ]]);
  }

  async function updateSessionStatus(sessionId, newStatus) {
    // Find row, then update Status cell (col E) only
    const rows = await getRange(CONFIG.TABS.EXAM, 'A:L');
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === sessionId) {
        const rowNum = i + 1;
        const url = `${BASE}/${CONFIG.SHEET_ID}/values/${encodeURIComponent(CONFIG.TABS.EXAM + '!E' + rowNum)}?valueInputOption=USER_ENTERED`;
        const body = { values: [[newStatus]] };
        const r = await fetch(url, { method:'PUT', headers: await _headers(), body: JSON.stringify(body) });
        if (!r.ok) throw new Error(`Session lock failed: ${r.status}`);
        return r.json();
      }
    }
    throw new Error('Session not found: ' + sessionId);
  }

  async function updateSessionLinkedPrelim(sessionId, linkedPrelimSessionId) {
    const rows = await getRange(CONFIG.TABS.EXAM, 'A:L');
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === sessionId) {
        const rowNum = i + 1;
        const url = `${BASE}/${CONFIG.SHEET_ID}/values/${encodeURIComponent(CONFIG.TABS.EXAM + '!L' + rowNum)}?valueInputOption=USER_ENTERED`;
        const body = { values: [[linkedPrelimSessionId]] };
        const r = await fetch(url, { method:'PUT', headers: await _headers(), body: JSON.stringify(body) });
        if (!r.ok) throw new Error(`Session link update failed: ${r.status}`);
        return r.json();
      }
    }
    throw new Error('Session not found: ' + sessionId);
  }

  // ── MASTER_LEDGER ────────────────────────────────────────
  async function getLedger() {
    const rows = await getRange(CONFIG.TABS.LEDGER, 'A2:Z');
    return rows.map(r => ({
      entryId:       r[0]  || '',
      uin:           r[1]  || '',
      prn:           r[2]  || '',
      name:          r[3]  || '',
      branch:        r[4]  || '',
      division:      r[5]  || '',
      batchYear:     r[6]  || '',
      examSession:   r[7]  || '',
      semester:      r[8]  || '',
      subjectCode:   r[9]  || '',
      subjectName:   r[10] || '',
      subjectType:   r[11] || '',
      creditsAssigned:r[12]|| '',
      attemptType:   r[13] || '',
      iatMarks:      r[14] || '',
      eseMarks:      r[15] || '',
      twMarks:       r[16] || '',
      oralMarks:     r[17] || '',
      totalMarks:    r[18] || '',
      grade:         r[19] || '',
      creditsEarned: r[20] || '',
      result:        r[21] || '',
      source:        r[22] || '',
      enteredBy:     r[23] || '',
      entryDateTime: r[24] || '',
      gender:        r[25] || '',
    })).filter(r => r.entryId);
  }

  async function appendLedgerRows(entries) {
    const rows = entries.map(e => [
      e.entryId, e.uin, e.prn, e.name, e.branch, e.division, e.batchYear,
      e.examSession, e.semester, e.subjectCode, e.subjectName, e.subjectType,
      e.creditsAssigned, e.attemptType, e.iatMarks, e.eseMarks, e.twMarks,
      e.oralMarks, e.totalMarks, e.grade, e.creditsEarned, e.result,
      e.source, e.enteredBy, e.entryDateTime, e.gender || ''
    ]);
    return appendRows(CONFIG.TABS.LEDGER, rows);
  }

  // ── SUBJECT_MASTER (optional sync — curriculum can be hardcoded) ──
  async function getSubjectMaster() {
    const rows = await getRange(CONFIG.TABS.SUBJECT, 'A2:L');
    return rows; // raw — used for admin verification only
  }

  // ── SEAT_MASTER ──────────────────────────────────────────
  // Columns: A=UIN, B=Session ID, C=Seat Number
  async function getSeats() {
    try {
      const rows = await getRange(CONFIG.TABS.SEAT, 'A2:C');
      return rows.map(r => ({
        uin:       r[0] || '',
        sessionId: r[1] || '',
        seatNumber:r[2] || '',
      })).filter(s => s.uin && s.sessionId);
    } catch (e) {
      // Tab doesn't exist yet — return empty until admin creates it in Google Sheets
      console.warn('SEAT_MASTER tab not found — seat numbers unavailable:', e.message);
      return [];
    }
  }

  async function uploadSeats(seats) {
    // seats = [{ uin, sessionId, seatNumber }]
    const rows = seats.map(s => [s.uin, s.sessionId, s.seatNumber]);
    return appendRows(CONFIG.TABS.SEAT, rows);
  }

  // updateSeatNumber — overwrites the Seat Number cell for an existing UIN+Session row
  async function updateSeatNumber(uin, sessionId, seatNumber) {
    const rows = await getRange(CONFIG.TABS.SEAT, 'A:C');
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][0] || '') === uin && (rows[i][1] || '') === sessionId) {
        const rowNum = i + 1;
        const url = `${BASE}/${CONFIG.SHEET_ID}/values/${encodeURIComponent(CONFIG.TABS.SEAT + '!C' + rowNum)}?valueInputOption=USER_ENTERED`;
        const r = await fetch(url, { method: 'PUT', headers: await _headers(), body: JSON.stringify({ values: [[seatNumber]] }) });
        if (!r.ok) throw new Error(`Seat update failed: ${r.status}`);
        return r.json();
      }
    }
    // Row not found in sheet — append instead (handles race condition)
    return appendRows(CONFIG.TABS.SEAT, [[uin, sessionId, seatNumber]]);
  }

  // ── Infer month from legacy session names ─────────────────
  // Fallback for sessions created before the Month column was added.
  // Parses 'Dec' or 'May' from the auto-generated session name.
  function _inferMonthFromName(name) {
    if (name.includes('Dec')) return 'December';
    if (name.includes('May')) return 'May';
    return '';
  }

  // ── Utility: generate Entry ID ────────────────────────────
  function newEntryId() {
    return 'RCE-' + Date.now() + '-' + Math.random().toString(36).slice(2,6).toUpperCase();
  }

  return {
    getStudents, uploadStudents,
    getSessions, addSession, updateSessionStatus, updateSessionLinkedPrelim,
    getLedger, appendLedgerRows,
    getSubjectMaster,
    getSeats, uploadSeats, updateSeatNumber,
    newEntryId,
  };
})();
