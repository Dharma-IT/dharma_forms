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
