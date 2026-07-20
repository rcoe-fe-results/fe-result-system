// ============================================================
// config.js — MU FYE Result Management System
// Rizvi College of Engineering
// ============================================================

const CONFIG = {
  // ── Google Identity / Sheets ──────────────────────────────
  CLIENT_ID: '497936592966-ktr29sdnhts41d3risg4pai84s3m15ig.apps.googleusercontent.com',
  SHEET_ID:  '1Zfm6RO0-Ax1LmrJFGJaatzCZh11mcbNKEHf8fzR_2Ww',
  API_KEY:   'AIzaSyDFKjU7qnGAlc_6L39n31jkjW8knsiaO8E',
  SCOPES:    'https://www.googleapis.com/auth/spreadsheets',
  DOMAIN:    'eng.rizvi.edu.in',

  // ── Sheet tab names ───────────────────────────────────────
  TABS: {
    STUDENT:  'STUDENT_MASTER',
    SUBJECT:  'SUBJECT_MASTER',
    EXAM:     'EXAM_MASTER',
    LEDGER:   'MASTER_LEDGER',
    SEAT:     'SEAT_MASTER',
  },

  // ── Admin emails (hardcoded) ──────────────────────────────
  ADMINS: [
    'hod.humanities@eng.rizvi.edu.in',
    'shiburaj@eng.rizvi.edu.in',
    // add more here
  ],
};

// ── Branches ─────────────────────────────────────────────────
const BRANCHES = ['AIDS', 'Civil', 'Computer', 'ECSE', 'Mechanical'];

// ── Attempt types ─────────────────────────────────────────────
const ATTEMPT_TYPES = ['Regular', 'Reval', 'KT', 'Grace'];

// ── Session naming ────────────────────────────────────────────
const SESSION_YEARS  = Array.from({ length: 10 }, (_, i) => 2024 + i); // 2024–2033
const SESSION_MONTHS = ['December', 'May'];
const SESSION_TYPES  = ['Preliminary', 'Final Gazette'];

// Derive fresh batch year from session year + month
// December 2025 Sem-I  → fresh batch 2025
// May 2026     Sem-II  → fresh batch 2025 (same academic year)
function deriveFreshBatch(year, month) {
  return month === 'May' ? year - 1 : year;
}

// Auto-generate session name
// e.g. "2025_Dec_Sem-I_Preliminary" or "2026_May_Sem-II_Final-Gazette"
function buildSessionName(year, month, semester, type) {
  const mo  = month === 'December' ? 'Dec' : 'May';
  const sem = semester === 1 ? 'Sem-I' : 'Sem-II';
  const typ = type === 'Final Gazette' ? 'Final-Gazette' : 'Preliminary';
  return `${year}_${mo}_${sem}_${typ}`;
}

// ── Semester I subjects ──────────────────────────────────────
const SEM1_SUBJECTS = [
  { code:'BSC101', name:'Applied Mathematics I',          type:'Theory+Tutorial',  credits:3,   marks:{ TW:25, ESE:60, IAT:40 } },
  { code:'BSC102', name:'Applied Physics',                type:'Theory',           credits:2,   marks:{ ESE:45, IAT:30 } },
  { code:'BSC103', name:'Applied Chemistry',              type:'Theory',           credits:2,   marks:{ ESE:45, IAT:30 } },
  { code:'ESC101', name:'Engineering Mechanics',          type:'Theory',           credits:2,   marks:{ ESE:60, IAT:40 } },
  { code:'ESC102', name:'Basic Electrical & Electronics', type:'Theory',           credits:3,   marks:{ ESE:60, IAT:40 } },
  { code:'BSL101', name:'Applied Physics Lab',            type:'Practical',        credits:0.5, marks:{ TW:25 } },
  { code:'BSL102', name:'Applied Chemistry Lab',          type:'Practical',        credits:0.5, marks:{ TW:25 } },
  { code:'ESL101', name:'Engineering Mechanics Lab',      type:'Practical+Oral',   credits:1,   marks:{ TW:25, Oral:25 } },
  { code:'ESL102', name:'BEE Lab',                        type:'Practical+Oral',   credits:1,   marks:{ TW:25, Oral:25 } },
  { code:'AEC101', name:'Prof & Communication Ethics',    type:'Theory',           credits:2,   marks:{ ESE:45, IAT:30 } },
  { code:'AEL101', name:'Prof & Comm Ethics Lab',         type:'Practical',        credits:1,   marks:{ TW:25 } },
  { code:'VSEC101',name:'Engineering Workshop I',         type:'Practical',        credits:1,   marks:{ TW:25 } },
  { code:'VSEC102',name:'C Programming',                  type:'Practical+Oral',   credits:2,   marks:{ TW:25, Oral:25 } },
  { code:'CC101',  name:'Induction cum Universal HV',     type:'Theory',           credits:2,   marks:{ TW:25 } },
];

