import type { ExcelPreviewTable } from '@shared/excelPreview'
import type { IWorkbookData } from '@univerjs/core'

export interface ExcelWorkbookViewProps {
  ariaLabel?: string
  className?: string
  onError?: (error: Error) => void
  readOnly?: boolean
  tables?: ExcelPreviewTable[]
  workbookData: IWorkbookData
}
