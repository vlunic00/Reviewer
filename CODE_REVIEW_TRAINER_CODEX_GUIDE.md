# Code Review Trainer — Codex Implementation Guide

> **Project brief:** Build a single-user, local-first web app for learning realistic code-review reasoning. The user chooses a **programming language** and **difficulty**, reviews a simulated Git commit in a GitHub-style diff interface, highlights suspicious code, and writes review comments. After submission, show which reference issues they found and missed, then teach the reasoning behind every mistake, with particular emphasis on **missed issues**. Codex authors and saves complete worked explanations alongside each mock commit **ahead of time**. A **small local model** compares learner comments with these references and supplies personalized feedback; the backend counts distinct found/missed issues. The application must not require any paid service.

## 1. Product goals and non-negotiable decisions

Build a polished learning tool. Success means the learner understands the mistake, its consequences, the correction, and how to recognize similar problems in future reviews.

- **Completely free to run:** no paid APIs, subscriptions, hosted AI, telemetry, cloud database, or required external services.
- **Single user, localhost only:** no sign-in, accounts, roles, collaboration, or deployment work.
- **Initial languages:** **TypeScript, Python, C++, and Rust**. Language selection is a first-class part of the user flow.
- **Three difficulties:** **Easy, Medium, Hard**. The user chooses **both language and difficulty** before starting an exercise. Difficulty describes reasoning complexity and helps choose what to learn; completion does not depend on finding every issue.
- **Prebuilt exercises and worked lessons:** Codex or another strong model generates mock commits, all planted mistakes, and detailed explanations **ahead of time**. Every mistake must include its mechanism, a concrete failure example, impact, corrected code, and prevention guidance. During a learning session the app loads saved content; it must not generate new exercises or reference lessons.
- **Learning before measurement:** show missed-issue explanations prominently and reinforce the reasoning behind found issues. Do not calculate numeric grades, quality/precision penalties, best-score comparisons, or competitive rankings. Found/missed counts are a brief orientation to the lessons.
- **Offline-first assessment:** use **Ollama with a small, configurable local model** (initial recommendation: `qwen3:1.7b`) to judge how well a submitted comment matches a known issue and explain the learner's reasoning. **Do not ask this model to independently discover bugs in a whole commit.**
- **Deterministic issue counts:** the backend deduplicates supported matches and computes found/missed counts from validated assessments. The stored reference key defines the expected issues and their lessons; the local model supplies bounded, personalized feedback.
- **Graceful offline fallback:** if Ollama/model is unavailable, preserve the review and show all stored reference lessons after submission for self-review. Label automatic found/missed counts unavailable rather than inventing assessment results. Empty reviews have known counts without inference.
- **Multiple findings per comment:** one comment may identify several known issues and additional findings. Assess each finding separately; findings outside the answer key receive local-model feedback but do not change reference-issue counts.
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
8. The backend matches comments to candidate known issues, asks the local model to assess every reported finding, validates its structured response, and counts distinct reference issues found and missed.
9. See a brief found/missed summary, study **missed issues and their worked explanations first**, then review found issues with reinforcing explanations. Each lesson shows the mechanism, failure example, impact, corrected code, and prevention guidance. Per-comment feedback and separate AI assessments of extra findings supplement these saved lessons.
10. Return to the library or revisit an exercise to practice the reasoning. Reviews, reference snapshots, and assessment history remain available across restarts.

The language and difficulty filters must compose: selecting **Rust + Hard**, for example, shows only Hard Rust exercises. Preserve selections when navigating back to the library (local storage or URL query params is enough).

---

## 3. Screens and interface requirements

### 3.1 Exercise Library (home)

- Prominent **Language** selector: `TypeScript`, `Python`, `C++`, `Rust`.
- Prominent **Difficulty** selector: `Easy`, `Medium`, `Hard`.
- Defaults can be TypeScript + Easy on first launch; remember the last selection afterward.
- Display only exercises matching the chosen combination. Show an understandable empty state if none exist.
- Cards/rows show title, a one-sentence scenario, language, difficulty, changed-file count, and status (`Not Started`, `In Progress`, `Completed`). A completed exercise may show the latest available found/missed counts as neutral learning context; do not compare best attempts or rank performance.
- Provide **Start**, **Continue**, **Retry**, and **View Results** actions as appropriate.
- Submission marks an exercise `Completed`, including when AI assessment is unavailable; a saved draft alone is `In Progress`. Completion means finishing a review, independent of how many issues were found. Use the latest attempt for Continue/View Results and label any counts with the assessment that produced them.
- Use learning-oriented copy such as **Choose what to practice**, **Explore an exercise**, and **Review what you learned**. When the app is next changed, replace its existing challenge-oriented copy; this guide update does not change the current UI.
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

