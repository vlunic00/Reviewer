# Code Review Trainer

A free, local app for learning code-review reasoning. Phases 1 and 2 are implemented: language/difficulty library, worked reference lessons, a GitHub-style diff workspace, accurate old/new/context annotations, and persistent review drafts.

Library cards offer **Start review**, **Continue review** for an existing draft, and public exercise previews. Submission, found/missed matching, and the learning-feedback screen belong to Phase 3. Answer keys and worked lessons stay private during a draft review; there are no numeric grades.

## Run locally

Install **Node.js 24.13 or newer**, then run these commands from this project directory:

```powershell
npm.cmd install
npm.cmd run dev
```

Open **http://127.0.0.1:5173**. The API listens on `127.0.0.1:3001`. One development process runs both servers; React changes reload automatically. Restart development after changing case JSON files. On macOS/Linux, use `npm` instead of `npm.cmd`.

No Ollama installation, model, account, or API key is needed for the library or draft reviews. Initial npm/browser/model installations require downloads; the installed application makes no runtime cloud calls or CDN requests.

To change ports, copy `.env.example` to `.env` and edit `PORT` / `WEB_PORT`. Both servers bind only to `127.0.0.1`. Open the exact address printed by the development command so browser origin checks match. `SQLITE_PATH` optionally changes the local progress database path; the default is `data/app.sqlite`.

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

Case validation and unit/API tests run without AI or network access. Browser tests start their own development server on ports **3199 / 5199** with an in-memory database so they cannot write to your progress. They cover all filters, preview dialogs, old/new/context ranges, added/deleted files, complete versions, context expansion, edits/deletion, reload recovery, serialized saves, lost-response retry, stale tabs, keyboard controls, and narrow layouts. Screenshots are written to the gitignored `test-results` directory.

## Review a commit

1. Select a language and difficulty, then choose **Start review** or **Continue review**.
2. Read the commit message and review context. Switch files using the file list.
3. Click an old or new line number to open an inline note. **Shift-click** a second line on the same side to select a contiguous range, or adjust its start/end fields. Keyboard users can focus a line number and press Enter; Shift+Enter extends a range.
4. Write your reasoning and choose **Add comment**. Existing comments can be edited or deleted. Comments save automatically, and **Save draft** saves immediately.
5. Switch between unified and side-by-side diffs, expand context, or inspect a complete original/updated file. Context files are clearly labeled; empty files have no commentable lines. Long code scrolls inside the viewer.
6. Return to the library or reload. The attempt URL and Continue action reopen the saved snapshot with the same anchors.

SQLite preserves posted draft comments across restarts. An unfinished editor note and pending save recovery are kept in **this tab's session storage**, which survives a reload but not closing the tab. Finish open notes before closing; the browser warns when edits are pending. A failed save leaves edits available and offers **Retry save**. If another tab changes the draft, saving is blocked rather than overwriting it; copy any pending notes before choosing **Load saved draft**. A response lost after a successful save can be retried safely. Browser storage failures are reported; keep that tab open until its comments are saved.

Drafts support up to 500 comments, each up to 8,000 characters, with a 5 MB request limit. Attempts store complete exercise and private answer-key snapshots at creation; changing or removing source case files does not change existing reviews.

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
- `answer-key.json`: private reference findings with the same exercise ID and revision, at least one issue, valid old/new line anchors, and full worked lessons. Every issue requires `explanation`, `failureExample`, `correctedCode` (file-path/code entries), and `prevention`, alongside its summary, impact, and suggested fix.

Use the starter files and [implementation guide](CODE_REVIEW_TRAINER_CODEX_GUIDE.md#4-exercises-and-their-answer-keys) as examples. IDs are lowercase letters/digits/hyphens; paths are relative, use forward slashes, and cannot traverse directories. Added files have only `after`, deleted files only `before`, modified files have different versions, and unchanged context files have identical versions. Empty strings represent empty files. Anchors use 1-based version line numbers; a final newline does not create an extra commentable row. Keys and cases with invalid fields, duplicate IDs/paths, missing pairs, or invalid issue locations fail validation and server startup. Case directories cannot contain symlinks.

Run `npm.cmd run validate:cases` and inspect every claimed issue, failure example, and corrected snippet. Structural validation checks required fields and correction paths, but cannot establish explanation quality. The four starter cases are now revision 2 and have complete authored lessons. Bump both public and private revisions together when changing a case. Exercise source code is displayed as data and is never executed by the application. Language-specific compilation checks are authoring-time checks; validators do not require those compilers.

## Local data and boundaries

The server initializes **`data/app.sqlite`** on first launch, using Node's built-in SQLite module. Node 24 may print an experimental SQLite API warning. This avoids a separate database service and native npm database bindings. The database and `.env` are gitignored; retain the database when updating the app. Schema version 2 adds ordered review comments and draft-save versions. A version-1 database is migrated without replacing its existing attempts or snapshots.

Only explicit public exercise fields are returned by the browsing API. Raw case folders, answer-key files, and the SQLite database are never served. The Vite filesystem allowlist includes frontend/shared source and dependencies, excluding `data`. Foreign Host/Origin headers are rejected; no permissive CORS is enabled.

`GET /api/languages` lists the four languages. `GET /api/cases?language=rust&difficulty=hard` requires both valid filters and returns public summaries. `GET /api/cases/:id` returns public exercise contents. Unsupported filters return 400 and unknown cases return 404.

`POST /api/attempts` accepts `{ "exerciseId": "ts-easy-001" }` and creates a snapshot-backed draft. `GET /api/attempts/:id` returns the public snapshot, server-generated diffs, comments, and save version. `PUT /api/attempts/:id/comments` accepts `{ "version": 0, "comments": [...] }`; each comment has a UUID, `anchor` (`filePath`, `side`, `startLine`, `endLine`), and `body`. Saves validate every anchor against the snapshot and atomically replace the comment list. Invalid input returns 400, stale versions or submitted edits return 409, and oversized requests return 413. Responses never contain private answer keys. Submission and reassessment endpoints are not implemented yet.

Ollama settings in `.env.example` are reserved for Phase 3; they have no effect yet. The planned default is `qwen3:1.7b`, downloaded separately with `ollama pull qwen3:1.7b`. See [Ollama model setup](https://ollama.com/library/qwen3:1.7b). AI matching calibration and findings outside the key remain subject to the limitations in the implementation guide.

Stack references: [Vite](https://vite.dev/guide/), [Tailwind's Vite plugin](https://tailwindcss.com/docs/installation/using-vite), [Zod schemas](https://zod.dev/api), and [Node SQLite](https://nodejs.org/api/sqlite.html).
