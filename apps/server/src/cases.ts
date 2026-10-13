import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  answerKeySchema,
  exerciseSchema,
  validateAnswerKey,
  type AnswerKey,
  type PublicExercise,
} from '../../../packages/shared/src/index.js';

export type LoadedCase = {
  exercise: PublicExercise;
  answerKey: AnswerKey;
  checksum: string;
};

export async function loadCases(
  directory: string,
): Promise<Map<string, LoadedCase>> {
  const cases = new Map<string, LoadedCase>();
  async function visit(folder: string): Promise<void> {
    const entries = await readdir(folder, { withFileTypes: true });
    if (entries.some((entry) => entry.isSymbolicLink())) {
      throw new Error('Case directories must not contain symbolic links.');
    }
    const exerciseFile = entries.find(
      (entry) => entry.name === 'exercise.json',
    );
    const keyFile = entries.find((entry) => entry.name === 'answer-key.json');
    if (Boolean(exerciseFile) !== Boolean(keyFile)) {
      throw new Error(
        `Incomplete case in ${folder}: both JSON files are required.`,
      );
    }
    if (exerciseFile && keyFile) {
      try {
        const exercise = exerciseSchema.parse(
          JSON.parse(await readFile(join(folder, 'exercise.json'), 'utf8')),
        );
        const answerKey = answerKeySchema.parse(
          JSON.parse(await readFile(join(folder, 'answer-key.json'), 'utf8')),
        );
        validateAnswerKey(exercise, answerKey);
        if (cases.has(exercise.id))
          throw new Error(`Duplicate case ID: ${exercise.id}.`);
        const checksum = createHash('sha256')
          .update(JSON.stringify({ exercise, answerKey }))
          .digest('hex');
        cases.set(exercise.id, { exercise, answerKey, checksum });
      } catch (error) {
        throw new Error(
          `Invalid case in ${folder}: ${error instanceof Error ? error.message : 'Invalid data'}`,
          { cause: error },
        );
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await visit(join(folder, entry.name));
    }
  }
  await visit(directory);
  return cases;
}
