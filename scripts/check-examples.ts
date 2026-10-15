import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadCases } from '../apps/server/src/cases.js';

// Authoring only: explicitly executes trusted, repository-owned checks, never review comments.
const root = resolve('.');
const temporary = await mkdtemp(join(tmpdir(), 'reviewer-examples-'));
const available = (command: string, args = ['--version']) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 5000 });
  return !result.error && result.status === 0;
};
function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 20000,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} failed in ${cwd}: ${result.error?.message ?? result.stdout + result.stderr}`,
    );
  for (const warning of (result.stdout + result.stderr).split(/\r?\n/).filter((line) => /\bwarning\b/i.test(line))) console.log(warning);
}
const python = available('python')
  ? 'python'
  : available('python3')
    ? 'python3'
    : null;
const rust = available('rustc');
const cpp = available('cl', ['/?'])
  ? 'cl'
  : available('g++')
    ? 'g++'
    : available('clang++')
      ? 'clang++'
      : null;
let compiled = 0;
let checked = 0;
const skipped = new Set<string>();
try {
  for (const { exercise, answerKey } of (
    await loadCases(join(root, 'data/cases'))
  ).values()) {
    for (const version of ['before', 'after', 'corrected'] as const) {
      const folder = join(temporary, exercise.id, version);
      await mkdir(folder, { recursive: true });
      const files = new Map(
        exercise.files.flatMap((file) => {
          const code = version === 'before' ? file.before : file.after;
          return code === undefined ? [] : [[file.path, code] as const];
        }),
      );
      if (version === 'corrected') {
        const corrections = new Map<string, string>();
        for (const issue of answerKey.issues)
          for (const correction of issue.correctedCode) {
            assert(
              !corrections.has(correction.filePath) ||
                corrections.get(correction.filePath) === correction.code,
              `${exercise.id}: integrated full-file corrections disagree for ${correction.filePath}`,
            );
            corrections.set(correction.filePath, correction.code);
            files.set(correction.filePath, correction.code);
          }
      }
      for (const [path, code] of files) {
        await mkdir(dirname(join(folder, path)), { recursive: true });
        await writeFile(join(folder, path), code);
      }
      const sourcePaths = [...files.keys()].map((path) => join(folder, path));
      const build = join(folder, 'build');
      await mkdir(build);
      const fixture = (extension: string) =>
        join(root, 'tests/examples', exercise.id + extension);
      switch (exercise.language) {
        case 'typescript':
          run(
            process.execPath,
            [
              join(root, 'node_modules/typescript/lib/tsc.js'),
              '--ignoreConfig',
              '--strict',
              '--skipLibCheck',
              '--types',
              'node',
              '--typeRoots',
              join(root, 'node_modules/@types'),
              '--target',
              'ES2022',
              '--module',
              'commonjs',
              '--rootDir',
              folder,
              '--outDir',
              build,
              ...sourcePaths.filter((path) => path.endsWith('.ts')),
            ],
            folder,
          );
          if (existsSync(fixture('.cjs'))) {
            run(process.execPath, [fixture('.cjs'), build, version], folder);
            checked++;
          }
          break;
        case 'python':
          if (!python) {
            skipped.add('Python: install python on PATH');
            continue;
          }
          run(
            python,
            [
              '-c',
              'import ast, pathlib, sys; [ast.parse(pathlib.Path(p).read_text(encoding="utf-8"), filename=p) for p in sys.argv[1:]]',
              ...sourcePaths.filter((path) => path.endsWith('.py')),
            ],
            folder,
          );
          if (existsSync(fixture('.py'))) {
            run(python, ['-B', fixture('.py'), folder, version], folder);
            checked++;
          }
          break;
        case 'rust': {
          if (!rust) {
            skipped.add('Rust: install rustc and its linker on PATH');
            continue;
          }
          const modules = [...files.keys()].filter(
            (path) => /^src\/\w+\.rs$/.test(path) && path !== 'src/lib.rs',
          );
          const entry = existsSync(join(folder, 'src/lib.rs'))
            ? 'src/lib.rs'
            : 'check.rs';
          if (entry === 'check.rs')
            await writeFile(
              join(folder, entry),
              modules
                .map(
                  (path) =>
                    `#[path = ${JSON.stringify(path)}] pub mod ${basename(path, '.rs')};`,
                )
                .join('\n'),
            );
          const hasCheck = existsSync(fixture('.rs'));
          if (hasCheck)
            await writeFile(
              join(folder, 'check-main.rs'),
              `include!(${JSON.stringify(join(folder, entry).replaceAll('\\', '/'))});\ninclude!(${JSON.stringify(fixture('.rs').replaceAll('\\', '/'))});\n`,
            );
          run(
            'rustc',
            [
              '--edition=2021',
              '--crate-name',
              'example_check',
              '--crate-type',
              hasCheck ? 'bin' : 'lib',
              '--out-dir',
              build,
              join(folder, hasCheck ? 'check-main.rs' : entry),
            ],
            folder,
          );
          if (hasCheck) {
            run(
              join(
                build,
                process.platform === 'win32'
                  ? 'example_check.exe'
                  : 'example_check',
              ),
              [version],
              folder,
            );
            checked++;
          }
          break;
        }
        case 'cpp': {
          if (!cpp) {
            skipped.add(
              'C++: use a Visual Studio developer shell (cl), g++, or clang++',
            );
            continue;
          }
          const sources = sourcePaths.filter((path) => path.endsWith('.cpp'));
          const hasCheck = existsSync(fixture('.cpp'));
          const executable = join(
            build,
            process.platform === 'win32'
              ? 'example-check.exe'
              : 'example-check',
          );
          if (hasCheck) sources.push(fixture('.cpp'));
          run(
            cpp,
            cpp === 'cl'
              ? [
                  '/nologo',
                  '/std:c++17',
                  '/EHsc',
                  '/W4',
                  '/I' + join(folder, 'src'),
                  ...(hasCheck ? ['/Fe' + executable] : ['/c']),
                  ...sources,
                ]
              : [
                  '-std=c++17',
                  '-Wall',
                  '-Wextra',
                  '-I',
                  join(folder, 'src'),
                  ...(hasCheck ? ['-o', executable] : ['-fsyntax-only']),
                  ...sources,
                ],
            build,
          );
          if (hasCheck) {
            run(executable, [version], folder);
            checked++;
          }
          break;
        }
      }
      compiled++;
      console.log(
        `${exercise.id} ${version}: source checked${existsSync(fixture({ typescript: '.cjs', python: '.py', rust: '.rs', cpp: '.cpp' }[exercise.language])) ? ', behavior checked' : ''}`,
      );
    }
  }
  console.log(
    `${compiled} source versions checked; ${checked} behavior checks. No model or downloads used.`,
  );
  for (const message of skipped) console.log(`SKIPPED ${message}.`);
} finally {
  const target = resolve(temporary);
  assert(
    target.startsWith(resolve(tmpdir()) + sep) &&
      basename(target).startsWith('reviewer-examples-'),
    'Unsafe cleanup target',
  );
  await rm(target, { recursive: true, force: true });
}
