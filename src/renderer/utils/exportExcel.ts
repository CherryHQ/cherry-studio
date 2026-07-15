import dayjs from 'dayjs'
import { t } from 'i18next'

/**
 * 解析 Markdown 表格为二维数组
 * @param markdown Markdown 格式的表格字符串
 * @returns 二维数组，每行为一个数组
 */
export function parseMarkdownTable(markdown: string): string[][] {
  const lines = markdown.trim().split('\n')
  const data: string[][] = []

  for (const line of lines) {
    const trimmedLine = line.trim()

    // 跳过空行
    if (!trimmedLine) {
      continue
    }

    // 跳过分隔行 (|---|---| 或 |:---:|:---:| 等)
    // 分隔行只包含 |, -, :, 空格
    if (/^\|[\s\-:| ]+\|$/.test(trimmedLine) && !trimmedLine.match(/[^|\-:\s]/)) {
      continue
    }

    // 确保是表格行（以 | 开头和结尾）
    if (!trimmedLine.startsWith('|') || !trimmedLine.endsWith('|')) {
      continue
    }

    // 解析单元格
    const cells = trimmedLine
      .split('|')
      .slice(1, -1) // 去掉首尾空元素
      .map((cell) => cell.trim())

    if (cells.length > 0) {
      data.push(cells)
    }
  }

  return data
}

/**
 * 导出 Markdown 表格为 Excel 文件
 * @param markdown Markdown 格式的表格字符串
 * @returns 是否导出成功
 */
export async function exportTableToExcel(markdown: string): Promise<boolean> {
  const data = parseMarkdownTable(markdown)

  if (data.length === 0) {
    return false
  }

  // 按需加载 xlsx（约 0.6 MB），避免进入窗口首屏静态图
  const XLSX = await import('@e965/xlsx')

  // 创建工作表
  const worksheet = XLSX.utils.aoa_to_sheet(data)

  // 设置列宽自适应
  const colWidths = data[0].map((_, colIndex) => {
    const maxLength = Math.max(...data.map((row) => (row[colIndex] || '').toString().length))
    return { wch: Math.min(Math.max(maxLength + 2, 10), 50) }
  })
  worksheet['!cols'] = colWidths

  // 创建工作簿
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')

  // 生成文件内容 (Uint8Array)
  const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
  const uint8Array = new Uint8Array(buffer)

  // 生成默认文件名
  const fileName = `table_${dayjs().format('YYYY-MM-DD_HHmmss')}.xlsx`

  // 打开“另存为”对话框，允许用户修改默认文件名
  const savedPath = await window.api.file.save(fileName, uint8Array, {
    filters: [{ name: t('common.export.excel'), extensions: ['xlsx'] }]
  })

  return Boolean(savedPath)
}
