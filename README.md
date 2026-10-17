# ExamGuard Medical (by DanjSoft) — deployment guide

```
Browser (Vercel, static)  ──Firebase Auth──►  Firebase Authentication
        │ Bearer ID token
        ▼
Railway (Node/Express API) ──Admin SDK──►  Cloud Firestore   (clients can NOT touch Firestore directly)
```
- `frontend/` static site → **Vercel**. `backend/` Express API → **Railway**. Database + login → **Firebase**.
- The browser signs in with Firebase Auth, then sends its ID token to the API. The API verifies it, checks the user's role in Firestore (`users/{uid}`), and does every read/write. Firestore rules deny all direct client access.
- Scanner reads **QR codes and barcodes** (Code 128/39, EAN-13/8, UPC-A/E, ITF, Codabar). QR payloads are `EGM:<opaque token>`; any other value (a barcode, typed text) is looked up as **matric number, student ID, or `barcode` field**.

## 0. Try it locally first (no accounts needed)
```
cd frontend && python3 -m http.server 8000     # open http://localhost:8000  (mock mode, demo logins INV-001/demo, ADM-001/demo)
```
Camera needs `localhost` or HTTPS (plain `http://192.168.x.x` is blocked by browsers).

## 1. Firebase (console.firebase.google.com)
1. **Add project** (Analytics optional).
2. **Build → Authentication → Get started → Email/Password → Enable.**
3. **Build → Firestore Database → Create database** (production mode, pick a region near you).
4. **Project settings → General → Your apps → Web (`</>`)** → register app → copy `apiKey`, `authDomain`, `projectId`, `appId` (needed for Vercel).
5. **Project settings → Service accounts → Generate new private key.** This downloads a JSON file. **Keep it secret** (never commit it). Its whole contents go into Railway as `FIREBASE_SERVICE_ACCOUNT_JSON`.
6. Deploy rules + indexes (once): `npm i -g firebase-tools && firebase login && firebase use --add && firebase deploy --only firestore`  (run in the repo root; uses `firestore.rules` and `firestore.indexes.json`). Indexes take a few minutes to build; reports/events lists fail until they are ready.

## 2. Railway (backend)
1. Push this repo to GitHub.
2. Railway → **New Project → Deploy from GitHub repo** → pick the repo.
3. Service → **Settings → Root Directory = `backend`**. (Build/start are auto-detected: `npm start`.)
4. Service → **Variables**:
   - `FIREBASE_SERVICE_ACCOUNT_JSON` = paste the whole JSON from step 1.5
   - `ALLOWED_ORIGINS` = your Vercel URL(s), comma-separated, no trailing slash (add after step 4; e.g. `https://examguard.vercel.app`)
5. **Settings → Networking → Generate Domain.** Open `https://<domain>/health`, which should return `{"ok":true}`. Optionally set Healthcheck Path to `/health`.
6. Copy the domain; it becomes `EGM_API_URL` on Vercel.

## 3. Create staff accounts (+ optional demo data)
Staff sign in with a **staff ID** (e.g. `INV-001`); the app maps it to the email `inv-001@staff.examguard.local` in Firebase Auth. Each account also needs a Firestore profile `users/{uid}`: `staffId, fullName, role (invigilator|admin|reviewer), venue, examId, status:"active"`.

Fast way (DEMO data: 30 fictional students, 2 exams, accounts INV-001 / ADM-001 / REV-001):
```
cd backend && npm install
# macOS/Linux — paste the service-account JSON into one line:
export FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
export SEED_PASSWORD='a-long-password-you-choose'
npm run seed
```
For a real institution: do **not** seed demo students. Create real accounts in Firebase Auth (email `<staffid>@staff.examguard.local`) and add the matching `users/{uid}` doc in Firestore; import real students into the `students` collection (fields: `id, matric (UPPERCASE), name, dept, faculty, programme, level (number), session, active (true), barcode (optional)`). Rotate/replace the seed password immediately.

## 4. Vercel (frontend)
1. Vercel → **Add New → Project** → import the repo.
2. **Root Directory = `frontend`**. Framework preset **Other**. (`vercel.json` already sets build `npm run build`, output `dist`.)
3. **Environment Variables:**
   | Name | Value |
   |---|---|
   | `EGM_MODE` | `api` |
   | `EGM_API_URL` | Railway URL, e.g. `https://examguard-api.up.railway.app` |
   | `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID` | from step 1.4 |
   | `EGM_STAFF_DOMAIN` | `staff.examguard.local` (must match the accounts) |
4. Deploy. Then go back to Railway and set `ALLOWED_ORIGINS` to the Vercel URL, and in Firebase **Authentication → Settings → Authorized domains** add the Vercel domain.
   (Without `EGM_MODE=api` the build is a **mock demo**.)

## 5. Verify
1. Open the Vercel URL → sign in `INV-001` + your seed password → dashboard shows **no "DEMO DATA" banner**.
2. Scan page → Start camera (HTTPS on Vercel, so it works on phones) → scan a QR **or** a Code 128 barcode of a matric number (or type `MED/21/100`).
3. As `ADM-001`: QR Batches → Generate → download/print the sheet; scan one of the codes as the invigilator.
4. Submit a malpractice report; as admin open Reports, change its status (a reason is required). Check Audit.

## Notes on behaviour
- **Generating a batch revokes older QR tokens** of those students (one active token each). Plain-text tokens are shown only at generation; the DB stores only SHA-256 hashes, so lost sheets must be reissued.
- Submitted reports can't be edited by invigilators; resubmitting with the same request key returns the same report (no duplicates).
- Barcodes: encode the **matric number** (or student ID) on ID cards as Code 128 for the best read rate. Barcode lookups are not secret tokens; anyone who knows a matric number can type it. QR tokens are the stronger option.
- Admin lists load up to 500 students / 300 reports / 200 events / 100 audit rows per page view (no pagination yet).

## Troubleshooting
| Symptom | Fix |
|---|---|
| Splash/login loads, then "Cannot reach the server" | Wrong `EGM_API_URL`, Railway not deployed, or `ALLOWED_ORIGINS` doesn't exactly match the Vercel URL (no trailing `/`) |
| "Account is not authorised or is disabled" | Auth user exists but `users/{uid}` doc is missing or `status` isn't `active` |
| Invalid credentials | Staff ID/email mismatch with `EGM_STAFF_DOMAIN`, or wrong password |
| Reports/events lists error with "index" | Wait for indexes (`firebase deploy --only firestore`) to finish building |
| Camera won't open | HTTPS/localhost required; allow camera in the browser's site settings; close other apps using it |
| Barcode not detected | Hold steady, fill ~half the frame, good light; Chrome/Android uses the native detector, others use ZXing (needs internet to load the library) |
| Vercel build fails "API mode needs…" | A `FIREBASE_*` or `EGM_API_URL` variable is missing |

