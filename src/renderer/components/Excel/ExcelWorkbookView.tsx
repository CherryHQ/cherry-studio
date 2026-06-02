import '@univerjs/preset-sheets-core/lib/index.css'
import '@univerjs/preset-sheets-filter/lib/index.css'
import '@univerjs/preset-sheets-table/lib/index.css'

import { loggerService } from '@logger'
import type {
  ExcelPreviewCellCustom,
  ExcelPreviewImageAnchor,
  ExcelPreviewImageRenderData,
  ExcelPreviewTable
} from '@shared/excelPreview'
import type { ICellCustomRender, IDisposable, IWorkbookData, Plugin, PluginCtor } from '@univerjs/core'
import { LocaleType, mergeLocales, Univer } from '@univerjs/core'
import { FUniver } from '@univerjs/core/facade'
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core'
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US'
import { UniverSheetsFilterPreset } from '@univerjs/preset-sheets-filter'
import UniverPresetSheetsFilterEnUS from '@univerjs/preset-sheets-filter/locales/en-US'
import {
  type IUniverSheetsTableUIConfig,
  UniverSheetsTablePlugin,
  UniverSheetsTableUIPlugin
} from '@univerjs/preset-sheets-table'
import UniverPresetSheetsTableEnUS from '@univerjs/preset-sheets-table/locales/en-US'
import { useCallback, useEffect, useRef } from 'react'

import { configureExcelWorkbookReadOnly, installExcelWorkbookCommandGuard } from './excelWorkbookProtection'
import type { ExcelWorkbookViewProps } from './types'

const logger = loggerService.withContext('ExcelWorkbookView')

type UniverPlugins = Parameters<Univer['registerPlugins']>[0]
type PresetPlugin = PluginCtor<Plugin> | [PluginCtor<Plugin>, ConstructorParameters<PluginCtor<Plugin>>[0]]
type ExcelWorkbookViewInstance = { commandGuard?: IDisposable; imageRenderer?: IDisposable; univer: Univer }
type ExcelTableColumnData = {
  dataType: string
  displayName: string
  formula: string
  id: string
  meta: Record<string, unknown>
  style: Record<string, unknown>
}
type ExcelTableWorksheetApi = {
  addTable?: (
    tableName: string,
    range: ExcelPreviewTable['range'],
    tableId?: string,
    options?: Record<string, unknown>
  ) => boolean | string | Promise<boolean | string | undefined>
  setTableFilter?: (
    tableId: string,
    column: number,
    filter: NonNullable<ExcelPreviewTable['filters']>[number]
  ) => boolean | Promise<boolean | undefined>
}
type ExcelTableWorkbookApi = {
  addTable?: (
    sheetId: string,
    tableName: string,
    range: ExcelPreviewTable['range'],
    tableId?: string,
    options?: Record<string, unknown>
  ) => boolean | string | Promise<boolean | string | undefined>
  getSheetByName?: (name: string) => ExcelTableWorksheetApi | null
  getSheetBySheetId?: (sheetId: string) => ExcelTableWorksheetApi | null
  setTableFilter?: (
    tableId: string,
    column: number,
    filter: NonNullable<ExcelPreviewTable['filters']>[number]
  ) => boolean | Promise<boolean | undefined>
}
type ExcelSheetHooksApi = {
  getSheetHooks?: () => {
    onCellRender?: (customRender: ICellCustomRender[]) => IDisposable
  }
}

const toError = (err: unknown) => (err instanceof Error ? err : new Error(String(err)))

const normalizePresetPlugins = (plugins: PresetPlugin[]): UniverPlugins => {
  return plugins.map((plugin) => (Array.isArray(plugin) ? plugin : [plugin])) as UniverPlugins
}

const createExcelTablePlugins = (): PresetPlugin[] => [
  UniverSheetsTablePlugin,
  [UniverSheetsTableUIPlugin, { hideAnchor: true } satisfies Partial<IUniverSheetsTableUIConfig>]
]

