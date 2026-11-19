# React + TypeScript + Vite

## Booking form preview

Run `npm run dev` to preview the two-step booking form. Edit `src/booking-config.ts`
to change agents, sellers, languages, channels, and sources. Replace the clearly
marked preview users with real CRM user IDs and paste each seller's HTTPS Bigin
embed URL into `bookingUrl`. These values are public; never add credentials here.

Run npm run server in a separate terminal alongside npm run dev. The local API
loads Bigin pipeline metadata and creates contacts/deals when Next is pressed.
An exact email match reuses the existing contact without changing it. New deals
link through Contact_Name. Select the target pipeline, sub-pipeline, and initial
stage. Channel and Source must exist in that pipeline and accept the selected values.
The save happens BEFORE appointment booking; a saved deal does not confirm a meeting.

Authorize these scopes before live submission:
ZohoBigin.modules.ALL,ZohoSearch.securesearch.READ,ZohoBigin.settings.fields.READ,ZohoBigin.settings.layouts.READ

Local submission receipts in ignored .bigin-submissions/ prevent duplicate saves
on retry with the same key. An uncertain deal write blocks further attempts until
manually checked in Bigin. Keep receipts across local API restarts. This localhost
API is for local development; add employee authentication and shared durable
idempotency storage before hosting for multiple users.

Live user loading, prefilling the third-party calendar, and verified booking
completion are still pending. A configured embed may collect details separately.

## Bigin connection (Node 24)

Credentials belong in the ignored root `.env`, using `.env.example` as a reference.
Never use a `VITE_` prefix for secrets or import `server/bigin.mjs` into browser code.

1. Run `npm run bigin:connect` in a local terminal.
2. Enter the accounts origin for your Zoho data center (the default is US).
3. Generate a Self Client code with `ZohoBigin.modules.ALL` and paste it into the terminal prompt before it expires.
4. The command saves the refresh token in `.env`, then checks Contacts and Pipelines using read-only requests. It does not create records or print CRM data or tokens.
5. Run `npm run bigin:check` to recheck later.

The server module caches access tokens and renews them automatically using the refresh token.
The connection tooling is server-side CLI code; a form submission HTTP endpoint still needs to be built.
For deployment, configure the same credentials, refresh token, and accounts origin in the hosting provider's server environment.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

## Render backend and Vercel frontend

The frontend uses relative `/api` requests. Locally, Vite forwards them to
`http://127.0.0.1:3001`. On Vercel, `vercel.json` forwards them to
`https://dharma-forms.onrender.com/api/*`. No frontend API URL or Bigin secrets
are needed in Vercel.

1. Push the deployment configuration and let Render deploy the latest commit.
2. Render: leave Root Directory blank, use `npm ci` for Build Command and
   `node server/api.mjs` for Start Command. Configure the `BIGIN_*` values from
   `.env.example` as server environment variables.
3. Import this repository into Vercel with the Vite preset, repository root,
   build command `npm run build`, and output directory `dist`.
4. In Render, set `ALLOWED_ORIGINS` to the exact Vercel production origin,
   for example `https://your-project.vercel.app` (no trailing slash). Multiple
   trusted domains can be comma-separated. Save and redeploy the backend.
   Preview deployments need their exact origins added separately.
5. Check `https://your-project.vercel.app/api/bigin/options` returns JSON with
   `pipelines`. Then verify a submission with an intended CRM record.

The root Render URL returns JSON `Not found` because this service hosts only
API endpoints. `GET /api/bigin/options` is the read-only connection check.
Employee authentication and durable submission receipts are still needed for
production use; an origin allowlist does not authenticate employees, and the
free Render filesystem does not preserve receipts reliably.

## Manage team

Open `/manage-team` directly. It has no link on the booking form and no dashboard.
A blurred placeholder and PIN modal appear until the server accepts the PIN.
Set the required server-only `MANAGE_TEAM_PIN` environment variable. There is no default; management is unavailable if it is missing or invalid.
(4â€“12 digits). The PIN is held only in component memory and cleared on lock or
refresh. Ten incorrect attempts temporarily block management requests for one
minute. The booking form necessarily exposes assigned members and their public
calendar links through `/api/teams`; the Bigin directory and management writes
require the PIN.

The page lists Booking agents, Nutritionists, Sellers, and Customer Service.
Choose an active, confirmed Bigin account, assign its team, and save an HTTPS
calendar link. Members can belong to multiple teams. Edit updates an existing
assignment; Remove only removes that assignment, never the Bigin account.
The backend rechecks Bigin before each add/update and uses Bigin's name and ID.
Host teams require a calendar link; Booking agents can omit one. Use an
embeddable public booking URL. Refresh the booking form to load changes.

Deployment setup:

