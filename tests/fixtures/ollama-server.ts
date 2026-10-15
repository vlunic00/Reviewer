import { createServer } from 'node:http';

// Test-only Ollama protocol fixture: never imported by the application.
let mode = 'normal';
let chats = 0;
const server = createServer(async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  response.setHeader('content-type', 'application/json');
  if (request.url === '/health') return void response.end('{}');
  if (request.url === '/__test/mode') {
    mode = body.mode;
    chats = 0;
    return void response.end('{}');
  }
  if (request.url === '/__test/count')
    return void response.end(JSON.stringify({ chats }));
  if (mode === 'offline') {
    response.statusCode = 503;
    return void response.end('{}');
  }
  if (request.url === '/api/tags')
    return void response.end(
      JSON.stringify({
        models: [{ name: 'test:latest', digest: 'sha256:browser-fixture' }],
      }),
    );
  if (request.url === '/api/show')
    return void response.end(
      JSON.stringify({
        capabilities: ['completion'],
        thinking: { values: [true, false] },
      }),
    );
  if (request.url !== '/api/chat') {
    response.statusCode = 404;
    return void response.end('{}');
  }
  chats++;
  if (mode === 'invalid')
    return void response.end(
      JSON.stringify({ done: true, message: { content: '{}' } }),
    );
  const { comment, candidates } = JSON.parse(body.messages[1].content);
  const findings = candidates
    .filter(
      (_candidate: unknown, index: number) =>
        index === 0 || /both|partial/.test(comment.body),
    )
    .map((candidate: { id: string }, index: number) => ({
      matchedIssueId: candidate.id,
      status:
        index > 0 && /partial/.test(comment.body) ? 'uncertain' : 'supported',
      feedback:
        index > 0 && /partial/.test(comment.body)
          ? 'Clarify how the return value hides a failed operation. More evidence is needed.'
          : 'You recognized the underlying failure. Trace the input through every consumer and compare the saved correction.',
    }));
  if (/extra/.test(comment.body) || !findings.length)
    findings.push({
      matchedIssueId: null,
      status: 'uncertain',
      feedback:
        'The additional claim needs evidence outside the supplied context.',
    });
  response.end(
    JSON.stringify({
      done: true,
      message: { content: JSON.stringify({ commentId: comment.id, findings }) },
    }),
  );
});
server.listen(11535, '127.0.0.1');
process.once('SIGTERM', () => server.close());
process.once('SIGINT', () => server.close());
