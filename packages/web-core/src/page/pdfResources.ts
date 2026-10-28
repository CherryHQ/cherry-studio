// pdf.js character maps and standard fonts, which the desktop reads from `node_modules/pdfjs-dist`.
// Loaded only when a PDF needs one: Vite inlines the small files into this module.
const resources = {
  cmap: import.meta.glob<string>('../../../../node_modules/pdfjs-dist/cmaps/*', {
    query: '?url',
    import: 'default',
    eager: true
  }),
  standard_font: import.meta.glob<string>('../../../../node_modules/pdfjs-dist/standard_fonts/*', {
    query: '?url',
    import: 'default',
    eager: true
  })
}

export function pdfResourceUrl(kind: 'cmap' | 'standard_font', name: string): string | undefined {
  const folder = kind === 'cmap' ? 'cmaps' : 'standard_fonts'
  return resources[kind][`../../../../node_modules/pdfjs-dist/${folder}/${name}`]
}
