import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { createTwoFilesPatch } from 'diff';
import {
  attemptSchema,
  exerciseSchema,
  reviewCommentSchema,
  saveCommentsSchema,
  validateAnchor,
  type PublicExercise,
  type ReviewAttempt,
} from '../../../packages/shared/src/index.js';
import type { LoadedCase } from './cases.js';

export class AttemptError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function buildDiffs(exercise: PublicExercise): Record<string, string> {
  return Object.fromEntries(
    exercise.files.map((file) => [
      file.path,
      `diff --git a/${file.path} b/${file.path}\n` +
        createTwoFilesPatch(
          `a/${file.path}`,
          `b/${file.path}`,
          (file.before ?? '').replace(/\r\n/g, '\n'),
          (file.after ?? '').replace(/\r\n/g, '\n'),
          '',
          '',
          { context: 3 },
        ),
    ]),
  );
}

export function getAttempt(database: DatabaseSync, id: string): ReviewAttempt {
  const row = database
    .prepare(
      'SELECT id, state, started_at, exercise_snapshot, draft_version FROM attempts WHERE id = ?',
    )
    .get(id);
  if (!row) throw new AttemptError(404, 'Review draft not found.');
  const exercise = exerciseSchema.parse(
    JSON.parse(String(row.exercise_snapshot)),
  );
  const comments = database
    .prepare(
      'SELECT id, file_path, side, start_line, end_line, body FROM review_comments WHERE attempt_id = ? ORDER BY position',
    )
    .all(id)
    .map((comment) =>
      reviewCommentSchema.parse({
        id: comment.id,
        body: comment.body,
        anchor: {
          filePath: comment.file_path,
          side: comment.side,
          startLine: comment.start_line,
          endLine: comment.end_line,
        },
      }),
    );
  return attemptSchema.parse({
    id: row.id,
    state: row.state,
    startedAt: row.started_at,
    version: row.draft_version,
    exercise,
    comments,
    diffs: buildDiffs(exercise),
  });
}

export function createAttempt(
  database: DatabaseSync,
  loaded: LoadedCase,
): ReviewAttempt {
  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO attempts
    (id, exercise_id, revision, checksum, exercise_snapshot, answer_key_snapshot, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      loaded.exercise.id,
      loaded.exercise.revision,
      loaded.checksum,
      JSON.stringify(loaded.exercise),
      JSON.stringify(loaded.answerKey),
      new Date().toISOString(),
    );
  return getAttempt(database, id);
}

export function saveComments(
  database: DatabaseSync,
  id: string,
  input: unknown,
): ReviewAttempt {
  const { version, comments } = saveCommentsSchema.parse(input);
  database.exec('BEGIN IMMEDIATE');
  try {
    const attempt = getAttempt(database, id);
    if (attempt.state !== 'draft')
      throw new AttemptError(409, 'Submitted reviews cannot be edited.');
    if (version !== attempt.version) {
      if (JSON.stringify(comments) === JSON.stringify(attempt.comments)) {
        database.exec('COMMIT');
        return attempt;
      }
      throw new AttemptError(
        409,
        'This draft changed in another tab. Your edits have been kept; review the other tab before saving.',
      );
    }
    for (const comment of comments) {
      try {
        validateAnchor(attempt.exercise, comment.anchor);
      } catch {
        throw new AttemptError(
          400,
          'A comment must refer to real lines in this review snapshot.',
        );
      }
    }
    database
      .prepare('DELETE FROM review_comments WHERE attempt_id = ?')
      .run(id);
    const insert = database.prepare(`INSERT INTO review_comments
      (attempt_id, id, position, file_path, side, start_line, end_line, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    comments.forEach((comment, position) =>
      insert.run(
        id,
        comment.id,
        position,
        comment.anchor.filePath,
        comment.anchor.side,
        comment.anchor.startLine,
        comment.anchor.endLine,
        comment.body,
      ),
    );
    database
      .prepare(
        'UPDATE attempts SET draft_version = draft_version + 1 WHERE id = ?',
      )
      .run(id);
    const saved = getAttempt(database, id);
    database.exec('COMMIT');
    return saved;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
