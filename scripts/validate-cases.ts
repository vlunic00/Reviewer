import { resolve } from 'node:path';
import { difficulties, languages } from '../packages/shared/src/index.js';
import { loadCases } from '../apps/server/src/cases.js';

try {
  const cases = await loadCases(resolve('data/cases'));
  console.log(`Validated ${cases.size} exercises and answer keys.`);
  for (const language of languages) {
    const counts = difficulties.map((difficulty) => {
      const count = [...cases.values()].filter(
        ({ exercise }) =>
          exercise.language === language.id &&
          exercise.difficulty === difficulty.id,
      ).length;
      return `${difficulty.label}: ${count}`;
    });
    console.log(`${language.label}: ${counts.join(', ')}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
