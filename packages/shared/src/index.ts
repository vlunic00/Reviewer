import { z } from 'zod';

export const languageSchema = z.enum(['typescript', 'python', 'cpp', 'rust']);
export const difficultySchema = z.enum(['easy', 'medium', 'hard']);
export type Language = z.infer<typeof languageSchema>;
export type Difficulty = z.infer<typeof difficultySchema>;

export const languages = [
  { id: 'typescript', label: 'TypeScript' },
  { id: 'python', label: 'Python' },
  { id: 'cpp', label: 'C++' },
  { id: 'rust', label: 'Rust' },
] as const;
export const difficulties = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
] as const;

export const caseIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const textSchema = z.string().trim().min(1);
const filePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !/[\\:\x00-\x1f]/.test(value) &&
      value
        .split('/')
        .every((part) => part !== '' && part !== '.' && part !== '..'),
    'Use a relative file path with forward slashes and no traversal segments.',
  );

export const anchorSchema = z
  .strictObject({
    filePath: filePathSchema,
    side: z.enum(['old', 'new']),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .refine(
    (anchor) => anchor.endLine >= anchor.startLine,
    'Line ranges must be ordered.',
  );
export type ReviewCommentAnchor = z.infer<typeof anchorSchema>;

const fileSchema = z
  .strictObject({
    path: filePathSchema,
    status: z.enum(['added', 'modified', 'deleted', 'unchanged']),
    before: z.string().optional(),
    after: z.string().optional(),
  })
  .superRefine((file, context) => {
    const valid =
      file.status === 'added'
        ? file.before === undefined && file.after !== undefined
        : file.status === 'deleted'
          ? file.before !== undefined && file.after === undefined
          : file.before !== undefined &&
            file.after !== undefined &&
            (file.status === 'unchanged'
              ? file.before === file.after
              : file.before !== file.after);
    if (!valid)
      context.addIssue({
        code: 'custom',
        message: 'File versions do not match its status.',
      });
  });

export const exerciseSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: caseIdSchema,
    revision: z.number().int().positive(),
    language: languageSchema,
    difficulty: difficultySchema,
    title: textSchema,
    description: textSchema,
    commitMessage: textSchema,
    reviewContext: textSchema.optional(),
    files: z.array(fileSchema).min(1),
    tags: z.array(textSchema).optional(),
  })
  .superRefine((exercise, context) => {
    if (
      new Set(exercise.files.map((file) => file.path)).size !==
      exercise.files.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: 'File paths must be unique.',
      });
    }
  });
export type PublicExercise = z.infer<typeof exerciseSchema>;

const issueSchema = z.strictObject({
  id: caseIdSchema,
  title: textSchema,
  category: textSchema,
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  locations: z.array(anchorSchema).min(1),
  summary: textSchema,
  explanation: textSchema,
  failureExample: textSchema,
  correctedCode: z
    .array(
      z.strictObject({
        filePath: filePathSchema,
        code: z
          .string()
          .refine(
            (code) => code.trim().length > 0,
            'Corrected code must not be empty.',
          ),
      }),
    )
    .min(1),
  prevention: textSchema,
  whyItMatters: textSchema,
  acceptableExplanations: z.array(textSchema).min(1),
  keyConcepts: z.array(textSchema).min(1),
  commonConfusions: z.array(textSchema),
  suggestedFix: textSchema,
  reviewHints: textSchema.optional(),
});

export const answerKeySchema = z
  .strictObject({
    exerciseId: caseIdSchema,
    revision: z.number().int().positive(),
    issues: z.array(issueSchema).min(1),
  })
  .superRefine((key, context) => {
    if (
      new Set(key.issues.map((issue) => issue.id)).size !== key.issues.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['issues'],
        message: 'Issue IDs must be unique.',
      });
    }
  });
export type AnswerKey = z.infer<typeof answerKeySchema>;

