# Code Review Trainer — Codex Implementation Guide

> **Project brief:** Build a single-user, local-first web app for practicing realistic code reviews. The user chooses a **programming language** and **difficulty**, reviews a simulated Git commit in a GitHub-style diff interface, highlights suspicious code, writes review comments, and receives feedback comparing their comments against an **answer key created in advance**. A **small local model** provides semantic comparison; the backend calculates the final score. The application must not require any paid service.

## 1. Product goals and non-negotiable decisions

Build a polished practice tool, not a Git hosting service.

- **Completely free to run:** no paid APIs, subscriptions, hosted AI, telemetry, cloud database, or required external services.
- **Single user, localhost only:** no sign-in, accounts, roles, collaboration, or deployment work.
- **Initial languages:** **TypeScript, Python, C++, and Rust**. Language selection is a first-class part of the user flow.
- **Three difficulties:** **Easy, Medium, Hard**. The user chooses **both language and difficulty** before starting an exercise.
- **Prebuilt, local exercises:** Codex or another strong model generates exercises and their correct answers **ahead of time**. During a training session the app only loads saved exercises; it must not generate new ones.
- **Offline-first grading:** use **Ollama with a small, configurable local model** (initial recommendation: `qwen3:1.7b`) to judge how well a submitted comment matches a known answer. **Do not ask this model to independently discover bugs in a whole commit.**
- **Deterministic final scoring:** the backend calculates scores from validated structured assessments; the local model is a bounded semantic evaluator, not the source of truth for arithmetic or the set of expected issues.
- **Graceful offline fallback:** if Ollama/model is unavailable, preserve the review, show the reference issues after submission, and offer self-review. Do not invent an AI grade. Heuristic grading is deferred beyond the MVP.
- **Multiple findings per comment:** one comment may identify several known issues and additional findings. Assess each finding separately; findings outside the answer key receive local-model feedback but never affect scoring.
- **Realistic code review UI:** display added, changed, deleted, and unchanged context code, including the **old/deleted side** of diffs. Users can comment on any of those lines.
- **Persist local progress:** save attempts, comments, results, and completion state using SQLite.

### Suggested stack

| Layer | Choice |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS |
| Diff visualization | `react-diff-view`; prove old/new/context range selection, inline editing, and expansion in the first vertical slice |
| Backend | Node.js, TypeScript, Express |
| Schema validation | Zod (shared TypeScript schemas) |
| Storage | Local JSON exercise files; SQLite for attempts/progress |
| Local AI | Ollama HTTP API, with configurable small Qwen model |
| Testing | Vitest, React Testing Library, and Playwright for critical UI flows |

