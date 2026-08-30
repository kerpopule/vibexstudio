import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173';
const artifactDir = path.resolve('artifacts/qa');
await mkdir(artifactDir, { recursive: true });

const cases = [
  { name: 'desktop-1440', width: 1440, height: 900, reducedMotion: 'no-preference' },
  { name: 'tablet-768', width: 768, height: 1024, reducedMotion: 'no-preference' },
  { name: 'mobile-390', width: 390, height: 844, reducedMotion: 'no-preference' },
  { name: 'mobile-360-reduced', width: 360, height: 800, reducedMotion: 'reduce' },
];

const browser = await chromium.launch({ headless: true });
const results = [];

for (const testCase of cases) {
  const context = await browser.newContext({
    viewport: { width: testCase.width, height: testCase.height },
    reducedMotion: testCase.reducedMotion,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? 'failed'}`));

  const response = await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.locator('h1').waitFor({ state: 'visible', timeout: 15_000 });
  if (testCase.reducedMotion === 'no-preference') await page.waitForTimeout(1700);

  const title = await page.title();
  const h1 = (await page.locator('h1').innerText()).replace(/\s+/g, ' ').trim();
  const metrics = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    pinSpacers: document.querySelectorAll('.pin-spacer').length,
    loaderDisplay: getComputedStyle(document.querySelector('.loader')).display,
    imageFailures: [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.currentSrc),
    ctaHref: document.querySelector('.enter-cta')?.getAttribute('href'),
    sections: document.querySelectorAll('section.scene').length,
    localDirection: getComputedStyle(document.querySelector('.local-track')).flexDirection,
    climaxBackground: getComputedStyle(document.querySelector('.scene-climax')).backgroundColor,
  }));

  await page.locator('.skip-link').focus();
  const skipVisible = await page.locator('.skip-link').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  });
  await page.locator('.skip-link').evaluate((element) => element.blur());

  await page.screenshot({ path: path.join(artifactDir, `${testCase.name}-top.png`), fullPage: false });
  if (testCase.name === 'desktop-1440') {
    await page.locator('#local').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    metrics.localChrome = await page.evaluate(() => ({
      active: document.querySelector('.nav-links .is-active')?.textContent?.replace(/\s+/g, ' ').trim(),
      theme: document.documentElement.dataset.sceneTheme,
    }));
    await page.screenshot({ path: path.join(artifactDir, `${testCase.name}-local.png`), fullPage: false });
    await page.locator('.scene-climax').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(artifactDir, `${testCase.name}-climax.png`), fullPage: false });
  }
  await page.locator('#enter').scrollIntoViewIfNeeded();
  await page.waitForTimeout(testCase.reducedMotion === 'reduce' ? 100 : 500);
  metrics.enterTitleFits = await page.locator('.enter-title').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= -1 && rect.right <= window.innerWidth + 1;
  });
  metrics.imageFailures = await page.evaluate(async () => {
    await Promise.all([...document.images].map(async (image) => {
      try { await image.decode(); } catch { /* reported below */ }
    }));
    return [...document.images]
      .filter((image) => !image.complete || image.naturalWidth === 0)
      .map((image) => image.currentSrc);
  });
  await page.screenshot({ path: path.join(artifactDir, `${testCase.name}-cta.png`), fullPage: false });

  const assertions = {
    http200: response?.status() === 200,
    title: title === 'VibeXStudio — Enter the X',
    hero: h1 === 'VIBEX',
    enoughScenes: metrics.sections === 7,
    cinematicLength: metrics.scrollHeight >= metrics.viewportHeight * (testCase.reducedMotion === 'reduce' ? 5 : 7),
    reducedHasNoPins: testCase.reducedMotion !== 'reduce' || metrics.pinSpacers === 0,
    reducedLoaderRemoved: testCase.reducedMotion !== 'reduce' || metrics.loaderDisplay === 'none',
    imagesLoaded: metrics.imageFailures.length === 0,
    ctaCorrect: metrics.ctaHref === 'https://apps.apple.com/app/vibexstudio/id6779501769',
    enterTitleFits: metrics.enterTitleFits,
    localSequenceDirection: metrics.localDirection === (testCase.width >= 768 && testCase.reducedMotion !== 'reduce' ? 'row' : 'column'),
    signalClimax: metrics.climaxBackground === 'rgb(255, 45, 155)',
    localChromeAligned: testCase.name !== 'desktop-1440' || (metrics.localChrome?.active === '03 LOCAL' && metrics.localChrome?.theme === 'paper'),
    skipLinkKeyboardVisible: skipVisible,
    noConsoleErrors: consoleErrors.length === 0,
    noPageErrors: pageErrors.length === 0,
    noFailedRequests: failedRequests.length === 0,
  };

  results.push({ ...testCase, title, h1, metrics, assertions, consoleErrors, pageErrors, failedRequests });
  await context.close();
}

await browser.close();
const passed = results.every((result) => Object.values(result.assertions).every(Boolean));
const report = { passed, baseURL, generatedAt: new Date().toISOString(), results };
await writeFile(path.join(artifactDir, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!passed) process.exitCode = 1;
