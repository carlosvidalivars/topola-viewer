import {max, min} from 'd3-array';
import {interpolateNumber} from 'd3-interpolate';
import {BaseType, select, Selection} from 'd3-selection';
import 'd3-transition';
import {
  D3ZoomEvent,
  zoom,
  ZoomBehavior,
  ZoomedElementBaseType,
  zoomTransform,
} from 'd3-zoom';
import {IntlShape} from 'react-intl';
import {ChartHandle, ChartInfo, createChart, TreeNode} from 'topola';
import {
  chartColors,
  ChartProps,
  getChartType,
  getRendererType,
} from './chart_types';

/** How much to zoom when using the +/- buttons. */
const ZOOM_FACTOR = 1.3;

/** The SVG's layout offset must also be part of D3's camera coordinates. */
function chartOffset(
  parent: Element,
  size: [number, number],
  scale: number,
  padded: boolean,
): [number, number] {
  return padded
    ? [parent.clientWidth / 2, parent.clientHeight / 2]
    : [
        Math.max(0, (parent.clientWidth - size[0] * scale) / 2),
        Math.max(0, (parent.clientHeight - size[1] * scale) / 2),
      ];
}

/**
 * Called when the view is dragged with the mouse.
 *
 * @param size the size of the chart
 */
function zoomed(
  size: [number, number],
  event: D3ZoomEvent<ZoomedElementBaseType, unknown>,
  padded = false,
) {
  const parent = select('#svgContainer').node() as Element;

  const scale = event.transform.k;
  const [offsetX, offsetY] = chartOffset(parent, size, scale, padded);
  select('#chartSvg')
    .attr('width', size[0] * scale + (padded ? parent.clientWidth : 0))
    .attr('height', size[1] * scale + (padded ? parent.clientHeight : 0))
    .attr('transform', padded ? null : `translate(${offsetX}, ${offsetY})`);
  select('#chart').attr(
    'transform',
    padded
      ? `translate(${parent.clientWidth / 2}, ${parent.clientHeight / 2}) scale(${scale})`
      : `scale(${scale})`,
  );

  parent.scrollLeft = offsetX - event.transform.x;
  parent.scrollTop = offsetY - event.transform.y;
}

/** Called when the scrollbars are used. */
function scrolled(size: [number, number], padded = false) {
  const parent = select('#svgContainer').node() as Element;
  const scale = zoomTransform(parent).k;
  const [offsetX, offsetY] = chartOffset(parent, size, scale, padded);
  const x = parent.scrollLeft + parent.clientWidth / 2 - offsetX;
  const y = parent.scrollTop + parent.clientHeight / 2 - offsetY;
  select(parent).call(zoom().translateTo, x / scale, y / scale);
}

/** Returns the element's usable width and height by subtracting the assumed scrollbar size. */
function getScrollbarAwareSize(
  element: Element,
  scrollbarSize = 20,
): [number, number] {
  const htmlElement = element as HTMLElement;
  return [
    htmlElement.clientWidth - scrollbarSize,
    htmlElement.clientHeight - scrollbarSize,
  ];
}

/**
 * Calculates the allowed zoom scale range.
 * Sets the minimum scale so the chart cannot zoom out beyond full visibility,
 * and fixes the maximum scale at 2.
 */
function calculateScaleExtent(
  parent: Element,
  scale: number,
  chartInfo: ChartInfo,
): [number, number] {
  const [availWidth, availHeight] = getScrollbarAwareSize(parent);

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const zoomOutFactor = min([
    1,
    scale,
    availWidth / chartInfo.size[0],
    availHeight / chartInfo.size[1],
  ])!;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return [max([0.1, zoomOutFactor])!, 2];
}

export class ChartWrapper {
  private chart?: ChartHandle;
  /** Animation is in progress. */
  private animating = false;
  /** Rendering is required after the current animation finishes. */
  private rerenderRequired = false;
  /** The d3 zoom behavior object. */
  private zoomBehavior?: ZoomBehavior<Element, unknown>;
  /** Props that will be used for rerendering. */
  private rerenderProps?: ChartProps;
  private rerenderResetPosition?: boolean;

  private currentProps?: ChartProps;
  private chartInfo?: ChartInfo;
  private focusedId?: string;

