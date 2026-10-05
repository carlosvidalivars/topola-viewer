import {expect, test} from '@playwright/test';
import {setupGedcomRoute} from './helpers';

for (const view of ['hourglass', 'relatives', 'fancy']) {
  test(`${view}: wheel zoom keeps the tree point under the cursor after centering`, async ({
    page,
    context,
  }) => {
    await setupGedcomRoute(context);
    await page.goto(`/#/view?url=https://example.org/family.ged&view=${view}`);
    const search = page.getByPlaceholder('Search for people', {exact: false});
    await search.fill('chik');
    await expect(page.locator('.results')).toContainText('Chike');
    await search.press('Enter');
    await expect(page.locator('#chart .person-selected')).toContainText(
      'Chike',
    );
    await expect(page.locator('#chart')).toHaveAttribute('aria-busy', 'false');

    const viewport = await page.locator('#svgContainer').boundingBox();
    if (!viewport) throw new Error('Missing chart viewport');
    const cursor = {
      x: viewport.x + viewport.width * 0.6,
      y: viewport.y + viewport.height * 0.4,
    };
    await page.mouse.move(cursor.x, cursor.y);
    for (const delta of [-240, 120]) {
      const before = await page
        .locator('#chart')
        .evaluate((element: SVGGElement, cursor) => {
          const matrix = element.getScreenCTM();
          if (!matrix) throw new Error('Missing chart matrix');
          const point = new DOMPoint(cursor.x, cursor.y).matrixTransform(
            matrix.inverse(),
          );
          return {x: point.x, y: point.y, scale: matrix.a};
        }, cursor);
      await page.mouse.wheel(0, delta);
      await expect
        .poll(() =>
          page
            .locator('#chart')
            .evaluate((element: SVGGElement) => element.getScreenCTM()?.a),
        )
        .not.toBe(before.scale);
      const after = await page
        .locator('#chart')
        .evaluate((element: SVGGElement, point) => {
          const matrix = element.getScreenCTM();
          if (!matrix) throw new Error('Missing chart matrix');
          const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
          return {x: screen.x, y: screen.y};
        }, before);
      expect(Math.abs(after.x - cursor.x)).toBeLessThan(3);
      expect(Math.abs(after.y - cursor.y)).toBeLessThan(3);
    }
  });
}
