import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  anchorSchema,
  attemptSchema,
  commentsSchema,
  difficulties,
  languages,
  validateAnchor,
  type ReviewAttempt,
  type ReviewComment,
  type ReviewCommentAnchor,
} from '../../../packages/shared/src/index.js';
import { ApiError, fetchJson } from './api.js';
import { FileDiff } from './FileDiff.js';
import { LearningResults } from './LearningResults.js';

const editorSchema = z.strictObject({
  id: z.uuid().optional(),
  anchor: z.strictObject({
    filePath: anchorSchema.shape.filePath,
    side: anchorSchema.shape.side,
    startLine: z.number().int(),
    endLine: z.number().int(),
  }),
  body: z.string().max(8000),
  pivotLine: z.number().int().positive(),
});
type Editor = z.infer<typeof editorSchema>;
const backupSchema = z.strictObject({
  version: z.number().int().nonnegative(),
  comments: commentsSchema,
  editor: editorSchema.nullable(),
});
const same = (left: ReviewComment[], right: ReviewComment[]) =>
  JSON.stringify(left) === JSON.stringify(right);

export function ReviewWorkspace({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
}) {
  const [attempt, setAttempt] = useState<ReviewAttempt>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    fetchJson(`/api/attempts/${encodeURIComponent(id)}`, {
      signal: controller.signal,
    })
      .then((data) => setAttempt(attemptSchema.parse(data)))
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            'This review could not be loaded. Your browser draft has been kept.',
          );
      });
    return () => controller.abort();
  }, [id, retry]);
  const active = attempt?.results?.runs.some(
    (run) => run.status === 'pending' || run.status === 'running',
  );
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setRetry((value) => value + 1), 1200);
    return () => window.clearTimeout(timer);
  }, [active, retry]);
  return attempt ? (
    attempt.state === 'submitted' && attempt.results ? (
      <>
        {error && (
          <p role="alert" className="save-error">
            Feedback updates could not be loaded. Your saved lessons remain
            available.
            <button
              className="secondary-button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Refresh feedback
            </button>
          </p>
        )}
        <LearningResults
          attempt={attempt}
          onBack={onBack}
          onUpdate={setAttempt}
        />
      </>
    ) : (
      <ReviewDraft
        key={id}
        attempt={attempt}
        onBack={onBack}
        onSubmitted={setAttempt}
      />
    )
  ) : (
    <main className="review-workspace">
      <button className="secondary-button" onClick={onBack}>
        Back to library
      </button>
      {error ? (
        <div role="alert" className="save-error">
          {error}
          <button
            className="secondary-button"
            onClick={() => setRetry(retry + 1)}
          >
            Try again
          </button>
        </div>
      ) : (
        <p role="status">Loading your review…</p>
      )}
    </main>
  );
}

