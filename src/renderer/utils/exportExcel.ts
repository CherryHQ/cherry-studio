import dayjs from 'dayjs'
import { t } from 'i18next'

/**
 * Export table data to an Excel file.
 * @param data Two-dimensional array containing the table data.
 * @returns Whether the export succeeded.
 */
export async function exportTableToExcel(data: string[][]): Promise<boolean> {
  if (data.length === 0) {
    return false
  }

  // Load xlsx on demand (~0.6 MB) to keep it out of the window's initial bundle.
  const XLSX = await import('@e965/xlsx')

  // Create the worksheet.
  const worksheet = XLSX.utils.aoa_to_sheet(data)

  // Size columns based on their longest value.
  const colWidths = data[0].map((_, colIndex) => {
    const maxLength = Math.max(...data.map((row) => (row[colIndex] || '').toString().length))
    return { wch: Math.min(Math.max(maxLength + 2, 10), 50) }
  })
  worksheet['!cols'] = colWidths

  // Create the workbook.
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')

  // Generate the file contents as a Uint8Array.
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
  const uint8Array = new Uint8Array(buffer)

  // Generate the default filename.
  const fileName = `table_${dayjs().format('YYYY-MM-DD_HHmmss')}.xlsx`

  // Open the Save As dialog so the user can change the default filename.
  const savedPath = await window.api.file.save(fileName, uint8Array, {
    filters: [{ name: t('common.export.excel'), extensions: ['xlsx'] }]
  })

  return Boolean(savedPath)
}
