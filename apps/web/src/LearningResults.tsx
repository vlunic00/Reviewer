import { useEffect, useRef, useState } from 'react';
import {
  attemptSchema,
  graderStatusSchema,
  type AssessmentRun,
  type ReviewAttempt,
  type ReviewCommentAnchor,
} from '../../../packages/shared/src/index.js';
import { fetchJson } from './api.js';
import { FileDiff } from './FileDiff.js';
import './results.css';

const verdict = {
  supported: 'Supported',
  unsupported: 'Unsupported',
  uncertain: 'Not yet verified',
};
const time = (value: string) => new Date(value).toLocaleString();

export function LearningResults({
  attempt,
  onBack,
  onUpdate,
}: {
  attempt: ReviewAttempt;
  onBack: () => void;
  onUpdate: (attempt: ReviewAttempt) => void;
}) {
  const { lessons, runs } = attempt.results!;
  const latest = runs[0];
  const [selectedId, setSelectedId] = useState<string>();
  const successful = runs.filter((run) => run.status === 'succeeded');
  const selected =
    successful.find((run) => run.id === selectedId) ?? successful[0];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [setup, setSetup] =
    useState<ReturnType<typeof graderStatusSchema.parse>>();
  const [checking, setChecking] = useState(false);
  const [anchor, setAnchor] = useState<ReviewCommentAnchor>();
  const inspector = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const active = latest?.status === 'pending' || latest?.status === 'running';
  const found = new Set(selected?.summary?.foundIssueIds);
  const feedback =
    selected?.assessments.flatMap((entry) =>
      entry.findings.map((finding) => ({
        ...finding,
        comment: attempt.comments.find(
          (comment) => comment.id === entry.commentId,
        )!,
      })),
    ) ?? [];

  useEffect(() => {
    if (!anchor) return;
    const target = inspector.current?.querySelector<HTMLElement>(
      '.diff-code-selected',
    );
    if (target) {
      target.tabIndex = -1;
      target.focus();
      target.scrollIntoView({ block: 'center' });
    }
  }, [anchor]);
  function inspect(location: ReviewCommentAnchor) {
    opener.current = document.activeElement as HTMLElement;
    setAnchor(location);
  }
  async function retry() {
    if (busy || active) return;
    setBusy(true);
    setError(undefined);
    try {
      onUpdate(
        attemptSchema.parse(
          await fetchJson(`/api/attempts/${attempt.id}/regrade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          }),
        ),
      );
      setSelectedId(undefined);
    } catch {
      setError(
        'AI feedback could not be requested. Your submission, previous feedback, and lessons are saved. Retry when the server is available.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function checkSetup() {
    setChecking(true);
    setError(undefined);
    try {
      setSetup(graderStatusSchema.parse(await fetchJson('/api/system/grader')));
    } catch {
      setError(
        'The local AI setup could not be checked. Check that the application server is running.',
      );
    } finally {
      setChecking(false);
    }
  }
  const locationButton = (location: ReviewCommentAnchor, index = 0) => (
    <button
      key={index}
      className="location-button"
      onClick={() => inspect(location)}
    >
      {location.filePath} · {location.side === 'old' ? 'Original' : 'Updated'}{' '}
      lines {location.startLine}–{location.endLine}
    </button>
  );

  if (anchor) {
    const file = attempt.exercise.files.find(
      (file) => file.path === anchor.filePath,
    )!;
    return (
      <main className="review-workspace" id="review" tabIndex={-1}>
        <button
          className="secondary-button"
          onClick={() => {
            setAnchor(undefined);
            requestAnimationFrame(() => opener.current?.focus());
          }}
        >
          ← Back to lessons
        </button>
        <h1>Code from your saved review</h1>
        <p className="submission-help">
          {anchor.side === 'old' ? 'Original' : 'Updated'} lines{' '}
          {anchor.startLine}–{anchor.endLine} are highlighted. Submitted
          comments are read-only.
        </p>
        <div ref={inspector} key={JSON.stringify(anchor)}>
          <FileDiff
            file={file}
            patch={attempt.diffs[file.path]}
            comments={attempt.comments.filter(
              (comment) => comment.anchor.filePath === file.path,
            )}
            selection={anchor}
            readOnly
            editing={false}
            onSelect={() => {}}
            onEdit={() => {}}
            onDelete={() => {}}
          />
        </div>
      </main>
    );
  }

  const groups = selected?.summary
    ? [
        {
          title: 'Missed issues',
          issues: lessons.filter((lesson) => !found.has(lesson.id)),
        },
        {
          title: 'Found issues',
          issues: lessons.filter((lesson) => found.has(lesson.id)),
        },
      ]
    : [{ title: 'Reference lessons for self-review', issues: lessons }];

  function runLabel(run: AssessmentRun) {
    return `${time(run.createdAt)} · ${run.model ?? run.mode} · ${run.id.slice(0, 8)}`;
  }
  return (
    <main
      className="review-workspace learning-results"
      id="review"
      tabIndex={-1}
    >
      <button className="secondary-button" onClick={onBack}>
        ← Back to library
      </button>
      <header className="learning-heading">
        <span className="eyebrow">REVIEW COMPLETE · KEEP LEARNING</span>
        <h1>{attempt.exercise.title}</h1>
        {selected?.summary ? (
          <p className="issue-summary">
            <strong>
              {selected.summary.foundCount} found ·{' '}
              {selected.summary.missedCount} missed
            </strong>{' '}
            of {lessons.length} reference{' '}
            {lessons.length === 1 ? 'issue' : 'issues'}.
            {selected.mode === 'Self-review'
              ? ' You can study every lesson below.'
              : ' Counts use AI matching; the authored lessons explain the reference mistakes.'}
          </p>
        ) : (
          <p className="issue-summary">
            <strong>Automatic found/missed counts unavailable.</strong> Your
            review is saved. All authored lessons are ready for self-review.
          </p>
        )}
        {selected && (
          <p className="run-caption">
            Showing{' '}
            {selected.mode === 'Self-review'
              ? 'reference-only results'
              : 'AI feedback'}
            : {runLabel(selected)}
          </p>
        )}
      </header>
      <section className="feedback-status" aria-label="AI feedback status">
        {active && (
          <p role="status">
            AI feedback is {latest.status === 'pending' ? 'queued' : 'running'}…
            You can read the stored lessons now.
          </p>
        )}
        {latest?.status === 'failed' && (
          <p role="alert">
            <strong>AI feedback unavailable.</strong> {latest.error}
            {selected &&
              ' Your earlier successful feedback remains available below.'}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="results-actions">
          <a className="secondary-button" href="#reference-lessons">
            Reveal lessons &amp; self-review
          </a>
          {attempt.comments.length > 0 && (
            <button
              className="primary-button"
              disabled={busy || active}
              onClick={() => void retry()}
            >
              {busy ? 'Requesting feedback…' : 'Retry AI feedback'}
            </button>
          )}
          <button
            className="secondary-button"
            disabled={checking}
            onClick={() => void checkSetup()}
          >
            {checking ? 'Checking…' : 'Check local AI setup'}
          </button>
        </div>
        {setup && (
          <div className="ai-setup">
            <p>
              <strong>
                {setup.available
                  ? 'Local AI is ready.'
                  : 'Local AI is unavailable.'}
              </strong>{' '}
              {setup.error}
            </p>
            <p>
              Model: <code>{setup.model}</code> · Endpoint:{' '}
              <code>{setup.url}</code> · Request timeout:{' '}
              {setup.timeoutMs / 1000}s.
            </p>
            <p>
              Install Ollama separately and start it. If needed, install the
              chosen local model with <code>ollama pull {setup.model}</code>. To
              change it, edit <code>OLLAMA_MODEL</code> in <code>.env</code> and
              restart the app. Downloads are optional; lessons work without
              them.
            </p>
          </div>
        )}
        {successful.length > 1 && (
          <label className="run-picker">
            Saved feedback run{' '}
            <select
              value={selected?.id}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {successful.map((run) => (
                <option key={run.id} value={run.id}>
                  {runLabel(run)}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>
      <div id="reference-lessons">
        {groups.map((group) => (
          <section
            className="lesson-group"
            key={group.title}
            aria-label={group.title}
          >
            <h2>
              {group.title} <span>({group.issues.length})</span>
            </h2>
            {!group.issues.length && (
              <p>
                {group.title === 'Missed issues'
                  ? 'You identified every reference issue. Revisit the explanations below to strengthen your reasoning.'
                  : 'Use the worked lessons above to build your next review.'}
              </p>
            )}
            {group.issues.map((lesson) => {
              const matches = feedback.filter(
                (finding) => finding.matchedIssueId === lesson.id,
              );
              return (
                <article
                  key={lesson.id}
                  id={`lesson-${lesson.id}`}
                  className="worked-lesson"
                  aria-labelledby={`heading-${lesson.id}`}
                >
                  <header>
                    <span className="badge">
                      {lesson.category} · {lesson.severity} impact
                    </span>
                    <h3 id={`heading-${lesson.id}`}>{lesson.title}</h3>
                    <p>{lesson.summary}</p>
                    {!found.has(lesson.id) &&
                      matches.some(
                        (finding) => finding.status === 'uncertain',
                      ) && (
                        <p className="uncertain-label">
                          Not yet verified: AI could not establish this issue
                          from your reasoning. Compare the lesson with your
                          comment.
                        </p>
                      )}
                    <div className="lesson-locations">
                      {lesson.locations.map(locationButton)}
                    </div>
                  </header>
                  {matches.length > 0 && (
                    <section className="personal-feedback">
                      <h4>Your reasoning · AI feedback</h4>
                      {matches.map((finding, index) => (
                        <div key={index}>
                          <p>
                            <strong>{verdict[finding.status]}.</strong>{' '}
                            {finding.feedback}
                          </p>
                          <blockquote>{finding.comment.body}</blockquote>
                          {locationButton(finding.comment.anchor)}
                        </div>
                      ))}
                    </section>
                  )}
                  <h4>How the failure happens</h4>
                  <p>{lesson.explanation}</p>
                  <h4>A concrete failure</h4>
                  <p>{lesson.failureExample}</p>
                  <h4>Why it matters</h4>
                  <p>{lesson.whyItMatters}</p>
                  <h4>The correction and why it works</h4>
                  <p>{lesson.suggestedFix}</p>
                  {lesson.correctedCode.map((correction, index) => (
                    <figure key={index}>
                      <figcaption>
                        {correction.filePath} · Corrected code
                      </figcaption>
                      <pre tabIndex={0}>
                        <code>{correction.code}</code>
                      </pre>
                    </figure>
                  ))}
                  <h4>Recognize and prevent it</h4>
                  <p>{lesson.prevention}</p>
                  <h4>Other ways to explain it</h4>
                  <ul>
                    {lesson.acceptableExplanations.map((text, index) => (
                      <li key={index}>{text}</li>
                    ))}
                  </ul>
                  <h4>Key concepts</h4>
                  <p>{lesson.keyConcepts.join(' · ')}</p>
                  {lesson.commonConfusions.length > 0 && (
                    <>
                      <h4>Common confusions</h4>
                      <ul>
                        {lesson.commonConfusions.map((text, index) => (
                          <li key={index}>{text}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </article>
              );
            })}
          </section>
        ))}
      </div>
      {feedback.some((finding) => finding.matchedIssueId === null) && (
        <section className="extra-findings" aria-label="Extra findings">
          <h2>AI-assessed, outside the reference key</h2>
          <p>
            These verdicts address your additional claims. They do not change
            reference-issue counts and may be inaccurate.
          </p>
          {feedback
            .filter((finding) => finding.matchedIssueId === null)
            .map((finding, index) => (
              <article className="worked-lesson" key={index}>
                <strong>
                  {finding.status === 'uncertain'
                    ? 'Uncertain · Not yet verified'
                    : verdict[finding.status]}
                </strong>
                <blockquote>{finding.comment.body}</blockquote>
                <p>{finding.feedback}</p>
                {locationButton(finding.comment.anchor)}
              </article>
            ))}
        </section>
      )}
      <section className="submitted-comments" aria-label="Submitted comments">
        <h2>Your submitted comments ({attempt.comments.length})</h2>
        {!attempt.comments.length && (
          <p>
            You finished without comments. No AI was needed; every reference
            lesson is available above.
          </p>
        )}
        {attempt.comments.map((comment) => (
          <div key={comment.id} className="saved-comment">
            <blockquote>{comment.body}</blockquote>
            {locationButton(comment.anchor)}
          </div>
        ))}
      </section>
      <details className="assessment-history">
        <summary>AI feedback history ({runs.length})</summary>
        <ol>
          {runs.map((run) => (
            <li key={run.id}>
              <strong>
                {run.status} · {runLabel(run)}
              </strong>
              <p>
                {run.mode} · Prompt v{run.promptVersion} · Assessment v
                {run.assessmentVersion}
                {run.digest ? ` · Model digest ${run.digest}` : ''}
              </p>
              <p>
                Started: {run.startedAt ? time(run.startedAt) : 'Not started'} ·
                Finished:{' '}
                {run.completedAt ? time(run.completedAt) : 'Not finished'}
              </p>
              {run.error && <p>{run.error}</p>}
              {run.summary && (
                <p>
                  {run.summary.foundCount} found · {run.summary.missedCount}{' '}
                  missed
                </p>
              )}
              {run.status === 'succeeded' && (
                <button
                  className="secondary-button"
                  onClick={() => {
                    setSelectedId(run.id);
                    document.getElementById('review')?.focus();
                    window.scrollTo(0, 0);
                  }}
                >
                  Read this feedback
                </button>
              )}
            </li>
          ))}
        </ol>
      </details>
      <footer className="page-footer">
        Reference lessons were written with the exercise. AI feedback
        supplements them; it can make mistakes.
      </footer>
    </main>
  );
}
