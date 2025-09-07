import { getExtensionByLanguage } from '@renderer/utils/code-language'

// 自定义语言文件扩展名映射
// key: 语言名小写
// value: 扩展名
const _customLanguageExtensions: Record<string, string> = {
  svg: 'xml',
  vab: 'vb',
  graphviz: 'dot'
}

/**
 * 获取语言的扩展名，用于 @uiw/codemirror-extensions-langs
 * - 先搜索自定义扩展名
 * - 再搜索 github linguist 扩展名
 * - 最后假定名称已经是扩展名
 * @param language 语言名称
 * @returns 扩展名（不包含 `.`）
 */
export async function getNormalizedExtension(language: string) {
  const lowerLanguage = language.toLowerCase()

  const customExt = _customLanguageExtensions[lowerLanguage]
  if (customExt) {
    return customExt
  }

  const linguistExt = getExtensionByLanguage(language)
  if (linguistExt) {
    return linguistExt.slice(1)
  }

  // 如果语言名称像扩展名
  if (language.startsWith('.') && language.length > 1) {
    return language.slice(1)
  }

  // 回退到语言名称
  return language
}
