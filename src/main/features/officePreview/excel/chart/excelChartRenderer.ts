import type { ExcelPreviewImageRenderData } from '@shared/types/excelPreview'

import { excelChartToEChartsOption } from './excelChartToECharts'
import type { ExcelChartRenderModel } from './excelChartTypes'

const DEFAULT_CHART_WIDTH = 480
const DEFAULT_CHART_HEIGHT = 280
const DEFAULT_COLUMN_WIDTH = 88
const DEFAULT_ROW_HEIGHT = 23

export const getExcelChartRenderSize = (model: ExcelChartRenderModel): { height: number; width: number } => {
  if (model.anchor.size) return model.anchor.size
  const to = model.anchor.to
  if (to) {
    const width =
      (to.column + to.columnOffset - model.anchor.from.column - model.anchor.from.columnOffset) * DEFAULT_COLUMN_WIDTH
    const height = (to.row + to.rowOffset - model.anchor.from.row - model.anchor.from.rowOffset) * DEFAULT_ROW_HEIGHT

    return {
      height: height > 0 ? height : DEFAULT_CHART_HEIGHT,
      width: width > 0 ? width : DEFAULT_CHART_WIDTH
    }
  }

  return { height: DEFAULT_CHART_HEIGHT, width: DEFAULT_CHART_WIDTH }
}

export const renderExcelChartImage = async (
  model: ExcelChartRenderModel
): Promise<ExcelPreviewImageRenderData | null> => {
  const option = excelChartToEChartsOption(model)
  if (!option) return null

  const [{ default: sharp }, echarts] = await Promise.all([import('sharp'), import('echarts')])
  const { height, width } = getExcelChartRenderSize(model)
  const chart = echarts.init(null as unknown as HTMLDivElement, undefined, {
    height,
    renderer: 'svg',
    ssr: true,
    width
  })

  try {
    chart.setOption(option)
    const svg = chart.renderToSVGString({ useViewBox: true })
    const png = await sharp(Buffer.from(svg)).png().toBuffer()

    return {
      from: model.anchor.from,
      id: model.id,
      size: { height, width },
      source: `data:image/png;base64,${png.toString('base64')}`,
      ...(model.anchor.to ? { to: model.anchor.to } : {})
    }
  } finally {
    chart.dispose()
  }
}
