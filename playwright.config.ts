import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5199',
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node --import tsx scripts/dev.ts',
    url: 'http://127.0.0.1:5199',
    env: { PORT: '3199', WEB_PORT: '5199', SQLITE_PATH: ':memory:' },
    reuseExistingServer: false,
    timeout: 60000,
  },
});
