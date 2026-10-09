import type { DocumentBlock, DocumentTextRun } from '@shared/types/documentModel'

export function flattenDocumentBlocks(blocks: DocumentBlock[]): DocumentBlock[] {
  return blocks.flatMap((block) => (block.type === 'columns' ? block.columns.flatMap(flattenDocumentBlocks) : [block]))
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function htmlRuns(runs: DocumentTextRun[]): string {
  return runs
    .map((run) => {
      const styles = [
        run.font ? `font-family:${escapeHtml(run.font)}` : '',
        run.size ? `font-size:${run.size}pt` : '',
        run.color ? `color:#${run.color}` : '',
        run.background ? `background-color:#${run.background}` : '',
        run.bold ? 'font-weight:bold' : '',
        run.italic ? 'font-style:italic' : '',
        run.underline || run.strike
          ? `text-decoration:${[run.underline ? 'underline' : '', run.strike ? 'line-through' : ''].join(' ')}`
          : ''
      ].filter(Boolean)
      const text = `<span style="${styles.join(';')}">${escapeHtml(run.text).replaceAll('\n', '<br>')}</span>`
      return run.link && /^(?:https?:|mailto:|#)/.test(run.link)
        ? `<a href="${escapeHtml(run.link)}">${text}</a>`
        : text
    })
    .join('')
}

export function documentToHtml(
  blocks: DocumentBlock[],
  imageSource: (source: string) => string,
  title: string
): string {
  const render = (items: DocumentBlock[]): string =>
    items
      .map((block) => {
        if (block.type === 'columns')
          return `<div style="display:flex;gap:16px">${block.columns.map((column, index) => `<div style="flex:${block.widths[index] || 1};min-width:0">${render(column)}</div>`).join('')}</div>`
        if (block.type === 'image')
          return `<p><img src="${escapeHtml(imageSource(block.source))}" alt="${escapeHtml(block.text)}" style="max-width:100%;height:auto${block.width ? `;width:${block.width}px` : ''}"></p>`
        if (block.type === 'table')
          return `<table>${block.rows
            .map(
              (row, rowIndex) =>
                `<tr>${row
                  .map((text, column) => {
                    const cell = block.cells?.[rowIndex]?.[column]
                    if (cell?.covered) return ''
                    return `<td colspan="${cell?.colSpan ?? 1}" rowspan="${cell?.rowSpan ?? 1}" style="${cell?.background ? `background:#${cell.background};` : ''}${cell?.align ? `text-align:${cell.align};` : ''}">${htmlRuns(cell?.runs ?? [{ text }])}</td>`
                  })
                  .join('')}</tr>`
            )
            .join('')}</table>`
        const tag = block.type === 'heading' ? `h${Math.min(6, block.level)}` : block.type === 'code' ? 'pre' : 'p'
        const style = block.style
        const css = [
          style?.align ? `text-align:${style.align}` : '',
          style?.before !== undefined ? `margin-top:${style.before}pt` : '',
          style?.after !== undefined ? `margin-bottom:${style.after}pt` : '',
          style?.indent ? `margin-left:${style.indent}pt` : '',
          style?.background ? `background:#${style.background}` : ''
        ]
          .filter(Boolean)
          .join(';')
        const content = htmlRuns(block.runs ?? [{ text: block.text }])
        if (block.type === 'text' && block.bullet) {
          const listTag = block.orderedNumber !== undefined ? 'ol' : 'ul'
          return `<${listTag}${block.orderedNumber !== undefined ? ` start="${block.orderedNumber}"` : ''}><li style="${css}">${content}</li></${listTag}>`
        }
        return `<${tag} style="${css}">${content}</${tag}>`
      })
      .join('\n')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#202020;line-height:1.5}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{border:1px solid #b0b0b0;padding:6px;vertical-align:top}img{max-width:100%}pre{white-space:pre-wrap}p,h1,h2,h3,td{overflow-wrap:anywhere}@media print{body{margin:0}tr,img{break-inside:avoid}}</style></head><body>${render(blocks)}</body></html>`
}

export function documentToMarkdown(blocks: DocumentBlock[], imageSource: (source: string) => string): string {
  const text = (runs: DocumentTextRun[]) =>
    runs
      .map((run) => {
        let value = run.text.replace(/([\\`*_[\]])/g, '\\$1')
        if (run.bold) value = `**${value}**`
        if (run.italic) value = `*${value}*`
        if (run.strike) value = `~~${value}~~`
        if (run.link && /^(https?:|mailto:|#)/.test(run.link)) value = `[${value}](${run.link})`
        return value
      })
      .join('')
  return (
    flattenDocumentBlocks(blocks)
      .map((block) => {
        if (block.type === 'columns') return ''
        if (block.type === 'image') return `![${block.text.replace(/[[\]]/g, '')}](${imageSource(block.source)})`
        if (block.type === 'table') {
          const rows = block.rows.map(
            (row, rowIndex) =>
              `| ${row
                .map((cell, column) => {
                  const runs = block.cells?.[rowIndex]?.[column]?.runs
                  return (runs ? text(runs).trim() : cell).replaceAll('|', '\\|').replaceAll('\n', '<br>')
                })
                .join(' | ')} |`
          )
          if (rows.length) rows.splice(1, 0, `| ${block.rows[0].map(() => '---').join(' | ')} |`)
          return rows.join('\n')
        }
        if (block.type === 'code') return `\`\`\`\n${block.text}\n\`\`\``
        const content = text(block.runs ?? [{ text: block.text }]).trim()
        if (block.type === 'heading') return `${'#'.repeat(Math.min(6, block.level))} ${content}`
        return block.bullet
          ? `${'  '.repeat(block.bullet - 1)}${block.orderedNumber !== undefined ? `${block.orderedNumber}.` : '-'} ${content}`
          : content
      })
      .join('\n\n') + '\n'
  )
}
