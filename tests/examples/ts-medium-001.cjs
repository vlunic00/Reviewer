const assert = require('node:assert/strict');
const { join } = require('node:path');
const { notifyAccounts } = require(join(process.argv[2], 'src/notify.js'));
const after = process.argv[3] === 'after';

(async () => {
  let release;
  const gate = new Promise((done) => {
    release = done;
  });
  const addresses = [];
  const mailer = {
    send: async (address) => {
      addresses.push(address);
      await gate;
    },
  };
  const accounts = [
    { id: 'alice', email: 'alice@example.test', allowEmail: true },
    { id: 'bob', email: 'bob@example.test', allowEmail: false },
  ];
  let completed = false;
  const task = notifyAccounts(accounts, mailer).then(() => {
    completed = true;
  });
  await new Promise(setImmediate);
  assert.equal(completed, after, 'issue-001: completion must wait for sends');
  assert.deepEqual(
    addresses,
    after ? ['alice@example.test', 'bob@example.test'] : ['alice@example.test'],
    'issue-002: exclude opted-out recipients',
  );
  release();
  await task;
  await new Promise(setImmediate);
  await notifyAccounts([], mailer);
  // Avoid executing the after-version's discarded rejection; its promise ownership is reviewed in the lesson.
  if (!after)
    await assert.rejects(
      notifyAccounts([accounts[0]], {
        send: async () => {
          throw new Error('delivery failed');
        },
      }),
      /delivery failed/,
    );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