Use actual file-version line numbers, **not** visual diff row indices. Deleted files/lines use `old`; added lines use `new`. Unchanged context files can use `new`. Store the exercise revision/checksum **and complete backend-only snapshots of the public exercise and answer key, including every worked lesson**, when an attempt starts. All attempt views, anchor validation, and reassessment use those snapshots, even if the source cases later change or disappear. A checksum alone does not preserve content. Validate that an anchor refers to real lines in the corresponding snapshot version; an empty file or absent side has no commentable lines. Use the same line-number convention in the viewer and validator for CRLF and trailing newlines.

### 3.3 Learning review / Feedback

- Start with a brief summary such as **You identified 2 of 4 reference issues; 2 are worth revisiting**. Display found/missed counts without a numeric grade, quality rating, penalty, or performance ranking.
- Put **missed issues and their worked lessons first**, followed by found issues and reinforcing lessons. Show each reference issue once, regardless of how many comments mention it. Preserve answer-key order within each group.
- Every reference issue, found or missed, must show its code locations, summary, detailed mechanism, concrete expected-versus-actual failure example, impact, corrected code, why the correction works, common confusions, and guidance for recognizing/preventing similar mistakes. Do not collapse the primary explanation behind a score or verdict.
- For found issues, explain what the learner recognized and clarify incomplete reasoning or misconceptions. A correctly identified issue does not require a polished explanation or a proposed fix; those are opportunities for teaching.
- Provide clear per-finding feedback grouped by the learner's comments, with a matched issue (if any) and `supported`, `unsupported`, or `uncertain` status. Uncertain known findings stay in the missed group with a **Not yet verified** label unless another supported finding identifies that issue; explain that the model's uncertainty is not a definitive judgment of the learner.
- Label extra findings **AI-assessed, outside the reference key**, with `supported`, `unsupported`, or `uncertain` verdicts and explanations. Absence from the key alone is not evidence that a finding is wrong. Extra findings never change reference-issue counts.
- Highlight relevant lines when jumping from a lesson to the diff. Corrected snippets must be clearly distinguished from the original mock commit.
- Show the feedback mode: `AI-assisted` or `Self-review`, plus pending/running/failed assessment state where applicable. Without a successful assessment, show all saved lessons together for self-review and label automatic found/missed counts unavailable. An empty review can show zero found and all reference issues to learn from without inference.
- If local AI cannot be reached, keep the submission and allow **Retry AI feedback** without repeating the review. The saved reference lessons are still available in full.
- Show assessment-run history. A failed reassessment leaves the last successful counts and personalized feedback visible, labeled with the run that produced them. Reference lessons always come from the saved answer key, not from a freshly generated model explanation.

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

### 4.3 Hidden answer-key and worked-lesson schema

Store expected findings and their complete worked lessons **separately** from public exercise data. Codex must author and save both when creating the mock commit; a short mistake label and one-line fix are insufficient. These lessons are the teaching source and must remain useful without Ollama.

In addition to the existing issue fields, require:

| Field | Required content |
| --- | --- |
| `explanation` | A nonempty string explaining the relevant code, violated assumption, and step-by-step failure mechanism. Connect the changed or removed behavior to the defect; explain more than the issue title. |
| `failureExample` | A nonempty string describing a concrete input or scenario, expected behavior, and actual behavior. For concurrency, a failing interleaving or ordering argument is appropriate; do not promise a deterministic ordinary execution. |
| `correctedCode` | A nonempty array of `{ "filePath": string, "code": string }` entries showing corrected snippets in the supplied files. Include enough context to understand the correction; every path must correspond to an exercise file and every snippet must be nonempty. |
| `prevention` | A nonempty string explaining how to recognize the pattern in future reviews and which regression checks would expose it. |

Retain `summary`, `whyItMatters`, `suggestedFix`, `acceptableExplanations`, `keyConcepts`, `commonConfusions`, and issue locations. Use `summary` as the concise overview and `explanation` for the full reasoning. Explain the concrete impact in `whyItMatters` and the fix **and why it works** in `suggestedFix`. Corrected snippets demonstrate that fix; acceptable explanations and common confusions help the model give useful, fair feedback.

