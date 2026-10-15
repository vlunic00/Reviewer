import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { getAttempt } from './attempts.js';
import { completeRun, failRun, getReference } from './assessment-store.js';
import { OllamaAssessor } from './ollama.js';

export class AssessmentService {
  private queue = Promise.resolve();
  private controller = new AbortController();
  constructor(
    private database: DatabaseSync,
    readonly provider: Pick<
      OllamaAssessor,
      'model' | 'inspect' | 'evaluate' | 'status'
    > = new OllamaAssessor(),
  ) {}

  enqueue(runId: string | null) {
    if (!runId || this.controller.signal.aborted) return;
    this.queue = this.queue
      .then(() => this.run(runId))
      .catch((error) => {
        console.error('Could not save AI feedback status.', error);
      });
  }

  stop() {
    this.controller.abort();
  }

  private async run(runId: string) {
    const signal = this.controller.signal;
    if (signal.aborted) return;
    try {
      const row = this.database
        .prepare(
          "SELECT attempt_id FROM assessment_runs WHERE id = ? AND status = 'pending'",
        )
        .get(runId);
      if (!row) return;
      this.database
        .prepare(
          "UPDATE assessment_runs SET status = 'running', started_at = ?, model = ? WHERE id = ?",
        )
        .run(new Date().toISOString(), this.provider.model, runId);
      const attempt = getAttempt(this.database, String(row.attempt_id));
      const { exercise, key } = getReference(this.database, attempt.id);
      const model = await this.provider.inspect(signal);
      if (signal.aborted) return;
      this.database
        .prepare(
          'UPDATE assessment_runs SET model = ?, digest = ? WHERE id = ?',
        )
        .run(model.model, model.digest, runId);
      const assessments = [];
      for (const comment of attempt.comments) {
        if (signal.aborted) return;
        assessments.push(
          await this.provider.evaluate(exercise, key, comment, model, signal),
        );
      }
      if (!signal.aborted) completeRun(this.database, runId, assessments);
    } catch (error) {
      if (!signal.aborted)
        failRun(
          this.database,
          runId,
          error instanceof z.ZodError || error instanceof SyntaxError
            ? 'Ollama returned invalid feedback or model metadata. Update Ollama and choose Retry AI feedback.'
            : error instanceof Error
              ? error.message
              : 'AI feedback failed. Choose Retry AI feedback.',
        );
    }
  }
}
