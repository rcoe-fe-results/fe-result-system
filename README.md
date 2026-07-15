# MU FYE Result Management System
### Rizvi College of Engineering — First Year Engineering

Single-page web app hosted on GitHub Pages. All data lives in Google Sheets (college Workspace). No backend server.

---

## File structure

```
fye-result-system/
├── index.html      ← full app shell + styles
├── config.js       ← credentials, subject master, business rules
├── auth.js         ← Google Identity Services login
├── ui-utils.js     ← toast, modal, spinner, CSV export
├── sheets.js       ← Google Sheets API wrapper
├── state.js        ← central state, KT logic, ledger writes
├── app.js          ← all 5 tab controllers
└── README.md
```

---

## One-time setup (do this once, in order)

### 1. Create the Google Sheet

In your college Google Workspace account, create a new spreadsheet with **4 tabs** named exactly:

| Tab name | Purpose |
|---|---|
| `STUDENT_MASTER` | Student roster |
| `SUBJECT_MASTER` | Subject reference (optional — curriculum is hardcoded in config.js) |
| `EXAM_MASTER` | Exam sessions |
| `MASTER_LEDGER` | Append-only marks log |

Add these **header rows** (row 1 of each tab):

**STUDENT_MASTER** — row 1:
```
UIN | PRN | Name | Branch | Division | BatchYear
```

**EXAM_MASTER** — row 1:
```
Session ID | Name | Semester | Batch Year | Status | Created By
```

**MASTER_LEDGER** — row 1:
```
Entry ID | UIN | PRN | Name | Branch | Division | Batch Year | Exam Session | Semester | Subject Code | Subject Name | Subject Type | Credits Assigned | Attempt Type | IAT Marks | ESE Marks | TW Marks | Oral Marks | Total Marks | Grade | Credits Earned | Result | Source | Entered By | Entry Date/Time
```

**Note the Sheet ID** from the URL:  
`https://docs.google.com/spreadsheets/d/<<SHEET_ID>>/edit`

---

### 2. Google Cloud — OAuth + API Key

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → Create project (or reuse one)
2. Enable **Google Sheets API**
3. **Credentials → Create Credentials → OAuth 2.0 Client ID**  
   - Application type: **Web application**  
   - Authorised JavaScript origins: `https://YOUR_ORG.github.io`  
   - Also add `http://localhost` for local testing
4. Copy the **Client ID** (`…apps.googleusercontent.com`)
5. **Credentials → Create Credentials → API Key**  
   - Restrict it to: Google Sheets API + HTTP referrers (your GitHub Pages URL)
6. **OAuth consent screen**:  
   - User type: **Internal** (Workspace only — this ensures only `@eng.rizvi.edu.in` accounts work)  
   - Add scopes: `https://www.googleapis.com/auth/spreadsheets`
   - No external approval needed for Internal apps

---

### 3. Configure `config.js`

Open `config.js` and replace the three placeholders:

```js
CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
SHEET_ID:  'YOUR_GOOGLE_SHEET_ID',
API_KEY:   'YOUR_GOOGLE_API_KEY',
```

Also update `ADMINS` with the email addresses that should have admin access:

```js
ADMINS: [
  'hod@eng.rizvi.edu.in',
  'principal@eng.rizvi.edu.in',
],
```

---

### 4. Deploy to GitHub Pages

```bash
# Create a new GitHub repo (public or private)
git init
git add .
git commit -m "Initial deploy"
git remote add origin https://github.com/YOUR_ORG/fye-results.git
git push -u origin main

# In GitHub repo → Settings → Pages → Source: main branch / root
```

The app will be live at `https://YOUR_ORG.github.io/fye-results/`

**Updates:** Edit files → push → GitHub Actions auto-deploys. URL never changes.

---

## First run

1. Open the app URL → sign in with an admin `@eng.rizvi.edu.in` account
2. Go to **Admin** tab → **Session Management** → create your first session  
   (e.g. name: `"May 2025"`, semester: `1`, batch year: `2024`)
3. Go to **Admin** tab → **Student Upload** → upload your student CSV
4. Go to **Bulk Entry** → select the session → load grid → enter marks → Submit

---

## Student CSV format

```csv
UIN,PRN,Name,Branch,Division,BatchYear
23RCEFYE001,2300001234,Aditya Sharma,Computer,A,2023
23RCEFYE002,2300001235,Priya Patel,AIDS,B,2023
```

Branches must match exactly: `AIDS` · `Civil` · `Computer` · `ECSE` · `Mechanical`

---

## Mark entry rules

| Input | Meaning |
|---|---|
| `42` | 42 marks |
| `AB` | Absent — result = AB, credits = 0 |
| `21*` | Grace mark — treated as Pass, highlighted amber |
| _(empty)_ | Not yet entered — blocked at submit |

- **Reval mode**: Only ESE column is editable; other marks pre-filled from ledger
- **KT mode**: Only students with active Fail/AB subjects shown; only their failed subjects editable
- Arrow keys / Tab / Enter navigate between cells

---

## Roles

| Role | Access |
|---|---|
| **Admin** | All tabs including Admin; session create/lock; student upload |
| **Faculty** | Bulk Entry, Single Student, Progress View, Reports (My Entries only) |

Admin emails are hardcoded in `config.js`. All other `@eng.rizvi.edu.in` accounts = Faculty.

---

## Grading scale

Grade computation is deferred pending MU gazette. The `Grade` column in the ledger is written as `—` until updated. To add grades:

1. Get the official MU grading table
2. Add a `computeGrade(totalMarks, maxMarks)` function in `config.js`  
3. Call it in `state.js` → `submitEntries()` where `grade = '—'` currently appears

No structural changes needed — it's a one-function addition.

---

## API usage estimate

~200 calls/day vs. 60,000/day limit (Google Sheets API).  
Reads happen only on page load and tab switches. Writes happen only on Submit.

---

## Adding collaborators

**Option A — Personal repo with collaborators:**  
GitHub repo → Settings → Collaborators → Add by username → Write access

**Option B — GitHub Organisation (recommended):**  
Create org (e.g. `rizvi-engineering`) → transfer repo → add team members as members with Write access

---

## HOD/Principal role

Deferred. When needed, add a third role in `config.js`:

```js
HOD_EMAILS: ['hod@eng.rizvi.edu.in'],
```

Then in `auth.js` → `_handleCredential`:
```js
role: CONFIG.ADMINS.includes(email) ? 'admin' :
      CONFIG.HOD_EMAILS.includes(email) ? 'hod' : 'faculty',
```

Show/hide tabs with `data-hod-only` attribute, same pattern as `data-admin-only`.

---

## Subject master note

The full semester I & II curriculum is hardcoded in `config.js` (`SEM1_SUBJECTS`, `getSem2Subjects()`). The `SUBJECT_MASTER` sheet tab exists for admin reference and audit but is not the source of truth for the app. If the curriculum changes, update `config.js` and redeploy.

---

## Security notes

- Sheet is restricted to `@eng.rizvi.edu.in` only via Google Workspace sharing settings
- OAuth consent screen is **Internal** — no external accounts can sign in
- Client ID and API key are public (safe — they're restricted to your domain); the Sheet itself is the access-controlled resource
- Ledger is append-only by design — the app never calls PUT/DELETE on ledger rows
