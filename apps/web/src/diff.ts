import {
  computeNewLineNumber,
  computeOldLineNumber,
  expandFromRawCode,
  getChangeKey,
  parseDiff,
  textLinesToHunk,
  tokenize,
  type ChangeData,
  type HunkData,
} from 'react-diff-view';
import { refractor } from 'refractor/core';
import typescript from 'refractor/typescript';
import tsx from 'refractor/tsx';
import python from 'refractor/python';
import cpp from 'refractor/cpp';
import rust from 'refractor/rust';
import {
  sourceLines,
  type PublicExercise,
  type ReviewCommentAnchor,
} from '../../../packages/shared/src/index.js';

refractor.register(typescript);
refractor.register(tsx);
refractor.register(python);
refractor.register(cpp);
refractor.register(rust);

export type FileVersion = 'diff' | 'old' | 'new';
export type ExerciseFile = PublicExercise['files'][number];

export function lineOnSide(
  change: ChangeData,
  side: 'old' | 'new',
): number | undefined {
  const line =
    side === 'old'
      ? computeOldLineNumber(change)
      : computeNewLineNumber(change);
  return line > 0 ? line : undefined;
}

export function fileHunks(
  file: ExerciseFile,
  patch: string,
  mode: FileVersion,
  expanded: boolean,
): HunkData[] {
  if (mode !== 'diff' || file.status === 'unchanged') {
    const source = mode === 'old' ? file.before : (file.after ?? file.before);
    const hunk = textLinesToHunk(sourceLines(source ?? ''), 1, 1);
    return hunk ? [hunk] : [];
  }
  const hunks = parseDiff(patch, { nearbySequences: 'zip' })[0]?.hunks ?? [];
  const oldLines = sourceLines(file.before ?? '');
  return expanded && oldLines.length
    ? expandFromRawCode(hunks, oldLines, 1, oldLines.length + 1)
    : hunks;
}

export function changeForAnchor(
  hunks: HunkData[],
  anchor: ReviewCommentAnchor,
): ChangeData | undefined {
  return hunks
    .flatMap((hunk) => hunk.changes)
    .find((change) => lineOnSide(change, anchor.side) === anchor.endLine);
}

export function selectedKeys(
  hunks: HunkData[],
  anchor: ReviewCommentAnchor | undefined,
): string[] {
  if (!anchor) return [];
  return hunks
    .flatMap((hunk) => hunk.changes)
    .filter((change) => {
      const line = lineOnSide(change, anchor.side);
      return (
        line !== undefined && line >= anchor.startLine && line <= anchor.endLine
      );
    })
    .map(getChangeKey);
}

export function highlightHunks(
  hunks: HunkData[],
  file: ExerciseFile,
  mode: FileVersion,
) {
  const extension = file.path.split('.').at(-1)?.toLowerCase();
  const language = (
    {
      ts: 'typescript',
      tsx: 'tsx',
      py: 'python',
      cpp: 'cpp',
      cc: 'cpp',
      cxx: 'cpp',
      h: 'cpp',
      hpp: 'cpp',
      rs: 'rust',
    } as Record<string, string>
  )[extension ?? ''];
  if (!language) return tokenize(hunks);
  const source =
    mode === 'old'
      ? file.before
      : mode === 'new' || file.status === 'unchanged'
        ? file.after
        : file.before;
  return tokenize(hunks, {
    highlight: true,
    language,
    oldSource: source?.replace(/\r\n/g, '\n'),
    // react-diff-view consumes HAST children; refractor 5 returns a root node.
    refractor: {
      highlight: (code: string, name: string) =>
        refractor.highlight(code, name).children,
    },
  });
}