const getExcelCellImages = (custom: unknown): ExcelPreviewImageRenderData[] => {
  if (!custom || typeof custom !== 'object') return []

  const images = (custom as ExcelPreviewCellCustom).excelImages
  return Array.isArray(images) ? images : []
}

const getExcelCellImageRefs = (custom: unknown): string[] => {
  if (!custom || typeof custom !== 'object') return []

  const refs = (custom as ExcelPreviewCellCustom).excelImageRefs
  return Array.isArray(refs) ? refs.filter((ref): ref is string => typeof ref === 'string') : []
}

const getExcelCellCustom = (cell: unknown): unknown => {
  if (!cell || typeof cell !== 'object') return undefined

  return (cell as { custom?: unknown }).custom
}

const createExcelImageIndex = (workbookData: IWorkbookData): Map<string, ExcelPreviewImageRenderData> => {
  const images = new Map<string, ExcelPreviewImageRenderData>()

  Object.values(workbookData.sheets ?? {}).forEach((sheet) => {
    Object.values(sheet?.cellData ?? {}).forEach((rowData) => {
      Object.values(rowData ?? {}).forEach((cell) => {
        getExcelCellImages(getExcelCellCustom(cell)).forEach((image) => {
          images.set(image.id, image)
        })
      })
    })
  })

  return images
}

const getExcelCellRenderImages = (
  custom: unknown,
  imageIndex: Map<string, ExcelPreviewImageRenderData>
): ExcelPreviewImageRenderData[] => {
  const imagesById = new Map<string, ExcelPreviewImageRenderData>()

  getExcelCellImages(custom).forEach((image) => {
    imagesById.set(image.id, image)
  })
  getExcelCellImageRefs(custom).forEach((imageId) => {
    const image = imageIndex.get(imageId)
    if (image) imagesById.set(image.id, image)
  })

  return Array.from(imagesById.values())
}

const getAnchorPoint = (
  skeleton: { getCellWithCoordByIndex?: (row: number, column: number, header?: boolean) => unknown },
  anchor: ExcelPreviewImageAnchor,
  fallbackCell: { endX: number; endY: number; startX: number; startY: number }
) => {
  const cell = skeleton.getCellWithCoordByIndex?.(anchor.row, anchor.column, false) as
    | { endX: number; endY: number; startX: number; startY: number }
    | undefined
  const anchorCell = cell ?? fallbackCell
  const width = anchorCell.endX - anchorCell.startX
  const height = anchorCell.endY - anchorCell.startY

  return {
    x: anchorCell.startX + width * anchor.columnOffset,
    y: anchorCell.startY + height * anchor.rowOffset
  }
}

type CellRenderBounds = { endX: number; endY: number; startX: number; startY: number }

const drawImageInCell = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  imageData: ExcelPreviewImageRenderData,
  skeleton: { getCellWithCoordByIndex?: (row: number, column: number, header?: boolean) => unknown },
  cell: CellRenderBounds
): void => {
  const from = getAnchorPoint(skeleton, imageData.from, cell)
  const to = imageData.to ? getAnchorPoint(skeleton, imageData.to, cell) : undefined
  const imageWidth = imageData.size?.width ?? (to ? to.x - from.x : image.naturalWidth)
  const imageHeight = imageData.size?.height ?? (to ? to.y - from.y : image.naturalHeight)
  if (imageWidth <= 0 || imageHeight <= 0) return

  const left = from.x
  const top = from.y
  const right = left + imageWidth
  const bottom = top + imageHeight
  const clipLeft = Math.max(left, cell.startX)
  const clipTop = Math.max(top, cell.startY)
  const clipRight = Math.min(right, cell.endX)
  const clipBottom = Math.min(bottom, cell.endY)
  const width = clipRight - clipLeft
  const height = clipBottom - clipTop
  if (width <= 0 || height <= 0) return

  const sourceX = ((clipLeft - left) / imageWidth) * image.naturalWidth
  const sourceY = ((clipTop - top) / imageHeight) * image.naturalHeight
  const sourceWidth = (width / imageWidth) * image.naturalWidth
  const sourceHeight = (height / imageHeight) * image.naturalHeight

  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, clipLeft, clipTop, width, height)
}

