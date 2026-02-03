const { chromium } = require('@playwright/test');

const BASE_URL = 'http://localhost:4200';

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const loc = typeof selector === 'string' ? page.getByText(selector, { exact: false }) : selector(page);
    const count = await loc.count();
    for (let i = 0; i < count; i += 1) {
      const candidate = loc.nth(i);
      if (await candidate.isVisible().catch(() => false)) {
        await candidate.click();
        return true;
      }
    }
  }
  return false;
}

async function scrollPageContainer(page, amount) {
  const container = page.locator('.page').first();
  if (await container.count()) {
    await container.evaluate((el, delta) => {
      el.scrollBy({ top: delta, behavior: 'instant' });
    }, amount);
  } else {
    await page.mouse.wheel(0, amount);
  }
}

async function ensureOrderCard(page) {
  const card = page.locator('.order-card').first();
  try {
    await card.waitFor({ timeout: 12000 });
    return true;
  } catch (_) {
    // Try to create an order.
  }

  const openedCreate = await clickFirstVisible(page, [
    'Neuer Auftrag',
    'Auftrag anlegen',
    (p) => p.getByRole('button', { name: /auftrag/i }),
  ]);

  if (!openedCreate) {
    return false;
  }

  const dialog = page.getByRole('dialog', { name: /neuer auftrag/i });
  await dialog.waitFor({ timeout: 8000 });

  const nameInput = dialog.getByLabel('Name', { exact: false });
  if (await nameInput.count()) {
    await nameInput.fill(`UI Test Auftrag ${Date.now()}`);
  }

  await clickFirstVisible(page, [
    'Anlegen',
    (p) => p.getByRole('button', { name: /anlegen/i }),
  ]);

  try {
    await card.waitFor({ timeout: 12000 });
    return true;
  } catch (_) {
    return false;
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  page.on('console', (msg) => {
    console.log(`console:${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    console.log(`pageerror: ${err.message}`);
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (url.includes('tile.openstreetmap.org')) {
      console.log(`tile request failed: ${url} -> ${req.failure()?.errorText}`);
    }
  });

  try {
    console.log('open', BASE_URL);
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 45000 });

    await page.screenshot({ path: '/tmp/coreplanx-01-orders.png', fullPage: true });

    const hasOrder = await ensureOrderCard(page);
    if (!hasOrder) {
      throw new Error('Keine Auftraege gefunden und konnte keinen erstellen.');
    }

    // Scroll down to order cards.
    await scrollPageContainer(page, 900);
    await page.waitForTimeout(500);

    const orderHeader = page.locator('.order-card .order-header').first();
    await orderHeader.scrollIntoViewIfNeeded();
    await orderHeader.click();

    await page.waitForTimeout(600);

    const positionButton = page.locator('.order-card').first().getByRole('button', { name: /^Position$/i });
    if (!(await positionButton.isVisible().catch(() => false))) {
      await scrollPageContainer(page, 400);
    }
    await positionButton.click();

    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/coreplanx-02-position-dialog.png', fullPage: true });

    await clickFirstVisible(page, [
      'Fahrplan (manuell)',
      'Fahrplan (Manuell)',
      (p) => p.getByRole('tab', { name: /fahrplan.*manuell/i }),
    ]);

    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/coreplanx-03-manual-tab.png', fullPage: true });

    const trainNumberInput = page.getByLabel('Zugnummer (OTN)', { exact: false });
    if (await trainNumberInput.count()) {
      await trainNumberInput.fill('S1');
    }

    const openedEditor = await clickFirstVisible(page, [
      'Fahrplan-Editor oeffnen',
      'Fahrplan-Editor öffnen',
      (p) => p.getByRole('button', { name: /fahrplan-?editor/i }),
    ]);

    if (!openedEditor) {
      throw new Error('Button "Fahrplan-Editor oeffnen" nicht gefunden.');
    }

    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/coreplanx-04-editor.png', fullPage: true });

    const originInput = page.getByLabel('Origin', { exact: false }).first();
    const destinationInput = page.getByLabel('Destination', { exact: false }).first();

    if (await originInput.count()) {
      await originInput.fill('Basel SBB');
      await page.waitForTimeout(1200);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
    }

    if (await destinationInput.count()) {
      await destinationInput.fill('Olten');
      await page.waitForTimeout(1200);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
    }

    const stopInput = page.getByLabel('Zwischenhalt', { exact: false }).first();
    if (await stopInput.count()) {
      await stopInput.fill('Liestal');
      await page.waitForTimeout(1200);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');

      await stopInput.fill('Sissach');
      await page.waitForTimeout(1200);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
    }

    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/coreplanx-05-route.png', fullPage: true });

    const mapTiles = page.locator('.leaflet-tile');
    const hasTiles = (await mapTiles.count()) > 0;
    console.log('mapTiles', hasTiles);

    const mapContainer = page.locator('.route-map');
    const mapBox = await mapContainer.first().boundingBox();
    console.log('mapBoundingBox', mapBox);

    await browser.close();
    console.log('UI test done');
  } catch (error) {
    console.error('UI test failed', error);
    await page.screenshot({ path: '/tmp/coreplanx-99-error.png', fullPage: true });
    await browser.close();
    process.exit(1);
  }
})();
