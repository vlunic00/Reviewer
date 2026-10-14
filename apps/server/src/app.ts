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
import {
  AttemptError,
  createAttempt,
  getAttempt,
  saveComments,
} from './attempts.js';

export function createApp(
  cases: Map<string, LoadedCase>,
  database: DatabaseSync,
  allowedOrigins: string[],
) {
  const app = express();
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
  app.get('/api/attempts/:id', (request, response) => {
    response.json(getAttempt(database, z.uuid().parse(request.params.id)));
  });
  app.put('/api/attempts/:id/comments', (request, response) => {
    response.json(
      saveComments(database, z.uuid().parse(request.params.id), request.body),
    );
  });
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
      response
        .status(400)
        .json({
          error:
            'Invalid request data. Check the comment fields and line range.',
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
