import type {HierarchyPointNode} from 'd3-hierarchy';
import {
  ChartOptions,
  ChartUtil,
  Fam,
  H_SPACING,
  HourglassChart,
  Indi,
  RelativesChart,
  Renderer,
  TreeNode,
  V_SPACING,
} from 'topola';

type Node = HierarchyPointNode<TreeNode>;
type ConnectionData = TreeNode & {connectionPersonId?: string};

function linkCopy(node: Node, data: ConnectionData, id = node.id): Node {
  return Object.assign(Object.create(Object.getPrototypeOf(node)), node, {
    data,
    id,
  });
}

/** Ancestor occurrences remain separate; downward branches share family records. */
function isDescendant(node: Node) {
  return (
    !node.parent ||
    (node.data.generation ?? 0) >= (node.parent.data.generation ?? 0)
  );
}

function recordKey(node: Node) {
  return node.data.family
    ? `family:${node.data.family.id}`
    : `person:${node.data.indi?.id}`;
}

/**
 * Topola lays out a tree of occurrences. Convert its downward portion to a
 * graph, keeping all incoming relationships and one copy of each shared branch.
 * Link-only node copies let Topola keep its anchors and animation machinery.
 */
export function convergeDescendants(nodes: Node[], horizontal = false) {
  const groups = new Map<string, Node[]>();
  for (const node of nodes.filter(isDescendant)) {
    const key = recordKey(node);
    const group = groups.get(key) ?? [];
    group.push(node);
    groups.set(key, group);
  }
  if (![...groups.values()].some((group) => group.length > 1)) {
    return {nodes, links: nodes};
  }

  const canonical = new Map<Node, Node>();
  for (const group of groups.values()) {
    // Prefer the focused node; otherwise retain the deepest occurrence so that
    // unions between different generations still follow both parents.
    const target =
      group.find((node) => !node.parent) ??
      group.reduce((a, b) =>
        (a.data.generation ?? 0) >= (b.data.generation ?? 0) ? a : b,
      );
    for (const node of group) canonical.set(node, target);
  }
  const resolve = (node: Node) => canonical.get(node) ?? node;
  const retained = nodes.filter((node) => resolve(node) === node);
  const links: Node[] = [];
  const linkTargets = new Map<Node, Node>();
  const seenLinks = new Set<string>();
  const parents = new Map<Node, Set<Node>>();

  for (const original of nodes) {
    if (!original.parent && !original.data.additionalMarriage) continue;
    if (!isDescendant(original)) {
      links.push(original);
      continue;
    }
    const target = resolve(original);
    const source = original.parent && resolve(original.parent);
    if (!source || source === target) continue;

    if (original.data.additionalMarriage) {
      const siblings = original.parent?.children ?? [];
      const index = siblings.indexOf(original);
      const previous = siblings[index - 1];
      if (!previous) continue;
      const sibling = resolve(previous);
      if (sibling === target) continue;
      const personId = original.data.indi?.id;
      const key = `marriage:${sibling.id}:${target.id}:${personId}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      const link = linkCopy(
        target,
        {
          ...target.data,
          id: key,
          additionalMarriage: true,
          connectionPersonId: personId,
        },
        key,
      );
      const endpoint = linkCopy(sibling, {
        ...sibling.data,
        connectionPersonId: personId,
      });
      link.parent = linkCopy(source, source.data);
      link.parent.children = [endpoint, link];
      linkTargets.set(link, target);
      linkTargets.set(endpoint, sibling);
      links.push(link);
      continue;
    }

    // A repeated couple can be entered through either spouse. Match record IDs
    // rather than the left/right order of their two layout occurrences.
    const spouse = original.data.indi?.id === target.data.spouse?.id;
    const key = `${source.id}:${target.id}:${spouse}`;
    if (seenLinks.has(key)) continue;
    seenLinks.add(key);
    const link = linkCopy(
      target,
      {
        ...target.data,
        id: key,
        additionalMarriage: false,
        spouseParentNodeId: spouse ? source.id : undefined,
      },
      key,
    );
    link.parent = source;
    linkTargets.set(link, target);
    links.push(link);
    const incoming = parents.get(target) ?? new Set<Node>();
    incoming.add(source);
    parents.set(target, incoming);
  }

  const breadth = horizontal ? 'y' : 'x';
  const depth = horizontal ? 'x' : 'y';
  const breadthSize = horizontal ? 'height' : 'width';
  const depthSize = horizontal ? 'width' : 'height';
  for (const group of groups.values()) {
    const target = resolve(group[0]);
    if (!target.parent) continue;
    target[breadth] =
      group.reduce((sum, node) => sum + node[breadth], 0) / group.length;
    target[depth] = Math.max(...group.map((node) => node[depth]));
  }

  // Process parents first, including unions reached at unequal depths. This
  // keeps the shared descendants below every incoming branch.
  const pending = new Set(retained.filter(isDescendant));
  while (pending.size) {
    let progressed = false;
    for (const node of pending) {
      const incoming = [...(parents.get(node) ?? [])];
      if (incoming.some((parent) => pending.has(parent))) continue;
      for (const parent of incoming) {
        node.data.generation = Math.max(
          node.data.generation ?? 0,
          (parent.data.generation ?? 0) + 1,
        );
        node[depth] = Math.max(
          node[depth],
          parent[depth] +
            ((parent.data[depthSize] ?? 0) + (node.data[depthSize] ?? 0)) / 2 +
            V_SPACING,
        );
      }
      pending.delete(node);
      progressed = true;
    }
    // Malformed cyclic data must not make this postprocessing loop hang.
    if (!progressed) break;
  }

  // Averaging branches can move a union towards an unrelated sibling. Restore
  // spacing around the focus without shifting any ancestor occurrences.
  for (const node of retained.filter(isDescendant)) {
    if (!node.parent) continue;
    const direction = node[breadth] < 0 ? -1 : 1;
    let collision: Node | undefined;
    do {
      collision = retained.find(
        (other) =>
          other !== node &&
          Math.abs(node[depth] - other[depth]) <
            ((node.data[depthSize] ?? 0) + (other.data[depthSize] ?? 0)) / 2 &&
          Math.abs(node[breadth] - other[breadth]) <
            ((node.data[breadthSize] ?? 0) + (other.data[breadthSize] ?? 0)) /
              2 +
              H_SPACING -
              0.01,
      );
      if (collision) {
        node[breadth] =
          collision[breadth] +
          direction *
            (((node.data[breadthSize] ?? 0) +
              (collision.data[breadthSize] ?? 0)) /
              2 +
              H_SPACING);
      }
    } while (collision);
  }

  // Link copies need the final position and generation, but retain their own
  // incoming parent and spouse anchor metadata.
  for (const [link, target] of linkTargets) {
    link.x = target.x;
    link.y = target.y;
    link.data.generation = target.data.generation;
  }
  return {nodes: retained, links};
}

class ConvergingChartUtil extends ChartUtil {
  private links: Node[] = [];

  renderChart(nodes: Node[]) {
    const result = convergeDescendants(nodes, this.options.horizontal);
    this.links = result.links;
    // The original chart computes its bounds from this same array afterwards.
    if (result.nodes !== nodes) nodes.splice(0, nodes.length, ...result.nodes);
    return super.renderChart(nodes);
  }

  renderLinks(
    _nodes: Node[],
    svg: ReturnType<ChartUtil['getSvgForRendering']>,
  ) {
    const original = this.options.renderer;
    const renderer = Object.create(original) as Renderer;
    renderer.getIndiAnchor = (data: ConnectionData) =>
      data.connectionPersonId && data.connectionPersonId === data.spouse?.id
        ? original.getSpouseAnchor(data)
        : original.getIndiAnchor(data);
    return new ChartUtil({...this.options, renderer}).renderLinks(
      this.links,
      svg,
    );
  }
}

export class ConvergingHourglassChart extends HourglassChart<Indi, Fam> {
  readonly util: ChartUtil;

  constructor(options: ChartOptions) {
    super(options);
    this.util = new ConvergingChartUtil(this.options);
  }
}

export class ConvergingRelativesChart extends RelativesChart<Indi, Fam> {
  readonly util: ChartUtil;

  constructor(options: ChartOptions) {
    super(options);
    this.util = new ConvergingChartUtil(this.options);
  }
}