// ── Semester II branch-specific PCC/PCL ──────────────────────
const PCC_MAP = {
  AIDS:       { pccCode:'PCC2011', pccName:'Data Structure',                    pclCode:'PCL2011', pclName:'Data Structure Lab' },
  Civil:      { pccCode:'PCC2012', pccName:'Elements of Civil Engineering',     pclCode:'PCL2012', pclName:'Elements of Civil Engineering Lab' },
  Computer:   { pccCode:'PCC2011', pccName:'Data Structure',                    pclCode:'PCL2011', pclName:'Data Structure Lab' },
  ECSE:       { pccCode:'PCC2014', pccName:'Digital Electronics',               pclCode:'PCL2014', pclName:'Digital Electronics Lab' },
  Mechanical: { pccCode:'PCC2018', pccName:'Elements of Mechanical Engineering', pclCode:'PCL2018', pclName:'Elements of Mechanical Engineering Lab' },
};

// ── Sem II Elective Physics options (BSC202X / BSL201X) ──────
// Admin picks ONE theory + ONE lab per session when creating a Sem II session.
const ELECTIVE_PHYSICS_THEORY = [
  { code:'BSC2021', name:'Physics for Emerging Fields' },
  { code:'BSC2022', name:'Semiconductor Physics' },
  { code:'BSC2023', name:'Physics of Measurements and Sensors' },
];

const ELECTIVE_PHYSICS_LAB = [
  { code:'BSL2011', name:'Physics for Emerging Fields Lab' },
  { code:'BSL2012', name:'Semiconductor Physics Lab' },
  { code:'BSL2013', name:'Physics of Measurements and Sensors Lab' },
];

// ── Sem II Elective Chemistry options (BSC203X / BSL202X) ────
// Admin picks ONE theory + ONE lab per session.
const ELECTIVE_CHEMISTRY_THEORY = [
  { code:'BSC2031', name:'Engineering Materials' },
  { code:'BSC2032', name:'Environmental Chemistry and Non-conventional Energy Sources' },
  { code:'BSC2033', name:'Introduction to Computational Chemistry' },
];

const ELECTIVE_CHEMISTRY_LAB = [
  { code:'BSL2021', name:'Engineering Materials Lab' },
  { code:'BSL2022', name:'Environmental Chemistry and Non-conventional Energy Sources Lab' },
  { code:'BSL2023', name:'Introduction to Computational Chemistry Lab' },
];

// ── Helper: look up an elective by code across all pools ──────
function findElective(code) {
  return [
    ...ELECTIVE_PHYSICS_THEORY, ...ELECTIVE_PHYSICS_LAB,
    ...ELECTIVE_CHEMISTRY_THEORY, ...ELECTIVE_CHEMISTRY_LAB,
  ].find(e => e.code === code) || null;
}

