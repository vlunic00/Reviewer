import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  answerKeySchema,
  assessmentRunSchema,
  attemptSummarySchema,
  exerciseSchema,
  learningResultsSchema,
  validateAnswerKey,
  type CommentAssessment,
} from '../../../packages/shared/src/index.js';
import { AttemptError, getAttempt } from './attempts.js';
import { countIssues, validateAssessments } from './matching.js';

export const PROMPT_VERSION = '1';
export const ASSESSMENT_VERSION = '1';

export function getReference(database: DatabaseSync, id: string) {
  const row = database
    .prepare(
      'SELECT exercise_snapshot, answer_key_snapshot FROM attempts WHERE id = ?',
    )
    .get(id);
  if (!row) throw new AttemptError(404, 'Review not found.');
  const exercise = exerciseSchema.parse(
    JSON.parse(String(row.exercise_snapshot)),
  );
  const key = answerKeySchema.parse(
    JSON.parse(String(row.answer_key_snapshot)),
  );
  validateAnswerKey(exercise, key);
  return { exercise, key };
}

export function getRuns(database: DatabaseSync, id: string) {
  return database
    .prepare(
      'SELECT * FROM assessment_runs WHERE attempt_id = ? ORDER BY rowid DESC',
    )
    .all(id)
    .map((row) =>
      assessmentRunSchema.parse({
        id: row.id,
        status: row.status,
        mode: row.mode,
        model: row.model,
        digest: row.digest,
        promptVersion: row.prompt_version,
        assessmentVersion: row.assessment_version,
        createdAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        summary: row.summary ? JSON.parse(String(row.summary)) : null,
        error: row.error,
        assessments: database
          .prepare(
            'SELECT comment_id, findings FROM comment_assessments WHERE run_id = ? ORDER BY position',
          )
          .all(row.id)
          .map((entry) => ({
            commentId: entry.comment_id,
            findings: JSON.parse(String(entry.findings)),
          })),
      }),
    );
}

export function getLearningAttempt(database: DatabaseSync, id: string) {
  const attempt = getAttempt(database, id);
  if (attempt.state === 'draft') return attempt;
  const { key } = getReference(database, id);
  return {
    ...attempt,
    results: learningResultsSchema.parse({
      lessons: key.issues,
      runs: getRuns(database, id),
    }),
  };
}

export function listAttempts(database: DatabaseSync) {
  return database
    .prepare(
      'SELECT id, exercise_snapshot, state, started_at, submitted_at FROM attempts ORDER BY started_at DESC, rowid DESC',
    )
    .all()
    .map((row) => {
      const exercise = exerciseSchema.parse(
        JSON.parse(String(row.exercise_snapshot)),
      );
      const runs = getRuns(database, String(row.id));
      return attemptSummarySchema.parse({
        id: row.id,
        exerciseId: exercise.id,
        title: exercise.title,
        language: exercise.language,
        difficulty: exercise.difficulty,
        revision: exercise.revision,
        state: row.state,
        startedAt: row.started_at,
        submittedAt: row.submitted_at,
        latestStatus: runs[0]?.status ?? null,
        summary:
          runs.find((run) => run.status === 'succeeded')?.summary ?? null,
      });
    });
}

function insertRun(database: DatabaseSync, id: string) {
  const attempt = getAttempt(database, id);
  const runId = randomUUID();
  const time = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO assessment_runs
    (id, attempt_id, status, mode, prompt_version, assessment_version, created_at)
    VALUES (?, ?, 'pending', ?, ?, ?, ?)`,
    )
    .run(
      runId,
      id,
      attempt.comments.length ? 'AI-assisted' : 'Self-review',
      PROMPT_VERSION,
      ASSESSMENT_VERSION,
      time,
    );
  if (!attempt.comments.length) {
    const { key } = getReference(database, id);
    database
      .prepare(
        `UPDATE assessment_runs SET status = 'succeeded', summary = ?, started_at = ?, completed_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(countIssues(key, [])), time, time, runId);
  }
  return runId;
}

export function submitAttempt(
  database: DatabaseSync,
  id: string,
  version: number,
) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const attempt = getAttempt(database, id);
    let runId: string | null = null;
    if (attempt.state === 'draft') {
      if (attempt.version !== version)
        throw new AttemptError(
          409,
          'The saved review changed. Reload it before submitting; your notes have been kept.',
        );
      getReference(database, id);
      database
        .prepare(
          "UPDATE attempts SET state = 'submitted', submitted_at = ? WHERE id = ?",
        )
        .run(new Date().toISOString(), id);
      runId = insertRun(database, id);
    }
    database.exec('COMMIT');
    return runId;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function retryAssessment(database: DatabaseSync, id: string) {
  database.exec('BEGIN IMMEDIATE');
  try {
    if (getAttempt(database, id).state !== 'submitted')
      throw new AttemptError(
        409,
        'Finish this review before requesting AI feedback.',
      );
    const active = database
      .prepare(
        "SELECT id FROM assessment_runs WHERE attempt_id = ? AND status IN ('pending', 'running')",
      )
      .get(id);
    const runId = active ? null : insertRun(database, id);
    database.exec('COMMIT');
    return runId;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function completeRun(
  database: DatabaseSync,
  runId: string,
  input: unknown,
) {
  const row = database
    .prepare('SELECT attempt_id, status FROM assessment_runs WHERE id = ?')
    .get(runId);
  if (!row || !['pending', 'running'].includes(String(row.status)))
    throw new Error('Assessment is no longer active.');
  const attempt = getAttempt(database, String(row.attempt_id));
  const { key } = getReference(database, attempt.id);
  const assessments: CommentAssessment[] = validateAssessments(
    input,
    attempt.comments,
    key,
  );
  database.exec('BEGIN IMMEDIATE');
  try {
    const insert = database.prepare(
      'INSERT INTO comment_assessments (run_id, comment_id, position, findings) VALUES (?, ?, ?, ?)',
    );
    assessments.forEach((entry, position) =>
      insert.run(
        runId,
        entry.commentId,
        position,
        JSON.stringify(entry.findings),
      ),
    );
    database
      .prepare(
        "UPDATE assessment_runs SET status = 'succeeded', summary = ?, completed_at = ?, error = NULL WHERE id = ?",
      )
      .run(
        JSON.stringify(countIssues(key, assessments)),
        new Date().toISOString(),
        runId,
      );
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function failRun(database: DatabaseSync, runId: string, error: string) {
  database
    .prepare(
      "UPDATE assessment_runs SET status = 'failed', completed_at = ?, error = ? WHERE id = ? AND status IN ('pending', 'running')",
    )
    .run(new Date().toISOString(), error, runId);
}
