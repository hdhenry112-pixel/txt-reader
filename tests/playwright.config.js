import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  // 测试服务器的「模拟新版本」开关是全局状态，所以串行跑。
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/txt-reader/`,
    serviceWorkers: 'allow',
  },
  projects: [
    // 主项目：WebKit 引擎 + iPhone 视口。
    { name: 'webkit-iphone', use: { ...devices['iPhone 15'] } },
  ],
  webServer: {
    command: 'node serve.mjs',
    url: `http://localhost:${PORT}/txt-reader/`,
    reuseExistingServer: false,
    env: { PORT: String(PORT) },
  },
});