// ── Semester II subjects ──────────────────────────────────────
// session object must include:
//   physicsTheoryCode, physicsLabCode, chemTheoryCode, chemLabCode
// These are set by the Admin when creating a Sem II session.
// KT lookups pass null for session — in that case we fall back to
// reading elective codes from the student's own ledger history,
// so the subject config object is reconstructed from ledger data
// (code + name already stored there). See getKTEligibleStudents().
function getSem2Subjects(branch, session) {
  const pcc = PCC_MAP[branch] || PCC_MAP['Computer'];

  // Resolve electives from session, or use placeholder stubs if session unknown
  const phyT = session ? (findElective(session.physicsTheoryCode) || { code: session.physicsTheoryCode || 'BSC202X', name: 'Elective Physics Theory' })
                       : { code: 'BSC202X', name: 'Elective Physics Theory' };
  const phyL = session ? (findElective(session.physicsLabCode)    || { code: session.physicsLabCode    || 'BSL201X', name: 'Elective Physics Lab' })
                       : { code: 'BSL201X', name: 'Elective Physics Lab' };
  const chT  = session ? (findElective(session.chemTheoryCode)    || { code: session.chemTheoryCode    || 'BSC203X', name: 'Elective Chemistry Theory' })
                       : { code: 'BSC203X', name: 'Elective Chemistry Theory' };
  const chL  = session ? (findElective(session.chemLabCode)       || { code: session.chemLabCode       || 'BSL202X', name: 'Elective Chemistry Lab' })
                       : { code: 'BSL202X', name: 'Elective Chemistry Lab' };

  return [
    { code:'BSC201',    name:'Applied Mathematics II',             type:'Theory+Tutorial', credits:3,   marks:{ TW:25, ESE:60, IAT:40 } },
    { code:'ESC201',    name:'Engineering Graphics',              type:'Theory',          credits:3,   marks:{ ESE:60, IAT:40 } },
    { code:pcc.pccCode, name:pcc.pccName,                        type:'Theory',          credits:2,   marks:{ ESE:60, IAT:40 } },
    { code:'ESL201',    name:'Engineering Graphics Lab',          type:'Practical+Oral',  credits:1,   marks:{ TW:25, Oral:25 } },
    { code:pcc.pclCode, name:pcc.pclName,                        type:'Practical+Oral',  credits:1,   marks:{ TW:25, Oral:25 } },
    { code:'CC201',     name:'Social Science & Community Services',type:'Practical',      credits:2,   marks:{ TW:25 } },
    { code:'IKS201',    name:'Indian Knowledge System',           type:'Practical',       credits:2,   marks:{ TW:25 } },
    { code:'VSEC201',   name:'Engineering Workshop II',           type:'Practical',       credits:1,   marks:{ TW:25 } },
    { code:'VSEC202',   name:'Python Programming',                type:'Practical+Oral',  credits:2,   marks:{ TW:25, Oral:25 } },
    { code:phyT.code,   name:phyT.name,                           type:'Theory',          credits:2,   marks:{ ESE:45, IAT:30 } },
    { code:phyL.code,   name:phyL.name,                          type:'Practical',       credits:0.5, marks:{ TW:25 } },
    { code:chT.code,    name:chT.name,                            type:'Theory',          credits:2,   marks:{ ESE:45, IAT:30 } },
    { code:chL.code,    name:chL.name,                           type:'Practical',       credits:0.5, marks:{ TW:25 } },
  ];
}

// ── Primary entry point for subject lists ─────────────────────
// session = full session object (has elective codes for Sem II)
// For Sem I, session is irrelevant — pass null freely.
function getSubjectsForSem(sem, branch, session) {
  return sem === 1 ? SEM1_SUBJECTS : getSem2Subjects(branch, session);
}

// ── Guard: does a session have electives configured? ──────────
function sessionHasElectives(session) {
  return !!(session &&
    session.physicsTheoryCode && session.physicsLabCode &&
    session.chemTheoryCode    && session.chemLabCode);
}

