# Code Review Trainer

A free, local app for learning code-review reasoning. Phases 1–3 are implemented: language/difficulty library, a GitHub-style diff workspace, persistent drafts, optional local AI feedback, and complete worked reference lessons.

Library cards offer **Start review**, **Continue review**, **Read lessons** after submission, and **Retry exercise**. Review history reopens earlier snapshots even if a case has been removed. Answer keys and worked lessons stay private during a draft review; there are no numeric grades.

## Run locally

Install **Node.js 24.13 or newer**, then run these commands from this project directory:

```powershell
npm.cmd install
npm.cmd run dev
```

Open **http://127.0.0.1:5173**. The API listens on `127.0.0.1:3001`. One development process runs both servers; React changes reload automatically. Restart development after changing case JSON files. On macOS/Linux, use `npm` instead of `npm.cmd`.

No Ollama installation, model, account, or API key is needed to review a commit, submit it, or read its authored lessons. Initial npm/browser/model installations require downloads; the installed application makes no runtime cloud calls or CDN requests.

To change ports, copy `.env.example` to `.env` and edit `PORT` / `WEB_PORT`. Both servers bind only to `127.0.0.1`. Open the exact address printed by the development command so browser origin checks match. `SQLITE_PATH` optionally changes the local progress database path; the default is `data/app.sqlite`.

For a local production build:

```powershell
npm.cmd run build
npm.cmd start
```

Open **http://127.0.0.1:3001**. Express serves the built frontend and API from one origin.

## Optional local AI feedback

