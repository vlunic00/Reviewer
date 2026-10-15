import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadCases } from '../apps/server/src/cases.js';
import {
  candidatesFor,
  countIssues,
  snippet,
  validateAssessments,
} from '../apps/server/src/matching.js';
import type {
  AnswerKey,
  CommentAssessment,
  PublicExercise,
  ReviewComment,
} from '../packages/shared/src/index.js';

let key: AnswerKey;
let exercise: PublicExercise;
const comment = (
  side: 'old' | 'new' = 'new',
  startLine = 10,
): ReviewComment => ({
  id: randomUUID(),
  body: 'Counting exhausts rows; errors must propagate.',
  anchor: { filePath: 'app/refresh.py', side, startLine, endLine: startLine },
});
const finding = (
  matchedIssueId: string | null,
  status: 'supported' | 'unsupported' | 'uncertain' = 'supported',
) => ({
  matchedIssueId,
  status,
  feedback: 'Trace the iterator and exception path separately.',
});
beforeAll(async () => {
  ({ answerKey: key, exercise } = (await loadCases(resolve('data/cases'))).get(
    'py-medium-001',
  )!);
});

describe('bounded reference comparison', () => {
  it('matches ranges, five-line proximity, and authored old-side alternatives only', () => {
    expect(candidatesFor(comment(), key).map((issue) => issue.id)).toEqual([
      'issue-001',
      'issue-002',
    ]);
    expect(candidatesFor(comment('old'), key).map((issue) => issue.id)).toEqual(
      ['issue-002'],
    );
    expect(
      candidatesFor(comment('new', 18), key).map((issue) => issue.id),
    ).toEqual(['issue-001']);
    expect(candidatesFor(comment('new', 19), key)).toEqual([]);
    const otherFile = comment();
    otherFile.anchor.filePath = 'app/source.py';
    expect(candidatesFor(otherFile, key)).toEqual([]);
  });

  it('deduplicates multi-finding comments and ignores extra findings and conflicting rejected duplicates', () => {
    const comments = [comment(), comment()];
    const assessments: CommentAssessment[] = [
      {
        commentId: comments[0].id,
        findings: [finding('issue-001'), finding('issue-002'), finding(null)],
      },
      {
        commentId: comments[1].id,
        findings: [
          finding('issue-001', 'unsupported'),
          finding('issue-002', 'uncertain'),
        ],
      },
    ];
    expect(
      countIssues(key, validateAssessments(assessments, comments, key)),
    ).toEqual({
      foundIssueIds: ['issue-001', 'issue-002'],
      foundCount: 2,
      missedCount: 0,
    });
    expect(
      countIssues(key, [
        {
          commentId: comments[0].id,
          findings: [finding('issue-001', 'uncertain'), finding(null)],
        },
      ]),
    ).toEqual({ foundIssueIds: [], foundCount: 0, missedCount: 2 });
    expect(countIssues(key, [])).toEqual({
      foundIssueIds: [],
      foundCount: 0,
      missedCount: 2,
    });
  });

  it('rejects omitted/duplicate/unknown comments, invalid candidates, statuses, empty feedback, and numeric ratings', () => {
    const comments = [comment(), comment()];
    const first = {
      commentId: comments[0].id,
      findings: [finding('issue-001')],
    };
    const second = {
      commentId: comments[1].id,
      findings: [finding('issue-002')],
    };
    for (const input of [
      [first],
      [first, first],
      [first, { ...second, commentId: randomUUID() }],
      [first, { ...second, findings: [finding('unknown-issue')] }],
      [first, { ...second, findings: [] }],
      [
        first,
        { ...second, findings: [{ ...finding(null), status: 'correct' }] },
      ],
      [first, { ...second, findings: [{ ...finding(null), feedback: ' ' }] }],
      [first, { ...second, findings: [{ ...finding(null), correctness: 4 }] }],
    ])
      expect(() => validateAssessments(input, comments, key)).toThrow();
    expect(() =>
      validateAssessments(
        [{ ...first, findings: [finding('issue-001')] }],
        [{ ...comments[0], anchor: { ...comments[0].anchor, side: 'old' } }],
        key,
      ),
    ).toThrow(/candidates/);
  });

  it('builds numbered old/new snippets and bounds long selections', () => {
    expect(snippet(exercise, comment('old').anchor)).toContain('raise');
    expect(snippet(exercise, comment().anchor)).toContain('return []');
    const long = {
      ...exercise,
      files: [
        {
          path: 'long.ts',
          status: 'added' as const,
          after:
            Array.from({ length: 200 }, (_, index) => `line ${index + 1}`).join(
              '\r\n',
            ) + '\r\n',
        },
      ],
    };
    const text = snippet(long, {
      filePath: 'long.ts',
      side: 'new',
      startLine: 1,
      endLine: 200,
    });
    expect(text).toContain('1: line 1');
    expect(text).toContain('200: line 200');
    expect(text).toContain('truncated');
    expect(text.split('\n')).toHaveLength(81);
  });
});
