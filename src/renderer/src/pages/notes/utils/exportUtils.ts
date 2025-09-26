import { loggerService } from '@logger'
import { RichEditorRef } from '@renderer/components/RichEditor/types'
import i18n from '@renderer/i18n'
import { getHighlighter } from '@renderer/utils/shiki'
import { RefObject } from 'react'

const logger = loggerService.withContext('exportUtils')

export interface ExportContext {
  editorRef: RefObject<RichEditorRef>
  currentContent: string
  fileName: string
}

/**
 * 添加语法高亮
 * @param html 原始 HTML
 * @returns 添加语法高亮后的 HTML
 */
const addSyntaxHighlighting = async (html: string): Promise<string> => {
  try {
    const highlighter = await getHighlighter()
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')

    const codeBlocks = doc.querySelectorAll('pre code')

    for (const codeElement of codeBlocks) {
      const preElement = codeElement.parentElement as HTMLPreElement
      const codeText = codeElement.textContent || ''

      if (!codeText.trim()) continue

      let languageMatch = preElement.className.match(/language-(\w+)/)
      if (!languageMatch) {
        languageMatch = codeElement.className.match(/language-(\w+)/)
      }
      const language = languageMatch ? languageMatch[1] : 'text'

      // Skip highlighting for plain text
      if (language === 'text' || language === 'plain' || language === 'plaintext') {
        continue
      }

      try {
        const loadedLanguages = highlighter.getLoadedLanguages()

        if (loadedLanguages.includes(language)) {
          const highlightedHtml = highlighter.codeToHtml(codeText, {
            lang: language,
            theme: 'one-light'
          })

          const tempDoc = parser.parseFromString(highlightedHtml, 'text/html')
          const highlightedCode = tempDoc.querySelector('code')

          if (highlightedCode) {
            // 保留原有的类名和属性
            const originalClasses = codeElement.className
            const originalAttributes = Array.from(codeElement.attributes)

            // 替换内容
            codeElement.innerHTML = highlightedCode.innerHTML

            // 合并类名
            const highlightedClasses = highlightedCode.className
            const mergedClasses = [originalClasses, highlightedClasses]
              .filter((cls) => cls && cls.trim())
              .join(' ')
              .split(' ')
              .filter((cls, index, arr) => cls && arr.indexOf(cls) === index) // 去重
              .join(' ')

            if (mergedClasses) {
              codeElement.className = mergedClasses
            }

            // 保留原有的其他属性（除了class）
            originalAttributes.forEach((attr) => {
              if (attr.name !== 'class' && !codeElement.hasAttribute(attr.name)) {
                codeElement.setAttribute(attr.name, attr.value)
              }
            })
          }
        }
      } catch (error) {
        logger.warn(`Failed to highlight ${language} code block:`, error as Error)
      }
    }

    return doc.documentElement.outerHTML
  } catch (error) {
    logger.warn('Failed to add syntax highlighting, using original HTML:', error as Error)
    return html
  }
}

export const handleExportPDF = async (context: ExportContext) => {
  if (!context.editorRef?.current || !context.currentContent?.trim()) {
    return
  }

  try {
    let htmlContent = context.editorRef.current.getHtml()

    htmlContent = await addSyntaxHighlighting(htmlContent)

    const filename = context.fileName ? `${context.fileName}.pdf` : 'note.pdf'
    const result = await window.api.export.toPDF(htmlContent, filename)

    if (result.success) {
      logger.info('PDF exported successfully to:', result.filePath)
      window.toast.success(i18n.t('message.success.pdf.export'))
    } else {
      logger.error('PDF export failed:', result.message)
      if (!result.message.includes('canceled')) {
        window.toast.error(i18n.t('message.error.pdf.export', { message: result.message }))
      }
    }
  } catch (error: any) {
    logger.error('PDF export error:', error)
  }
}
