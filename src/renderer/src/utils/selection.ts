/**
 * Get the selected text including KaTeX formulas in LaTeX format with delimiters
 * This function extracts text from the current selection and properly handles
 * KaTeX formulas by retrieving their LaTeX source code and wrapping them with
 * appropriate delimiters ($ for inline, $$ for display mode)
 */
export function getSelectedText(): string {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) {
    return ''
  }

  const range = selection.getRangeAt(0)
  const fragment = range.cloneContents()

  // Process KaTeX elements to replace them with their LaTeX source with delimiters
  const katexElements = fragment.querySelectorAll('.katex')
  katexElements.forEach((element) => {
    const annotation = element.querySelector('annotation[encoding="application/x-tex"]')
    if (annotation?.textContent) {
      const latex = annotation.textContent
      const isDisplayMode = element.classList.contains('katex-display')
      const delimiter = isDisplayMode ? '$$' : '$'
      const formattedLatex = isDisplayMode ? `${delimiter}\n${latex}\n${delimiter}` : `${delimiter}${latex}${delimiter}`
      const textNode = document.createTextNode(formattedLatex)
      element.parentNode?.replaceChild(textNode, element)
    }
  })

  // Get the text content
  const tempDiv = document.createElement('div')
  tempDiv.appendChild(fragment)
  return tempDiv.textContent.trim()
}
