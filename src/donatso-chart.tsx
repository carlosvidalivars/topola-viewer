import {select} from 'd3-selection';
import {
  Datum,
  Store,
  TreeDatum,
  createStore,
  createSvg,
  elements,
  handlers,
  view,
} from 'family-chart';
import {useEffect, useRef} from 'react';
import {IntlShape, useIntl} from 'react-intl';
import {IndiInfo, JsonFam, JsonGedcomData} from 'topola';
import {formatDateOrRange} from './util/date_util';

export interface DonatsoChartProps {
  data: JsonGedcomData;
  selection: IndiInfo;
  focusedPerson?: IndiInfo;
  centerRequest?: number;
  onSelection: (indiInfo: IndiInfo) => void;
  /** Called once after the initial chart render completes. */
  onFirstRender?: () => void;
}

function getOtherSpouse(fam: JsonFam, indi: string) {
  return fam.husb === indi ? fam.wife : fam.husb;
}

function convertData(data: JsonGedcomData, intl: IntlShape): Datum[] {
  const famMap = new Map<string, JsonFam>();
  data.fams.forEach((fam) => famMap.set(fam.id, fam));
  return data.indis.map((indi) => {
    const famc = (indi.famc && famMap.get(indi.famc)) || undefined;
    const fams = (indi.fams || [])
      .map((fam) => famMap.get(fam))
      .filter((fam): fam is JsonFam => fam !== undefined);
    const father = famc?.husb;
    const mother = famc?.wife;
    const parents = [father, mother].filter((x) => !!x);
    const spouses = fams
      .map((fam) => getOtherSpouse(fam, indi.id))
      .filter((indi): indi is string => indi !== undefined);
    const children = fams.flatMap((fam) => fam.children || []);

    return {
      id: indi.id,
      data: {
        'first name': indi.firstName,
        'last name': indi.lastName,
        birthday: formatDateOrRange(indi.birth, intl),
        avatar: indi.images?.[0]?.url,
        gender: indi.sex,
      },
      rels: {
        parents,
        spouses,
        children,
      },
    } as Datum;
  });
}

class ChartWrapper {
  private store!: Store;
  private svg!: SVGSVGElement;
  private card!: ReturnType<typeof elements.CardSvg>;
  private data?: JsonGedcomData;
  private intl?: IntlShape;
  private rootId?: string;
  private focusedId?: string;
  private centerRequest?: number;
  onSelection?: DonatsoChartProps['onSelection'];

  initializeChart(props: DonatsoChartProps, intl: IntlShape) {
    this.data = props.data;
    this.intl = intl;
    this.rootId = props.selection.id;
    this.focusedId = props.focusedPerson?.id;
    const data = convertData(props.data, intl);
    this.store = createStore({
      data,
      main_id: props.selection.id,
    });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const svg = createSvg(document.querySelector('#dotatsoSvgContainer')!);
    this.svg = svg;
    const onCardClick = (_e: MouseEvent, d: TreeDatum) =>
      this.onSelection?.({id: d.data.id, generation: 0});
    const card = elements.CardSvg({
      store: this.store,
      svg,
      card_display: [
        (i: Datum) =>
          `${i.data['first name'] || ''} ${i.data['last name'] || ''}`,
        (i: Datum) => `${i.data.birthday || ''}`,
      ] as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      mini_tree: true,
      link_break: false,
      onCardClick,
      onMiniTreeClick: onCardClick,
      card_dim: {
        w: 220,
        h: 70,
        text_x: 75,
        text_y: 15,
        img_w: 60,
        img_h: 60,
        img_x: 5,
        img_y: 5,
      },
    });
    this.card = card;
    this.store.setOnUpdate((props: unknown) => {
      select(svg).select('.focused-person-preview').remove();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      view(this.store.getTree()!, svg, card, props || {});
      this.updateFocus(false);
    });
    this.store.updateTree({initial: true});
    this.updateFocus(true);
  }

  updateChart(props: DonatsoChartProps, intl: IntlShape) {
    const treeChanged =
      props.data !== this.data ||
      props.selection.id !== this.rootId ||
      intl !== this.intl;
    const focusChanged =
      props.focusedPerson?.id !== this.focusedId ||
      props.centerRequest !== this.centerRequest;
    this.centerRequest = props.centerRequest;
    this.focusedId = props.focusedPerson?.id;
    if (treeChanged) {
      this.data = props.data;
      this.intl = intl;
      this.rootId = props.selection.id;
      this.store.updateData(convertData(props.data, intl));
      this.store.updateMainId(props.selection.id);
      this.store.updateTree();
    }
    if (treeChanged || focusChanged) {
      this.updateFocus(true);
    }
  }

  private updateFocus(center: boolean) {
    select(this.svg).select('.focused-person-preview').remove();
    let focusedDatum = this.focusedId
      ? this.store.getTreeDatum(this.focusedId)
      : undefined;
    if (!focusedDatum && this.focusedId) {
      const data = this.store.getDatum(this.focusedId);
      const tree = this.store.getTree();
      if (data && tree) {
        // Keep every existing card and relation in place; show an isolated
        // search result beside the tree until it is selected as the root.
        focusedDatum = {
          data,
          x: tree.data.reduce((right, d) => Math.max(right, d.x), 0) + 330,
          y: 0,
          depth: 0,
          all_rels_displayed: true,
        };
        const renderCard = this.card;
        select(this.svg)
          .select('.cards_view')
          .append('g')
          .attr('class', 'card_cont focused-person-preview')
          .attr('transform', `translate(${focusedDatum.x},${focusedDatum.y})`)
          .datum(focusedDatum)
          .each(function (d) {
            // family-chart types the shared card renderer as HTML although
            // CardSvg renders SVG groups.
            renderCard.call(this as unknown as HTMLElement, d);
          });
      }
    }
    const highlightedId = focusedDatum?.data.id || this.rootId;
    select(this.svg)
      .selectAll<SVGGElement, TreeDatum>('g.card_cont')
      .select('.card-outline')
      .classed('card-main-outline', (d) => d.data.id === highlightedId);
    if (center && focusedDatum) {
      handlers.cardToMiddle({
        datum: focusedDatum,
        svg: this.svg,
        svg_dim: this.svg.getBoundingClientRect(),
        transition_time: 300,
      });
    }
  }
}

export function DonatsoChart(props: DonatsoChartProps) {
  const chartWrapper = useRef(new ChartWrapper());
  const initialized = useRef(false);
  const intl = useIntl();
  chartWrapper.current.onSelection = props.onSelection;

  useEffect(() => {
    if (!initialized.current) {
      chartWrapper.current.initializeChart(props, intl);
      initialized.current = true;
      props.onFirstRender?.();
    } else {
      chartWrapper.current.updateChart(props, intl);
    }
  });

  return <div id="dotatsoSvgContainer"></div>;
}
