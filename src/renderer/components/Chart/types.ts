export type ChartValue = number | null

interface ChartAxisOption {
  axisLabel?: {
    formatter?: (value: number) => string
    show?: boolean
  }
  axisPointer?: {
    type?: 'line' | 'shadow'
  }
  minInterval?: number
}

interface ChartGridOption {
  bottom?: number
  containLabel?: boolean
  left?: number
  right?: number
  top?: number
}

interface ChartTooltipOptionExtension {
  tooltip?: {
    valueFormatter?: (value: unknown) => string
  }
}

interface ChartLegendOptionExtension {
  legend?: {
    formatter?: (name: string) => string
  }
}

export interface CartesianChartOptionExtension extends ChartTooltipOptionExtension, ChartLegendOptionExtension {
  grid?: ChartGridOption
  xAxis?: ChartAxisOption
  yAxis?: ChartAxisOption
}

interface ChartPropsBase {
  ariaLabel: string
  className?: string
  loading?: boolean
  loadingLabel?: string
}

interface CartesianChartSeries {
  id?: string
  name?: string
  values: ChartValue[]
}

export interface CartesianChartProps extends ChartPropsBase {
  type: 'bar' | 'line'
  categories: Array<number | string>
  series: CartesianChartSeries[]
  barWidth?: number
  horizontal?: boolean
  option?: CartesianChartOptionExtension
  stack?: string
  visibleCategoryCount?: number
}

export interface PieChartDatum {
  name: string
  value: number
}

export interface PieChartTimelineFrame {
  label: string
  data: PieChartDatum[]
}

export interface PieChartProps extends ChartPropsBase {
  type: 'pie'
  data: PieChartDatum[]
  option?: ChartTooltipOptionExtension & ChartLegendOptionExtension
  timeline?: {
    currentIndex: number
    frames: PieChartTimelineFrame[]
  }
}

export type ChartProps = CartesianChartProps | PieChartProps