Use the stack above and avoid unnecessary frameworks or services. Build on `react-diff-view` widgets and source-text utilities rather than writing a diff renderer. See the [library documentation](https://github.com/otakustay/react-diff-view).

---

## 2. Core user journey

1. Open the app on `localhost` and land on the **Exercise Library**.
2. **Choose a language:** TypeScript, Python, C++, or Rust.
3. **Choose a difficulty:** Easy, Medium, or Hard.
4. Browse exercises matching the selection, seeing titles, concise descriptions, file counts, and attempt/completion status.
5. Start an exercise; see the commit summary and a GitHub-like **Files Changed** workspace.
6. Read code diffs, inspect surrounding unchanged code, switch files, and attach review comments to selected lines or ranges.
7. Edit/remove comments until satisfied; click **Submit Review**.
8. The backend matches comments to candidate known issues, asks the local model to assess every reported finding, validates its structured response, then calculates a score from known findings only.
9. View per-finding feedback grouped by comment, discovered issues, missed issues, AI assessments of extra findings, and the reference explanations/fixes.
10. Return to the library or retry. Results remain available across restarts.

The language and difficulty filters must compose: selecting **Rust + Hard**, for example, shows only Hard Rust exercises. Preserve selections when navigating back to the library (local storage or URL query params is enough).

---

## 3. Screens and interface requirements

### 3.1 Exercise Library (home)

- Prominent **Language** selector: `TypeScript`, `Python`, `C++`, `Rust`.
- Prominent **Difficulty** selector: `Easy`, `Medium`, `Hard`.
- Defaults can be TypeScript + Easy on first launch; remember the last selection afterward.
- Display only exercises matching the chosen combination. Show an understandable empty state if none exist.
- Cards/rows show title, a one-sentence scenario, language, difficulty, changed-file count, status (`Not Started`, `In Progress`, `Completed`), and best/latest score where applicable.
- Provide **Start**, **Continue**, **Retry**, and **View Results** actions as appropriate.
- Submission marks an exercise `Completed`, including when AI grading is unavailable; a saved draft alone is `In Progress`. Use the latest attempt for Continue/View Results and successful grading runs for best/latest scores.
- Completed-status filtering and text search are deferred beyond the MVP.

### 3.2 Review Workspace

Build a GitHub-inspired diff viewer, without copying GitHub branding.

**Header**
- Commit title, realistic commit message/PR description, language and difficulty badges, number of files, and a **Submit Review** action.
- Show a running count of draft comments, not the number of actual hidden mistakes.

**Files sidebar**
- List added, modified, deleted, renamed (if supported), and unchanged **context** files.
- Click to navigate. Retain draft comments while changing files.

**Diff**
- Unified view by default; offer side-by-side view where practical.
- Green styling for additions, red styling for deletions, neutral styling for unchanged lines.
- Show old and new line numbers, file paths, file status, and syntax highlighting.
- Support expanding collapsed unchanged sections and viewing a complete file.
- Show original (`before`) and updated (`after`) versions reliably; for unchanged context files, present the file in a clearly labeled context viewer.
- Support TypeScript (`.ts`, `.tsx`), Python (`.py`), C++ (`.cpp`, `.cc`, `.cxx`, `.h`, `.hpp`), and Rust (`.rs`) syntax highlighting and filename handling.
- Ensure code remains readable for long lines, long files, and multiple-file exercises.

**Inline commenting**
- Add a comment to one line or a contiguous multi-line range.
- A comment may describe several distinct findings; do not require one issue per comment.
- Allow comments on the **old side (deleted code)**, **new side (added/current code)**, and unchanged lines/context files.
- Show an inline text editor and saved threads/markers. Editing and deleting remain possible until review submission.
- On submission, comments become immutable for that attempt; retry creates a new attempt.
- Serialize draft saves, show saving/saved/error state, and finish saving the current comments before submission. Freeze editing while the final save and submission are pending; a failed save restores editing, keeps the local edits, and prevents submission until the save succeeds.
- Handle clicking or selecting lines without accidentally confusing the old and new line number spaces.

**Stable comment anchor** — persist at least:

```ts
type ReviewCommentAnchor = {
  filePath: string;
  side: "old" | "new";
  startLine: number; // 1-based line in the selected file version
  endLine: number;   // inclusive, same side/version
};
```

Use actual file-version line numbers, **not** visual diff row indices. Deleted files/lines use `old`; added lines use `new`. Unchanged context files can use `new`. Store the exercise revision/checksum **and complete backend-only snapshots of the public exercise and answer key** when an attempt starts. All attempt views, anchor validation, and regrading use those snapshots, even if the source cases later change or disappear. A checksum alone does not preserve content. Validate that an anchor refers to real lines in the corresponding snapshot version; an empty file or absent side has no commentable lines. Use the same line-number convention in the viewer and validator for CRLF and trailing newlines.

### 3.3 Results / Feedback

- Overall exercise score **0–100**, if AI grading succeeded.
- Number of distinct expected issues found and missed, plus extra findings outside the reference key. A single comment can contribute several findings.
- Per-finding rubric values, matched issue (if any), and clear, actionable feedback, grouped by comment. Do not imply that a multi-finding comment has only one match or one rubric score.
- Reference answers with file locations, the problem, likely impact, and suggested fix.
- Label extra findings **AI-assessed, outside the reference key**, with `supported`, `unsupported`, or `uncertain` verdicts and explanations. Absence from the key alone is not evidence that a finding is wrong. Extra findings never affect coverage, quality, or precision, regardless of their verdict.
- Highlight the relevant lines when jumping from a finding to the diff.
- Show which grading mode produced the result: `AI-assisted` or `Self-review / ungraded`. Also show pending/running/failed grading state where applicable.
- If local AI cannot be reached, keep the submission and allow **Retry AI grading** without repeating the review.
- Show grading-run history. A failed regrade leaves the last successful score and feedback visible, labeled with the run that produced them.

---

## 4. Exercises and their answer keys

### 4.1 Storage layout

Keep exercise content human-readable and version controlled. A suggested layout:

```text
data/
  cases/
    typescript/
      easy/
        ts-easy-001/
          exercise.json       # Public-facing exercise and before/after files
          answer-key.json     # Private reference findings; backend only
    python/
      medium/
    cpp/
      hard/
    rust/
      easy/
  app.sqlite                 # Local progress database (gitignored)
```

The folders above are illustrative; the loader must support **every** combination of the four languages and three difficulties.

### 4.2 Public exercise schema

Each exercise should include:

- Stable `id`, `schemaVersion`, and `revision`.
- `language`: `typescript | python | cpp | rust`.
- `difficulty`: `easy | medium | hard`.
- `title`, `description`, `commitMessage`, optionally `reviewContext` (business behavior, API expectations, relevant constraints).
- A list of files with `path`, `status` (`added | modified | deleted | unchanged`), `before` contents (if any), and `after` contents (if any).
- Optional tags (security, correctness, performance, etc.) for future filtering.

**Important:** the backend must construct the old/new diff from file versions and show unchanged contextual code. Never treat a unified diff string as the only source of truth.

Example (abridged):

```json
{
  "schemaVersion": 1,
  "id": "ts-easy-001",
  "revision": 1,
  "language": "typescript",
  "difficulty": "easy",
  "title": "Update profile deletion handler",
  "description": "Review an endpoint change before release.",
  "commitMessage": "Refactor profile deletion",
  "reviewContext": "Authenticated users may only delete their own profile.",
  "files": [
    {
      "path": "src/api/profiles.ts",
      "status": "modified",
      "before": "export function deleteProfile(request) {\n  assertOwner(request.user, request.params.id);\n  return db.profiles.delete(request.params.id);\n}\n",
      "after": "export function deleteProfile(request) {\n  return db.profiles.delete(request.params.id);\n}\n"
    }
  ]
}
```

The example intentionally omits language-specific imports/types to illustrate the data shape; real cases must contain coherent, realistic, reviewable code.

### 4.3 Hidden answer-key schema

Store expected findings **separately** from public exercise data:

```json
{
  "exerciseId": "ts-easy-001",
  "revision": 1,
  "issues": [
    {
      "id": "issue-001",
      "title": "Missing ownership authorization",
      "category": "security",
      "severity": "high",
      "locations": [
        { "filePath": "src/api/profiles.ts", "side": "old", "startLine": 2, "endLine": 2 },
        { "filePath": "src/api/profiles.ts", "side": "new", "startLine": 2, "endLine": 2 }
      ],
      "summary": "The ownership check was removed before deletion.",
      "whyItMatters": "An authenticated user can delete somebody else's profile.",
      "acceptableExplanations": [
        "The endpoint no longer verifies ownership",
        "Users can delete another user's data",
        "Deleting a profile needs a resource-level authorization check"
      ],
      "keyConcepts": ["authorization", "resource ownership", "unauthorized deletion"],
      "commonConfusions": ["Authentication alone is not sufficient authorization"],
      "suggestedFix": "Reintroduce and test resource ownership or permission checks before deletion.",
      "reviewHints": "Comments on the removed guard or the deletion call are both valid."
    }
  ]
}
```

**Design considerations**

- One issue may have **multiple acceptable anchor locations** and may span files.
- Every seed answer key must contain at least one issue. Issue IDs must be unique within the key; the exercise ID and revision must agree with the public exercise.
- Use detailed explanations, alternative phrasings, key concepts, common confusions, and clear scope boundaries to make evaluation possible for a small model.
- Some issues are caused by deleting formerly correct code; these must be considered valid findings.
- Do not require exact phrase matches. Recognize equivalent explanations and legitimate alternatives.
- Do not send `answer-key.json` from any public browsing or exercise API endpoint before review submission.
- After submission, show the reference answers only in the results flow. This is not hardened anti-cheat security; it is sensible separation for a single-user trainer.

### 4.4 Difficulty guidelines

| Difficulty | Typical scope | Expected reasoning |
| --- | --- | --- |
| **Easy** | 1–2 files, 1–3 planted issues | Direct mistakes (null/None handling, off-by-one, obvious broken conditions, missing checks) |
| **Medium** | 2–5 files, ~2–4 issues | Cross-function effects, edge cases, error handling, security checks, performance regressions |
| **Hard** | Larger multi-file commits, several subtle issues | Cross-file behavior, concurrency/races, transaction boundaries, lifetimes/ownership pitfalls, regressions due to removed behavior |

Difficulty should reflect **reasoning**, not arbitrary line count. Include realistic correct changes and contextual code; not every altered line should contain a bug.

### 4.5 Initial case coverage

The seed library must contain **at least one working case for each language × difficulty combination** (4 languages × 3 difficulties = **12 cases minimum**):

| Language | Easy | Medium | Hard |
| --- | :---: | :---: | :---: |
| TypeScript | ✓ | ✓ | ✓ |
| Python | ✓ | ✓ | ✓ |
| C++ | ✓ | ✓ | ✓ |
| Rust | ✓ | ✓ | ✓ |

Aim for **two cases per combination (24 total)** after the MVP is stable. Include language-specific issues instead of translating the same generic bug into four syntaxes:

- **TypeScript:** asynchronous control flow, runtime validation, type narrowing, authorization, state handling.
- **Python:** mutable defaults, exception handling, iterator/data handling, async mistakes, resource cleanup.
- **C++:** lifetime/ownership, iterator invalidation, bounds, move semantics, undefined behavior, concurrency.
- **Rust:** `Result`/error propagation, lifetimes/borrows in context, `Option` handling, async/concurrency, locking or state invariants.

Do not force invalid code that could never plausibly compile into a case unless identifying a build failure is itself the intentional review issue.

### 4.6 Offline case creation workflow

Codex (or another capable model) should produce cases **before the app is used**. The running app must not depend on Codex or a cloud model.

1. Choose language, difficulty, scenario, and target issues.
2. Generate believable **before** and **after** file trees, including unchanged context and a plausible commit description.
3. Write the complete hidden answer key with issue locations and acceptable explanations.
4. Validate JSON schemas, duplicate IDs, nonempty answer keys, matching exercise IDs/revisions, file paths, side/line ranges, and whether all referenced code exists.
5. Where feasible, run language-specific syntax/type/build tests for sample projects; document any intentional failing behavior. Keep this **generation-time only**, not a requirement for the review runtime.
6. Manually inspect exercise quality: issues should be real, discoverable, and not ambiguous; make sure no unintended severe mistakes invalidate the key.
7. Commit the cases to the project so they work fully offline.

Provide a CLI validator such as `npm run validate:cases` that runs without AI or network calls.

---

## 5. Grading design: known-answer scoring and bounded extra-finding feedback

### 5.1 Separate responsibilities

| Task | Component |
| --- | --- |
| Identify candidate expected issues near a comment | Backend, using file/side/line ranges and documented alternative anchors |
| Assess each known finding reported in a comment | Small local model |
| Assess reported findings outside the answer key | Small local model, for feedback only |
| Assess explanation, actionability, and clarity per finding | Small local model using fixed rubric |
| Resolve duplicate findings about the same known issue | Backend |
| Compute coverage, quality, precision, final score | Backend, deterministic |
| Show missed issues and known answers | Backend |
| Show extra-finding verdicts without scoring them | Backend/results UI |

**Critical optimization:** do not send the entire exercise or repository to the small model for each comment. Send a compact context: the user's comment, selected code snippet, nearby relevant lines (as needed), exercise requirements/review context, **one or a few candidate issues from the answer key**, and the rubric. This reduces token usage and the reasoning burden. A comment may produce several known findings, extra findings, or both; do not stop after the first match.

A comment may correctly refer to an issue a few lines away, to removed code, or to a separate related file; candidate matching must allow the explicitly documented valid locations and reasonable proximity rather than requiring an exact line overlap.

For a user-reported finding that does not match a candidate, ask the model to assess that specific claim against the supplied code and requirements. Return its verdict and explanation even when the reference key is incomplete. If context is insufficient, use `uncertain`; never ask the model to invent extra findings or independently discover bugs in the whole commit. Model accuracy calibration is follow-up work, not an MVP release gate.

### 5.2 Local AI provider

- Integrate via the **local Ollama HTTP API** (default `http://127.0.0.1:11434`) using Node's native `fetch`; do not add an SDK for these HTTP calls. Any configurable Ollama endpoint must remain loopback-only, with redirects disabled.
- Default configurable model: `qwen3:1.7b` **if installed and supported**. Allow changing the model name without code changes (environment variable/local settings).
- A 3B–4B Qwen model can be an optional quality upgrade if hardware permits.
- Never require a model download on first application launch; show setup instructions and a useful unavailable state instead.
- Keep all code, comments, and answers on the local machine; do not call hosted inference services.
- Call `POST /api/chat` with the JSON schema in `format`, `stream: false`, and `options.temperature: 0`. Set `think: false` where the selected model supports disabling thinking. Parse only the final `message.content` and validate it with Zod; thinking text is not an assessment.
- Use a configurable per-request timeout, default **120 seconds** (`OLLAMA_TIMEOUT_MS=120000`), including model loading. Retry malformed or schema-invalid output **once**; do not automatically retry unavailable servers, missing models, or timeouts. Process inference requests serially, including across attempts, to avoid competing for local model resources. Keep prompts concise and explicit.
- Treat user comments and code snippets as **data**, not as instructions for the grading model.

Use the official [structured-output documentation](https://docs.ollama.com/capabilities/structured-outputs) and [thinking controls](https://docs.ollama.com/capabilities/thinking) when implementing the adapter. Discover the selected model's supported thinking controls instead of assuming every configurable model accepts `think: false`.

Suggested abstraction:

```ts
interface GradingProvider {
  evaluate(
    exercise: PublicExercise,
    candidates: CandidateIssueMatch[],
    comments: ReviewComment[]
  ): Promise<ValidatedCommentAssessments>;
}
```

### 5.3 Model assessment rubric

Return one assessment object per submitted comment, with a nonempty `findings[]` array. Apply the **0–10** rubric to each finding separately, using integer values:

- **Correctness 0–4:** Does the reported finding accurately identify the problem without major technical errors? Known findings are compared with the key; extra findings receive an AI assessment for feedback only.
- **Explanation 0–3:** Does it explain the mechanism and consequence?
- **Actionability 0–2:** Does it suggest a meaningful fix or next step?
- **Clarity 0–1:** Is the review understandable and appropriately specific?

Return structured data such as:

```json
{
  "commentId": "comment-123",
  "findings": [
    {
      "matchedIssueId": "issue-001",
      "status": "supported",
      "correctness": 4,
      "explanation": 3,
      "actionability": 1,
      "clarity": 1,
      "feedback": "Correctly identified the removed ownership check. Suggest testing authorization across different users."
    },
    {
      "matchedIssueId": null,
      "status": "uncertain",
      "correctness": 1,
      "explanation": 1,
      "actionability": 0,
      "clarity": 1,
      "feedback": "The additional claim that database errors are swallowed cannot be established from the supplied handler and context."
    }
  ]
}
```

The same array supports multiple distinct non-null issue IDs in one comment. A non-null `matchedIssueId` identifies the known issue being discussed, including an incorrectly explained issue; it does **not** automatically award credit. A null ID is an extra finding outside the reference key. `status` must be `supported`, `unsupported`, or `uncertain`. For a known finding, correctness 3–4 means `supported`; lower correctness must be `unsupported` or `uncertain`.

The backend must validate that the response covers every supplied `commentId` exactly once, with no unknown or duplicate comment IDs. Validate every finding's non-null issue ID against the candidates supplied for that comment, bound each integer rubric value to its range, validate statuses and their consistency with known-finding correctness, and require nonempty feedback. Reject malformed or incomplete output; never silently skip an omitted comment or substitute zero scores for a failed assessment. If a comment makes no concrete claim, return an unmatched `uncertain` assessment explaining that rather than inventing a finding. **Do not force a match.**

### 5.4 Overall score

Calculate **0–100** in the backend from validated **known findings only**:

- A known issue is discovered when at least one finding matching its ID has **correctness >= 3/4**. Count that issue once, even if it appears in several comments or findings.
- For each discovered issue, select the accepted finding with the highest rubric total (`correctness + explanation + actionability + clarity`). Ignore duplicates for score calculation. If totals tie, use comment order and then finding order for a stable displayed representative.
- **Coverage:** number of discovered distinct known issues divided by the total reference issue count.
- **Quality:** average rubric total of the selected findings divided by 10; zero if no issue is discovered.
- **Precision:** number of discovered distinct known issues divided by the number of distinct known issue IDs discussed anywhere in the assessments, including rejected or uncertain findings. Use zero when the denominator is zero. An issue with both accepted and rejected assessments counts once and is discovered.
- **Total:** `Math.round(100 * (0.6 * coverage + 0.3 * quality + 0.1 * precision))`.

**Zero comments = zero score.** A successfully assessed review with only extra findings also scores zero: none of the known issues was discovered. Seed answer keys must contain at least one issue. Extra findings (`matchedIssueId: null`) are excluded from every numerator, denominator, duplicate-credit calculation, and quality calculation, regardless of their AI verdict or rubric values. They receive feedback only; do not amend the key automatically or provide manual score overrides in the MVP.

Unit-test duplicate findings, partial correctness, no valid matches, multiple known issues in one comment, mixed known/extra findings, different issue counts, and exact rounding. Persist the component values, selected findings, total score, model identity, and prompt/rubric/scoring versions with each grading run. Deterministic scoring means identical validated assessments produce identical scores; inference itself need not be deterministic.

### 5.5 Unavailable model / fallback behavior

If Ollama is stopped, the configured model is not installed, or grading fails:

1. **Save the submitted review** without data loss.
2. Clearly say that **AI grading is unavailable**.
3. Offer **Retry AI grading** later.
4. Offer **Reveal answer key & self-review** immediately.
5. Do **not** display fabricated finding scores or an overall AI score. If a regrade fails, retain the previous successful result with its grading-run label.

Do not publish a partial overall grade if any comment cannot be assessed successfully. Record the failed run and keep the immutable submission available for self-review and regrading. Heuristic grading is deferred beyond the MVP.

For a fully offline machine with a small model installed, the normal flow should work without an internet connection after initial software/model installation.

### 5.6 Follow-up: calibrate the small grader

After the first working version, create a fixture set of **at least 30 manually labeled comment-to-issue examples** across all four languages. This benchmark and any agreement-rate threshold are **not MVP release gates**. Include:

- Correct paraphrases with different wording.
- Partially correct explanations.
- Incorrect explanations containing the expected buzzwords.
- Authentication vs. authorization confusion.
- Right issue but imperfect line selection.
- Comments about removed code.
- Duplicates and unrelated comments.
- Several known issues in one comment and mixed known/extra findings.
- Legitimate-looking findings absent from the predefined answer key.

Run these fixtures against the configured small model (an optional local integration test); report agreement rates and representative disagreements. Keep deterministic application tests independent of Ollama so the test suite can run without a model. Use mocked structured assessments to verify schemas, scoring, and failure handling before the benchmark exists. Local-model verdicts, particularly for extra findings, may be inaccurate; label them as AI assessments.

---

## 6. Persistence and backend routes

### Database records

At minimum:

- `attempts`: attempt ID, exercise ID and revision/checksum, backend-only public exercise and answer-key snapshots, attempt state (`draft | submitted`), and started/submitted timestamps.
- `review_comments`: attempt ID, comment ID, path, side, start/end lines, body.
- `grading_runs`: run ID, attempt ID, status (`pending | running | succeeded | failed`), grading mode, model name and digest/version where available, prompt/rubric/scoring versions, started/completed timestamps, nullable total score and breakdown, and optional error.
- `comment_assessments`: grading-run ID, comment ID, and the validated `findings[]` data, including nullable matched issue IDs, rubric values, feedback, and statuses. Store one assessment per comment per run.

Keep the SQLite file in a gitignored local data directory. Snapshots are stored when an attempt starts and never replaced; the frontend receives only the public snapshot until submission. Continuing a draft, displaying results, validating anchors, and regrading must work if the original case directory has been edited or removed. New attempts use the current validated case content.

### Attempt lifecycle and grading history

- Attempts move only from `draft` to `submitted`. Comments can be saved only while the attempt is a draft; enforce immutability in the backend, not only in the UI. Submission marks the exercise completed regardless of grader availability. Derive `Not Started`, `In Progress`, and `Completed` from saved attempts, giving completed status precedence when any submitted attempt exists.
- The client waits for all current draft saves before submitting. The backend transactionally marks the attempt submitted and creates its first pending grading run before making any Ollama request. Repeated submission returns the existing submission and must not create another job. A late comment update after submission is rejected without altering stored comments.
- Run inference outside SQLite transactions. Persist assessments, score breakdown, and successful run status together only after every comment has a valid assessment. A zero-comment submission succeeds with score zero without an inference request; do not fabricate comment assessments.
- If Ollama is unavailable or a request fails, mark the run failed with an actionable error and leave the submitted review intact. On backend restart, mark interrupted pending/running runs failed with an interruption reason so the user can retry explicitly; do not leave them permanently running.
- **Retry exercise** creates a new draft attempt and preserves older attempts. **Retry AI grading** creates a new grading run for the same immutable submission, using its saved snapshots. Transactionally permit at most one pending/running run per attempt; repeated requests while it is active return that run rather than starting duplicate work.
- Preserve every grading run and its assessments. Results show the latest successful run plus the latest run's state/error when different. Failed regrading must not erase or replace an earlier successful result. An attempt with no successful run has a null score and remains available for self-review.
- For library scores, use each attempt's latest successful run; latest score comes from the most recently submitted attempt with such a run, and best score is the highest of those attempt scores. Expose grading-run history through the attempt results payload.

### Suggested HTTP API

| Endpoint | Behavior |
| --- | --- |
| `GET /api/languages` | Returns the four supported languages and labels |
| `GET /api/cases?language=rust&difficulty=hard` | Lists public cases matching **both** filters |
| `GET /api/cases/:id` | Returns public exercise (never the hidden key) |
| `POST /api/attempts` | Creates a new draft attempt for a case, saving its public/private snapshots; used by Start/Retry |
| `PUT /api/attempts/:id/comments` | Saves/updates draft comments after validating anchors against the snapshot; rejects submitted attempts |
| `POST /api/attempts/:id/submit` | Transactionally locks the draft and creates one grading run; returns the existing submission on repeated requests |
| `POST /api/attempts/:id/regrade` | Creates a new grading run for a submitted attempt, or returns its already pending/running run |
| `GET /api/attempts` | Returns attempt summaries for progress/history |
| `GET /api/attempts/:id` | Returns the public snapshot and draft comments for Continue, or immutable comments, reference findings, grading-run history, and per-comment `findings[]` results after submission |
| `GET /api/system/grader` | Reports local Ollama/model availability and configuration |

Reference findings should be returned **only for submitted attempts** through a results-specific payload. Validate filters, IDs, and comment anchors; do not expose arbitrary filesystem paths or raw answer-key endpoints.

### Local-only serving

Bind both the development server and backend explicitly to loopback (`127.0.0.1`), not `0.0.0.0`. Use Vite's `/api` proxy during development and serve the built frontend from Express for local production so browser requests stay same-origin. Validate request Host headers and browser origins against the configured local application address; reject foreign origins for mutation requests rather than enabling permissive CORS. Require JSON for comment/submission mutations. Bundle scripts, styles, fonts, and highlighting assets locally; the runtime must not fetch them from a CDN.

---

## 7. Project structure

A monorepo or simple two-package structure is fine; keep boundaries clear:

```text
code-review-trainer/
  apps/
    web/
      src/
        pages/            # library, review, results, history
        components/       # selectors, diff viewer, comment editor, score UI
    server/
      src/
        routes/
        services/         # case loader, matching, grading, scoring
        persistence/
        ollama/
  packages/
    shared/
      src/                # Zod schemas, TypeScript types
  data/
    cases/                # language/difficulty subfolders
    app.sqlite            # generated, gitignored
  scripts/
    validate-cases.ts
    create-case-template.ts  # optional authoring helper; no runtime AI
  tests/
    fixtures/
  .env.example
  README.md
```

Provide straightforward commands for install, development, case validation, testing, and local production start. Use a one-command development workflow if practical. Document that Ollama itself and the chosen local model must be installed separately for AI-assisted grading, and that this initial setup may require an internet download. Include the model name setting, loopback endpoint, and `OLLAMA_TIMEOUT_MS` (default `120000`) in `.env.example` and the README.

---

## 8. Implementation order

### Phase 1 — Foundation and language/difficulty library

- Initialize React/Vite + Express/TypeScript, shared schemas, and local SQLite.
- Implement strict exercise and answer-key validation, including nonempty keys and matching exercise IDs/revisions.
- Build the **language + difficulty selection** interface with all 12 combinations.
- Implement public case loading/filtering; ensure no answer-key leakage.
- Add a small set of manually checked starter exercises to exercise the UI.

**Done when:** the user can select any of the four languages and any difficulty and see the correctly filtered library or a helpful empty state.

**Status:** implemented with four validated starter cases, public exercise previews, and all 12 filter combinations. See `README.md` for run/check commands. Review commenting and grading remain in Phases 2–3; complete 12-case coverage remains in Phase 4.

### Phase 2 — GitHub-style code review

- Build the file sidebar and unified diffs with `react-diff-view`, then optional split view. Prove old/new/context range selection, inline editing, and collapsed-section expansion in the first vertical slice before advanced polish.
- Support old/deleted code, new/added code, unchanged context, full-file expansion, and per-language highlighting.
- Implement stable line/range anchoring for old/new sides and inline draft comments.
- Persist drafts and their public/private exercise snapshots; support editing/deleting comments, serialized saves, and visible save errors.

**Done when:** a reviewer can annotate added, deleted, and unchanged code across several files, switch views, reload, and retain accurate anchors.

### Phase 3 — Offline grading and results

- Implement deterministic issue candidate matching.
- Implement Ollama adapter with configurable small Qwen model and structured-output validation.
- Implement per-comment `findings[]`, multi-issue assessment, exact 60/30/10 scoring, duplicate prevention, and feedback-only AI assessments of extra findings.
- Build feedback/results screen and missing-model fallback.
- Transactionally lock submissions, save grading-run history, prevent duplicate jobs, and make interrupted grading retryable.

**Done when:** a submitted review can earn credit for multiple known findings in one comment, extra findings receive feedback without affecting the score, and missing/interrupted grading preserves submissions and previous successful results.

### Phase 4 — Complete language/difficulty exercise coverage

- Populate **all 12 initial combinations** with at least one credible exercise each.
- Add a case generation/validation authoring guide for Codex.
- Include language-specific bug patterns, removed-behavior regressions, and unchanged contextual files.
- Validate issue locations and manually sanity-check answers.

**Done when:** TypeScript, Python, C++, and Rust each have Easy, Medium, and Hard reviewable cases.

### Phase 5 — Testing and polish

- Test public/private data isolation, case loader, all language/difficulty filters, stable line anchors (including empty files, CRLF, and trailing newlines), scoring arithmetic, duplicate suppression, multi-finding assessment validation, and grader failures.
- Run UI end-to-end tests for commenting on old/new/context lines, submitting, reviewing missed issues, and retrying.
- Test save failures, repeated submission/regrade requests, interrupted grading, and failed regrades preserving earlier successful results. Edit/remove source cases and verify historical views and regrading still use the saved snapshots.
- Keep model-accuracy benchmarking and the 30+ manually labeled fixtures as post-MVP follow-up work, not release gates.
- Improve accessibility, loading and error states, long code files, and README instructions.

---

## 9. MVP acceptance criteria

The MVP is complete only when **all** of the following are true:

1. Runs on loopback with validated local request origins and bundled assets, without login, cloud services, subscriptions, or paid APIs.
2. Offers **TypeScript, Python, C++, and Rust**, and **Easy, Medium, Hard** selection on the main screen.
3. Filters exercises by **both** selected language and difficulty.
4. Contains **at least 12 working exercises**—one for each language/difficulty combination.
5. Shows a GitHub-like file diff with clear additions, deletions, and unchanged context.
6. Supports viewing the old version and commenting on deleted/old-side code.
7. Supports line and multi-line comments on added, modified, and unchanged context code.
8. Draft comments persist while navigating files and across application reloads; save failures are visible and prevent submitting unsaved edits.
9. Submitting a review compares comments with **prewritten hidden answers** rather than asking the small model to find bugs unaided.
10. Uses Ollama locally with a configurable small Qwen model, validates the structured output, and calculates final scoring on the backend.
11. Shows multiple per-finding assessments grouped by comment, correctly found issues, missed issues, and reference solutions. Extra findings receive labeled AI verdicts without affecting any scoring component.
12. Preserves immutable submissions, exercise/key snapshots, and grading-run history across restarts; historical views and regrading use the original saved content after source cases change or disappear. A fresh model assessment may differ from an earlier run.
13. Handles missing/stopped Ollama, timeouts, invalid/incomplete output, and interrupted grading without losing submissions or inventing scores; a failed regrade preserves the last successful result.
14. Never returns hidden answer keys from pre-submission/public exercise endpoints.
15. Has automated tests for critical data boundaries, comment anchors, language/difficulty filtering, grading validation, and exact score computation, including multi-issue comments, duplicate/partial findings, zero comments, and extra findings having no score effect.
16. Includes clear installation, model-setup, and usage instructions.
17. Prevents duplicate jobs from repeated submission or regrade requests and enforces submitted-comment immutability in the backend.

Model accuracy agreement rates and the 30-example benchmark are follow-up work; the MVP requires validated assessments and correct deterministic behavior, not a benchmark threshold.

---

## 10. Explicitly out of scope

- Accounts, sign-in, teams, shared reviews, or online leaderboards.
- Hosted/cloud AI graders, paid inference APIs, automatic billing, or required API keys.
- Dynamic AI exercise generation during a review session.
- GitHub account integration, real pull request imports, repository synchronization, or deployments.
- Running arbitrary code submitted by users in a server sandbox.
- Mobile-native apps, achievements, badges, or detailed analytics dashboards.
- Robust anti-cheat protection; this is a personal learning tool.
- MVP extras: text/status search filters, heuristic grading, manual score overrides, and automatic answer-key amendments.

---

## 11. Direct instructions to Codex

**Implement the application described above; do not only produce a plan.** Work incrementally, prioritizing a solid review interface and trustworthy answer-key comparison over secondary features.

1. Start by defining the shared schemas and interfaces. Make language and difficulty enumerations foundational, not bolted-on filters.
2. Implement a working vertical slice with **one case**, from library selection through `react-diff-view` range selection/expansion/inline editing to submitted feedback; then extend to the other languages and difficulties.
3. Maintain strict separation of public exercise data, private answer keys/snapshots, AI semantic assessment, and deterministic scoring. Use per-comment `findings[]`; extra findings receive AI feedback only.
4. Keep the runtime **fully local**. Ollama is optional for basic use but required for AI-assisted assessment. Do not add cloud-service dependencies.
5. Ensure comments can reference **old, new, and unchanged context lines** correctly; write tests for this before adding advanced UI polish.
6. Deliver at least one quality-controlled exercise in every combination of TypeScript/Python/C++/Rust and Easy/Medium/Hard.
7. Add useful save/grading errors and fallback flows. Transactionally lock submissions, preserve grading-run history, prevent duplicate jobs, and retain prior successful results after failed regrades.
8. Provide a complete `README.md` with exact setup/run/test commands, case-authoring instructions, Ollama installation/configuration, and how to switch local models.
9. Run deterministic tests and validate the seed cases before declaring the implementation complete; report any remaining limitations. Defer model-accuracy calibration until after the first working version.

**Success criterion:** the app feels like a simplified GitHub pull request review experience, but it is a self-contained, free, local training tool with curated multi-language exercises and lightweight, answer-key-assisted feedback.
