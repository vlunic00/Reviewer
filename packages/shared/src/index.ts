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
});
export type CaseSummary = z.infer<typeof caseSummarySchema>;