  /** Highlight and move the camera without recalculating the existing tree. */
  focusPerson(props: ChartProps, intl: IntlShape, force = false) {
    this.currentProps = props;
    if (!this.chartInfo || this.animating) return;
    const id = props.focusedPerson?.id;
    if (!force && id === this.focusedId) return;
    this.focusedId = id;
    select('#focusPreview').remove();
    const parent = select('#svgContainer').node() as Element;
    let size: [number, number] = [...this.chartInfo.size];
    const matches = () => {
      const detailed = select('#chart').selectAll<
        SVGGElement,
        {indi: {id: string}}
      >('.indi');
      detailed.classed('person-selected', (d) => d.indi.id === id);
      const circles = select('#chart').selectAll<SVGGElement, {data: TreeNode}>(
        '.circle',
      );
      circles.on('click.selection', (event: MouseEvent, d) => {
        const text =
          event.target instanceof SVGTextElement ? event.target : undefined;
        const texts = text
          ? Array.from(text.parentElement?.querySelectorAll('text') || [])
          : [];
        const person = text
          ? texts.indexOf(text) === 1
            ? d.data.spouse
            : d.data.indi
          : d.data.spouse?.id === this.currentProps?.focusedPerson?.id
            ? d.data.spouse
            : d.data.indi;
        if (!person) return;
        const info = {id: person.id, generation: d.data.generation || 0};
        if (event.shiftKey) this.currentProps?.onDetailSelection(info);
        else this.currentProps?.onSelection(info);
      });
      circles.classed(
        'person-selected',
        (d) => !!id && (d.data.indi?.id === id || d.data.spouse?.id === id),
      );
      return select('#chart').select<SVGGElement>('.person-selected').node();
    };
    let target = matches();
    if (id && !target) {
      const person = props.data.indis.find((indi) => indi.id === id);
      if (person) {
        select('#chart')
          .append('g')
          .attr('id', 'focusPreview')
          .attr('transform', `translate(${size[0] + 40}, 20)`);
        const preview = createChart({
          json: {indis: [{...person, famc: undefined, fams: []}], fams: []},
          chartType: getChartType(props.chartType),
          renderer: getRendererType(props.chartType),
          svgSelector: '#focusPreview',
          indiCallback: (info) => this.currentProps?.onSelection(info),
          animate: false,
          updateSvgSize: false,
          locale: intl.locale,
        }).render({startIndi: id});
        size = [
          size[0] + 40 + preview.size[0],
          Math.max(size[1], preview.size[1] + 20),
        ];
        target = matches();
      }
    }
    const scale = zoomTransform(parent).k;
    this.zoomBehavior = zoom<Element, unknown>()
      .scaleExtent(
        calculateScaleExtent(parent, scale, {...this.chartInfo, size}),
      )
      .translateExtent([
        [
          id ? -parent.clientWidth / (2 * scale) : 0,
          id ? -parent.clientHeight / (2 * scale) : 0,
        ],
        [
          size[0] + (id ? parent.clientWidth / (2 * scale) : 0),
          size[1] + (id ? parent.clientHeight / (2 * scale) : 0),
        ],
      ])
      .on('zoom', (event) => zoomed(size, event, !!id));
    select(parent)
      .on('scroll', () => scrolled(size, !!id))
      .call(this.zoomBehavior);
    select('#chartSvg').interrupt();
    zoomed(
      size,
      {transform: zoomTransform(parent)} as D3ZoomEvent<
        ZoomedElementBaseType,
        unknown
      >,
      !!id,
    );
    if (target) {
      const bounds = target.getBoundingClientRect();
      const viewport = parent.getBoundingClientRect();
      // Scroll by the distance between the person and the viewport centers.
      parent.scrollLeft +=
        bounds.x + bounds.width / 2 - viewport.x - parent.clientWidth / 2;
      parent.scrollTop +=
        bounds.y + bounds.height / 2 - viewport.y - parent.clientHeight / 2;
    }
    scrolled(size, !!id);
  }

  zoom(factor: number) {
    const parent = select('#svgContainer') as Selection<
      Element,
      unknown,
      BaseType,
      unknown
    >;
    this.zoomBehavior?.scaleBy(parent, factor);
  }

