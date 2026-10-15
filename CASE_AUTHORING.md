# Authoring review lessons

Use this alongside [the project guide](CODE_REVIEW_TRAINER_CODEX_GUIDE.md#4-exercises-and-their-answer-keys) when asking Codex to create or revise a case. Cases are authored ahead of time; the running app does not generate lessons or execute exercise code.

## Write the change and its lessons together

1. Choose a language, difficulty, realistic change, and the reasoning it should teach. Read the existing catalog below to avoid repeating a generic bug in another syntax. Easy cases should make a direct concept approachable; Medium adds interactions and error paths; Hard requires tracing state, ownership, or concurrency across boundaries. Difficulty follows reasoning, not a required line count or number of findings.
2. Write down the behavioral contract first. State meaningful edge cases, ownership, error/cancellation behavior, and any assumptions needed to make the example coherent. Put requirements in public `reviewContext`, without naming the planted mistakes. Include enough unchanged code to establish the contracts used by the modified files.
3. Create `data/cases/<language>/<difficulty>/<id>/exercise.json` and `answer-key.json`. Start a new exercise at revision 1. Keep IDs stable and bump **both** revisions for later content changes, including requirement clarifications. Never replace stored attempt snapshots. The TypeScript notification case reached revision 2 while clarifying its success-versus-failure completion contract.
4. Supply complete before/after files and accurate added/modified/deleted/unchanged statuses. Keep imports, declarations, types and callers consistent in each version. Include plausible correct changes as well as mistakes. A removed guard or cleanup step is a valid planted mistake; preserve its old-side anchor.
5. Save a full reference lesson for every planted mistake in the same commit as the mock change. Do not leave explanations for Ollama to invent. Each issue needs its title, category, severity, locations, summary, detailed `explanation`, `failureExample`, impact (`whyItMatters`), fix and why it works (`suggestedFix`), `correctedCode`, `prevention`, acceptable explanations, key concepts and common confusions.
6. Explain the violated assumption and trace the failure step by step. Give a concrete input or controlled interleaving with expected versus actual behavior. Distinguish independent mistakes from several consequences of one mistake. Do not inflate the issue count by splitting one defect's symptoms. Recognition of the underlying defect is sufficient; learners need not provide a polished explanation or fix.
7. Locate each issue on a meaningful changed or removed line. Add explicit alternative locations when a comment on a caller, related file or other side is reasonable. Anchors use one-based source-version coordinates, not diff row numbers. Matching allows five-line proximity on the same file/side; it does not infer arbitrary cross-file relationships.
8. For this catalog, corrected snippets are complete replacement files so the authoring checker can assemble and compile an integrated correction. If several lessons replace the same file, provide the **same combined correction** in each lesson and explain the particular change relevant to that issue. Keep useful benign changes. Do not silently treat incompatible snippets as a complete fix.
9. Review all issues by hand against the actual files. Verify requirements, failure paths, the proposed corrections, old/new anchors, and what regression checks would expose each mistake. Check for unintended severe defects that would invalidate the lesson. Nonempty strings, word counts, compilation and a model verdict cannot establish teaching quality.
10. Run the checks below, update the catalog/review record when needed, and commit the exercise, answer key, and behavior fixture together. Commit in small groups. Do not change grading or add hints, model benchmarks, generators, or application features just to author a case.

For undefined behavior, explain the violated lifetime/container/mutex precondition rather than promising a crash or particular output. For weak memory or concurrency, describe a permitted failing observation/interleaving rather than promising that a stress test will reproduce it. The saved lesson must explain the argument without a model or special hardware.

## Validation and examples

```powershell
npm.cmd run validate:cases
npm.cmd test
npm.cmd run check:examples
npm.cmd run build
npm.cmd run test:e2e
```

`validate:cases` is structural and never executes sample code: it validates JSON, matching identity/revisions, unique IDs/paths, nonempty lessons/keys, real old/new ranges, and correction paths. Unit/API tests enforce at least one exercise in each of the 12 combinations, usable diff anchors, public/private isolation, and lesson access without AI. Browser tests open every seeded case, attach/cancel a draft note on a reference location, and check that every complete lesson and corrected file appears after submission.

`check:examples` is an **explicit authoring command for trusted repository content**, separate from application runtime and the ordinary test suite. It creates temporary copies of before/after/corrected versions, omits files absent from a version, and overlays the integrated corrected files. Temporary files are removed afterward; source cases and progress data are not changed. The command uses installed tools and downloads nothing:

- TypeScript: the repository compiler, strict checks, and CommonJS output for fixture execution.
- Python: `python` or `python3`, Python 3.11+, syntax checks and isolated fixture processes.
- C++: `cl` from a Visual Studio developer shell, or `g++`/`clang++` on PATH, using C++17. On Windows, launch **Developer PowerShell for VS** or **x64 Native Tools Command Prompt** before running the command so the compiler can find its headers and libraries.
- Rust: `rustc` and its platform linker, edition 2021. Flat `src/*.rs` examples get a temporary module entry; a supplied `src/lib.rs` is used when present.

Missing language tools are reported as `SKIPPED`; that is not verification for that language. Use a suitable development environment and rerun before claiming all examples were checked. Each compiler/fixture invocation has a 20-second timeout. The checks need no database server, Ollama, model download, network service or external language packages.

Behavior fixtures live at `tests/examples/<exercise-id>.cjs`, `.py`, `.cpp`, or `.rs`. Add one when introducing a case. They receive the materialized directory (compiled directory for TypeScript) and `before | after | corrected`; Rust/C++ receive the version as their first argument. Assert the intended behavior in before/corrected and the specific documented regressions in after. Cover independent issues separately so one failure cannot conceal another. Use gates/events for async ordering rather than sleep-based assumptions, and retain useful empty/valid/boundary cases.

Unsafe after-version C++ paths are compiled and reasoned about, not executed as ordinary regression assertions. Safe symptoms can still be tested independently. The notification fixture explicitly observes the known discarded rejection rather than depending on Node's fatal unhandled-rejection policy. Existing starter cases have source checks and reviewed reasoning; the eight added cases have executable behavior fixtures. Adding fixtures for the older starters is optional follow-up.

## Catalog and author review record

Phase 4 author review checked the stated mechanism, expected/actual example, correction, anchors and prevention guidance for all 22 reference issues below. The four original starter cases remain unchanged at revision 2. Every case includes unchanged context; the library contains removed-behavior regressions as well as newly introduced code mistakes.

| Exercise | Reference reasoning reviewed | Verification evidence and limits |
| --- | --- | --- |
| `ts-easy-001` | Ceiling versus floor for partial pages; follow the navigation caller. | Three source versions type-check; arithmetic and preserved validation reviewed. |
| `ts-medium-001` | Async `forEach` discards callback promises; the preference guard was removed. | Gates verify premature completion; a rejection observer checks lost failure propagation; a mixed-recipient fixture verifies the opt-out regression. |
| `ts-hard-001` | Tenant identity is missing from the key; rejected promises stay cached; offer mutations alias the cached object. | Separate fixtures cover tenant overlap, failure/recovery and caller isolation, while preserving same-tenant request coalescing. |
| `py-easy-001` | A mutable default is evaluated once and aliases later results. | Multiple calls check contents and identity; explicit empty-list mutation remains intentional. |
| `py-medium-001` | Counting exhausts the iterator; returning an empty list hides a connection error. | Three versions parse; iterator and exception paths reviewed against the Source contract and combined correction. |
| `py-hard-001` | `gather` leaves siblings running on ordinary failure; clearing current data loses the fallback; cleanup consumes failure/cancellation. | Event-gated writer failure verifies cleanup ordering and preserved data; separate cancellation and success fixtures verify outcomes. |
| `cpp-easy-001` | Capacity is not size; indexed writes require constructed elements. | Three versions compile; the after-version out-of-bounds write is not executed. |
| `cpp-medium-001` | `string_view` outlives its local owner; `map::operator[]` inserts on a miss. | Header/implementation/caller versions compile together; safe membership/insertion tests reproduce mutation. Dangling-view reads are deliberately avoided; ownership is reviewed directly. |
| `cpp-hard-001` | Waits must recheck the predicate; shutdown must drain accepted jobs; callbacks must run outside the mutex. | Safe fixtures cover closed-queue draining and push rejection. Before/corrected re-entrant callbacks complete. Spurious-wakeup UB and after-version recursive locking are explained, not forced. |
| `rust-easy-001` | `Some(0)` differs from absence; filtering replaces a valid disabling value. | A caller-level table checks None, zero, one and the supported upper bound. |
| `rust-medium-001` | `zip` truncates mismatches; `Result::ok` drops parse failures before ledger mutation. | Both mismatch directions, invalid/zero/all-invalid amounts, empty batches and ordered valid receipts are tested; the ledger stays unchanged on corrected failures. |
| `rust-hard-001` | A Relaxed flag store does not pair with Acquire to publish another value. | Three versions compile; the Release/Acquire argument is reviewed under the single-producer, single-publication contract. Ordinary execution is not a weak-memory proof. |

The Phase 4 verification run checked **36 source versions** with TypeScript, Python, MSVC and Rust, plus **24 behavior-fixture runs** for the eight new cases. Those counts describe builds/runs, not model agreement or proof of every possible execution. No model-accuracy benchmark was run.

Useful primary references for reviewing these lessons include Python's [default argument semantics](https://docs.python.org/3/tutorial/controlflow.html#default-argument-values) and [task supervision](https://docs.python.org/3/library/asyncio-task.html#task-groups), the C++ working draft's [map access](https://eel.is/c++draft/map.access), [string views](https://eel.is/c++draft/string.view.template), [condition variables](https://eel.is/c++draft/thread.condition.condvar) and [mutex requirements](https://eel.is/c++draft/thread.mutex.requirements.mutex), and Rust's [zip](https://doc.rust-lang.org/std/iter/trait.Iterator.html#method.zip), [Result::ok](https://doc.rust-lang.org/std/result/enum.Result.html#method.ok) and [atomic ordering](https://doc.rust-lang.org/std/sync/atomic/enum.Ordering.html) documentation. Verify relevant semantics when expanding a lesson; never copy prose as a substitute for explaining the supplied code.