function ReviewDraft({
  attempt,
  onBack,
  onSubmitted,
}: {
  attempt: ReviewAttempt;
  onBack: () => void;
  onSubmitted: (attempt: ReviewAttempt) => void;
}) {
  const key = `review-draft:${attempt.id}`;
  const [restored] = useState(() => {
    if (attempt.state !== 'draft')
      return { backup: undefined, warning: undefined };
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return { backup: undefined, warning: undefined };
      const backup = backupSchema.parse(JSON.parse(raw));
      for (const comment of backup.comments)
        validateAnchor(attempt.exercise, comment.anchor);
      if (
        backup.editor &&
        !attempt.exercise.files.some(
          (file) => file.path === backup.editor!.anchor.filePath,
        )
      )
        throw new Error('Unknown draft file.');
      return { backup, warning: undefined };
    } catch {
      return {
        backup: undefined,
        warning:
          'The browser backup could not be read. The saved review was loaded; keep this tab open until any new notes are saved.',
      };
    }
  });
  const [comments, setCommentsState] = useState(
    restored.backup?.comments ?? attempt.comments,
  );
  const [editor, setEditorState] = useState<Editor | null>(
    restored.backup?.editor ?? null,
  );
  const [filePath, setFilePath] = useState(
    editor?.anchor.filePath ?? attempt.exercise.files[0].path,
  );
  const conflictOnLoad =
    restored.backup &&
    restored.backup.version !== attempt.version &&
    !same(restored.backup.comments, attempt.comments);
  const [error, setError] = useState<string | undefined>(
    conflictOnLoad
      ? 'This draft changed in another tab. Your unsaved notes remain here; compare them before loading the saved draft.'
      : undefined,
  );
  const [conflict, setConflict] = useState(Boolean(conflictOnLoad));
  const [backupWarning, setBackupWarning] = useState(restored.warning);
  const [editorError, setEditorError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [submissionUnconfirmed, setSubmissionUnconfirmed] = useState(false);
  const [submissionError, setSubmissionError] = useState<string>();
  const submissionInFlight = useRef(false);
  const [saveState, setSaveState] = useState<
    'saved' | 'unsaved' | 'saving' | 'error'
  >(
    conflictOnLoad
      ? 'error'
      : same(comments, attempt.comments)
        ? 'saved'
        : 'unsaved',
  );
  const version = useRef(
    conflictOnLoad ? restored.backup!.version : attempt.version,
  );
  const saved = useRef(attempt.comments);
  const current = useRef(comments);
  const currentEditor = useRef(editor);
  const inFlight = useRef<Promise<boolean> | undefined>(undefined);
  current.current = comments;
  currentEditor.current = editor;
  const readOnly =
    attempt.state !== 'draft' || submitting || submissionUnconfirmed;
  const file = attempt.exercise.files.find(
    (candidate) => candidate.path === filePath,
  )!;

  function writeBackup() {
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({
          version: version.current,
          comments: current.current,
          editor: currentEditor.current,
        }),
      );
    } catch {
      setBackupWarning(
        'Browser recovery is unavailable. Keep this tab open until your comments are saved; finish any open note before leaving.',
      );
    }
  }
  function setComments(next: ReviewComment[]) {
    current.current = next;
    setCommentsState(next);
    setSaveState('unsaved');
    if (!conflict) setError(undefined);
  }
  function setEditor(next: Editor | null) {
    currentEditor.current = next;
    setEditorState(next);
    setEditorError(undefined);
  }
  function save(): Promise<boolean> {
    if (inFlight.current) return inFlight.current;
    if (readOnly) return Promise.resolve(true);
    if (conflict) return Promise.resolve(false);
    if (same(current.current, saved.current)) return Promise.resolve(true);
    const task = (async () => {
      try {
        setError(undefined);
        while (!same(current.current, saved.current)) {
          setSaveState('saving');
          const sending = current.current;
          const data = attemptSchema.parse(
            await fetchJson(`/api/attempts/${attempt.id}/comments`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                version: version.current,
                comments: sending,
              }),
            }),
          );
          version.current = data.version;
          saved.current = data.comments;
          if (same(current.current, sending)) {
            current.current = data.comments;
            setCommentsState(data.comments);
          }
          writeBackup();
        }
        setSaveState('saved');
        return true;
      } catch (failure) {
        setSaveState('error');
        setConflict(failure instanceof ApiError && failure.status === 409);
        setError(
          failure instanceof ApiError
            ? failure.message
            : 'Your comments could not be saved. They remain here; retry before leaving.',
        );
        writeBackup();
        return false;
      } finally {
        inFlight.current = undefined;
      }
    })();
    inFlight.current = task;
    return task;
  }
  useEffect(() => {
    writeBackup();
  }, [comments, editor, saveState]);
  useEffect(() => {
    if (same(current.current, saved.current) || conflict || readOnly) return;
    const timer = window.setTimeout(() => {
      void save();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [comments]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        !same(current.current, saved.current) ||
        currentEditor.current?.body.trim()
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  useEffect(() => {
    if (editor) document.getElementById('review-comment-body')?.focus();
  }, [Boolean(editor), editor?.id, filePath]);

  function select(side: 'old' | 'new', line: number, extend: boolean) {
    const previous = currentEditor.current;
    const pivot =
      extend &&
      previous?.anchor.filePath === filePath &&
      previous.anchor.side === side
        ? previous.pivotLine
        : line;
    setEditor({
      id: previous?.id,
      body: previous?.body ?? '',
      pivotLine: pivot,
      anchor: {
        filePath,
        side,
        startLine: Math.min(pivot, line),
        endLine: Math.max(pivot, line),
      },
    });
  }
  function postComment() {
    if (!editor || !editor.body.trim()) return;
    if (!editor.id && comments.length >= 500) {
      setEditorError(
        'This review already has 500 comments. Remove a comment before adding another; your open note has been kept.',
      );
      return;
    }
    try {
      validateAnchor(attempt.exercise, editor.anchor);
    } catch {
      setEditorError(
        'Choose a valid line range in this file version. Your note has been kept.',
      );
      return;
    }
    const comment = {
      id: editor.id ?? crypto.randomUUID(),
      anchor: editor.anchor,
      body: editor.body.trim(),
    };
    setComments(
      editor.id
        ? comments.map((existing) =>
            existing.id === editor.id ? comment : existing,
          )
        : [...comments, comment],
    );
    setEditor(null);
  }
  async function back() {
    if (await save()) {
      writeBackup();
      onBack();
    }
  }
  async function submit() {
    if (submissionInFlight.current || conflict) return;
    if (currentEditor.current) {
      setSubmissionError(
        'Add or cancel your open note before finishing the review.',
      );
      return;
    }
    submissionInFlight.current = true;
    setSubmitting(true);
    setSubmissionError(undefined);
    try {
      if (!(await save())) return;
      const submitted = attemptSchema.parse(
        await fetchJson(`/api/attempts/${attempt.id}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ version: version.current }),
        }),
      );
      if (submitted.state !== 'submitted')
        throw new Error('Submission was not confirmed.');
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Saved submission is durable. */
      }
      onSubmitted(submitted);
    } catch (error) {
      setSubmissionUnconfirmed(!(error instanceof ApiError));
      setSubmissionError(
        error instanceof ApiError
          ? error.message
          : 'Submission could not be confirmed. Editing is paused; choose Finish review again to safely retry. Your comments have been kept.',
      );
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true);
        setError(
          'The saved review changed. Copy any pending notes, then load the saved review before finishing.',
        );
      }
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  }
  function loadSaved() {
    if (
      !window.confirm(
        'Replace the unsaved notes in this tab with the saved draft? Copy any notes you want to keep first.',
      )
    )
      return;
    current.current = saved.current;
    currentEditor.current = null;
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* Browser recovery may be unavailable. */
    }
    window.location.reload();
  }
  const selection: ReviewCommentAnchor | undefined =
    editor?.anchor.filePath === filePath ? editor.anchor : undefined;
  const editorElement =
    selection && editor && !readOnly ? (
      <form
        className="comment-editor"
        onSubmit={(event) => {
          event.preventDefault();
          postComment();
        }}
        aria-label="Comment editor"
      >
        <strong>
          {editor.id ? 'Edit your note' : 'Write a review note'} ·{' '}
          {selection.side === 'old' ? 'Original' : 'Updated'} version
        </strong>
        <div className="range-fields">
          <label>
            Start line
            <input
              type="number"
              min="1"
              value={selection.startLine}
              onChange={(event) =>
                setEditor({
                  ...editor,
                  anchor: {
                    ...selection,
                    startLine: Number(event.target.value),
                  },
                })
              }
            />
          </label>
          <label>
            End line
            <input
              type="number"
              min="1"
              value={selection.endLine}
              onChange={(event) =>
                setEditor({
                  ...editor,
                  anchor: { ...selection, endLine: Number(event.target.value) },
                })
              }
            />
          </label>
        </div>
        <label htmlFor="review-comment-body">Review comment</label>
        <textarea
          id="review-comment-body"
          maxLength={8000}
          value={editor.body}
          onChange={(event) =>
            setEditor({ ...editor, body: event.target.value })
          }
          placeholder="What might go wrong, and why?"
        />
        {editorError && <p role="alert">{editorError}</p>}
        <div className="editor-actions">
          <button className="primary-button" disabled={!editor.body.trim()}>
            {editor.id ? 'Save comment' : 'Add comment'}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setEditor(null)}
          >
            Cancel note
          </button>
        </div>
      </form>
    ) : undefined;

  return (
    <main className="review-workspace" id="review" tabIndex={-1}>
      <button
        className="secondary-button"
        disabled={submitting}
        onClick={() => void back()}
      >
        ← Back to library
      </button>
      <div className="review-heading">
        <div>
          <span className="eyebrow">READ · REASON · REVIEW</span>
          <h1>{attempt.exercise.title}</h1>
          <p>{attempt.exercise.commitMessage}</p>
          <div className="review-meta">
            <span className="badge">
              {
                languages.find((item) => item.id === attempt.exercise.language)
                  ?.label
              }
            </span>
            <span className="badge">
              {
                difficulties.find(
                  (item) => item.id === attempt.exercise.difficulty,
                )?.label
              }
            </span>
            <span>{attempt.exercise.files.length} files</span>
            <span>{comments.length} draft comments</span>
          </div>
        </div>
        <div>
          <span className="save-state" role="status" aria-live="polite">
            {saveState === 'saved'
              ? 'All comments saved'
              : saveState === 'saving'
                ? 'Saving comments…'
                : saveState === 'error'
                  ? 'Comments not saved'
                  : 'Unsaved changes'}
          </span>
          {!readOnly && (
            <button
              className="secondary-button"
              onClick={() => void save()}
              disabled={saveState === 'saving' || conflict}
            >
              Save draft
            </button>
          )}
          {attempt.state === 'draft' && (
            <button
              className="primary-button"
              disabled={submitting || conflict}
              onClick={() => void submit()}
            >
              {submitting ? 'Finishing review…' : 'Finish review'}
            </button>
          )}
        </div>
      </div>
      <p className="submission-help">
        Finish when you are ready to study the reference lessons. Submitted
        comments cannot be edited.
      </p>
      {submissionError && (
        <p className="save-error" role="alert">
          {submissionError}
        </p>
      )}
      {attempt.exercise.reviewContext && (
        <details className="review-context" open>
          <summary>Review context</summary>
          <p>{attempt.exercise.reviewContext}</p>
        </details>
      )}
      {error && (
        <div className="save-error" role="alert">
          {error}
          {conflict ? (
            <button className="secondary-button" onClick={loadSaved}>
              Load saved draft
            </button>
          ) : (
            <button className="secondary-button" onClick={() => void save()}>
              Retry save
            </button>
          )}
        </div>
      )}
      {backupWarning && (
        <div className="save-error" role="alert">
          {backupWarning}
        </div>
      )}
      {editor && editor.anchor.filePath !== filePath && (
        <button
          className="other-version-note"
          onClick={() => setFilePath(editor.anchor.filePath)}
        >
          Continue your open note in {editor.anchor.filePath}
        </button>
      )}
      <div className="review-grid">
        <aside className="file-sidebar" aria-label="Exercise files">
          <h2>Files changed</h2>
          {attempt.exercise.files.map((item) => (
            <button
              key={item.path}
              aria-pressed={item.path === filePath}
              onClick={() => setFilePath(item.path)}
            >
              <code>{item.path}</code>
              <small>
                {item.status === 'unchanged' ? 'Context' : item.status} ·{' '}
                {
                  comments.filter(
                    (comment) => comment.anchor.filePath === item.path,
                  ).length
                }{' '}
                notes
              </small>
            </button>
          ))}
        </aside>
        <div className="review-content">
          <FileDiff
            key={filePath}
            file={file}
            patch={attempt.diffs[filePath]}
            comments={comments.filter(
              (comment) => comment.anchor.filePath === filePath,
            )}
            selection={selection}
            editor={editorElement}
            editorLine={editor?.pivotLine}
            onSelect={select}
            editing={Boolean(editor)}
            readOnly={readOnly}
            onEdit={(comment) => {
              setFilePath(comment.anchor.filePath);
              setEditor({
                id: comment.id,
                anchor: comment.anchor,
                body: comment.body,
                pivotLine: comment.anchor.endLine,
              });
            }}
            onDelete={(commentId) =>
              setComments(
                comments.filter((comment) => comment.id !== commentId),
              )
            }
          />
        </div>
      </div>
      <footer className="page-footer">
        <span>Follow the behavior, not just the changed lines.</span>
        <span>Notes are private to this review.</span>
      </footer>
    </main>
  );
}
