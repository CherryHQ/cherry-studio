import { KB, MB } from '@shared/config/constant'

/**
 * 从文件路径中提取目录路径。
 * @param {string} filePath 文件路径
 * @returns {string} 目录路径
 */
export function getFileDirectory(filePath: string): string {
  const parts = filePath.split('/')
  const directory = parts.slice(0, -1).join('/')
  return directory
}

/**
 * 从文件路径中提取文件扩展名。
 * @param {string} filePath 文件路径
 * @returns {string} 文件扩展名（小写），如果没有则返回 '.'
 */
export function getFileExtension(filePath: string): string {
  const parts = filePath.split('.')
  if (parts.length > 1) {
    const extension = parts.slice(-1)[0].toLowerCase()
    return '.' + extension
  }
  return '.'
}

/**
 * 格式化文件大小，根据大小返回以 MB 或 KB 为单位的字符串。
 * @param {number} size 文件大小（字节）
 * @returns {string} 格式化后的文件大小字符串
 */
export function formatFileSize(size: number): string {
  if (size >= MB) {
    return (size / MB).toFixed(1) + ' MB'
  }

  if (size >= KB) {
    return (size / KB).toFixed(0) + ' KB'
  }

  return (size / KB).toFixed(2) + ' KB'
}

/**
 * 从文件名中移除特殊字符：
 * - 替换非法字符为下划线
 * - 替换换行符为空格。
 * @param {string} str 输入字符串
 * @returns {string} 处理后的文件名字符串
 */
export function removeSpecialCharactersForFileName(str: string): string {
  return str
    .replace(/[<>:"/\\|?*.]/g, '_')
    .replace(/[\r\n]+/g, ' ')
    .trim()
}
