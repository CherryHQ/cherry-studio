const OPEN_DIRECTIVE = /^\s*@start\S*/
const CLOSE_DIRECTIVE = /^\s*@end\S*/
const NEW_PAGE = /^\s*newpage\b.*$/i

/**
 * Split a PlantUML source into one source per page.
 *
 * PlantUML renders only the first page of a multi-page (`newpage`) diagram,
 * so the preview splits the source and renders each page separately. Sources
 * without an `@start...`/`@end...` wrapper or without `newpage` are returned
 * unchanged as a single page.
 */
export function splitPlantUmlPages(source: string): string[] {
  const lines = source.split(/\r?\n/)

  const openIndex = lines.findIndex((line) => OPEN_DIRECTIVE.test(line))
  if (openIndex === -1) return [source]

  let closeIndex = -1
  for (let i = lines.length - 1; i > openIndex; i--) {
    if (CLOSE_DIRECTIVE.test(lines[i])) {
      closeIndex = i
      break
    }
  }
  if (closeIndex === -1) return [source]

  const open = lines[openIndex]
  const close = lines[closeIndex]

  const pages: string[] = []
  let current: string[] = []
  let sawNewpage = false
  for (const line of lines.slice(openIndex + 1, closeIndex)) {
    if (NEW_PAGE.test(line)) {
      sawNewpage = true
      pages.push(current.join('\n'))
      current = []
    } else {
      current.push(line)
    }
  }
  if (!sawNewpage) return [source]
  pages.push(current.join('\n'))

  return pages
    .map((page) => page.trim())
    .filter((page) => page.length > 0)
    .map((page) => `${open}\n${page}\n${close}`)
}
