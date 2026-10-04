import {expect, test} from '@playwright/test';
import type {HierarchyPointNode} from 'd3-hierarchy';
import {readFileSync} from 'node:fs';
import type {TreeNode} from 'topola';
import {mockGedcomResponse} from './helpers';

for (const view of ['hourglass', 'relatives']) {
  test(`${view}: cousin branches converge and survive selection changes`, async ({
    page,
    context,
  }, testInfo) => {
    await mockGedcomResponse(
      context,
      readFileSync('tests/fixtures/cousins.ged', 'utf8'),
    );
    await page.goto(
      `/#/view?url=https://example.org/family.ged&indi=I1&view=${view}`,
    );
    const chart = page.locator('#chart');
    await expect(chart.getByText('Sharedchild', {exact: true})).toHaveCount(1);
    await expect(
      chart.getByText('Sharedgrandchild', {exact: true}),
    ).toHaveCount(1);
    await expect(chart.getByText('Cousinone', {exact: true})).toHaveCount(1);
    await expect(chart.getByText('Cousintwo', {exact: true})).toHaveCount(1);

    const incoming = await chart.locator('path.link').evaluateAll((paths) => {
      return paths
        .map((path) => {
          const node = (
            path as unknown as {
              __data__: {
                data: {family?: {id: string}; spouseParentNodeId?: string};
                parent?: {id?: string; data: {family?: {id: string}}};
              };
            }
          ).__data__;
          return {
            family: node.data.family?.id,
            parent: node.parent?.data.family?.id,
            spouse: node.data.spouseParentNodeId === node.parent?.id,
          };
        })
        .filter((link) => link.family === 'F4');
    });
    expect(incoming).toEqual(
      expect.arrayContaining([
        {family: 'F4', parent: 'F2', spouse: false},
        {family: 'F4', parent: 'F3', spouse: true},
      ]),
    );
    expect(incoming).toHaveLength(2);
    await page
      .locator('#svgContainer')
      .screenshot({path: testInfo.outputPath('converged-tree.png')});

    await chart.getByText('Sharedchild', {exact: true}).click({force: true});
    await expect(page).toHaveURL(/indi=I9/);
    await expect(
      chart.getByText('Sharedgrandchild', {exact: true}),
    ).toHaveCount(1);
    // Repeated ancestors are still present when looking upwards from the child.
    await expect(chart.getByText('Grandfather', {exact: true})).toHaveCount(2);
    await chart
      .getByText('Grandfather', {exact: true})
      .first()
      .click({force: true});
    await expect(page).toHaveURL(/indi=I1/);
    await expect(chart.getByText('Sharedchild', {exact: true})).toHaveCount(1);
    await expect(
      chart.getByText('Sharedgrandchild', {exact: true}),
    ).toHaveCount(1);
  });

  test(`${view}: previous marriages connect to the correct spouse`, async ({
    page,
    context,
  }) => {
    let gedcom = readFileSync('tests/fixtures/cousins.ged', 'utf8');
    gedcom = gedcom.replace('1 FAMS @F4@', '1 FAMS @F6@\n1 FAMS @F4@');
    gedcom = gedcom.replace(
      '1 NAME Cousintwo /Common/\n1 SEX F\n1 FAMC @F3@\n1 FAMS @F4@',
      '1 NAME Cousintwo /Common/\n1 SEX F\n1 FAMC @F3@\n1 FAMS @F7@\n1 FAMS @F4@',
    );
    gedcom = gedcom.replace(
      '0 TRLR',
      `0 @I12@ INDI
1 NAME Earlierone /Other/
1 SEX F
1 FAMS @F6@
0 @I13@ INDI
1 NAME Earliertwo /Other/
1 SEX M
1 FAMS @F7@
0 @F6@ FAM
1 HUSB @I7@
1 WIFE @I12@
0 @F7@ FAM
1 HUSB @I13@
1 WIFE @I8@
0 TRLR`,
    );
    await mockGedcomResponse(context, gedcom);
    await page.goto(
      `/#/view?url=https://example.org/family.ged&indi=I1&view=${view}`,
    );
    const chart = page.locator('#chart');
    await expect(chart.getByText('Sharedchild', {exact: true})).toHaveCount(1);
    const endpoints = await chart
      .locator('path.additional-marriage')
      .evaluateAll((paths) =>
        paths.map((path) => {
          type Node = HierarchyPointNode<
            TreeNode & {connectionPersonId?: string}
          >;
          const node = (path as unknown as {__data__: Node}).__data__;
          const sibling = node.parent?.children?.[0];
          if (!sibling) throw new Error('Missing previous marriage');
          const person = node.data.connectionPersonId;
          const anchor = (entry: Node) => [
            entry.x +
              (person === entry.data.spouse?.id
                ? (entry.data.indi?.width ?? 0) / 2
                : -(entry.data.spouse?.width ?? 0) / 2),
            entry.y -
              (entry.data.height ?? 0) / 2 +
              (entry.data.indi?.height ?? 0) / 2,
          ];
          const coordinates =
            (path.getAttribute('d') ?? '')
              .match(/-?\d+(?:\.\d+)?/g)
              ?.map(Number) ?? [];
          return {
            id: node.data.id,
            start: coordinates.slice(0, 2),
            end: coordinates.slice(-2),
            expectedStart: anchor(node),
            expectedEnd: anchor(sibling),
          };
        }),
      );
    expect(endpoints).toHaveLength(2);
    expect(new Set(endpoints.map((entry) => entry.id)).size).toBe(2);
    for (const entry of endpoints) {
      expect(entry.start[0]).toBeCloseTo(entry.expectedStart[0]);
      expect(entry.start[1]).toBeCloseTo(entry.expectedStart[1]);
      expect(entry.end[0]).toBeCloseTo(entry.expectedEnd[0]);
      expect(entry.end[1]).toBeCloseTo(entry.expectedEnd[1]);
    }
  });
}
