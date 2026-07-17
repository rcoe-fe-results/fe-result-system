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

// ── Semester I subjects ──────────────────────────────────────
const SEM1_SUBJECTS = [
  { code:'BSC101', name:'Applied Mathematics I',          type:'Theory+Tutorial',  credits:3,   marks:{ IAT:40, ESE:60, TW:25 } },
  { code:'BSC102', name:'Applied Physics',                type:'Theory',           credits:2,   marks:{ IAT:30, ESE:45 } },
  { code:'BSC103', name:'Applied Chemistry',              type:'Theory',           credits:2,   marks:{ IAT:30, ESE:45 } },
  { code:'ESC101', name:'Engineering Mechanics',          type:'Theory',           credits:2,   marks:{ IAT:40, ESE:60 } },
  { code:'ESC102', name:'Basic Electrical & Electronics', type:'Theory',           credits:3,   marks:{ IAT:40, ESE:60 } },
  { code:'BSL101', name:'Applied Physics Lab',            type:'Practical',        credits:0.5, marks:{ TW:25 } },
  { code:'BSL102', name:'Applied Chemistry Lab',          type:'Practical',        credits:0.5, marks:{ TW:25 } },
  { code:'ESL101', name:'Engineering Mechanics Lab',      type:'Practical+Oral',   credits:1,   marks:{ TW:25, Oral:25 } },
  { code:'ESL102', name:'BEE Lab',                        type:'Practical+Oral',   credits:1,   marks:{ TW:25, Oral:25 } },
  { code:'AEC101', name:'Prof & Communication Ethics',    type:'Theory',           credits:2,   marks:{ IAT:30, ESE:45 } },
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
    { code:'BSC201',    name:'Applied Mathematics II',             type:'Theory+Tutorial', credits:3,   marks:{ IAT:40, ESE:60, TW:25 } },
    { code:phyT.code,   name:phyT.name,                           type:'Theory',          credits:2,   marks:{ IAT:30, ESE:45 } },
    { code:chT.code,    name:chT.name,                            type:'Theory',          credits:2,   marks:{ IAT:30, ESE:45 } },
    { code:'ESC201',    name:'Engineering Graphics',              type:'Theory',          credits:3,   marks:{ IAT:40, ESE:60 } },
    { code:pcc.pccCode, name:pcc.pccName,                        type:'Theory',          credits:2,   marks:{ IAT:40, ESE:60 } },
    { code:phyL.code,   name:phyL.name,                          type:'Practical',       credits:0.5, marks:{ TW:25 } },
    { code:chL.code,    name:chL.name,                           type:'Practical',       credits:0.5, marks:{ TW:25 } },
    { code:'ESL201',    name:'Engineering Graphics Lab',          type:'Practical+Oral',  credits:1,   marks:{ TW:25, Oral:25 } },
    { code:pcc.pclCode, name:pcc.pclName,                        type:'Practical+Oral',  credits:1,   marks:{ TW:25, Oral:25 } },
    { code:'CC201',     name:'Social Science & Community Services',type:'Practical',      credits:2,   marks:{ TW:25 } },
    { code:'IKS201',    name:'Indian Knowledge System',           type:'Practical',       credits:2,   marks:{ TW:25 } },
    { code:'VSEC201',   name:'Engineering Workshop II',           type:'Practical',       credits:1,   marks:{ TW:25 } },
    { code:'VSEC202',   name:'Python Programming',                type:'Practical+Oral',  credits:2,   marks:{ TW:25, Oral:25 } },
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
function parseMarkValue(raw) {
  if (!raw || raw === '') return { value: null, valid: false, grace: false, absent: false };
  const s = String(raw).trim().toUpperCase();
  if (s === 'AB') return { value: 0, valid: true, grace: false, absent: true };
  const graceMatch = s.match(/^(\d+)\*$/);
  if (graceMatch) return { value: parseInt(graceMatch[1]), valid: true, grace: true, absent: false };
  const n = Number(s);
  if (!isNaN(n) && n >= 0) return { value: n, valid: true, grace: false, absent: false };
  return { value: null, valid: false, grace: false, absent: false };
}

function computeResult(subject, marks) {
  // marks = { IAT, ESE, TW, Oral } — each is parseMarkValue result or null
  const components = Object.keys(subject.marks);
  let total = 0;
  let anyAbsent = false;
  let anyGrace = false;

  for (const comp of components) {
    const m = marks[comp];
    if (!m || m.value === null) return { total: null, result: null, creditsEarned: 0 };
    if (m.absent) { anyAbsent = true; }
    if (m.grace)  { anyGrace = true; }
    total += m.absent ? 0 : m.value;
  }

  if (anyAbsent) return { total: 0, result: 'AB', creditsEarned: 0, grace: false };

  // Pass/Fail logic — simple: if any component below 40% of its max → Fail
  let pass = true;
  for (const comp of components) {
    const max = subject.marks[comp];
    const m = marks[comp];
    const pct = m.value / max;
    if (!m.grace && pct < 0.40) { pass = false; break; }
  }

  return {
    total,
    result: pass ? 'Pass' : 'Fail',
    creditsEarned: pass ? subject.credits : 0,
    grace: anyGrace,
  };
}

// ── Ledger column order ───────────────────────────────────────
const LEDGER_COLS = [
  'Entry ID','UIN','PRN','Name','Branch','Division','Batch Year',
  'Exam Session','Semester','Subject Code','Subject Name','Subject Type',
  'Credits Assigned','Attempt Type','IAT Marks','ESE Marks','TW Marks',
  'Oral Marks','Total Marks','Grade','Credits Earned','Result',
  'Source','Entered By','Entry Date/Time'
];
