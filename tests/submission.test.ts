import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadCases, type LoadedCase } from '../apps/server/src/cases.js';
import {
  createAttempt,
  getAttempt,
  saveComments,
} from '../apps/server/src/attempts.js';
import {
  completeRun,
  failRun,
  getLearningAttempt,
  getReference,
  getRuns,
  listAttempts,
  retryAssessment,
  submitAttempt,
} from '../apps/server/src/assessment-store.js';
import { getProgress, openDatabase } from '../apps/server/src/database.js';
import type { ReviewComment } from '../packages/shared/src/index.js';

let loaded: LoadedCase;
const comment = (): ReviewComment => ({
  id: randomUUID(),
  body: 'Counting exhausts rows and the handler hides errors.',
  anchor: {
    filePath: 'app/refresh.py',
    side: 'new',
    startLine: 9,
    endLine: 13,
  },
});
beforeAll(async () => {
  loaded = (await loadCases(resolve('data/cases'))).get('py-medium-001')!;
});

describe('immutable submission and assessment history', () => {
  it('locks only the saved version, prevents duplicate submissions/retries, and exposes lessons only after submission', () => {
    const db = openDatabase(':memory:');
    try {
      const draft = createAttempt(db, loaded);
      expect(getLearningAttempt(db, draft.id)).not.toHaveProperty('results');
      expect(() => retryAssessment(db, draft.id)).toThrow(/Finish/);
      saveComments(db, draft.id, { version: 0, comments: [comment()] });
      expect(() => submitAttempt(db, draft.id, 0)).toThrow(/changed/);
      expect(getAttempt(db, draft.id).state).toBe('draft');
      expect(getRuns(db, draft.id)).toEqual([]);
      const run = submitAttempt(db, draft.id, 1);
      expect(run).toBeTruthy();
      expect(submitAttempt(db, draft.id, 0)).toBeNull();
      expect(retryAssessment(db, draft.id)).toBeNull();
      expect(getRuns(db, draft.id)).toHaveLength(1);
      expect(getProgress(db).get(loaded.exercise.id)).toBe('completed');
      expect(() =>
        saveComments(db, draft.id, { version: 1, comments: [] }),
      ).toThrow(/cannot be edited/);
      expect(getLearningAttempt(db, draft.id).results?.lessons).toEqual(
        loaded.answerKey.issues,
      );
      expect(getRuns(db, draft.id)[0].summary).toBeNull();
    } finally {
      db.close();
    }
  });

  it('finishes empty reviews without model usage or invented comment feedback', () => {
    const db = openDatabase(':memory:');
    try {
      const draft = createAttempt(db, loaded);
      submitAttempt(db, draft.id, 0);
      expect(getRuns(db, draft.id)[0]).toMatchObject({
        status: 'succeeded',
        mode: 'Self-review',
        model: null,
        digest: null,
        assessments: [],
        summary: { foundIssueIds: [], foundCount: 0, missedCount: 2 },
      });
    } finally {
      db.close();
    }
  });

  it('publishes only complete validated feedback, preserves previous successes, and reassesses saved snapshots', () => {
    const db = openDatabase(':memory:');
    const source = structuredClone(loaded);
    try {
      const draft = createAttempt(db, source);
      const note = comment();
      saveComments(db, draft.id, { version: 0, comments: [note] });
      const run = submitAttempt(db, draft.id, 1)!;
      source.answerKey.issues = [];
      source.exercise.files = [];
      expect(() => completeRun(db, run, [])).toThrow(/every comment/);
      expect(getRuns(db, draft.id)[0]).toMatchObject({
        status: 'pending',
        assessments: [],
        summary: null,
      });
      completeRun(db, run, [
        {
          commentId: note.id,
          findings: [
            {
              matchedIssueId: 'issue-001',
              status: 'supported',
              feedback: 'You traced the consumer correctly.',
            },
            {
              matchedIssueId: 'issue-002',
              status: 'uncertain',
              feedback: 'Clarify the exception contract.',
            },
          ],
        },
      ]);
      const retry = retryAssessment(db, draft.id)!;
      failRun(db, retry, 'Ollama is unavailable. Start it, then retry.');
      const history = getLearningAttempt(db, draft.id).results!;
      expect(history.lessons).toEqual(loaded.answerKey.issues);
      expect(history.runs.map((entry) => entry.status)).toEqual([
        'failed',
        'succeeded',
      ]);
      expect(history.runs[1].summary).toEqual({
        foundIssueIds: ['issue-001'],
        foundCount: 1,
        missedCount: 1,
      });
      expect(history.runs[1].assessments).toHaveLength(1);
      expect(listAttempts(db)[0]).toMatchObject({
        state: 'submitted',
        latestStatus: 'failed',
        summary: history.runs[1].summary,
      });
      expect(() => completeRun(db, retry, [])).toThrow(/no longer active/);
    } finally {
      db.close();
    }
  });

  it('retains snapshots and successful feedback after source files change, disappear, and interrupted jobs restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'reviewer-assessment-'));
    const path = join(directory, 'app.sqlite');
    const casesPath = join(directory, 'cases');
    let db = openDatabase(path);
    try {
      await mkdir(casesPath);
      const exercisePath = join(casesPath, 'exercise.json');
      const keyPath = join(casesPath, 'answer-key.json');
      await writeFile(exercisePath, JSON.stringify(loaded.exercise));
      await writeFile(keyPath, JSON.stringify(loaded.answerKey));
      const source = (await loadCases(casesPath)).get(loaded.exercise.id)!;
      const note = comment();
      const saved = createAttempt(db, source);
      saveComments(db, saved.id, { version: 0, comments: [note] });
      const feedback = [
        {
          commentId: note.id,
          findings: [
            {
              matchedIssueId: 'issue-001',
              status: 'supported' as const,
              feedback: 'The second consumer receives no rows.',
            },
          ],
        },
      ];
      completeRun(db, submitAttempt(db, saved.id, 1)!, feedback);
      const success = getRuns(db, saved.id)[0];
      const retry = retryAssessment(db, saved.id)!;
      db.prepare(
        "UPDATE assessment_runs SET status = 'running' WHERE id = ?",
      ).run(retry);
      const ids = ['pending', 'running'].map((status) => {
        const draft = createAttempt(db, source);
        saveComments(db, draft.id, { version: 0, comments: [comment()] });
        const run = submitAttempt(db, draft.id, 1)!;
        db.prepare('UPDATE assessment_runs SET status = ? WHERE id = ?').run(
          status,
          run,
        );
        return draft.id;
      });
      source.exercise.revision++;
      source.answerKey.revision++;
      source.answerKey.issues[0].explanation =
        'A changed lesson for future reviews.';
      await writeFile(exercisePath, JSON.stringify(source.exercise));
      await writeFile(keyPath, JSON.stringify(source.answerKey));
      expect(
        (await loadCases(casesPath)).get(loaded.exercise.id)!.exercise.revision,
      ).toBe(loaded.exercise.revision + 1);
      await rm(exercisePath);
      await rm(keyPath);
      expect((await loadCases(casesPath)).size).toBe(0);
      db.close();
      db = openDatabase(path);
      for (const id of [saved.id, ...ids]) {
        expect(getLearningAttempt(db, id).results!.lessons).toEqual(
          loaded.answerKey.issues,
        );
        expect(getRuns(db, id)[0]).toMatchObject({
          status: 'failed',
          summary: null,
          error: expect.stringContaining('interrupted'),
        });
        expect(retryAssessment(db, id)).toBeTruthy();
      }
      expect(getAttempt(db, saved.id)).toMatchObject({
        state: 'submitted',
        exercise: loaded.exercise,
        comments: [note],
      });
      expect(getReference(db, saved.id)).toEqual({
        exercise: loaded.exercise,
        key: loaded.answerKey,
      });
      expect(getRuns(db, saved.id)[2]).toEqual(success);
      completeRun(db, getRuns(db, saved.id)[0].id, feedback);
      expect(getRuns(db, saved.id).map((run) => run.status)).toEqual([
        'succeeded',
        'failed',
        'succeeded',
      ]);
      expect(getRuns(db, saved.id)[0].summary).toEqual(success.summary);
      expect(getRuns(db, saved.id)[2]).toEqual(success);
    } finally {
      db.close();
      const target = resolve(directory);
      if (
        !target.startsWith(resolve(tmpdir()) + sep) ||
        !basename(target).startsWith('reviewer-assessment-')
      )
        throw new Error('Unsafe cleanup target.');
      await rm(target, { recursive: true, force: true });
    }
  });
});