1. Create a PostgreSQL database and set Render's `DATABASE_URL` to its connection
   string (prefer Render's internal URL in the same region). Tables are created
   automatically. Existing test assignments are seeded once; deleting all
   assignments does not reseed them. Render blocks management saves without a
   database so changes cannot silently disappear after a restart.
2. Set `MANAGE_TEAM_PIN` on Render to your chosen 4-12 digit PIN. Locally, set it in the ignored `.env` file. Never commit the PIN or prefix it with `VITE_`.
3. Generate a new Zoho Self Client code with all existing scopes plus user read:
   `ZohoBigin.modules.ALL,ZohoSearch.securesearch.READ,ZohoBigin.settings.fields.READ,ZohoBigin.settings.layouts.READ,ZohoBigin.users.READ`.
   Run `npm run bigin:connect`, then copy the new `BIGIN_REFRESH_TOKEN` from the
   ignored local `.env` into Render. Do not remove the existing module/settings
   scopes or put credentials in Vercel.
4. Push the changes and deploy both services. Vercel's explicit `/manage-team`
   rewrite enables direct page visits.

Locally, with no DATABASE_URL, team settings persist in ignored
`.team-settings/members.json`. Submission receipts still use the existing local
filesystem and are separate from team storage.

## Supabase storage and sign-in (current deployment)

Manage Team also offers **Block calendar times** for Sellers, Nutritionists, and
Customer Service. Choose a date with a time range, a continuous start/end date
and time, or full days with an inclusive date range. All inputs use Eastern Time
(`America/New_York`), including daylight saving time. Ambiguous or nonexistent
times during a clock change must be adjusted before saving.

Scheduled blocks are Bigin Events owned by the selected person. Bigin excludes
overlapping appointment slots on that person's booking pages. They apply across
the person's calendars, rather than only one team assignment. No participants
are added, and existing appointments are not cancelled. Remove a saved block
to reopen that time; this editor can delete only events it created. The separate
**Pause app bookings** option keeps its existing team-specific behavior.
This feature uses the existing Bigin Events read/create/delete permissions and
requires deployment of both frontend and backend; no database migration is needed.

This supersedes the standalone PostgreSQL setup above. Run `supabase/setup.sql`
in the Supabase SQL Editor. It creates and seeds team tables once, enables RLS,
and grants writes only to the server's service role. Browser users deliberately
have no table access: the backend verifies sign-in, the management PIN, and Bigin
identity before changing assignments. No DATABASE_URL is needed with this setup.

Set these in Render (and the ignored local .env):

- SUPABASE_URL: https://abiojwgzcdnxgfxfdmza.supabase.co (no /rest/v1 suffix)
- SUPABASE_PUBLISHABLE_KEY: the project's publishable key
- SUPABASE_SECRET_KEY: the project's secret key; backend only
- MANAGE_TEAM_PIN: the existing management PIN
- Existing BIGIN_* and ALLOWED_ORIGINS settings stay required.

No Vercel environment variables are needed: `/api/auth/config` serves only the
project URL and publishable key. All other endpoints require a Supabase user
access token, verified with Supabase Auth. `/manage-team` additionally requires
the PIN. Refresh tokens are managed by the Supabase browser SDK. Signing out
unmounts the booking/editor UI and clears the in-memory management PIN.

Create employee accounts in Supabase Authentication > Users. The app has sign-in
only, with no public registration UI. Disable "Allow new users to sign up" in
Supabase Auth settings if this is an employee-only project; every confirmed user
in this project can access bookings, and users with the PIN can manage teams.
Existing users in the project can sign in using their email and password.
Set Auth Site URL to https://dharma-forms.vercel.app and configure appropriate
redirect URLs if you later use invitations or password recovery. Password
recovery is currently handled by your administrator, not an in-app flow.

Team assignments persist in Supabase. Existing local team settings are not
migrated automatically; the SQL seeds the initial assignment once. Existing
submission idempotency receipts remain filesystem-based and are not migrated.

## Local HubSpot migration

Run `node --env-file=.env --experimental-strip-types scripts/migrate-hubspot-local.mts`.
The command reads the server-only HubSpot token from `.env`, reads HubSpot deals,
owners, and linked contacts, and checks Bigin layouts and active users. It does
not write to either CRM. Keep the token out of browser configuration.

Local source caches and CSVs are stored under ignored `.migration-local/`.
`exports/summary.json` reconciles ready and review counts. Import-ready CSVs
contain at most 10,000 deals each; `review.csv` contains excluded deals and
reasons; `audit.csv` preserves deal IDs, original owner IDs, contact IDs, and
original paid dates. Matched existing owners are preserved; unmatched and unassigned owners
default to Carolina. Original owner details are retained in the audit files. Contact names still need linking to the
correct Bigin contacts at import. Missing paid/closing dates use the existing
reference placeholder `2020-01-01` and are counted in the summary.

Reruns resume the cached source snapshot. To fetch a fresh snapshot, rename
`.migration-local` before running again. Do not import review.csv or audit.csv
as deal files. Search reads are partitioned below HubSpot's 10,000 result cap.

Open http://localhost:5173/migration with the Vite dev server running to download
files from the New Leads and Customer Service tabs. Migration has no sign-in
requirement and uses the local API export rather than a manual CSV upload.
Review and audit files are also split per pipeline. Local download endpoints
are available only in development and accept loopback connections only.

