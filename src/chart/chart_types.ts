import {
  CircleRenderer,
  DetailedRenderer,
  FancyChart,
  IndiInfo,
  JsonGedcomData,
  ChartColors as TopolaChartColors,
} from 'topola';
import {ChartColors, Ids, PlaceDisplay, Sex} from '../sidepanel/config/config';
import {
  ConvergingHourglassChart,
  ConvergingRelativesChart,
} from './converging_chart';

/** Supported chart types. */
export enum ChartType {
  Hourglass,
  Relatives,
  Donatso,
  Fancy,
}

export interface ChartProps {
  data: JsonGedcomData;
  selection: IndiInfo;
  focusedPerson?: IndiInfo;
  chartType: ChartType;
  onSelection: (indiInfo: IndiInfo) => void;
  onDetailSelection: (indiInfo: IndiInfo) => void;
  freezeAnimation?: boolean;
  colors?: ChartColors;
  hideIds?: Ids;
  hideSex?: Sex;
  placeDisplay?: PlaceDisplay;
  placeCount?: number;
  /** Called once after the initial D3 layout and SVG render completes. */
  onFirstRender?: () => void;
}

export const chartColors = new Map<ChartColors, TopolaChartColors>([
  [ChartColors.NO_COLOR, TopolaChartColors.NO_COLOR],
  [ChartColors.COLOR_BY_GENERATION, TopolaChartColors.COLOR_BY_GENERATION],
  [ChartColors.COLOR_BY_SEX, TopolaChartColors.COLOR_BY_SEX],
]);

export function getChartType(chartType: ChartType) {
  switch (chartType) {
    case ChartType.Hourglass:
      return ConvergingHourglassChart;
    case ChartType.Relatives:
      return ConvergingRelativesChart;
    case ChartType.Fancy:
      return FancyChart;
    default:
      // Fall back to hourglass chart.
      return ConvergingHourglassChart;
  }
}

export function getRendererType(chartType: ChartType) {
  switch (chartType) {
    case ChartType.Fancy:
      return CircleRenderer;
    default:
      // Use DetailedRenderer by default.
      return DetailedRenderer;
  }
}
