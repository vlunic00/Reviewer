import express, { type ErrorRequestHandler } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  caseIdSchema,
  caseSummarySchema,
  difficultySchema,
  languageSchema,
  languages,
} from '../../../packages/shared/src/index.js';
import type { LoadedCase } from './cases.js';
import { getProgress } from './database.js';
import { AttemptError, createAttempt, saveComments } from './attempts.js';
import { AssessmentService } from './assessment-service.js';
import {
  getLearningAttempt,
  listAttempts,
  retryAssessment,
  submitAttempt,
} from './assessment-store.js';

export function createApp(
  cases: Map<string, LoadedCase>,
  database: DatabaseSync,
  allowedOrigins: string[],
  assessments = new AssessmentService(database),
) {
  const app = express();
  app.locals.assessments = assessments;
  app.disable('x-powered-by');
  const hosts = new Set(allowedOrigins.map((origin) => new URL(origin).host));
  app.use((request, response, next) => {
    const origin = request.get('origin');
    if (
      !hosts.has(request.get('host') ?? '') ||
      (origin && !allowedOrigins.includes(origin))
    ) {
      response
        .status(403)
        .json({ error: 'Only the local application can access this API.' });
      return;
    }
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
      !request.is('application/json')
    ) {
      response
        .status(415)
        .json({ error: 'Mutation requests must use application/json.' });
      return;
    }
    next();
  });
  app.use('/api', (_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '5mb' }));
  app.get('/api/languages', (_request, response) => response.json(languages));
  app.get('/api/cases', (request, response) => {
    const language = languageSchema.safeParse(request.query.language);
    const difficulty = difficultySchema.safeParse(request.query.difficulty);
    if (!language.success || !difficulty.success) {
      response
        .status(400)
        .json({ error: 'Choose a supported language and difficulty.' });
      return;
    }
    const progress = getProgress(database);
    const draftRows = database
      .prepare(
        "SELECT id, exercise_id FROM attempts WHERE state = 'draft' ORDER BY started_at, rowid",
      )
      .all();
    const drafts = new Map(
      draftRows.map((row) => [String(row.exercise_id), String(row.id)]),
    );
    const submitted = new Map(
      database
        .prepare(
          "SELECT id, exercise_id FROM attempts WHERE state = 'submitted' ORDER BY submitted_at, rowid",
        )
        .all()
        .map((row) => [String(row.exercise_id), String(row.id)]),
    );
    const summaries = [...cases.values()]
      .filter(
        ({ exercise }) =>
          exercise.language === language.data &&
          exercise.difficulty === difficulty.data,
      )
      .map(({ exercise }) =>
        caseSummarySchema.parse({
          id: exercise.id,
          revision: exercise.revision,
          language: exercise.language,
          difficulty: exercise.difficulty,
          title: exercise.title,
          description: exercise.description,
          changedFileCount: exercise.files.filter(
            (file) => file.status !== 'unchanged',
          ).length,
          status: progress.get(exercise.id) ?? 'not_started',
          draftAttemptId: drafts.get(exercise.id) ?? null,
          latestAttemptId: submitted.get(exercise.id) ?? null,
        }),
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    response.json(summaries);
  });
  app.get('/api/cases/:id', (request, response) => {
    const id = caseIdSchema.safeParse(request.params.id);
    if (!id.success) {
      response.status(400).json({ error: 'Invalid exercise ID.' });
      return;
    }
    const loaded = cases.get(id.data);
    if (!loaded) {
      response.status(404).json({ error: 'Exercise not found.' });
      return;
    }
    response.json(loaded.exercise);
  });
  app.post('/api/attempts', (request, response) => {
    const { exerciseId } = z
      .strictObject({ exerciseId: caseIdSchema })
      .parse(request.body);
    const loaded = cases.get(exerciseId);
    if (!loaded) throw new AttemptError(404, 'Exercise not found.');
    response.status(201).json(createAttempt(database, loaded));
  });
  app.get('/api/attempts', (_request, response) =>
    response.json(listAttempts(database)),
  );
  app.get('/api/attempts/:id', (request, response) => {
    response.json(
      getLearningAttempt(database, z.uuid().parse(request.params.id)),
    );
  });
  app.put('/api/attempts/:id/comments', (request, response) => {
    response.json(
      saveComments(database, z.uuid().parse(request.params.id), request.body),
    );
  });
  app.post('/api/attempts/:id/submit', (request, response) => {
    const id = z.uuid().parse(request.params.id);
    const { version } = z
      .strictObject({ version: z.number().int().nonnegative() })
      .parse(request.body);
    const runId = submitAttempt(database, id, version);
    assessments.enqueue(runId);
    response.status(202).json(getLearningAttempt(database, id));
  });
  app.post('/api/attempts/:id/regrade', (request, response) => {
    const id = z.uuid().parse(request.params.id);
    z.strictObject({}).parse(request.body);
    assessments.enqueue(retryAssessment(database, id));
    response.status(202).json(getLearningAttempt(database, id));
  });
  app.get('/api/system/grader', async (_request, response) =>
    response.json(await assessments.provider.status()),
  );
  app.use('/api', (_request, response) =>
    response.status(404).json({ error: 'API route not found.' }),
  );
  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    if (error instanceof AttemptError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    if (
      error instanceof z.ZodError ||
      (error instanceof SyntaxError && 'body' in error)
    ) {
      response.status(400).json({
        error: 'Invalid request data. Check the comment fields and line range.',
      });
      return;
    }
    if (error?.type === 'entity.too.large') {
      response.status(413).json({ error: 'The review is too large to save.' });
      return;
    }
    console.error(error);
    response
      .status(500)
      .json({ error: 'The local server could not complete the request.' });
  };
  app.use(errorHandler);
  return app;
}
