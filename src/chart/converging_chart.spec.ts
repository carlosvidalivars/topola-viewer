import {describe, expect, it} from '@jest/globals';
import type {HierarchyPointNode} from 'd3-hierarchy';
import {linkId, TreeNode, V_SPACING} from 'topola';
import {convergeDescendants} from './converging_chart';

type Node = HierarchyPointNode<TreeNode>;

function node(
  id: string,
  family: string | undefined,
  indi: string,
  spouse: string | undefined,
  generation: number,
  x: number,
  parent?: Node,
): Node {
  const result = {
    id,
    data: {
      id,
      family: family ? {id: family} : undefined,
      indi: {id: indi},
      spouse: spouse ? {id: spouse} : undefined,
      generation,
      width: 120,
      height: 60,
    },
    x,
    y: generation * 100,
    parent: parent ?? null,
  } as Node;
  if (parent) (parent.children ??= []).push(result);
  return result;
}

function cousinBranches() {
  const root = node('F0', 'F0', 'grandfather', 'grandmother', 0, 0);
  const left = node('F1', 'F1', 'aunt', 'uncle', 1, -200, root);
  const right = node('F2', 'F2', 'father', 'mother', 1, 200, root);
  const first = node('F3', 'F3', 'cousinA', 'cousinB', 2, -200, left);
  const second = node('F3_2', 'F3', 'cousinB', 'cousinA', 2, 200, right);
  const child = node('child', undefined, 'child', undefined, 3, -200, first);
  const childCopy = node(
    'child',
    undefined,
    'child',
    undefined,
    3,
    200,
    second,
  );
  return {root, left, right, first, second, child, childCopy};
}

describe('convergeDescendants', () => {
  it('joins both cousin branches at one couple and draws their child once', () => {
    const {root, left, right, first, second, child, childCopy} =
      cousinBranches();
    const result = convergeDescendants([
      root,
      left,
      right,
      first,
      second,
      child,
      childCopy,
    ]);
    expect(result.nodes).toHaveLength(5);
    expect(first.x).toBe(0);
    expect(child.x).toBe(0);
    const incoming = result.links.filter(
      (link) => link.data.family?.id === 'F3',
    );
    expect(incoming).toHaveLength(2);
    expect(incoming.map((link) => link.parent?.id)).toEqual(['F1', 'F2']);
    expect(incoming[0].data.spouseParentNodeId).toBeUndefined();
    expect(incoming[1].data.spouseParentNodeId).toBe('F2');
    expect(
      result.links.filter((link) => link.data.indi?.id === 'child'),
    ).toHaveLength(1);
  });

  it('preserves repeated ancestors and leaves ordinary trees untouched', () => {
    const root = node('F0', 'F0', 'person', 'spouse', 0, 0);
    const a = node('F1', 'F1', 'ancestor', 'partner', -1, -100, root);
    const b = node('F1_2', 'F1', 'ancestor', 'partner', -1, 100, root);
    const nodes = [root, a, b];
    const result = convergeDescendants(nodes);
    expect(result.nodes).toBe(nodes);
    expect(result.links).toBe(nodes);
    expect(a.x).toBe(-100);
    expect(b.x).toBe(100);
  });

  it('puts a shared family and its children below the longer incoming branch', () => {
    const {root, left, right, first, second, child, childCopy} =
      cousinBranches();
    const extra = node('F4', 'F4', 'parent', 'partner', 2, 200, right);
    second.parent = extra;
    second.data.generation = 3;
    second.y = 300;
    childCopy.data.generation = 4;
    childCopy.y = 400;
    const result = convergeDescendants([
      root,
      left,
      right,
      extra,
      first,
      second,
      child,
      childCopy,
    ]);
    expect(result.nodes).toHaveLength(6);
    expect(second.data.generation).toBe(3);
    expect(childCopy.data.generation).toBe(4);
    expect(childCopy.y - second.y).toBeGreaterThanOrEqual(60 + V_SPACING);
    expect(
      result.links.filter((link) => link.data.family?.id === 'F3'),
    ).toHaveLength(2);
  });

  it('keeps different marriages of the same person and their connecting link', () => {
    const {root, left, right, first, second, child, childCopy} =
      cousinBranches();
    const marriage = node('F4', 'F4', 'cousinA', 'otherSpouse', 2, -60, left);
    marriage.data.additionalMarriage = true;
    const result = convergeDescendants([
      root,
      left,
      right,
      first,
      marriage,
      second,
      child,
      childCopy,
    ]);
    expect(result.nodes).toContain(marriage);
    expect(
      result.links.filter((link) => link.data.additionalMarriage),
    ).toHaveLength(1);
    expect(
      result.nodes.filter((entry) => entry.data.indi?.id === 'cousinA'),
    ).toHaveLength(2);
  });

  it('separates unrelated siblings from a shared couple', () => {
    const {root, left, right, first, second, child, childCopy} =
      cousinBranches();
    const sibling = node(
      'sibling',
      undefined,
      'sibling',
      undefined,
      2,
      0,
      left,
    );
    const result = convergeDescendants([
      root,
      left,
      right,
      first,
      second,
      sibling,
      child,
      childCopy,
    ]);
    const row = result.nodes
      .filter((entry) => entry.y === first.y)
      .sort((a, b) => a.x - b.x);
    expect(row[1].x - row[0].x).toBeGreaterThanOrEqual(135);
  });

  it('keeps separate spouse identities and link keys when both cousins had earlier marriages', () => {
    const {root, left, right, first, second, child, childCopy} =
      cousinBranches();
    const firstMarriage = node(
      'FA',
      'FA',
      'cousinA',
      'earlierA',
      2,
      -340,
      left,
    );
    const secondMarriage = node(
      'FB',
      'FB',
      'cousinB',
      'earlierB',
      2,
      60,
      right,
    );
    left.children = [firstMarriage, first];
    right.children = [secondMarriage, second];
    first.data.additionalMarriage = true;
    second.data.additionalMarriage = true;
    const result = convergeDescendants([
      root,
      left,
      right,
      firstMarriage,
      first,
      secondMarriage,
      second,
      child,
      childCopy,
    ]);
    const marriages = result.links.filter(
      (link) => link.data.additionalMarriage,
    );
    expect(marriages).toHaveLength(2);
    expect(new Set(marriages.map(linkId)).size).toBe(2);
    expect(
      marriages.map(
        (link) =>
          (link.data as TreeNode & {connectionPersonId: string})
            .connectionPersonId,
      ),
    ).toEqual(['cousinA', 'cousinB']);
    expect(marriages[1].data.spouse?.id).toBe('cousinB');
  });

  it('avoids overlapping cards on partially overlapping rows', () => {
    const {root, left, right, first, second, child, childCopy} =
      cousinBranches();
    const sibling = node(
      'sibling',
      undefined,
      'sibling',
      undefined,
      2,
      0,
      left,
    );
    sibling.y += 20;
    convergeDescendants([
      root,
      left,
      right,
      first,
      second,
      sibling,
      child,
      childCopy,
    ]);
    expect(Math.abs(first.x - sibling.x)).toBeGreaterThanOrEqual(135);
  });
});
