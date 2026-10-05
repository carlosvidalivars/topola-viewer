import {expect, test} from '@playwright/test';
import {readFileSync} from 'fs';
import {mockGedcomResponse} from './helpers';

for (const view of ['hourglass', 'relatives', 'fancy', 'donatso']) {
  test(`${view}: home button returns to the GEDCOM main person on mobile`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({width: 390, height: 844});
    const gedcom = readFileSync(
      'src/datasource/testdata/test.ged',
      'utf8',
    ).replace('0 HEAD', '0 HEAD\n1 _ROOT @I2@');
    await mockGedcomResponse(context, gedcom);
    await page.goto(
      `/#/view?url=https://example.org/family.ged&view=${view}&indi=I3`,
    );
    const button = page.getByRole('button', {name: 'Center on main person'});
    await expect(button).toBeVisible();
    await button.click();
    await expect(page).toHaveURL(/indi=I2/);
    const selected = page
      .locator(
        view === 'donatso' ? '.card-main-outline' : '#chart .person-selected',
      )
      .first();
    await expect(selected).toBeVisible();
    if (view !== 'donatso') {
      await expect(page.locator('#chart')).toHaveAttribute(
        'aria-busy',
        'false',
      );
      await page.locator('#svgContainer').evaluate((element) => {
        element.scrollTop += 200;
      });
      await button.click();
      await expect
        .poll(async () => {
          const bounds = await selected.boundingBox();
          const viewport = await page.locator('#svgContainer').boundingBox();
          return bounds && viewport
            ? Math.abs(
                bounds.y + bounds.height / 2 - viewport.y - viewport.height / 2,
              )
            : Infinity;
        })
        .toBeLessThan(25);
    }
  });
}

test('home button falls back to the first person when no main person is declared', async ({
  page,
  context,
}) => {
  await mockGedcomResponse(
    context,
    readFileSync('src/datasource/testdata/test.ged', 'utf8'),
  );
  await page.goto('/#/view?url=https://example.org/family.ged&indi=I3');
  await page.getByRole('button', {name: 'Center on main person'}).click();
  await expect(page).toHaveURL(/indi=I1/);
});

for (const width of [390, 1280]) {
  test(`home button stays outside the side panel at width ${width}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({width, height: 844});
    await mockGedcomResponse(
      context,
      readFileSync('src/datasource/testdata/test.ged', 'utf8'),
    );
    await page.goto('/#/view?url=https://example.org/family.ged');
    const button = page.getByRole('button', {name: 'Center on main person'});
    for (let i = 0; i < 2; i++) {
      await expect(button).toBeVisible();
      await expect
        .poll(() =>
          button.evaluate((element) => {
            const box = element.getBoundingClientRect();
            return [
              [4, 4],
              [box.width - 4, 4],
              [4, box.height - 4],
              [box.width - 4, box.height - 4],
            ].every(([x, y]) =>
              element.contains(document.elementFromPoint(box.x + x, box.y + y)),
            );
          }),
        )
        .toBe(true);
      await button.click();
      await page.locator('#sideToggle').click();
    }
  });
}