export function sourceLines(source: string): string[] {
  if (source === '') return [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

export function validateAnchor(
  exercise: PublicExercise,
  anchor: ReviewCommentAnchor,
): void {
  anchorSchema.parse(anchor);
  const file = exercise.files.find(
    (candidate) => candidate.path === anchor.filePath,
  );
  const source = anchor.side === 'old' ? file?.before : file?.after;
  if (source === undefined || anchor.endLine > sourceLines(source).length) {
    throw new Error(
      `Anchor does not refer to real ${anchor.side}-side lines in ${anchor.filePath}.`,
    );
  }
}

export function validateAnswerKey(
  exercise: PublicExercise,
  key: AnswerKey,
): void {
  if (exercise.id !== key.exerciseId || exercise.revision !== key.revision) {
    throw new Error(
      'Answer-key exercise ID/revision does not match the exercise.',
    );
  }
  for (const issue of key.issues) {
    for (const location of issue.locations) validateAnchor(exercise, location);
    for (const correction of issue.correctedCode) {
      if (!exercise.files.some((file) => file.path === correction.filePath)) {
        throw new Error(
          `Corrected code refers to an unknown file: ${correction.filePath}.`,
        );
      }
    }
  }
}

export const caseSummarySchema = z.strictObject({
  id: caseIdSchema,
  revision: exerciseSchema.shape.revision,
  language: languageSchema,
  difficulty: difficultySchema,
  title: textSchema,
  description: textSchema,
  changedFileCount: z.number().int().nonnegative(),
  status: z.enum(['not_started', 'in_progress', 'completed']),
  draftAttemptId: z.string().min(1).nullable().optional(),
  latestAttemptId: z.uuid().nullable().optional(),
});
export type CaseSummary = z.infer<typeof caseSummarySchema>;

export const reviewCommentSchema = z.strictObject({
  id: z.uuid(),
  anchor: anchorSchema,
  body: z.string().trim().min(1).max(8000),
});
export type ReviewComment = z.infer<typeof reviewCommentSchema>;
export const commentsSchema = z
  .array(reviewCommentSchema)
  .max(500)
  .superRefine((comments, context) => {
    if (
      new Set(comments.map((comment) => comment.id)).size !== comments.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Comment IDs must be unique.',
      });
    }
  });
export const saveCommentsSchema = z.strictObject({
  version: z.number().int().nonnegative(),
  comments: commentsSchema,
});

export const commentAssessmentSchema = z.strictObject({
  commentId: z.uuid(),
  findings: z
    .array(
      z.strictObject({
        matchedIssueId: caseIdSchema.nullable(),
        status: z.enum(['supported', 'unsupported', 'uncertain']),
        feedback: textSchema.max(8000),
      }),
    )
    .min(1)
    .max(100),
});
export type CommentAssessment = z.infer<typeof commentAssessmentSchema>;
export const issueCountsSchema = z.strictObject({
  foundIssueIds: z.array(caseIdSchema),
  foundCount: z.number().int().nonnegative(),
  missedCount: z.number().int().nonnegative(),
});
export const assessmentRunSchema = z.strictObject({
  id: z.uuid(),
  status: z.enum(['pending', 'running', 'succeeded', 'failed']),
  mode: z.enum(['AI-assisted', 'Self-review']),
  model: z.string().nullable(),
  digest: z.string().nullable(),
  promptVersion: textSchema,
  assessmentVersion: textSchema,
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  summary: issueCountsSchema.nullable(),
  assessments: z.array(commentAssessmentSchema),
  error: z.string().nullable(),
});
export type AssessmentRun = z.infer<typeof assessmentRunSchema>;
export const learningResultsSchema = z.strictObject({
  lessons: z.array(issueSchema).min(1),
  runs: z.array(assessmentRunSchema),
});
export const attemptSummarySchema = z.strictObject({
  id: z.uuid(),
  exerciseId: caseIdSchema,
  title: textSchema,
  language: languageSchema,
  difficulty: difficultySchema,
  revision: z.number().int().positive(),
  state: z.enum(['draft', 'submitted']),
  startedAt: z.string(),
  submittedAt: z.string().nullable(),
  latestStatus: assessmentRunSchema.shape.status.nullable(),
  summary: issueCountsSchema.nullable(),
});
export type AttemptSummary = z.infer<typeof attemptSummarySchema>;
export const graderStatusSchema = z.strictObject({
  available: z.boolean(),
  model: z.string(),
  url: z.string(),
  timeoutMs: z.number().int().positive(),
  error: z.string().nullable(),
});
export const attemptSchema = z.strictObject({
  id: z.uuid(),
  state: z.enum(['draft', 'submitted']),
  version: z.number().int().nonnegative(),
  startedAt: z.string(),
  exercise: exerciseSchema,
  comments: commentsSchema,
  diffs: z.record(filePathSchema, z.string()),
  results: learningResultsSchema.optional(),
});
export type ReviewAttempt = z.infer<typeof attemptSchema>;
