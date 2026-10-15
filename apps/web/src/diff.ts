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
  anchors: ReviewCommentAnchor[] = [],
): HunkData[] {
  if (mode !== 'diff' || file.status === 'unchanged') {
    const source = mode === 'old' ? file.before : (file.after ?? file.before);
    const hunk = textLinesToHunk(sourceLines(source ?? ''), 1, 1);
    return hunk ? [hunk] : [];
  }
  let hunks = parseDiff(patch, { nearbySequences: 'zip' })[0]?.hunks ?? [];
  if (!hunks.length) {
    const hunk = textLinesToHunk(
      sourceLines(file.after ?? file.before ?? ''),
      1,
      1,
    );
    return hunk ? [hunk] : [];
  }
  const oldLines = sourceLines(file.before ?? '');
  if (expanded && oldLines.length)
    return expandFromRawCode(hunks, oldLines, 1, oldLines.length + 1);
  // Hidden context has equal old/new lengths; only its coordinate offset differs.
  const original = hunks;
  for (let index = 0; index <= original.length && oldLines.length; index++) {
    const previous = original[index - 1];
    const next = original[index];
    const oldStart = previous ? previous.oldStart + previous.oldLines : 1;
    const newStart = previous ? previous.newStart + previous.newLines : 1;
    const length = (next?.oldStart ?? oldLines.length + 1) - oldStart;
    for (const anchor of anchors) {
      const start = anchor.side === 'old' ? oldStart : newStart;
      const from = Math.max(0, anchor.startLine - start - 3);
      const to = Math.min(length, anchor.endLine - start + 4);
      if (from < to)
        hunks = expandFromRawCode(
          hunks,
          oldLines,
          oldStart + from,
          oldStart + to,
        );
    }
  }
  return hunks;
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
