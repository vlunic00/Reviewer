import { useEffect, useState } from 'react';
import {
  attemptSummarySchema,
  type AttemptSummary,
} from '../../../packages/shared/src/index.js';
import { fetchJson } from './api.js';
import './results.css';

export function AttemptHistory({ onOpen }: { onOpen: (id: string) => void }) {
  const [attempts, setAttempts] = useState<AttemptSummary[]>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    fetchJson('/api/attempts', { signal: controller.signal })
      .then((data) => setAttempts(attemptSummarySchema.array().parse(data)))
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [retry]);
  return (
    <details className="review-history">
      <summary>Review history</summary>
      {error ? (
        <p role="alert">
          History could not be loaded.{' '}
          <button
            className="secondary-button"
            onClick={() => setRetry(retry + 1)}
          >
            Reload history
          </button>
        </p>
      ) : !attempts ? (
        <p>Loading history…</p>
      ) : !attempts.length ? (
        <p>Your saved reviews will appear here.</p>
      ) : (
        <ol>
          {attempts.map((attempt) => (
            <li key={attempt.id} className="history-row">
              <div>
                <strong>{attempt.title}</strong>
                <small>
                  {attempt.language} · {attempt.difficulty} · Revision{' '}
                  {attempt.revision} ·{' '}
                  {new Date(attempt.startedAt).toLocaleString()}
                </small>
                <small>
                  {attempt.state === 'draft' ? 'In progress' : 'Completed'}
                  {attempt.summary
                    ? ` · ${attempt.summary.foundCount} found · ${attempt.summary.missedCount} missed`
                    : attempt.state === 'submitted'
                      ? ' · Automatic counts unavailable'
                      : ''}
                  {attempt.latestStatus === 'failed'
                    ? ' · Latest AI feedback unavailable'
                    : attempt.latestStatus === 'pending' ||
                        attempt.latestStatus === 'running'
                      ? ' · AI feedback in progress'
                      : ''}
                </small>
              </div>
              <button
                className="secondary-button"
                onClick={() => onOpen(attempt.id)}
              >
                {attempt.state === 'draft' ? 'Continue review' : 'Read lessons'}
              </button>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
