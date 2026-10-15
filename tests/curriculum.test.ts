import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { parseDiff } from 'react-diff-view';
import { describe, expect, it } from 'vitest';
import { loadCases } from '../apps/server/src/cases.js';
import { buildDiffs, createAttempt } from '../apps/server/src/attempts.js';
import {
  getLearningAttempt,
  submitAttempt,
} from '../apps/server/src/assessment-store.js';
import { openDatabase } from '../apps/server/src/database.js';
import { candidatesFor } from '../apps/server/src/matching.js';
import {
  changeForAnchor,
  fileHunks,
  lineOnSide,
} from '../apps/web/src/diff.js';

describe('seeded teaching content', () => {
  it('keeps every issue reachable through real diff lines and at least one changed-code anchor', async () => {
    for (const { exercise, answerKey } of (
      await loadCases(resolve('data/cases'))
    ).values()) {
      const diffs = buildDiffs(exercise);
      for (const issue of answerKey.issues) {
        const label = `${exercise.id}/${issue.id}`;
        let touchesChange = false;
        for (const anchor of issue.locations) {
          const file = exercise.files.find(
            (file) => file.path === anchor.filePath,
          )!;
          expect(
            changeForAnchor(
              fileHunks(file, diffs[file.path], 'diff', true),
              anchor,
            ),
            label,
          ).toBeDefined();
          expect(
            candidatesFor(
              { id: randomUUID(), body: issue.summary, anchor },
              answerKey,
            ).map((candidate) => candidate.id),
            label,
          ).toContain(issue.id);
          const changes =
            parseDiff(diffs[file.path])[0]?.hunks.flatMap(
              (hunk) => hunk.changes,
            ) ?? [];
          touchesChange ||= changes.some((change) => {
            const line = lineOnSide(change, anchor.side);
            return (
              change.type !== 'normal' &&
              line !== undefined &&
              line >= anchor.startLine &&
              line <= anchor.endLine
            );
          });
        }
        expect(
          touchesChange,
          `${label} needs an anchor on the introduced or removed behavior`,
        ).toBe(true);
      }
    }
  });

  it('makes all lessons available after an empty review in every seeded combination without AI', async () => {
    const database = openDatabase(':memory:');
    try {
      for (const loaded of (await loadCases(resolve('data/cases'))).values()) {
        const attempt = createAttempt(database, loaded);
        expect(getLearningAttempt(database, attempt.id)).not.toHaveProperty(
          'results',
        );
        submitAttempt(database, attempt.id, 0);
        const results = getLearningAttempt(database, attempt.id).results!;
        expect(results.lessons).toEqual(loaded.answerKey.issues);
        expect(results.runs[0]).toMatchObject({
          mode: 'Self-review',
          status: 'succeeded',
          model: null,
          assessments: [],
          summary: {
            foundIssueIds: [],
            foundCount: 0,
            missedCount: loaded.answerKey.issues.length,
          },
        });
      }
    } finally {
      database.close();
    }
  });
});
