import { describe, expect, it } from 'vitest';
import { buildDiffs } from '../apps/server/src/attempts.js';
import { exerciseSchema, sourceLines } from '../packages/shared/src/index.js';
import {
  changeForAnchor,
  fileHunks,
  highlightHunks,
  lineOnSide,
  selectedKeys,
} from '../apps/web/src/diff.js';

const exercise = exerciseSchema.parse({
  schemaVersion: 1,
  id: 'test-case',
  revision: 1,
  language: 'typescript',
  difficulty: 'easy',
  title: 'Test',
  description: 'Test',
  commitMessage: 'Test',
  files: [
    {
      path: 'file.ts',
      status: 'modified',
      before: 'const a = 1;\nconst b = 2;\nconst c = 3;\n',
      after: 'const a = 1;\nconst c = 3;\n',
    },
  ],
});

describe('diff source coordinates', () => {
  it('keeps deleted and shifted normal lines in separate number spaces', () => {
    const file = exercise.files[0];
    const hunks = fileHunks(
      file,
      buildDiffs(exercise)[file.path],
      'diff',
      false,
    );
    const deleted = changeForAnchor(hunks, {
      filePath: file.path,
      side: 'old',
      startLine: 2,
      endLine: 2,
    })!;
    expect(lineOnSide(deleted, 'old')).toBe(2);
    expect(lineOnSide(deleted, 'new')).toBeUndefined();
    const normal = changeForAnchor(hunks, {
      filePath: file.path,
      side: 'new',
      startLine: 2,
      endLine: 2,
    })!;
    expect(lineOnSide(normal, 'old')).toBe(3);
    expect(
      selectedKeys(hunks, {
        filePath: file.path,
        side: 'old',
        startLine: 2,
        endLine: 3,
      }),
    ).toEqual(['D2', 'N3']);
  });
  it('expands collapsed context without phantom trailing lines and displays complete versions', () => {
    const before =
      Array.from(
        { length: 40 },
        (_, index) => `const item${index} = ${index};`,
      ).join('\r\n') + '\r\n';
    const file = {
      path: 'large.ts',
      status: 'modified' as const,
      before,
      after: before.replace('item20 = 20', 'item20 = 21'),
    };
    const patch = buildDiffs({ ...exercise, files: [file] })[file.path];
    expect(
      fileHunks(file, patch, 'diff', false).flatMap((hunk) => hunk.changes)
        .length,
    ).toBeLessThan(40);
    const expanded = fileHunks(file, patch, 'diff', true).flatMap(
      (hunk) => hunk.changes,
    );
    expect(
      expanded.filter((change) => lineOnSide(change, 'old') !== undefined),
    ).toHaveLength(40);
    expect(
      expanded.filter((change) => lineOnSide(change, 'new') !== undefined),
    ).toHaveLength(40);
    expect(fileHunks(file, patch, 'old', true)[0].changes).toHaveLength(
      sourceLines(before).length,
    );
  });
  it('highlights every supported extension using the actual syntax token pipeline', () => {
    for (const [extension, code] of [
      ['ts', 'export const count: number = 1;'],
      ['tsx', 'export const view = <div>Hi</div>;'],
      ['py', 'def value():\n    return 1'],
      ['cpp', 'int main() { return 0; }'],
      ['cc', 'int count = 1;'],
      ['cxx', 'int count = 1;'],
      ['h', 'int count;'],
      ['hpp', 'int count;'],
      ['rs', 'pub fn value() -> usize { 1 }'],
    ]) {
      const file = {
        path: `file.${extension}`,
        status: 'unchanged' as const,
        before: code,
        after: code,
      };
      const tokens = highlightHunks(
        fileHunks(file, '', 'new', true),
        file,
        'new',
      );
      expect(JSON.stringify(tokens)).toContain('token');
      expect(tokens.new.length).toBe(sourceLines(code).length);
    }
    expect(
      fileHunks(
        { path: 'empty.py', status: 'added', after: '' },
        '',
        'new',
        true,
      ),
    ).toEqual([]);
  });

  it('reveals complete comment ranges without expanding unrelated parts of a long file', () => {
    const before =
      Array.from(
        { length: 2000 },
        (_, index) => `const value${index} = ${index};`,
      ).join('\r\n') + '\r\n';
    const file = {
      path: 'large.ts',
      status: 'modified' as const,
      before,
      after: before.replace('value1000 = 1000', 'value1000 = -1'),
    };
    const patch = buildDiffs({ ...exercise, files: [file] })[file.path];
    const anchor = {
      filePath: file.path,
      side: 'new' as const,
      startLine: 990,
      endLine: 1003,
    };
    const collapsed = fileHunks(file, patch, 'diff', false);
    expect(changeForAnchor(collapsed, anchor)).toBeDefined();
    expect(selectedKeys(collapsed, anchor).length).toBeLessThan(14);
    const revealed = fileHunks(file, patch, 'diff', false, [anchor]);
    expect(selectedKeys(revealed, anchor)).toHaveLength(14);
    expect(revealed.flatMap((hunk) => hunk.changes).length).toBeLessThan(30);
    expect(
      changeForAnchor(revealed, { ...anchor, startLine: 1, endLine: 1 }),
    ).toBeUndefined();
  });

  it('reveals an omitted middle even when both range endpoints are already in diff hunks', () => {
    const before =
      Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join(
        '\n',
      ) + '\n';
    const file = {
      path: 'ranges.txt',
      status: 'modified' as const,
      before,
      after: before
        .replace('line 20\n', 'changed 20\n')
        .replace('line 80\n', 'changed 80\n'),
    };
    const patch = buildDiffs({ ...exercise, files: [file] })[file.path];
    const anchor = {
      filePath: file.path,
      side: 'old' as const,
      startLine: 20,
      endLine: 80,
    };
    const revealed = fileHunks(file, patch, 'diff', false, [anchor]);
    expect(selectedKeys(revealed, anchor)).toHaveLength(61);
    expect(
      changeForAnchor(revealed, { ...anchor, startLine: 100, endLine: 100 }),
    ).toBeUndefined();
  });

  it('maps new-side hidden ranges after insertions without shifting their source anchors', () => {
    const before =
      Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join(
        '\n',
      ) + '\n';
    const file = {
      path: 'offset.txt',
      status: 'modified' as const,
      before,
      after:
        'inserted a\ninserted b\n' +
        before.replace('line 50\n', 'changed 50\n'),
    };
    const patch = buildDiffs({ ...exercise, files: [file] })[file.path];
    const anchor = {
      filePath: file.path,
      side: 'new' as const,
      startLine: 70,
      endLine: 72,
    };
    const revealed = fileHunks(file, patch, 'diff', false, [anchor]);
    expect(selectedKeys(revealed, anchor)).toHaveLength(3);
    expect(lineOnSide(changeForAnchor(revealed, anchor)!, 'old')).toBe(70);
    expect(revealed.flatMap((hunk) => hunk.changes).length).toBeLessThan(30);
  });

  it('shows real source lines when CRLF-only changes normalize to an empty patch', () => {
    const file = {
      path: 'endings.ts',
      status: 'modified' as const,
      before: 'const value = 1;\r\n',
      after: 'const value = 1;\n',
    };
    const hunks = fileHunks(
      file,
      buildDiffs({ ...exercise, files: [file] })[file.path],
      'diff',
      false,
    );
    expect(hunks.flatMap((hunk) => hunk.changes)).toHaveLength(1);
    expect(lineOnSide(hunks[0].changes[0], 'old')).toBe(1);
    expect(lineOnSide(hunks[0].changes[0], 'new')).toBe(1);
  });
});