Example (using the same abridged public exercise as above):

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
      "explanation": "The endpoint contract allows an authenticated user to delete only their own profile. The authenticated identity and the profile named by request.params.id are separate inputs: being logged in does not establish permission to delete that profile.\n\nBefore the change, assertOwner checked the relationship between request.user and the requested profile before calling the database. After the change, the handler passes the requested profile ID directly to db.profiles.delete without enforcing that relationship. A caller can therefore supply a profile belonging to somebody else, and the database call performs a deletion the endpoint should have rejected. The regression is the removed resource-level authorization check, not missing authentication.",
      "failureExample": "Alice is authenticated and sends a deletion request containing the ID of Bob's profile. Expected: the handler rejects the request before any deletion occurs, and Bob's profile remains intact. Actual after the change: db.profiles.delete receives Bob's profile ID and removes it. The same authenticated Alice should still be permitted to delete her own profile; denying all deletions would not satisfy the contract.",
      "whyItMatters": "An authenticated caller can delete another user's profile, causing unauthorized data loss. Authentication alone does not prevent this because the caller is allowed to log in but is not allowed to delete that resource.",
      "acceptableExplanations": [
        "The endpoint no longer verifies ownership",
        "Users can delete another user's data",
        "Deleting a profile needs a resource-level authorization check"
      ],
      "keyConcepts": ["authorization", "resource ownership", "unauthorized deletion"],
      "commonConfusions": [
        "Authentication establishes who the caller is; authorization determines whether that caller may delete this profile.",
        "Checking ownership after the database deletion would be too late to protect the data."
      ],
      "suggestedFix": "Restore assertOwner before db.profiles.delete. The existing guard checks permission for the requested resource and rejects unauthorized callers before any destructive operation. Keep the authorized owner path working; a blanket rejection would hide the regression without restoring the intended behavior.",
      "correctedCode": [
        {
          "filePath": "src/api/profiles.ts",
          "code": "export function deleteProfile(request) {\n  assertOwner(request.user, request.params.id);\n  return db.profiles.delete(request.params.id);\n}\n"
        }
      ],
      "prevention": "When reviewing a destructive endpoint, trace the authenticated identity and requested resource through all permission checks, including guards removed by the diff. Add regression checks proving that Alice can delete her own profile, cannot delete Bob's profile, and does not trigger a database deletion when ownership validation fails. Review every early return or refactor that could bypass the guard.",
      "reviewHints": "Comments on the removed guard or the deletion call are both valid."
    }
  ]
}
```

**Design considerations**

- One issue may have **multiple acceptable anchor locations** and may span files.
- Every seed answer key must contain at least one issue. Issue IDs must be unique within the key; the exercise ID and revision must agree with the public exercise.
- Every issue must have a complete worked lesson, including when the learner already identified it. Use language-specific reasoning, alternative phrasings, key concepts, common confusions, and clear scope boundaries to support learning and small-model assessment.
- Never ask the small runtime model to generate or replace the authoritative lessons for missed issues. It can explain a learner's match or misconception while the UI displays the authored reference lesson unchanged.
- Some issues are caused by deleting formerly correct code; these must be considered valid findings.
- Do not require exact phrase matches. Recognize equivalent explanations and legitimate alternatives.
- Do not send `answer-key.json` from any public browsing or exercise API endpoint before review submission.
- After submission, show the reference answers only in the results flow. This is not hardened anti-cheat security; it is sensible separation for a single-user trainer.

**Existing starter-case follow-up:** the four Phase 1 answer keys have useful summaries but do not yet satisfy this worked-lesson standard. As the next implementation step, extend the strict shared answer-key schema and CLI validation, then expand **all four starter answer keys together**, adding the required fields and manually reviewing their examples/corrections. Increment each changed case's revision in both `exercise.json` and `answer-key.json`; preserve any existing attempt snapshots. Until that coordinated update, the current validator does not enforce the new fields. This documentation change does not modify app code or seed JSON.

### 4.4 Difficulty guidelines

| Difficulty | Typical scope | Expected reasoning |
| --- | --- | --- |
| **Easy** | 1–2 files, 1–3 planted issues | Direct mistakes (null/None handling, off-by-one, obvious broken conditions, missing checks) |
| **Medium** | 2–5 files, ~2–4 issues | Cross-function effects, edge cases, error handling, security checks, performance regressions |
| **Hard** | Larger multi-file commits, several subtle issues | Cross-file behavior, concurrency/races, transaction boundaries, lifetimes/ownership pitfalls, regressions due to removed behavior |

Difficulty should reflect **reasoning**, not arbitrary line count, and help learners choose the complexity they want to practice. Include realistic correct changes and contextual code; not every altered line should contain a bug. Completing an exercise never requires finding every mistake or earning a particular result.

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

1. Choose language, difficulty, scenario, target issues, and the reasoning each issue should teach.
2. Generate believable **before** and **after** file trees, including unchanged context and a plausible commit description.
3. Write the complete hidden answer key **while authoring the commit**, with locations, acceptable explanations, and a worked lesson for every planted mistake. Save the step-by-step mechanism, concrete expected-versus-actual failure example, impact, corrected code, explanation of why the fix works, common confusions, and prevention/regression guidance. Do not leave lessons for the runtime model to fill in.
4. Validate JSON schemas, duplicate IDs, nonempty answer keys, matching exercise IDs/revisions, file paths, side/line ranges, referenced code, and required lesson fields. Validate corrected-snippet paths and nonempty snippets. Structural validation cannot establish explanation accuracy or teaching quality.
5. Where feasible, run language-specific syntax/type/build tests for the before/after sample projects and check the corrected version in its supplied context; document any intentional failing behavior. Keep this **generation-time only**, not a requirement for the review runtime.
6. Manually review every lesson: verify the claimed mistake against the code and requirements, check the failure example and correction for consistency, explain the fix's mechanism, and ensure a learner who missed the issue can understand it without additional inference. Check for unintended severe mistakes that invalidate the key. Do not substitute minimum word counts or nonempty strings for this author review.
7. Save and commit the mock commit **and all its mistakes/explanations** together so lessons work fully offline. When an existing lesson changes, update the matching exercise/key revisions and leave historical snapshots intact.

Provide a CLI validator such as `npm run validate:cases` that runs without AI or network calls.

---

## 5. Learning feedback: reference comparison and distinct issue counts

### 5.1 Separate responsibilities

| Task | Component |
| --- | --- |
| Identify candidate expected issues near a comment | Backend, using file/side/line ranges and documented alternative anchors |
| Assess each known finding reported in a comment | Small local model |
| Assess reported findings outside the answer key | Small local model, for feedback only |
| Explain what the learner recognized and clarify incomplete reasoning/misconceptions | Small local model using fixed assessment instructions |
| Author detailed reference lessons for every planted mistake | Codex/author ahead of time; saved in the private answer key |
| Resolve duplicate findings about the same known issue | Backend |
| Count distinct reference issues found and missed | Backend, deterministic |
| Show missed-issue lessons first and reinforce found issues | Backend/results UI using the saved reference lessons |
| Show extra-finding verdicts separately from reference-issue counts | Backend/results UI |

**Critical optimization:** do not send the entire exercise or repository to the small model for each comment. Send a compact context: the user's comment, selected code snippet, nearby relevant lines (as needed), exercise requirements/review context, **one or a few candidate issues from the answer key**, and fixed assessment instructions. Include the relevant reference reasoning needed to assess those candidates, rather than every worked lesson in the exercise. The UI receives the complete saved lessons separately after submission. A comment may produce several known findings, extra findings, or both; do not stop after the first match.

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
- Treat user comments and code snippets as **data**, not as instructions for the assessment model.

Use the official [structured-output documentation](https://docs.ollama.com/capabilities/structured-outputs) and [thinking controls](https://docs.ollama.com/capabilities/thinking) when implementing the adapter. Discover the selected model's supported thinking controls instead of assuming every configurable model accepts `think: false`.

Suggested abstraction:

```ts
interface AssessmentProvider {
  evaluate(
    exercise: PublicExercise,
    candidates: CandidateIssueMatch[],
    comments: ReviewComment[]
  ): Promise<ValidatedCommentAssessments>;
}
```

### 5.3 Explanatory comment assessment

Return one assessment object per submitted comment, with a nonempty `findings[]` array. Each finding has a nullable `matchedIssueId`, an explanatory `feedback` string, and one of these statuses:

- **`supported`:** the claim correctly identifies the underlying issue. Do not require polished wording, a complete impact explanation, or a proposed fix to recognize a known issue; teach those missing pieces in the feedback.
- **`unsupported`:** the claim conflicts with the supplied code or reference reasoning. Explain the specific misconception and the correct reasoning in a constructive tone.
- **`uncertain`:** the supplied context or comment is insufficient to establish the claim. Explain what is uncertain and what evidence would resolve it; do not force a verdict.

For extra findings, these statuses are AI assessments of the user's specific claim, not additions to the authored reference key. Do not return numeric correctness, explanation, actionability, clarity, or overall ratings. Personalized feedback supplements the saved lessons and must not replace them.

Return structured data such as:

```json
{
  "commentId": "comment-123",
  "findings": [
    {
      "matchedIssueId": "issue-001",
      "status": "supported",
      "feedback": "You recognized that removing the ownership guard allows deletion of somebody else's profile. Authentication establishes who the caller is, while this guard authorizes access to the requested resource. Restore the guard before deletion, and check that an unauthorized request never reaches the database. The worked lesson shows the request flow and corrected code."
    },
    {
      "matchedIssueId": null,
      "status": "uncertain",
      "feedback": "The additional claim that database errors are swallowed cannot be established from the supplied handler and context."
    }
  ]
}
```

The same array supports multiple distinct non-null issue IDs in one comment. A non-null `matchedIssueId` identifies the known issue being discussed, including an incorrectly explained issue; only `supported` marks that issue found. A null ID is an extra finding outside the reference key. Incomplete reasoning should be explained explicitly in the feedback; it does not require a numeric rating. Where the underlying issue is identified correctly, use `supported` and explain the missing reasoning; where the claim cannot be established, use `uncertain`.

The backend must validate that the response covers every supplied `commentId` exactly once, with no unknown or duplicate comment IDs. Validate every finding's non-null issue ID against the candidates supplied for that comment, require an allowed status and nonempty feedback, and reject unknown fields, including legacy numeric ratings. Reject malformed or incomplete output; never silently skip an omitted comment or invent a verdict for a failed assessment. If a comment makes no concrete claim, return an unmatched `uncertain` assessment explaining that rather than inventing a finding. **Do not force a match.**

### 5.4 Found/missed counts and lesson grouping

Compute counts in the backend from validated **known findings only**:

- Let `foundIssueIds` be the set of non-null matched issue IDs with at least one `supported` finding. Count each reference issue once, even when several comments mention it. An issue with both supported and unsupported/uncertain findings is found; retain the individual feedback for learning.
- `foundCount = foundIssueIds.size`. `missedCount = referenceIssueCount - foundCount`. Missed issues are the reference issues outside that set. Seed keys must contain at least one issue, and matched IDs must belong to the supplied candidates/key.
- Unsupported or uncertain known findings do not mark an issue found. Keep uncertain findings clearly labeled **Not yet verified** when displaying the corresponding missed lesson, rather than asserting the learner's reasoning is definitively wrong.
- Extra findings (`matchedIssueId: null`) do not change either count, regardless of their status. After a successful assessment of comments containing only extra findings, zero reference issues are found and all reference issues are available to revisit.
- **An empty review needs no inference:** record a successful reference-only assessment with zero found, all reference issues missed, and no fabricated comment assessments. The learner can immediately study all the lessons, even without Ollama.
- For a nonempty review without a complete successful assessment, automatic counts are unavailable. Do not report every issue as missed simply because the model is unavailable or output validation failed. Earlier successful counts may remain visible with their run label.

Show missed lessons first, then found lessons, retaining author-defined order inside each group. Both groups use the same complete stored lesson content; a found issue still deserves an explanation. Do not calculate a total grade, weighted formula, quality/precision penalty, best attempt, or percentage performance indicator.

Unit-test distinct counting, duplicates, conflicting statuses for one issue, incomplete reasoning, uncertain findings, no supported matches, multi-issue comments, mixed known/extra findings, different issue counts, empty reviews, and unavailable assessments. Persist the found/missed summary, model identity, and prompt/assessment versions with each assessment run. Identical validated assessments produce identical counts; a new model assessment may differ.

### 5.5 Unavailable model / fallback behavior

If Ollama is stopped, the configured model is not installed, or assessment fails:

1. **Save the submitted review** without data loss.
2. Clearly say that **AI feedback is unavailable** and, for a nonempty review with no successful run, automatic found/missed counts are unavailable.
3. Offer **Retry AI feedback** later.
4. Offer **Reveal lessons & self-review** immediately, showing all authored explanations, failure examples, corrected code, and prevention guidance without inference.
5. Do **not** invent verdicts or counts. If reassessment fails, retain the previous successful counts and feedback with their assessment-run label. Empty reviews can use the deterministic counts defined above.

Do not publish completed automatic counts if any submitted comment cannot be assessed successfully. Record the failed run and keep the immutable submission and full reference lessons available for self-review and reassessment. Teaching from the authored lessons must never be blocked by unavailable inference.

For a fully offline machine with a small model installed, the normal flow should work without an internet connection after initial software/model installation.

### 5.6 Follow-up: calibrate the small assessor

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

Run these fixtures against the configured small model (an optional local integration test); report agreement rates and representative disagreements. Keep deterministic application tests independent of Ollama so the test suite can run without a model. Use mocked structured assessments to verify schemas, distinct issue counts, and failure handling before the benchmark exists. Local-model matching and verdicts, particularly for extra findings, may be inaccurate; label them as AI assessments and retain the authored reference lessons as the teaching source.

---

## 6. Persistence and backend routes

### Database records

At minimum:

- `attempts`: attempt ID, exercise ID and revision/checksum, backend-only public exercise and answer-key snapshots, attempt state (`draft | submitted`), and started/submitted timestamps.
- `review_comments`: attempt ID, comment ID, path, side, start/end lines, body.
- `assessment_runs`: run ID, attempt ID, status (`pending | running | succeeded | failed`), feedback mode (`AI-assisted | Self-review`), model name and digest/version when inference was used, prompt/assessment versions, started/completed timestamps, nullable found/missed summary, and optional error. Do not add grade, numeric rubric, or weighted-score fields.
- `comment_assessments`: assessment-run ID, comment ID, and the validated `findings[]` data, including nullable matched issue IDs, explanatory feedback, and statuses. Store one assessment per comment per run.

Keep the SQLite file in a gitignored local data directory. Snapshots include the full worked lessons, are stored when an attempt starts, and are never replaced; the frontend receives only the public snapshot until submission. Continuing a draft, displaying lessons/results, validating anchors, and reassessment must work if the original case directory has been edited or removed. New attempts use the current validated case content.

### Attempt lifecycle and assessment history

- Attempts move only from `draft` to `submitted`. Comments can be saved only while the attempt is a draft; enforce immutability in the backend, not only in the UI. Submission marks the exercise completed regardless of assessor availability or found/missed counts. Derive `Not Started`, `In Progress`, and `Completed` from saved attempts, giving completed status precedence when any submitted attempt exists.
- The client waits for all current draft saves before submitting. The backend transactionally marks the attempt submitted and creates its first pending assessment run before making any Ollama request. Repeated submission returns the existing submission and must not create another job. A late comment update after submission is rejected without altering stored comments. Reference lessons become accessible as soon as the review is submitted, even while assessment is pending.
- Run inference outside SQLite transactions. Persist validated assessments, found/missed summary, and successful run status together only after every comment has a valid assessment. A zero-comment submission succeeds with zero found and all reference issues missed without an inference request; record `Self-review` mode and do not fabricate comment assessments or model usage.
- If Ollama is unavailable or a request fails, mark the run failed with an actionable error and leave the submitted review intact. On backend restart, mark interrupted pending/running runs failed with an interruption reason so the user can retry explicitly; do not leave them permanently running.
- **Retry exercise** creates a new draft attempt and preserves older attempts. **Retry AI feedback** creates a new assessment run for the same immutable submission, using its saved snapshots. Transactionally permit at most one pending/running run per attempt; repeated requests while it is active return that run rather than starting duplicate work.
- Preserve every assessment run and its feedback. Results show the latest successful run plus the latest run's state/error when different. Failed reassessment must not erase or replace earlier successful counts or feedback. A nonempty attempt with no successful run has unavailable automatic counts and remains available with all its saved lessons for self-review.
- Expose assessment history through the attempt results payload so learners can revisit explanations. If library cards show counts, use the latest successful assessment of the latest attempt and label unavailable feedback clearly when that attempt has none; do not select or display a best-performing attempt.

### Suggested HTTP API

| Endpoint | Behavior |
| --- | --- |
| `GET /api/languages` | Returns the four supported languages and labels |
| `GET /api/cases?language=rust&difficulty=hard` | Lists public cases matching **both** filters |
| `GET /api/cases/:id` | Returns public exercise (never the hidden key) |
| `POST /api/attempts` | Creates a new draft attempt for a case, saving its public/private snapshots; used by Start/Retry |
| `PUT /api/attempts/:id/comments` | Saves/updates draft comments after validating anchors against the snapshot; rejects submitted attempts |
| `POST /api/attempts/:id/submit` | Transactionally locks the draft and creates one assessment run; returns the existing submission on repeated requests |
| `POST /api/attempts/:id/regrade` | Retries AI feedback for a submitted attempt by creating a new assessment run, or returns its already pending/running run |
| `GET /api/attempts` | Returns attempt summaries for progress/history |
| `GET /api/attempts/:id` | Returns the public snapshot and draft comments for Continue, or immutable comments, complete reference lessons, assessment history, found/missed counts when available, and per-comment `findings[]` feedback after submission |
| `GET /api/system/grader` | Reports local Ollama/model availability and configuration for AI feedback |

Keep the existing planned HTTP route paths, including `/regrade` and `/api/system/grader`, as technical names; the product action is **Retry AI feedback**, and payloads contain explanations and issue counts rather than grades. Reference findings and worked lessons should be returned **only for submitted attempts** through a results-specific payload, without waiting for successful inference. Validate filters, IDs, and comment anchors; do not expose arbitrary filesystem paths or raw answer-key endpoints.

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
        components/       # selectors, diff viewer, comment editor, worked lessons
    server/
      src/
        routes/
        services/         # case loader, matching, assessment, issue counts
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

Provide straightforward commands for install, development, case validation, testing, and local production start. Use a one-command development workflow if practical. Document that Ollama itself and the chosen local model must be installed separately for AI-assisted matching/personalized feedback, and that this initial setup may require an internet download. All authored lessons remain available after submission without Ollama. Include the model name setting, loopback endpoint, and `OLLAMA_TIMEOUT_MS` (default `120000`) in `.env.example` and the README.

---

## 8. Implementation order

### Phase 1 — Foundation and language/difficulty library

- Initialize React/Vite + Express/TypeScript, shared schemas, and local SQLite.
- Implement strict exercise and answer-key validation, including nonempty keys and matching exercise IDs/revisions.
- Build the **language + difficulty selection** interface with all 12 combinations.
- Implement public case loading/filtering; ensure no answer-key leakage.
- Add a small set of manually checked starter exercises to exercise the UI.

**Done when:** the user can select any of the four languages and any difficulty and see the correctly filtered library or a helpful empty state.

**Status:** implemented with four starter cases validated against the original schema, public exercise previews, and all 12 filter combinations. The new worked-lesson fields and expanded starter explanations are not implemented yet; complete that coordinated schema/key update next as specified in Section 4.3. See `README.md` for run/check commands. Review commenting and AI assessment remain in Phases 2–3; complete 12-case coverage remains in Phase 4.

### Phase 2 — GitHub-style code review

- First extend the shared answer-key schema/validator and expand all four starter keys to the worked-lesson standard, updating matching exercise/key revisions together. Update challenge-oriented UI copy to learning-oriented language when changing the app.
- Build the file sidebar and unified diffs with `react-diff-view`, then optional split view. Prove old/new/context range selection, inline editing, and collapsed-section expansion in the first vertical slice before advanced polish.
- Support old/deleted code, new/added code, unchanged context, full-file expansion, and per-language highlighting.
- Implement stable line/range anchoring for old/new sides and inline draft comments.
- Persist drafts and their public/private exercise snapshots; support editing/deleting comments, serialized saves, and visible save errors.

**Done when:** a reviewer can annotate added, deleted, and unchanged code across several files, switch views, reload, and retain accurate anchors.

### Phase 3 — Offline assessment and learning feedback

- Implement deterministic issue candidate matching.
- Implement Ollama adapter with configurable small Qwen model and structured-output validation.
- Implement per-comment `findings[]`, multi-issue status/explanation assessment, distinct found/missed counts, duplicate prevention, and separate AI feedback on extra findings. Do not implement numeric grades or quality/precision penalties.
- Build the learning review with a brief counts summary, **missed-issue worked lessons first**, and complete reinforcing lessons for found issues. Make full stored lessons accessible without the model; show automatic counts as unavailable when nonempty reviews have no successful assessment.
- Transactionally lock submissions, save assessment history, prevent duplicate jobs, and make interrupted assessment retryable without losing earlier feedback or changing lesson snapshots.

**Done when:** a learner can understand the causes, consequences, corrections, and prevention of every reference mistake, especially those missed. Multiple known findings in one comment count correctly, extra findings receive separate feedback, and missing/interrupted AI assessment preserves submissions, prior feedback, and access to all saved lessons.

### Phase 4 — Complete language/difficulty exercise coverage

- Populate **all 12 initial combinations** with at least one credible exercise each.
- Add a case generation/validation authoring guide for Codex.
- Include language-specific bug patterns, removed-behavior regressions, and unchanged contextual files.
- Validate issue locations and worked-lesson fields; manually check explanation accuracy, concrete failure examples, corrected-code consistency, and prevention guidance for every issue.

**Done when:** TypeScript, Python, C++, and Rust each have Easy, Medium, and Hard reviewable cases, with a complete authored worked lesson for every planted mistake.

### Phase 5 — Testing and polish

- Test public/private data isolation, case/lesson validation, all language/difficulty filters, stable line anchors (including empty files, CRLF, and trailing newlines), distinct found/missed counts, duplicate suppression, multi-finding status/feedback validation, and assessor failures.
- Run UI end-to-end tests for commenting on old/new/context lines, submitting, showing missed lessons before found lessons, reading full explanations and corrected code for both groups, and retrying AI feedback. Verify offline lesson access and completion independent of found counts.
- Test save failures, repeated submission/reassessment requests, interrupted assessment, and failed reassessment preserving earlier successful feedback/counts. Edit/remove source cases and verify historical views and reassessment still use the saved lesson snapshots.
- Keep model-accuracy benchmarking and the 30+ manually labeled fixtures as post-MVP follow-up work, not release gates.
- Improve accessibility, loading and error states, long code files, and README instructions.

---

## 9. MVP acceptance criteria

The MVP is complete only when **all** of the following are true:

1. Runs on loopback with validated local request origins and bundled assets, without login, cloud services, subscriptions, or paid APIs.
2. Offers **TypeScript, Python, C++, and Rust**, and **Easy, Medium, Hard** selection on the main screen.
3. Filters exercises by **both** selected language and difficulty.
4. Contains **at least 12 working exercises**—one for each language/difficulty combination—with a complete prewritten worked lesson for every planted mistake.
5. Shows a GitHub-like file diff with clear additions, deletions, and unchanged context.
6. Supports viewing the old version and commenting on deleted/old-side code.
7. Supports line and multi-line comments on added, modified, and unchanged context code.
8. Draft comments persist while navigating files and across application reloads; save failures are visible and prevent submitting unsaved edits.
9. Submitting a review compares comments with **prewritten hidden answers** rather than asking the small model to find bugs unaided.
10. Uses Ollama locally with a configurable small Qwen model, validates status-based explanatory output, and computes distinct found/missed counts on the backend. Does not calculate numeric grades, weighted formulas, penalties, or best-score comparisons.
11. Leads feedback with a brief found/missed summary, then missed issues and their worked explanations, followed by found issues and reinforcing lessons. Every lesson includes mechanism, failure example, impact, corrected code, explanation of the fix, common confusions, and prevention guidance. Multiple findings per comment work; extra findings receive labeled AI verdicts without changing reference-issue counts.
12. Preserves immutable submissions, exercise/key/lesson snapshots, and assessment history across restarts; historical views and reassessment use the original saved content after source cases change or disappear. A fresh model assessment may differ from an earlier run.
13. Handles missing/stopped Ollama, timeouts, invalid/incomplete output, and interrupted assessment without losing submissions or inventing verdicts/counts; a failed reassessment preserves the last successful feedback. All authored lessons remain readable without inference, including when automatic counts are unavailable.
14. Never returns hidden answer keys from pre-submission/public exercise endpoints.
15. Has automated tests for critical data boundaries, required lesson fields, comment anchors, language/difficulty filtering, status/feedback validation, and distinct issue counts, including multi-issue comments, duplicates, incomplete reasoning, uncertain findings, empty reviews, and extra findings having no count effect. Tests verify full lesson display for found/missed issues and offline lesson access.
16. Includes clear installation, model-setup, and usage instructions.
17. Prevents duplicate jobs from repeated submission or reassessment requests and enforces submitted-comment immutability in the backend.
18. Treats submission as completion regardless of issues found, uses learning-oriented product language, and has author-reviewed lessons whose explanations, failure examples, and corrected code agree with the exercise context. Structural validation alone is not sufficient quality control.

Model accuracy agreement rates and the 30-example benchmark are follow-up work; the MVP requires validated assessments and correct deterministic behavior, not a benchmark threshold.

---

## 10. Explicitly out of scope

- Accounts, sign-in, teams, shared reviews, online leaderboards, competitive rankings, numeric grades, or score-based comparisons.
- Hosted/cloud AI graders, paid inference APIs, automatic billing, or required API keys.
- Dynamic AI exercise generation during a review session.
- GitHub account integration, real pull request imports, repository synchronization, or deployments.
- Running arbitrary code submitted by users in a server sandbox.
- Mobile-native apps, achievements, badges, or detailed analytics dashboards.
- Robust anti-cheat protection; this is a personal learning tool.
- MVP extras: text/status search filters, new hint systems, heuristic assessments, and automatic answer-key amendments.

---

## 11. Direct instructions to Codex

**Implement the application described above; do not only produce a plan.** Work incrementally, prioritizing a solid review interface, trustworthy reference comparison, and clear teaching explanations, especially for missed issues. The learning experience is the primary outcome.

1. Keep language and difficulty foundational. Next extend the strict shared answer-key schema/validator and upgrade all four existing starter keys together to the worked-lesson standard, updating matching exercise/key revisions. Their current short summaries are not sufficient under this guide.
2. Implement a working vertical slice with **one case**, from library selection through `react-diff-view` range selection/expansion/inline editing to submitted feedback; then extend to the other languages and difficulties.
3. Maintain strict separation of public exercise data, private reference lessons/snapshots, AI semantic assessment, and backend found/missed counting. Use per-comment `findings[]` with status and explanations; extra findings receive separate AI feedback and do not change reference counts. Do not implement numeric grades or competitive comparisons.
4. Keep the runtime **fully local**. Ollama is optional for basic use but required for AI-assisted assessment. Do not add cloud-service dependencies.
5. Ensure comments can reference **old, new, and unchanged context lines** correctly; write tests for this before adding advanced UI polish.
6. For every mock commit, **save each planted mistake and its full worked explanation during authoring**: code mechanism, violated assumption, concrete expected/actual example, impact, corrected code, why the fix works, and prevention/regression guidance. Deliver this quality-controlled content in every language/difficulty combination. Review lesson accuracy manually; do not rely on a small runtime model to fill gaps.
7. Put missed lessons first and fully explain found issues too. Add useful save/assessment errors and fallback flows. Transactionally lock submissions, preserve assessment history, prevent duplicate jobs, retain prior successful feedback after failed reassessment, and always allow submitted reviews to access their stored lessons without AI.
8. Provide a complete `README.md` with exact setup/run/test commands, case-authoring instructions, Ollama installation/configuration, and how to switch local models.
9. Run deterministic tests and validate the seed cases before declaring the implementation complete; report any remaining limitations. Defer model-accuracy calibration until after the first working version.

**Success criterion:** the app is a self-contained, free, local learning tool with a realistic pull request review experience. After a review, the learner understands the mistakes they found and, especially, the ones they missed: what failed, why it mattered, how to fix it, and how to recognize or prevent similar problems next time.
