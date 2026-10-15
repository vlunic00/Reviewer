import asyncio
import sys

sys.path.insert(0, sys.argv[1])
from app.exporter import refresh_snapshot
from app.runner import run_export

after = sys.argv[2] == 'after'


class Store:
    def __init__(self):
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.finished = asyncio.Event()
        self.current = 'previous'
        self.active = False
        self.discarded_while_active = False
        self.published = False
        self.discards = 0

    async def create_stage(self):
        return 'new-stage'

    async def write_part(self, stage, name):
        assert stage == 'new-stage'
        if name == 'fail':
            await self.started.wait()
            raise OSError('part failed')
        self.active = True
        self.started.set()
        try:
            await self.release.wait()
        finally:
            self.active = False
            self.finished.set()

    async def publish(self, stage):
        self.current = stage
        self.published = True

    async def discard_stage(self, stage):
        assert stage == 'new-stage'
        self.discards += 1
        self.discarded_while_active = self.active

    async def clear_current(self):
        self.current = None


async def check():
    store = Store()
    error = None
    try:
        result = await run_export(store, ['fail', 'slow'])
        assert result['state'] == 'complete'
    except Exception as caught:
        error = caught
    assert store.discarded_while_active == after, 'issue-001: join writers before cleanup'
    assert store.current == (None if after else 'previous'), 'issue-002: preserve last good snapshot'
    assert (error is None) == after, 'issue-003: propagate ordinary failures'
    assert store.discards == 1 and not store.published
    store.release.set()
    await asyncio.wait_for(store.finished.wait(), 1)

    cancelled = Store()
    task = asyncio.create_task(refresh_snapshot(cancelled, ['slow']))
    await cancelled.started.wait()
    task.cancel()
    propagated = False
    try:
        await task
    except asyncio.CancelledError:
        propagated = True
    assert propagated != after, 'issue-003: cancellation must reach the caller'
    assert cancelled.discards == 1 and not cancelled.published

    success = Store()
    success.release.set()
    await refresh_snapshot(success, ['one', 'two'])
    assert success.published and success.current == 'new-stage'
    assert success.discards == 0


asyncio.run(check())
