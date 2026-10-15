import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Decoration, Diff, Hunk, getChangeKey } from 'react-diff-view';
import type {
  ReviewComment,
  ReviewCommentAnchor,
} from '../../../packages/shared/src/index.js';
import {
  fileHunks,
  highlightHunks,
  lineOnSide,
  selectedKeys,
  type ExerciseFile,
  type FileVersion,
} from './diff.js';
import 'react-diff-view/style/index.css';
import './review.css';

type Props = {
  file: ExerciseFile;
  patch: string;
  comments: ReviewComment[];
  selection?: ReviewCommentAnchor;
  editor?: ReactNode;
  editorLine?: number;
  onSelect: (side: 'old' | 'new', line: number, extend: boolean) => void;
  onEdit: (comment: ReviewComment) => void;
  onDelete: (id: string) => void;
  editing: boolean;
  readOnly: boolean;
};

export function FileDiff({
  file,
  patch,
  comments,
  selection,
  editor,
  editorLine,
  onSelect,
  onEdit,
  onDelete,
  editing,
  readOnly,
}: Props) {
  const [mode, setMode] = useState<FileVersion>('diff');
  const [split, setSplit] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const anchors = [
    ...comments.map((comment) => comment.anchor),
    ...(selection ? [selection] : []),
    ...(selection && editor && editorLine
      ? [{ ...selection, startLine: editorLine, endLine: editorLine }]
      : []),
  ];
  // Note text changes should not re-expand or re-highlight the source.
  const anchorKey = JSON.stringify(anchors);
  const hunks = useMemo(
    () => fileHunks(file, patch, mode, expanded, anchors),
    [file, patch, mode, expanded, anchorKey],
  );
  const visible = comments.filter(
    (comment) => mode === 'diff' || comment.anchor.side === mode,
  );
  const tokens = useMemo(
    () => highlightHunks(hunks, file, mode),
    [hunks, file, mode],
  );
  const widgets: Record<string, ReactNode> = {};
  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      const attached = visible.filter(
        (comment) =>
          lineOnSide(change, comment.anchor.side) === comment.anchor.endLine,
      );
      const isSelected =
        selection &&
        (mode === 'diff' || selection.side === mode) &&
        lineOnSide(change, selection.side) ===
          (editorLine ?? selection.endLine);
      if (attached.length || (isSelected && editor)) {
        widgets[getChangeKey(change)] = (
          <div className="inline-threads">
            {attached.map((comment) => (
              <article
                className="review-note"
                key={comment.id}
                aria-label={`Comment on ${comment.anchor.side} lines ${comment.anchor.startLine} to ${comment.anchor.endLine}`}
              >
                <header>
                  <span>
                    {comment.anchor.side === 'old' ? 'Original' : 'Updated'} ·
                    lines {comment.anchor.startLine}–{comment.anchor.endLine}
                  </span>
                  {!readOnly && (
                    <div>
                      <button
                        disabled={editing || readOnly}
                        onClick={() => onEdit(comment)}
                        aria-label={`Edit comment: ${comment.body}`}
                      >
                        Edit
                      </button>
                      <button
                        disabled={editing || readOnly}
                        onClick={() => onDelete(comment.id)}
                        aria-label={`Delete comment: ${comment.body}`}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </header>
                <p>{comment.body}</p>
              </article>
            ))}
            {isSelected && editor}
          </div>
        );
      }
    }
  }
  return (
    <section className="file-diff" aria-label={`Code for ${file.path}`}>
      <div className="file-toolbar">
        <div>
          <code>{file.path}</code>
          <span className={`file-status ${file.status}`}>
            {file.status === 'unchanged' ? 'Context file' : file.status}
          </span>
        </div>
        <div className="diff-controls">
          <label>
            File version{' '}
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as FileVersion)}
            >
              <option value="diff">
                {file.status === 'unchanged' ? 'Context' : 'Diff'}
              </option>
              <option value="old" disabled={file.before === undefined}>
                Complete original file
              </option>
              <option value="new" disabled={file.after === undefined}>
                Complete updated file
              </option>
            </select>
          </label>
          <button aria-pressed={split} onClick={() => setSplit(!split)}>
            {split ? 'Unified view' : 'Side-by-side view'}
          </button>
          {mode === 'diff' && file.status === 'modified' && (
            <button
              aria-pressed={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Collapse context' : 'Expand all context'}
            </button>
          )}
        </div>
      </div>
      <div className="line-help">
        {mode === 'old'
          ? 'Original version'
          : mode === 'new'
            ? 'Updated version'
            : file.status === 'unchanged'
              ? 'Unchanged context'
              : 'Original (old) and updated (new) line numbers'}{' '}
        {readOnly
          ? ' · Saved review, read-only.'
          : ' · Click a line number to write a note. Shift-click another line on the same side to select a range.'}
      </div>
      {selection && mode !== 'diff' && selection.side !== mode && (
        <button
          className="other-version-note"
          onClick={() => setMode(selection.side)}
        >
          Continue your note in the{' '}
          {selection.side === 'old' ? 'original' : 'updated'} file
        </button>
      )}
      {visible.length !== comments.length && (
        <button className="other-version-note" onClick={() => setMode('diff')}>
          Show notes on both versions
        </button>
      )}
      {hunks.length ? (
        <div className="diff-scroll">
          <Diff
            hunks={hunks}
            diffType={
              file.status === 'added'
                ? 'add'
                : file.status === 'deleted'
                  ? 'delete'
                  : 'modify'
            }
            viewType={split ? 'split' : 'unified'}
            tokens={tokens}
            widgets={widgets}
            selectedChanges={selectedKeys(hunks, selection)}
            renderGutter={({ change, side }) => {
              const line = lineOnSide(change, side);
              const available =
                line !== undefined &&
                (mode === 'diff' || mode === side) &&
                !(
                  file.status === 'unchanged' &&
                  mode === 'diff' &&
                  side === 'old'
                );
              if (!available) return null;
              return (
                <button
                  className="line-button"
                  disabled={readOnly}
                  aria-label={`Comment on ${side} line ${line}`}
                  aria-pressed={
                    selection?.side === side &&
                    line >= selection.startLine &&
                    line <= selection.endLine
                  }
                  onClick={(event) => onSelect(side, line, event.shiftKey)}
                >
                  {line}
                </button>
              );
            }}
          >
            {(rendered) =>
              rendered.map((hunk) => (
                <Fragment key={`${hunk.oldStart}-${hunk.newStart}`}>
                  {mode === 'diff' && file.status !== 'unchanged' && (
                    <Decoration>
                      <span className="hunk-label">{hunk.content}</span>
                    </Decoration>
                  )}
                  <Hunk hunk={hunk} />
                </Fragment>
              ))
            }
          </Diff>
        </div>
      ) : (
        <p className="empty-file">
          This file is empty. There are no lines to annotate.
        </p>
      )}
    </section>
  );
}