const createExcelImageCellRenderer = (workbookData: IWorkbookData): ICellCustomRender => {
  const imageIndex = createExcelImageIndex(workbookData)
  const imageCache = new Map<string, HTMLImageElement>()

  const getImage = (imageData: ExcelPreviewImageRenderData, markDirty: () => void) => {
    const cached = imageCache.get(imageData.id)
    if (cached) return cached

    const image = new Image()
    image.onload = markDirty
    image.onerror = markDirty
    image.src = imageData.source
    imageCache.set(imageData.id, image)
    return image
  }

  return {
    drawWith: (ctx, info, skeleton, spreadsheets) => {
      const images = getExcelCellRenderImages(info.data?.custom, imageIndex)
      if (!images.length) return

      const markDirty =
        spreadsheets && typeof spreadsheets.makeDirty === 'function' ? () => spreadsheets.makeDirty() : () => {}

      images.forEach((imageData) => {
        const image = getImage(imageData, markDirty)
        if (!image.complete || image.naturalWidth === 0) return

        drawImageInCell(ctx, image, imageData, skeleton, info.primaryWithCoord)
      })
    },
    zIndex: 100
  }
}

const installExcelImageCellRenderer = (
  univerAPI: ReturnType<typeof FUniver.newAPI>,
  workbookData: IWorkbookData
): IDisposable | undefined => {
  return (univerAPI as unknown as ExcelSheetHooksApi)
    .getSheetHooks?.()
    ?.onCellRender?.([createExcelImageCellRenderer(workbookData)])
}

const toUniverTableColumns = (table: ExcelPreviewTable): ExcelTableColumnData[] => {
  return table.columns.map((column) => ({
    dataType: 'string',
    displayName: column.displayName,
    formula: '',
    id: column.id,
    meta: {},
    style: {}
  }))
}

const installExcelTables = async (
  fWorkbook: ExcelTableWorkbookApi | undefined,
  tables: ExcelPreviewTable[] | undefined
): Promise<void> => {
  if (!fWorkbook || !tables?.length) return

  for (const table of tables) {
    try {
      const fWorksheet = fWorkbook.getSheetBySheetId?.(table.sheetId) ?? fWorkbook.getSheetByName?.(table.sheetId)
      if (!fWorkbook.addTable && !fWorksheet?.addTable) {
        logger.warn(`Excel table preview skipped because worksheet was not found: ${table.name}`)
        continue
      }

      const filters = table.filters?.map((filter) => filter ?? undefined)
      const options = {
        columns: toUniverTableColumns(table),
        ...(filters?.some(Boolean) ? { filters } : {}),
        hasTotalRow: table.showFooter,
        showFooter: table.showFooter,
        showHeader: table.showHeader,
        ...(table.tableStyleId ? { tableStyleId: table.tableStyleId } : {})
      }

      const created = fWorkbook.addTable
        ? await fWorkbook.addTable(table.sheetId, table.name, table.range, table.id, options)
        : await fWorksheet?.addTable?.(table.name, table.range, table.id, options)
      if (!created) {
        logger.warn(`Excel table preview failed to create table: ${table.name}`)
        continue
      }

      const tableId = typeof created === 'string' ? created : table.id
      if (!table.filters?.length) continue

      for (const [column, filter] of table.filters.entries()) {
        if (!filter) continue
        try {
          if (fWorkbook.setTableFilter) {
            await fWorkbook.setTableFilter(tableId, column, filter)
          } else if (fWorksheet?.setTableFilter) {
            await fWorksheet.setTableFilter(tableId, column, filter)
          }
        } catch (err) {
          logger.warn(`Excel table preview failed to apply table filter: ${table.name}`, toError(err))
        }
      }
    } catch (err) {
      logger.warn(`Excel table preview failed to install table: ${table.name}`, toError(err))
    }
  }
}

