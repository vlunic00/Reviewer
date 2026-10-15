import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CaseSummary } from '../../../packages/shared/src/index.js';

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  try {
    database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const version = database.prepare('PRAGMA user_version').get()?.user_version;
    if (version === 0) {
      database.exec(`
        BEGIN;
        CREATE TABLE attempts (
          id TEXT PRIMARY KEY,
          exercise_id TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision > 0),
          checksum TEXT NOT NULL,
          exercise_snapshot TEXT NOT NULL,
          answer_key_snapshot TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'submitted')),
          started_at TEXT NOT NULL,
          submitted_at TEXT,
          CHECK ((state = 'draft' AND submitted_at IS NULL)
            OR (state = 'submitted' AND submitted_at IS NOT NULL))
        );
        CREATE INDEX attempts_exercise ON attempts(exercise_id);
        PRAGMA user_version = 1;
        COMMIT;
      `);
    } else if (version !== 1 && version !== 2 && version !== 3) {
      throw new Error(
        'This progress database requires a newer application version.',
      );
    }
    if (version === 0 || version === 1) {
      database.exec(`
        BEGIN;
        ALTER TABLE attempts ADD COLUMN draft_version INTEGER NOT NULL DEFAULT 0 CHECK (draft_version >= 0);
        CREATE TABLE review_comments (
          attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
          id TEXT NOT NULL,
          position INTEGER NOT NULL,
          file_path TEXT NOT NULL,
          side TEXT NOT NULL CHECK (side IN ('old', 'new')),
          start_line INTEGER NOT NULL CHECK (start_line > 0),
          end_line INTEGER NOT NULL CHECK (end_line >= start_line),
          body TEXT NOT NULL,
          PRIMARY KEY (attempt_id, id)
        );
        PRAGMA user_version = 2;
        COMMIT;
      `);
    }
    if (version === 0 || version === 1 || version === 2) {
      database.exec(`
        BEGIN;
        CREATE TABLE assessment_runs (
          id TEXT PRIMARY KEY,
          attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
          status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
          mode TEXT NOT NULL CHECK (mode IN ('AI-assisted', 'Self-review')),
          model TEXT, digest TEXT,
          prompt_version TEXT NOT NULL, assessment_version TEXT NOT NULL,
          created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT,
          summary TEXT, error TEXT
        );
        CREATE UNIQUE INDEX one_active_assessment ON assessment_runs(attempt_id)
          WHERE status IN ('pending', 'running');
        CREATE TABLE comment_assessments (
          run_id TEXT NOT NULL REFERENCES assessment_runs(id) ON DELETE CASCADE,
          comment_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          findings TEXT NOT NULL,
          PRIMARY KEY (run_id, comment_id)
        );
        PRAGMA user_version = 3;
        COMMIT;
      `);
    }
    database
      .prepare(
        `UPDATE assessment_runs SET status = 'failed', completed_at = ?,
      error = 'AI feedback was interrupted by a server restart. Choose Retry AI feedback.'
      WHERE status IN ('pending', 'running')`,
      )
      .run(new Date().toISOString());
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function getProgress(
  database: DatabaseSync,
): Map<string, CaseSummary['status']> {
  const rows = database
    .prepare(
      `
    SELECT exercise_id, MAX(CASE WHEN state = 'submitted' THEN 1 ELSE 0 END) AS completed
    FROM attempts GROUP BY exercise_id
  `,
    )
    .all();
  return new Map(
    rows.map((row) => [
      String(row.exercise_id),
      row.completed === 1 ? 'completed' : 'in_progress',
    ]),
  );
}