// ── Marks validation ──────────────────────────────────────────
function parseMarkValue(raw, componentMax) {
  // componentMax is optional — only needed for grace-adjusted display value
  if (!raw || raw === '') return { value: null, valid: false, grace: false, absent: false };
  const s = String(raw).trim().toUpperCase();
  if (s === 'AB') return { value: 0, valid: true, grace: false, absent: true };
  const graceMatch = s.match(/^(\d+)\*$/);
  if (graceMatch) {
    const raw_n = parseInt(graceMatch[1]);
    // Grace-adjusted value = componentMax * 0.40 (exact passing mark)
    // Used for display calculations (grade, GP, SGPA, CGPA) only — not stored
    const adjusted = componentMax !== undefined ? Math.round(componentMax * 0.40) : raw_n;
    return { value: raw_n, adjustedValue: adjusted, valid: true, grace: true, absent: false };
  }
  const n = Number(s);
  if (!isNaN(n) && n >= 0) return { value: n, adjustedValue: n, valid: true, grace: false, absent: false };
  return { value: null, valid: false, grace: false, absent: false };
}

// computeResult — used at ENTRY TIME (stored in ledger)
// Uses raw mark values. Grace treated as passing, value stored as-is.
function computeResult(subject, marks) {
  const components = Object.keys(subject.marks);
  let total = 0;
  let anyAbsent = false;
  let anyGrace  = false;

  for (const comp of components) {
    const m = marks[comp];
    if (!m || m.value === null) return { total: null, result: null, creditsEarned: 0 };
    if (m.absent) anyAbsent = true;
    if (m.grace)  anyGrace  = true;
    total += m.absent ? 0 : m.value;
  }

  if (anyAbsent) return { total: 0, result: 'AB', creditsEarned: 0, grace: false };

  // Pass/Fail: every component must be ≥ 40% of its own max
  // Grace marks always pass their component (that's what grace means)
  let pass = true;
  for (const comp of components) {
    const max = subject.marks[comp];
    const m   = marks[comp];
    if (!m.grace && m.value / max < 0.40) { pass = false; break; }
  }

  return {
    total,
    result:       pass ? 'Pass' : 'Fail',
    creditsEarned: pass ? subject.credits : 0,
    grace:         anyGrace,
  };
}

// ── Grade scale ───────────────────────────────────────────────
function computeGrade(pct) {
  // pct = percentage of total obtained / total max × 100
  if (pct >= 90) return { grade: 'O',  gradePoint: 10 };
  if (pct >= 80) return { grade: 'A+', gradePoint:  9 };
  if (pct >= 70) return { grade: 'A',  gradePoint:  8 };
  if (pct >= 60) return { grade: 'B+', gradePoint:  7 };
  if (pct >= 55) return { grade: 'B',  gradePoint:  6 };
  if (pct >= 50) return { grade: 'C',  gradePoint:  5 };
  if (pct >= 40) return { grade: 'D',  gradePoint:  4 };
  return            { grade: 'F',  gradePoint:  0 };
}

