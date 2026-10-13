# Code Review Trainer

A free, local exercise library for practicing code reviews. Phase 1 is implemented: React/Vite/Tailwind frontend, Express backend, shared Zod schemas, SQLite initialization, private answer-key validation, and language/difficulty filtering.

The diff review workspace, draft-comment editing, submission, and Ollama grading belong to later phases. Library cards currently open an exercise overview with public context and file names. They do not start an attempt or reveal answers.

## Run locally

Install **Node.js 24.13 or newer**, then run these commands from this project directory:

```powershell
npm.cmd install
npm.cmd run dev
```

Open **http://127.0.0.1:5173**. The API listens on `127.0.0.1:3001`. One development process runs both servers; React changes reload automatically. Restart development after changing case JSON files. On macOS/Linux, use `npm` instead of `npm.cmd`.

No Ollama installation, model, account, or API key is needed for Phase 1. Initial npm/browser/model installations require downloads; the installed application makes no runtime cloud calls or CDN requests.

To change ports, copy `.env.example` to `.env` and edit `PORT` / `WEB_PORT`. Both servers bind only to `127.0.0.1`. Open the exact address printed by the development command so browser origin checks match.

For a local production build:

```powershell
npm.cmd run build
npm.cmd start
```

Open **http://127.0.0.1:3001**. Express serves the built frontend and API from one origin.

## Checks

```powershell
npm.cmd run validate:cases
npm.cmd test
npm.cmd run typecheck
npm.cmd exec playwright install chromium
npm.cmd run test:e2e
```

Case validation and unit/API tests run without AI or network access. Browser tests start their own development server on ports **3199 / 5199** and exercise every language/difficulty selection, reload persistence, previews, error recovery, keyboard controls, local assets, and desktop/mobile-width layouts. Screenshots are written to the gitignored `test-results` directory.

## Starter exercises

| Language | Difficulty | Exercise |
| --- | --- | --- |
| TypeScript | Easy | Simplify pagination totals |
| Python | Medium | Stream the row refresh |
| C++ | Easy | Preallocate display labels |
| Rust | Hard | Relax the publication flag |

All **12 language/difficulty combinations** are selectable. Combinations without a case show an empty state. Complete 12-case coverage is scheduled for Phase 4. Language and difficulty are stored in URL query parameters and survive reloads and closing an overview.

## Add a case

Add a folder under `data/cases/<language>/<difficulty>/<id>/` with:

- `exercise.json`: public metadata plus complete before/after file contents; `schemaVersion` is `1`.
- `answer-key.json`: private reference findings with the same exercise ID and revision, at least one issue, and valid old/new line anchors.

Use the starter files and [implementation guide](CODE_REVIEW_TRAINER_CODEX_GUIDE.md#4-exercises-and-their-answer-keys) as examples. IDs are lowercase letters/digits/hyphens; paths are relative, use forward slashes, and cannot traverse directories. Added files have only `after`, deleted files only `before`, modified files have different versions, and unchanged context files have identical versions. Empty strings represent empty files. Anchors use 1-based version line numbers; a final newline does not create an extra commentable row. Keys and cases with invalid fields, duplicate IDs/paths, missing pairs, or invalid issue locations fail validation and server startup. Case directories cannot contain symlinks.

Run `npm.cmd run validate:cases` and inspect every claimed issue. Exercise source code is displayed as data and is never executed by the application. Language-specific compilation checks are authoring-time checks; validators do not require those compilers.

## Local data and boundaries

The server initializes **`data/app.sqlite`** on first launch, using Node's built-in SQLite module. Node 24 may print an experimental SQLite API warning. This avoids a separate database service and native npm database bindings. The database and `.env` are gitignored; retain the database when updating the app. Schema version 1 establishes the attempts/snapshot table for Phase 2; Phase 1 has no attempt-writing endpoint.

Only explicit public exercise fields are returned by the browsing API. Raw case folders, answer-key files, and the SQLite database are never served. The Vite filesystem allowlist includes frontend/shared source and dependencies, excluding `data`. Foreign Host/Origin headers are rejected; no permissive CORS is enabled.

`GET /api/languages` lists the four languages. `GET /api/cases?language=rust&difficulty=hard` requires both valid filters and returns public summaries. `GET /api/cases/:id` returns public exercise contents. Unsupported filters return 400 and unknown cases return 404.

Ollama settings in `.env.example` are reserved for Phase 3; they have no effect yet. The planned default is `qwen3:1.7b`, downloaded separately with `ollama pull qwen3:1.7b`. See [Ollama model setup](https://ollama.com/library/qwen3:1.7b). Grading calibration and findings outside the key remain subject to the limitations in the implementation guide.

Stack references: [Vite](https://vite.dev/guide/), [Tailwind's Vite plugin](https://tailwindcss.com/docs/installation/using-vite), [Zod schemas](https://zod.dev/api), and [Node SQLite](https://nodejs.org/api/sqlite.html).