const ExcelWorkbookView = ({
  ariaLabel,
  className,
  onError,
  readOnly = false,
  tables,
  workbookData
}: ExcelWorkbookViewProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const onErrorRef = useRef(onError)
  const univerRef = useRef<ExcelWorkbookViewInstance | null>(null)

  const disposeUniver = useCallback(() => {
    univerRef.current?.commandGuard?.dispose()
    univerRef.current?.imageRenderer?.dispose()
    univerRef.current?.univer.dispose()
    univerRef.current = null
    containerRef.current?.replaceChildren()
  }, [])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => disposeUniver, [disposeUniver])

  useEffect(() => {
    const container = containerRef.current

    disposeUniver()

    if (!container) return

    let disposed = false
    let pendingCommandGuard: IDisposable | undefined
    let pendingImageRenderer: IDisposable | undefined
    let pendingUniver: Univer | null = null

    const disposePending = () => {
      pendingCommandGuard?.dispose()
      pendingImageRenderer?.dispose()
      pendingUniver?.dispose()
      pendingCommandGuard = undefined
      pendingImageRenderer = undefined
      pendingUniver = null
    }

    void (async () => {
      try {
        const univer = new Univer({
          locale: LocaleType.EN_US,
          locales: {
            [LocaleType.EN_US]: mergeLocales(
              UniverPresetSheetsCoreEnUS,
              UniverPresetSheetsFilterEnUS,
              UniverPresetSheetsTableEnUS
            )
          }
        })
        pendingUniver = univer
        const preset = UniverSheetsCorePreset({
          container,
          header: false,
          toolbar: false,
          formulaBar: true,
          contextMenu: false,
          disableAutoFocus: true,
          sheets: {
            disableForceStringAlert: true,
            disableForceStringMark: true
          },
          footer: {
            sheetBar: true,
            statisticBar: false,
            menus: false,
            zoomSlider: true,
            addSheetButtonConfig: {
              show: false
            }
          }
        })
        const filterPreset = UniverSheetsFilterPreset()
        univer.registerPlugins(
          normalizePresetPlugins([...preset.plugins, ...filterPreset.plugins, ...createExcelTablePlugins()])
        )
        if (readOnly) {
          configureExcelWorkbookReadOnly(univer)
        }
        const univerAPI = FUniver.newAPI(univer)

        const fWorkbook = univerAPI.createWorkbook(workbookData) as unknown as ExcelTableWorkbookApi | undefined
        pendingImageRenderer = installExcelImageCellRenderer(univerAPI, workbookData)
        await installExcelTables(fWorkbook, tables)
        if (disposed) return

        pendingCommandGuard = readOnly ? installExcelWorkbookCommandGuard(univerAPI) : undefined
        univerRef.current = {
          univer,
          imageRenderer: pendingImageRenderer,
          commandGuard: pendingCommandGuard
        }
        pendingCommandGuard = undefined
        pendingImageRenderer = undefined
        pendingUniver = null
      } catch (err) {
        disposePending()
        const normalized = err instanceof Error ? err : new Error(String(err))
        logger.error('Failed to initialize Excel workbook view', normalized)
        onErrorRef.current?.(normalized)
      }
    })()

    return () => {
      disposed = true
      disposePending()
      disposeUniver()
    }
  }, [disposeUniver, readOnly, tables, workbookData])

  return (
    <div
      data-testid="excel-workbook-view"
      aria-label={ariaLabel}
      className={['relative h-full w-full bg-background', className].filter(Boolean).join(' ')}>
      <div ref={containerRef} data-testid="univer-excel-container" className="h-full w-full" />
    </div>
  )
}

export default ExcelWorkbookView
export type { ExcelWorkbookViewProps }