// computeDisplayResult — used for DISPLAY only (progress view, reports)
// Uses grace-adjusted values (componentMax × 0.40) for totals, %, grade, GP, SGPA, CGPA
// Takes a subject object and a marks map built from ledger strings:
//   marksMap = { IAT: '21*', ESE: '40', TW: '8*', Oral: '20' }  (raw ledger strings)
// Returns: { total, totalMax, pct, grade, gradePoint, GxC, result, creditsEarned, pending, grace }
function computeDisplayResult(subject, marksMap) {
  const components = Object.keys(subject.marks);
  let totalObtained = 0;
  let totalMax      = 0;
  let anyAbsent     = false;
  let anyGrace      = false;
  let anyPending    = false;
  let pass          = true;

  for (const comp of components) {
    const compMax = subject.marks[comp];
    const raw     = marksMap ? marksMap[comp] : undefined;
    totalMax += compMax;

    if (raw === undefined || raw === null || raw === '') {
      anyPending = true;
      continue;
    }

    const parsed = parseMarkValue(raw, compMax);

    if (!parsed.valid) { anyPending = true; continue; }

    if (parsed.absent) {
      anyAbsent = true;
      // AB component contributes 0 — don't add to total
      continue;
    }

    if (parsed.grace) {
      anyGrace = true;
      // Grace: use adjusted value (compMax × 0.40) for all display calculations
      totalObtained += parsed.adjustedValue;
    } else {
      totalObtained += parsed.value;
      // Check component pass threshold
      if (parsed.value / compMax < 0.40) pass = false;
    }
  }

  // If any component still pending → result is pending
  if (anyPending && !anyAbsent) {
    return { pending: true, grade: '—', gradePoint: 0, GxC: 0, creditsEarned: 0, result: 'Pending' };
  }

  if (anyAbsent) {
    return {
      total: 0, totalMax, pct: 0,
      grade: 'F', gradePoint: 0, GxC: 0,
      result: 'AB', creditsEarned: 0, grace: anyGrace, pending: false,
    };
  }

  const pct = totalMax > 0 ? (totalObtained / totalMax) * 100 : 0;
  const { grade, gradePoint } = pass ? computeGrade(pct) : { grade: 'F', gradePoint: 0 };
  const creditsEarned = (pass && grade !== 'F') ? subject.credits : 0;

  return {
    total:    totalObtained,
    totalMax,
    pct,
    grade,
    gradePoint,
    GxC:          gradePoint * subject.credits,
    result:        pass ? 'Pass' : 'Fail',
    creditsEarned,
    grace:         anyGrace,
    pending:       false,
  };
}

// ── Session sort ──────────────────────────────────────────────
// Global sort: Year DESC → Month DESC (May > Dec) → Sem ASC → Type DESC (Gazette > Preliminary)
function sortSessions(sessions) {
  function _chronoScore(s) {
    // Convert session name to a numeric score for true chronological ordering
    // May YYYY → YYYY * 12 + 5, Dec YYYY → YYYY * 12 + 12
    const year  = Number(s.name.slice(0, 4));
    const month = s.name.includes('May') ? 5 : 12;
    return year * 12 + month;
  }

  return [...sessions].sort((a, b) => {
    const scoreA = _chronoScore(a);
    const scoreB = _chronoScore(b);
    if (scoreB !== scoreA) return scoreB - scoreA; // newer first

    if (a.semester !== b.semester) return a.semester - b.semester; // Sem I before Sem II

    const typeA = a.entryType === 'Final Gazette' ? 1 : 0;
    const typeB = b.entryType === 'Final Gazette' ? 1 : 0;
    return typeB - typeA; // Gazette before Preliminary
  });
}


// Progress View sort: oldest attempt first (Year ASC → Month ASC → Type ASC)
function sortSessionsChronological(sessions) {
  function _chronoScore(s) {
    const year  = Number(s.name.slice(0, 4));
    const month = s.name.includes('May') ? 5 : 12;
    return year * 12 + month;
  }

  return [...sessions].sort((a, b) => {
    const scoreA = _chronoScore(a);
    const scoreB = _chronoScore(b);
    if (scoreA !== scoreB) return scoreA - scoreB; // older first

    if (a.semester !== b.semester) return a.semester - b.semester;

    const typeA = a.entryType === 'Final Gazette' ? 1 : 0;
    const typeB = b.entryType === 'Final Gazette' ? 1 : 0;
    return typeA - typeB; // Preliminary before Gazette
  });
}

// ── Ledger column order ───────────────────────────────────────
const LEDGER_COLS = [
  'Entry ID','UIN','PRN','Name','Branch','Division','Batch Year',
  'Exam Session','Semester','Subject Code','Subject Name','Subject Type',
  'Credits Assigned','Attempt Type','IAT Marks','ESE Marks','TW Marks',
  'Oral Marks','Total Marks','Grade','Credits Earned','Result',
  'Source','Entered By','Entry Date/Time','Gender'
];
