import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  caseSummarySchema,
  attemptSchema,
  difficulties,
  difficultySchema,
  exerciseSchema,
  languages,
  languageSchema,
  type CaseSummary,
  type Difficulty,
  type Language,
  type PublicExercise,
} from '../../../packages/shared/src/index.js';
import { fetchJson } from './api.js';
import { ReviewWorkspace } from './ReviewWorkspace.js';
import { AttemptHistory } from './AttemptHistory.js';

const languageMarks: Record<Language, string> = {
  typescript: 'TS',
  python: 'Py',
  cpp: 'C++',
  rust: 'Rs',
};
const statusLabels: Record<CaseSummary['status'], string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};

function initialFilters(): { language: Language; difficulty: Difficulty } {
  const params = new URLSearchParams(window.location.search);
  const language = languageSchema.safeParse(params.get('language'));
  const difficulty = difficultySchema.safeParse(params.get('difficulty'));
  return {
    language: language.success ? language.data : 'typescript',
    difficulty: difficulty.success ? difficulty.data : 'easy',
  };
}

function ExercisePreview({ id, onClose }: { id: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef(document.activeElement);
  const [exercise, setExercise] = useState<PublicExercise>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    setExercise(undefined);
    fetchJson(`/api/cases/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then((data) => setExercise(exerciseSchema.parse(data)))
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [id, retry]);
  return (
    <dialog
      ref={dialog}
      className="exercise-dialog"
      aria-labelledby="preview-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-heading">
        <span className="eyebrow">EXERCISE OVERVIEW</span>
        <button
          className="close-button"
          aria-label="Close exercise overview"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <h2 id="preview-title">
        {exercise?.title ??
          (error ? 'Exercise unavailable' : 'Loading exercise…')}
      </h2>
      {error ? (
        <div role="alert" className="error-state">
          <p>We couldn’t load this exercise.</p>
          <button onClick={() => setRetry((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : exercise ? (
        <>
          <p className="dialog-description">{exercise.description}</p>
          <div className="badge-row">
            <span className="badge">
              {
                languages.find((language) => language.id === exercise.language)
                  ?.label
              }
            </span>
            <span className="badge">
              {
                difficulties.find(
                  (difficulty) => difficulty.id === exercise.difficulty,
                )?.label
              }
            </span>
          </div>
          <h3>Commit message</h3>
          <p className="commit-message">{exercise.commitMessage}</p>
          {exercise.reviewContext && (
            <>
              <h3>Review context</h3>
              <p>{exercise.reviewContext}</p>
            </>
          )}
          <h3>
            Files in this exercise{' '}
            <span className="muted">({exercise.files.length})</span>
          </h3>
          <ul className="file-list">
            {exercise.files.map((file) => (
              <li key={file.path}>
                <code>{file.path}</code>
                <span className={`file-status ${file.status}`}>
                  {file.status === 'unchanged' ? 'context' : file.status}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        !error && <p role="status">Loading the commit and file list…</p>
      )}
      <div className="dialog-footer">
        <button className="primary-button" onClick={onClose}>
          Back to library <span aria-hidden="true">↗</span>
        </button>
      </div>
    </dialog>
  );
}

export function App() {
  const [filters, setFilters] = useState(initialFilters);
  const [cases, setCases] = useState<CaseSummary[]>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [previewId, setPreviewId] = useState<string>();
  const [attemptId, setAttemptId] = useState<string | undefined>(
    () =>
      new URLSearchParams(window.location.search).get('attempt') ?? undefined,
  );
  const [startingId, setStartingId] = useState<string>();
  const [startError, setStartError] = useState<string>();
  const previousAttempt = useRef(attemptId);
  useEffect(() => {
    document.title = `${attemptId ? 'Review' : 'Exercise library'} · Code Review Trainer`;
    if (!attemptId && previousAttempt.current)
      document.getElementById('library')?.focus();
    previousAttempt.current = attemptId;
  }, [attemptId]);
  const languageLabel = languages.find(
    (language) => language.id === filters.language,
  )!.label;
  const difficultyLabel = difficulties.find(
    (difficulty) => difficulty.id === filters.difficulty,
  )!.label;
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('language', filters.language);
    url.searchParams.set('difficulty', filters.difficulty);
    window.history.replaceState(null, '', url);
    const controller = new AbortController();
    setCases(undefined);
    setError(false);
    fetchJson(
      `/api/cases?language=${filters.language}&difficulty=${filters.difficulty}`,
      { signal: controller.signal },
    )
      .then((data) => setCases(z.array(caseSummarySchema).parse(data)))
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [filters, retry]);
  useEffect(() => {
    const navigate = () => {
      setAttemptId(
        new URLSearchParams(window.location.search).get('attempt') ?? undefined,
      );
      setFilters(initialFilters());
    };
    window.addEventListener('popstate', navigate);
    return () => window.removeEventListener('popstate', navigate);
  }, []);
  async function start(exercise: CaseSummary) {
    setStartingId(exercise.id);
    setStartError(undefined);
    try {
      const id =
        exercise.draftAttemptId ??
        attemptSchema.parse(
          await fetchJson('/api/attempts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ exerciseId: exercise.id }),
          }),
        ).id;
      openAttempt(id);
    } catch {
      setStartError(
        'The review could not be opened. Try again; your saved drafts are unchanged.',
      );
    } finally {
      setStartingId(undefined);
    }
  }
  function openAttempt(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('attempt', id);
    window.history.pushState(null, '', url);
    setAttemptId(id);
  }
  function returnToLibrary() {
    const url = new URL(window.location.href);
    url.searchParams.delete('attempt');
    window.history.pushState(null, '', url);
    setAttemptId(undefined);
    setRetry((value) => value + 1);
  }
  return (
    <div className="app-shell">
      <a href={attemptId ? '#review' : '#library'} className="skip-link">
        {attemptId ? 'Skip to review workspace' : 'Skip to exercise library'}
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href={`/?language=${filters.language}&difficulty=${filters.difficulty}`}
          aria-label="Code Review Trainer home"
        >
          <span className="brand-mark" aria-hidden="true">
            {'</>'}
          </span>
          <span>
            Code Review
            <br />
            <strong>Trainer</strong>
          </span>
        </a>
        <div className="sidebar-section">YOUR WORKSPACE</div>
        <a
          href={
            attemptId
              ? `/?language=${filters.language}&difficulty=${filters.difficulty}`
              : '#library'
          }
          className="nav-link"
          aria-current={attemptId ? undefined : 'page'}
        >
          <span aria-hidden="true">▦</span> Exercise library{' '}
          <span className="nav-dot" />
        </a>
        <div className="sidebar-note">
          <span className="status-dot" /> Local workspace
          <p>
            Your practice, on your machine.
            <br />
            No account needed.
          </p>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <span>
            Practice <span className="breadcrumb-slash">/</span>{' '}
            <strong>
              {attemptId ? 'Review workspace' : 'Exercise library'}
            </strong>
          </span>
          <span className="local-label">
            <span className="status-dot" /> LOCAL
          </span>
        </header>
        {attemptId ? (
          <ReviewWorkspace
            key={attemptId}
            id={attemptId}
            onBack={returnToLibrary}
          />
        ) : (
          <main id="library" tabIndex={-1}>
            <section className="hero" aria-labelledby="page-title">
              <div className="hero-copy">
                <div className="eyebrow">
                  <span className="eyebrow-line" /> A SHARPER EYE STARTS HERE
                </div>
                <h1 id="page-title">
                  Practice the art
                  <br />
                  of <em>code review.</em>
                </h1>
                <p>
                  Small commits. Real mistakes. Choose a language
                  <br className="desktop-break" /> and something to practice,
                  then look closer.
                </p>
                <div className="hero-facts">
                  <span>4 languages</span>
                  <i aria-hidden="true" />
                  <span>3 difficulty levels</span>
                  <i aria-hidden="true" />
                  <span>Built for practice</span>
                </div>
              </div>
              <div className="review-loop">
                <div className="loop-heading">
                  <span className="eyebrow">THE REVIEW LOOP</span>
                  <span aria-hidden="true">↗</span>
                </div>
                <ol>
                  <li>
                    <span className="step-number">01</span>
                    <div>
                      <strong>Read the change</strong>
                      <p>Understand the code and its context.</p>
                    </div>
                  </li>
                  <li>
                    <span className="step-number">02</span>
                    <div>
                      <strong>Question the details</strong>
                      <p>Look for what a quick glance misses.</p>
                    </div>
                  </li>
                  <li>
                    <span className="step-number">03</span>
                    <div>
                      <strong>Learn from the review</strong>
                      <p>Compare your reasoning with the answers.</p>
                    </div>
                  </li>
                </ol>
              </div>
            </section>
            <section className="library-panel" aria-labelledby="choose-title">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">CHOOSE WHAT TO PRACTICE</span>
                  <h2 id="choose-title">Find your next exercise</h2>
                </div>
                <span className="selection-note">
                  One focused review at a time.
                </span>
              </div>
              <div className="filter-row">
                <fieldset className="language-filter">
                  <legend>Language</legend>
                  <div className="language-options">
                    {languages.map((language) => (
                      <label
                        className={`language-option ${filters.language === language.id ? 'selected' : ''}`}
                        key={language.id}
                        data-language={language.id}
                      >
                        <input
                          type="radio"
                          name="language"
                          value={language.id}
                          checked={filters.language === language.id}
                          onChange={() =>
                            setFilters((previous) => ({
                              ...previous,
                              language: language.id,
                            }))
                          }
                        />
                        <span className="language-mark" aria-hidden="true">
                          {languageMarks[language.id]}
                        </span>
                        <span>{language.label}</span>
                        {filters.language === language.id && (
                          <span className="selected-check" aria-hidden="true">
                            ✓
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="difficulty-filter">
                  <legend>Difficulty</legend>
                  <div className="difficulty-options">
                    {difficulties.map((difficulty) => (
                      <label
                        className={
                          filters.difficulty === difficulty.id ? 'selected' : ''
                        }
                        key={difficulty.id}
                      >
                        <input
                          type="radio"
                          name="difficulty"
                          value={difficulty.id}
                          checked={filters.difficulty === difficulty.id}
                          onChange={() =>
                            setFilters((previous) => ({
                              ...previous,
                              difficulty: difficulty.id,
                            }))
                          }
                        />
                        {difficulty.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              <div className="results-heading">
                <h3>
                  {languageLabel} <span aria-hidden="true">/</span>{' '}
                  {difficultyLabel}
                </h3>
                <span role="status" aria-live="polite">
                  {error
                    ? 'Could not load exercises'
                    : cases
                      ? `${cases.length} exercise${cases.length === 1 ? '' : 's'}`
                      : 'Loading exercises…'}
                </span>
              </div>
              {startError && (
                <p className="save-error" role="alert">
                  {startError}
                </p>
              )}
              {error ? (
                <div className="error-state" role="alert">
                  <h3>The library couldn’t load</h3>
                  <p>Check that the local server is running, then try again.</p>
                  <button
                    className="primary-button"
                    onClick={() => setRetry((value) => value + 1)}
                  >
                    Try again
                  </button>
                </div>
              ) : !cases ? (
                <div className="loading-card" aria-hidden="true">
                  <div />
                  <div />
                  <div />
                </div>
              ) : cases.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-symbol" aria-hidden="true">
                    {'{ }'}
                  </span>
                  <h3>No exercises here yet</h3>
                  <p>
                    There aren’t any {difficultyLabel.toLowerCase()}{' '}
                    {languageLabel} exercises in your library.
                    <br />
                    Choose another language or difficulty to explore.
                  </p>
                </div>
              ) : (
                <div className="exercise-list">
                  {cases.map((exercise) => (
                    <article
                      className="exercise-card"
                      key={exercise.id}
                      aria-labelledby={`title-${exercise.id}`}
                    >
                      <div
                        className="exercise-language"
                        data-language={exercise.language}
                        aria-hidden="true"
                      >
                        {languageMarks[exercise.language]}
                      </div>
                      <div className="exercise-copy">
                        <div className="card-meta">
                          <span
                            className={`difficulty-badge ${exercise.difficulty}`}
                          >
                            {difficultyLabel}
                          </span>
                          <span className="exercise-id">{exercise.id}</span>
                        </div>
                        <h3 id={`title-${exercise.id}`}>{exercise.title}</h3>
                        <p>{exercise.description}</p>
                        <div className="card-details">
                          <span>
                            {exercise.changedFileCount} changed file
                            {exercise.changedFileCount === 1 ? '' : 's'}
                          </span>
                          <span className="detail-dot" aria-hidden="true">
                            ·
                          </span>
                          <span>{statusLabels[exercise.status]}</span>
                        </div>
                      </div>
                      <div className="card-actions">
                        {exercise.latestAttemptId && (
                          <button
                            className="secondary-button"
                            onClick={() =>
                              openAttempt(exercise.latestAttemptId!)
                            }
                            aria-label={`Read lessons: ${exercise.title}`}
                          >
                            Read lessons
                          </button>
                        )}
                        <button
                          className="primary-button"
                          disabled={Boolean(startingId)}
                          onClick={() => void start(exercise)}
                          aria-label={`${exercise.draftAttemptId ? 'Continue review' : exercise.status === 'completed' ? 'Retry exercise' : 'Start review'}: ${exercise.title}`}
                        >
                          {startingId === exercise.id
                            ? 'Opening…'
                            : exercise.draftAttemptId
                              ? 'Continue review'
                              : exercise.status === 'completed'
                                ? 'Retry exercise'
                                : 'Start review'}
                        </button>
                        <button
                          className="preview-button"
                          onClick={() => setPreviewId(exercise.id)}
                          aria-label={`Preview ${exercise.title}`}
                        >
                          Preview exercise <span aria-hidden="true">↗</span>
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
            <AttemptHistory onOpen={openAttempt} />
            <footer className="page-footer">
              <span>Thoughtful reviews start with good questions.</span>
              <span className="footer-code" aria-hidden="true">
                {'{ read · reason · review }'}
              </span>
            </footer>
          </main>
        )}
      </div>
      {previewId && (
        <ExercisePreview
          id={previewId}
          onClose={() => setPreviewId(undefined)}
        />
      )}
    </div>
  );
}
