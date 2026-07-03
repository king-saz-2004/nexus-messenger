# Repository Guidelines

## Project Structure & Module Organization
Nexus Messenger is a full-stack chat app. The React 19 + TypeScript frontend lives at the repository root: `App.tsx`, `index.tsx`, `types.ts`, `components/`, `features/`, `hooks/`, `services/`, and `shared/`. New frontend work should usually start in `features/*` or `shared/*`; `components/ChatWindow.tsx`, `components/Sidebar.tsx`, `services/apiClient.ts`, and `services/i18n.ts` are compatibility wrappers/stable import surfaces. Backend Express + TypeScript code is under `backend/src/`, with `routes/`, `services/`, `middleware/`, `sockets/`, `socket/`, `cache/`, and `config/` split by responsibility. Chat services live under `backend/src/services/chat/*` behind `chatSystem.ts`; message services live under `backend/src/services/messages/*` behind `messageSystem.ts`; Socket.IO modules live under `backend/src/socket/*` behind `backend/src/sockets/index.ts`. SQL schema and migrations live in `backend/sql/`; `backend/sql/init.sql` is the canonical fresh-install schema, while `backend/sql/migrations/` is for existing databases. Deployment assets are in `deploy/`, Docker configuration is in `docker-compose.yml`, and local utility scripts are in `scripts/`.

## Build, Test, and Development Commands
- `npm ci` and `npm --prefix backend ci`: install frontend and backend dependencies reproducibly.
- `npm run dev:all`: starts Postgres, Redis, backend API on `http://localhost:4000`, and Vite frontend on `http://localhost:3000`.
- `npm run db:up` / `npm run db:down` / `npm run db:reset`: manage local database and Redis containers.
- `npm run typecheck` and `npm --prefix backend run typecheck`: run TypeScript checks.
- `npm run build` and `npm --prefix backend run build`: create production frontend and backend builds.
- `npm --prefix backend run db:migrate`: apply SQL migrations in development.
- `npm --prefix backend run smoke:test`: run guarded backend smoke tests; required environment variables are documented in the script.

## Coding Style & Naming Conventions
Use TypeScript and ES modules throughout. Follow existing formatting: two-space indentation, single quotes, semicolons, and named exports where the surrounding module does so. React components use PascalCase file names in `components/`; hooks use `useX.ts` or `useX.tsx`; backend route/service modules use camelCase names. Keep shared frontend types in `types.ts`; backend validation belongs near the route or service it protects.

Keep compatibility wrappers unless a scoped cleanup migrates every caller and passes frontend and backend typecheck/build. Prefer feature-local modules for new frontend code: `features/messages`, `features/chats`, `features/contacts`, `features/groups`, `features/admin`, `features/profile`, `features/realtime`, `features/settings`, and `features/app-shell`. For backend chat/message behavior, edit the split domain modules first and let the compatibility barrels preserve existing imports.

## Testing Guidelines
There is no general unit-test runner configured yet. Treat `typecheck`, `build`, and targeted manual verification as required before submitting changes. For backend behavior, prefer small smoke or script-based checks under `backend/src/scripts/`, and guard destructive tests with explicit environment flags.

## Commit & Pull Request Guidelines
Git history uses concise Conventional Commit-style prefixes such as `fix:`, `feat:`, and `deploy:`. Keep commits focused and imperative, for example `fix: preserve unread counters after reconnect`. Pull requests should describe the behavior change, list verification commands, link related issues, and include screenshots or clips for UI changes.

## Security & Configuration Tips
Never commit `.env` or secrets. Copy `.env.example` and `backend/.env.example` for local setup. Keep production secrets strong, set exact `CLIENT_ORIGIN`, and run migrations through the provided migration commands rather than editing production schema manually.
