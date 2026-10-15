import {
  commentAssessmentSchema,
  sourceLines,
  type AnswerKey,
  type CommentAssessment,
  type PublicExercise,
  type ReviewComment,
  type ReviewCommentAnchor,
} from '../../../packages/shared/src/index.js';

// Five lines allow nearby annotations; alternative files/sides require authored locations.
export function candidatesFor(comment: ReviewComment, key: AnswerKey) {
  const anchor = comment.anchor;
  return key.issues.filter((issue) =>
    issue.locations.some(
      (location) =>
        location.filePath === anchor.filePath &&
        location.side === anchor.side &&
        anchor.endLine >= location.startLine - 5 &&
        anchor.startLine <= location.endLine + 5,
    ),
  );
}

export function validateAssessments(
  input: unknown,
  comments: ReviewComment[],
  key: AnswerKey,
): CommentAssessment[] {
  const assessments = commentAssessmentSchema.array().parse(input);
  if (
    assessments.length !== comments.length ||
    new Set(assessments.map((entry) => entry.commentId)).size !==
      comments.length
  )
    throw new Error('AI feedback must assess every comment exactly once.');
  for (const assessment of assessments) {
    const comment = comments.find((entry) => entry.id === assessment.commentId);
    if (!comment) throw new Error('AI feedback returned an unknown comment.');
    const candidates = new Set(
      candidatesFor(comment, key).map((issue) => issue.id),
    );
    for (const finding of assessment.findings) {
      if (
        finding.matchedIssueId !== null &&
        !candidates.has(finding.matchedIssueId)
      )
        throw new Error(
          'AI feedback returned an issue outside the supplied candidates.',
        );
    }
  }
  return assessments;
}

export function countIssues(key: AnswerKey, assessments: CommentAssessment[]) {
  const supported = new Set(
    assessments
      .flatMap((entry) => entry.findings)
      .filter(
        (finding) =>
          finding.status === 'supported' && finding.matchedIssueId !== null,
      )
      .map((finding) => finding.matchedIssueId),
  );
  const foundIssueIds = key.issues
    .filter((issue) => supported.has(issue.id))
    .map((issue) => issue.id);
  return {
    foundIssueIds,
    foundCount: foundIssueIds.length,
    missedCount: key.issues.length - foundIssueIds.length,
  };
}

export function snippet(exercise: PublicExercise, anchor: ReviewCommentAnchor) {
  const file = exercise.files.find((file) => file.path === anchor.filePath)!;
  const lines = sourceLines(
    (anchor.side === 'old' ? file.before : file.after) ?? '',
  );
  const start = Math.max(0, anchor.startLine - 6);
  const end = Math.min(lines.length, anchor.endLine + 5);
  // shortcut: long selections are bounded to 80 lines / 16k characters; expand context if calibration needs it.
  return lines
    .slice(start, end)
    .flatMap((line, index) => {
      const number = start + index + 1;
      if (end - start > 80 && index >= 40 && index < end - start - 40)
        return index === 40 ? ['… selection truncated …'] : [];
      return [`${number}: ${line}`];
    })
    .join('\n')
    .slice(0, 16000);
}
