# Contributing

Thanks for your interest in Nexus Messenger.

## Local Setup

Install dependencies:

```bash
npm ci
npm --prefix backend ci
```

Create local environment files from templates:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

Use placeholder values only in examples and documentation. Never include real `.env` contents, tokens, private keys, database dumps, or user data in issues or pull requests.

Start the development stack:

```bash
npm run dev:all
```

## Checks

Frontend:

```bash
npm run typecheck
npm run build
```

Backend:

```bash
npm --prefix backend run typecheck
npm --prefix backend run build
```

The backend smoke test is guarded and should only be run against a disposable development database with the required environment variables:

```bash
npm --prefix backend run smoke:test
```

## Issues

- Describe the expected behavior and the actual behavior.
- Include reproduction steps when possible.
- Include logs only after removing secrets and private data.
- Do not post real passwords, tokens, private deployment paths, private IPs, or personal user data.

## Pull Requests

- Keep PRs focused and small enough to review.
- Preserve existing runtime behavior unless the PR intentionally fixes a verified bug or implements a scoped feature.
- Include verification commands you ran.
- Add screenshots or clips for UI changes when practical.
- Use concise Conventional Commit-style titles when possible, such as `fix: preserve unread counters after reconnect`.
- Use `.env.example` files for configuration examples, never real `.env` files.

