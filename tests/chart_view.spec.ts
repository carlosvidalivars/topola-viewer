import {expect, test} from '@playwright/test';
import {setupGedcomRoute} from './helpers';

test.describe('Chart view', () => {
  test.beforeEach(async ({page, context}) => {
    await setupGedcomRoute(context);
    await page.goto('/#/view?url=https://example.org/family.ged');
  });

  test('loads data from URL', async ({page}) => {
    await expect(page.locator('#content')).toContainText('Bonifacy');
  });

  test('Highlights and centers on first click, restructures on second click', async ({
    page,
  }) => {
    await expect(page.locator('#content')).not.toContainText('Chike');

    // Click Radobod's node. force: true is required because D3 wraps the text in a border <rect>
    // that intercepts pointer events, which is expected SVG chart layout behavior.
    await page.getByText('Radobod').click({force: true});
    const highlighted = page.locator('#chart .indi.person-selected');
    await expect(highlighted).toContainText('Radobod');
    await expect(page.locator('#chart')).not.toContainText('Chike');
    await expect(page).not.toHaveURL(/indi=/);
    await expect
      .poll(async () => {
        const card = await highlighted.boundingBox();
        const viewport = await page.locator('#svgContainer').boundingBox();
        return card && viewport
          ? Math.max(
              Math.abs(
                card.x + card.width / 2 - viewport.x - viewport.width / 2,
              ),
              Math.abs(
                card.y + card.height / 2 - viewport.y - viewport.height / 2,
              ),
            )
          : Infinity;
      })
      .toBeLessThan(15);
    await highlighted.getByText('Radobod').click({force: true});
    await expect(page.locator('#chart')).toContainText('Chike');
    await expect(highlighted).toContainText('Radobod');
  });

  test('shows the right panel', async ({page}) => {
    await expect(page.locator('#content')).toContainText('a random note');
  });
});

for (const view of ['relatives', 'fancy', 'donatso']) {
  test(`${view}: search highlights and centers before changing the root`, async ({
    page,
    context,
  }) => {
    await setupGedcomRoute(context);
    await page.goto(`/#/view?url=https://example.org/family.ged&view=${view}`);
    const search = page.getByPlaceholder('Search for people', {exact: false});
    await search.fill('chik');
    await expect(page.locator('.results')).toContainText('Chike');
    await search.press('Enter');
    const card =
      view === 'donatso'
        ? page
            .locator('.card_cont')
            .filter({has: page.locator('.card-main-outline')})
        : page.locator('#chart .person-selected');
    await expect(card).toContainText('Chike');
    await expect(page).not.toHaveURL(/indi=/);
    await expect
      .poll(async () => {
        const bounds = await card.boundingBox();
        const viewport = await page
          .locator(
            view === 'donatso' ? '#dotatsoSvgContainer' : '#svgContainer',
          )
          .boundingBox();
        return bounds && viewport
          ? Math.max(
              Math.abs(
                bounds.x + bounds.width / 2 - viewport.x - viewport.width / 2,
              ),
              Math.abs(
                bounds.y + bounds.height / 2 - viewport.y - viewport.height / 2,
              ),
            )
          : Infinity;
      })
      .toBeLessThan(15);
    await card.click({force: true});
    await expect(page).toHaveURL(/indi=/);
  });
}