Install and start [Ollama](https://docs.ollama.com/quickstart), then install a local model separately if you want personalized feedback:

```powershell
ollama pull qwen3:1.7b
```

Copy `.env.example` to `.env` to change `OLLAMA_MODEL`, `OLLAMA_URL` (default `http://127.0.0.1:11434`), or `OLLAMA_TIMEOUT_MS` (default `120000`); restart the app after changing settings. The app never downloads a model. Only HTTP loopback endpoints are accepted, `localhost` resolves to the fixed loopback address, redirects are disabled, and models advertised as cloud/remote are rejected before sending review content. Choose **Check local AI setup** on a submitted review to inspect availability and settings.

The adapter uses native HTTP, schema-constrained output, temperature zero, and supported thinking controls discovered from model metadata. It validates final `message.content` with Zod and retries malformed/incomplete output once. Unavailable servers, missing models, HTTP errors, and timeouts fail without automatic retries. One queue processes inference serially across reviews. See Ollama's [structured outputs](https://docs.ollama.com/capabilities/structured-outputs) and [thinking controls](https://docs.ollama.com/capabilities/thinking).

AI matching can be inaccurate, particularly for findings outside the reference key. The saved reference lessons remain the teaching source. Real-model accuracy calibration and the 30-example benchmark are deferred; deterministic tests use local protocol fixtures.

## Checks

```powershell
npm.cmd run validate:cases
npm.cmd test
npm.cmd run typecheck
npm.cmd exec playwright install chromium
npm.cmd run test:e2e
```

Case validation and unit/API tests need no installed AI or internet connection. Browser tests start their own development server on ports **3199 / 5199**, an in-memory database, and a test-only Ollama protocol server on **11535**. They cannot write to your progress or call your configured model. The 36 unit/API tests and 19 browser tests cover filtering, private-key isolation, old/new/context ranges, complete versions, edits, recovery, submission, distinct issue counts, multi-finding comments, invalid AI output, retries/history, snapshot preservation, offline lessons, keyboard controls, and narrow layouts. Screenshots are written to the gitignored `test-results` directory.

## Review a commit

1. Select a language and difficulty, then choose **Start review** or **Continue review**.
2. Read the commit message and review context. Switch files using the file list.
3. Click an old or new line number to open an inline note. **Shift-click** a second line on the same side to select a contiguous range, or adjust its start/end fields. Keyboard users can focus a line number and press Enter; Shift+Enter extends a range.
4. Write your reasoning and choose **Add comment**. Existing comments can be edited or deleted. Comments save automatically, and **Save draft** saves immediately.
5. Switch between unified and side-by-side diffs, expand context, or inspect a complete original/updated file. Context files are clearly labeled; empty files have no commentable lines. Long code scrolls inside the viewer.
6. Return to the library or reload to resume later, or choose **Finish review** when you are ready to learn from the references. Add or cancel any open note first. The app finishes pending saves and locks the saved version before requesting AI feedback. Completion does not depend on finding issues or having a working model.
7. Read the brief found/missed summary, then the **missed lessons first**, followed by reinforcing lessons for found issues. Each lesson includes the failure mechanism, concrete example, impact, correction, prevention, key concepts, and common confusions. Location buttons open the saved old/new code with the relevant lines highlighted.
8. If AI feedback is unavailable, all reference lessons remain readable for self-review. Nonempty reviews show automatic counts as unavailable until a complete assessment succeeds; an empty review immediately shows zero found and all reference issues to learn from, without inference. Choose **Retry AI feedback** later. Earlier successful feedback survives a failed retry, and feedback history lets you revisit successful runs.

One comment may identify several issues. A reference issue is found if any matched finding is supported; repeated findings add no count. Unsupported/uncertain matches remain missed, with uncertainty labeled **Not yet verified**. Extra findings are labeled **AI-assessed, outside the reference key** and never change reference counts. Candidate selection uses authored file/side locations, overlapping ranges or a maximum five-line gap; explicitly authored alternative locations support related files and removed code. Each request includes one comment, requirements, nearby source (bounded to 80 lines / 16,000 characters for long selections), and compact candidate reasoning. The model assesses submitted claims rather than searching the commit for new defects.

SQLite preserves posted draft comments across restarts. An unfinished editor note and pending save recovery are kept in **this tab's session storage**, which survives a reload but not closing the tab. Finish open notes before closing; the browser warns when edits are pending. A failed save leaves edits available and offers **Retry save**. If another tab changes the draft, saving is blocked rather than overwriting it; copy any pending notes before choosing **Load saved draft**. A response lost after a successful save can be retried safely. Browser storage failures are reported; keep that tab open until its comments are saved.

Drafts support up to 500 comments, each up to 8,000 characters, with a 5 MB request limit. Attempts store complete exercise and private answer-key snapshots at creation; changing or removing source case files does not change existing reviews.

Submitted comments are immutable. Repeated submit requests return the same submission, and repeated feedback requests share an active run. If a submission response is lost or returns a server error, editing pauses while **Finish review** safely retries. A backend restart marks interrupted feedback failed with a retry action; it preserves the submitted comments, prior results, and lessons. **Retry exercise** starts another draft and keeps earlier reviews in history.

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

The server initializes **`data/app.sqlite`** on first launch, using Node's built-in SQLite module. Node 24 may print an experimental SQLite API warning. This avoids a separate database service and native npm database bindings. The database and `.env` are gitignored; retain the database when updating the app. Schema version 3 adds assessment runs and per-comment findings to the existing comments/save-version tables. Version-1 and version-2 databases migrate without replacing attempts or snapshots. Run one application server per progress database; opening it recovers interrupted jobs from the previous process.

Only explicit public exercise fields are returned by the browsing API. Raw case folders, answer-key files, and the SQLite database are never served. The Vite filesystem allowlist includes frontend/shared source and dependencies, excluding `data`. Foreign Host/Origin headers are rejected; no permissive CORS is enabled.

`GET /api/languages` lists the four languages. `GET /api/cases?language=rust&difficulty=hard` requires both valid filters and returns public summaries. `GET /api/cases/:id` returns public exercise contents. Unsupported filters return 400 and unknown cases return 404.

`POST /api/attempts` accepts `{ "exerciseId": "ts-easy-001" }` and creates a snapshot-backed draft. `GET /api/attempts/:id` returns the public snapshot, server-generated diffs, comments, and save version. `PUT /api/attempts/:id/comments` accepts `{ "version": 0, "comments": [...] }`; each comment has a UUID, `anchor` (`filePath`, `side`, `startLine`, `endLine`), and `body`. Saves validate every anchor against the snapshot and atomically replace the comment list. Invalid input returns 400, stale versions or submitted edits return 409, and oversized requests return 413. Draft responses never contain reference lessons.

`POST /api/attempts/:id/submit` accepts `{ "version": 1 }` for the last saved draft version and returns the immutable submission with HTTP 202. Its `results` contains all stored lessons and assessment runs immediately. `POST /api/attempts/:id/regrade` accepts `{}` to retry AI feedback; it also returns 202 and reuses an active run. Poll `GET /api/attempts/:id` to follow pending/running feedback. Runs preserve statuses, model/digest, prompt/assessment versions, timestamps, errors, nullable distinct issue counts, and per-comment `findings[]`. Only a fully validated assessment is published; no partial counts or fabricated assessments are saved.

`GET /api/attempts` returns snapshot-backed review history and latest successful counts alongside the newest feedback status. `GET /api/system/grader` reports local model availability/configuration without inference. These technical route names are retained; the product action is **Retry AI feedback**. There are no raw answer-key or arbitrary filesystem endpoints.

Stack references: [Vite](https://vite.dev/guide/), [Tailwind's Vite plugin](https://tailwindcss.com/docs/installation/using-vite), [Zod schemas](https://zod.dev/api), and [Node SQLite](https://nodejs.org/api/sqlite.html).
