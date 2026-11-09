# BarcoX Scanner

## Run locally

```sh
npm install
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env` to enable Supabase features. Never put a Supabase service-role key in the frontend.

## Project structure

- `index.html`, `vite.config.ts`, and `tsconfig*.json` are Vite and TypeScript entry/configuration files.
- `public/` contains files served as-is, including the favicon and public images.
- `src/pages/` contains the login and dashboard screens.
- `src/components/` contains shared presentation components.
- `src/features/` groups scanner, session, catalogue, and report code by domain.
- `src/hooks/`, `src/services/`, `src/config/`, `src/styles/`, and `src/types/` contain shared application code.
- `tests/unit/` contains Vitest tests.
- The scanner reads from the live camera; recent items are paginated newest-first, with at most 10 per page. Repeated scans are allowed.
- The optional session Product Name is used for scanned items whose payload does not contain a product name. Keyboard-wedge barcode scanners can submit scans with their Enter suffix; payloads must contain a weight (for example `theremi36.3`) or match the catalogue. An ID-only code cannot provide a weight.
- Session identifiers retain a vendor-specific daily sequence and include a random suffix so sessions created on separate devices cannot overwrite one another during cloud sync.

The app currently has a single dashboard flow, so it does not add a routing or global-store dependency. Keep state in the page or feature that owns it; introduce those layers when the app needs multiple navigable routes or shared cross-feature state.

## Checks

```sh
npm run build
npm test
```

On Node.js 26, run tests in PowerShell with Node's experimental `localStorage` disabled:

```powershell
$env:NODE_OPTIONS = '--no-experimental-webstorage'
npm test -- --maxWorkers=1
```