  /**
   * Renders the chart or performs a transition animation to a new state.
   * If indiInfo is not given, it means that it is the initial render and no
   * animation is performed.
   */
  renderChart(
    props: ChartProps,
    intl: IntlShape,
    args: {initialRender: boolean; resetPosition: boolean} = {
      initialRender: false,
      resetPosition: false,
    },
  ) {
    this.currentProps = props;
    // Nothing changed — the SVG is already correct. Skip re-render.
    // This prevents repeated full D3 layout passes (500ms+ each) that happen
    // when React re-renders for unrelated state changes.
    if (!args.initialRender && !args.resetPosition) {
      return;
    }

    // Wait for animation to finish if animation is in progress.
    if (!args.initialRender && this.animating) {
      this.rerenderRequired = true;
      this.rerenderProps = props;
      this.rerenderResetPosition = args.resetPosition;
      return;
    }

    // Freeze changing selection after initial rendering.
    if (!args.initialRender && props.freezeAnimation) {
      return;
    }

    if (args.initialRender || !this.chart) {
      (select('#chart').node() as HTMLElement).innerHTML = '';
      this.chart = createChart({
        json: props.data,
        chartType: getChartType(props.chartType),
        renderer: getRendererType(props.chartType),
        svgSelector: '#chart',
        indiCallback: (info) => {
          // ths is called when an individual is selected in the chart
          if (info.modifiers?.shiftKey) {
            // If the shift key is pressed, we just update the details tab without changing the selection in the chart.
            // This allows users to quickly view details of multiple individuals without losing their place in the chart.
            this.currentProps?.onDetailSelection(info);
          } else {
            // If the shift key is not pressed, we update the selection in the chart as usual.
            this.currentProps?.onSelection(info);
          }
        },
        colors:
          props.colors !== undefined
            ? chartColors.get(props.colors)
            : undefined,
        animate: true,
        updateSvgSize: false,
        locale: intl.locale,
      });
    } else {
      this.chart.setData(props.data);
    }
    select('#focusPreview').remove();
    const chartInfo = this.chart.render({
      startIndi: props.selection.id,
      baseGeneration: props.selection.generation,
    });
    select('#chart').attr('aria-busy', 'true');
    this.chartInfo = chartInfo;
    const svg = select('#chartSvg');
    const parent = select('#svgContainer').node() as Element;
    const scale = zoomTransform(parent).k;
    const extent: [number, number] = calculateScaleExtent(
      parent,
      scale,
      chartInfo,
    );

    this.zoomBehavior = zoom()
      .scaleExtent(extent)
      .translateExtent([[0, 0], chartInfo.size])
      .on('zoom', (event) => zoomed(chartInfo.size, event));

    select(parent)
      .on('scroll', () => scrolled(chartInfo.size))
      .call(this.zoomBehavior);

    const scrollTopTween = (scrollTop: number) => {
      return () => {
        const i = interpolateNumber(parent.scrollTop, scrollTop);
        return (t: number) => {
          parent.scrollTop = i(t);
        };
      };
    };
    const scrollLeftTween = (scrollLeft: number) => {
      return () => {
        const i = interpolateNumber(parent.scrollLeft, scrollLeft);
        return (t: number) => {
          parent.scrollLeft = i(t);
        };
      };
    };

    const dx = parent.clientWidth / 2 - chartInfo.origin[0] * scale;
    const dy = parent.clientHeight / 2 - chartInfo.origin[1] * scale;
    const offsetX = max([
      0,
      (parent.clientWidth - chartInfo.size[0] * scale) / 2,
    ]);
    const offsetY = max([
      0,
      (parent.clientHeight - chartInfo.size[1] * scale) / 2,
    ]);
    const svgTransition = svg.transition().delay(200).duration(500);
    const transition = args.initialRender ? svg : svgTransition;
    transition.attr('transform', `translate(${offsetX}, ${offsetY})`);
    transition.attr('width', chartInfo.size[0] * scale);
    transition.attr('height', chartInfo.size[1] * scale);
    if (args.resetPosition) {
      if (args.initialRender) {
        parent.scrollLeft = -dx;
        parent.scrollTop = -dy;
      } else {
        svgTransition
          .tween('scrollLeft', scrollLeftTween(-dx))
          .tween('scrollTop', scrollTopTween(-dy));
      }
    }

    // After the animation is finished, rerender the chart if required.
    this.animating = true;
    chartInfo.animationPromise.then(() => {
      this.animating = false;
      select('#chart').attr('aria-busy', 'false');
      if (this.currentProps) this.focusPerson(this.currentProps, intl, true);
      if (this.rerenderRequired) {
        this.rerenderRequired = false;
        // Use `this.rerenderProps` instead of the props in scope because
        // the props may have been updated in the meantime.
        if (this.rerenderProps) {
          this.renderChart(this.rerenderProps, intl, {
            initialRender: false,
            resetPosition: !!this.rerenderResetPosition,
          });
        } else {
          console.error(
            'Rerender required after animation, but rerenderProps was not set.',
          );
        }
      }
    });
  }
}

export {ZOOM_FACTOR};
