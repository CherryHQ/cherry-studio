import '@cherrystudio/file-preview/styles.css'
import { Activity, useState } from 'react'
import { createRoot } from 'react-dom/client'

import type { PreviewSource } from '@cherrystudio/file-preview/core'
import { Preview } from '@cherrystudio/file-preview/react'

// ASCII-only PDF objects keep byte offsets deterministic without an extra fixture-generation dependency.
function createPdf(mixed: boolean, count: number, wide: boolean, shortReadingPage = false): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${count} /Kids [${Array.from({ length: count }, (_, i) => `${i * 2 + 3} 0 R`).join(' ')}] >>`
  ]
  for (let i = 0; i < count; i++) {
    const height = (mixed && (i === 0 || i === count - 1)) || (shortReadingPage && i === 7) ? 200 : 1000
    const width = wide && i > 0 && i < count - 1 ? 1200 : 600
    const content = `0.2 0.5 0.8 rg 30 ${height - 60} 540 30 re f\n`
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents ${i * 2 + 4} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}endstream`
    )
  }
  let pdf = '%PDF-1.7\n'
  const offsets = objects.map((object, i) => {
    const offset = pdf.length
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`
    return offset
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

function mountPdfPreview(mixed: boolean, wide: boolean, responsive: boolean) {
  let bytes = createPdf(mixed, 9, wide)
  const source: PreviewSource = {
    id: 'reading.pdf',
    name: 'reading.pdf',
    async open() {
      const content = bytes
      return {
        size: content.length,
        revision: String(content.length),
        async readRange(offset, length) {
          return content.slice(offset, offset + length)
        },
        async close() {}
      }
    }
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const resources = { baseUrl: new URL('/dist/assets/', location.href).href }
  function Harness() {
    const [refreshKey, setRefreshKey] = useState(0)
    const [hidden, setHidden] = useState(false)
    const [width, setWidth] = useState(650)
    const refresh = () => setRefreshKey((key) => key + 1)
    return (
      <>
        <div style={{ width, height: 650 }}>
          <Activity mode={hidden ? 'hidden' : 'visible'}>
            <Preview
              source={source}
              resources={resources}
              refreshKey={refreshKey}
              options={responsive ? { pdf: { outlineLayout: 'panel' } } : undefined}
            />
          </Activity>
        </div>
        <div style={{ position: 'fixed', right: 0, top: 0 }}>
          <button type="button" onClick={refresh}>
            Refresh
          </button>
          <button type="button" onClick={() => setHidden(true)}>
            Hide
          </button>
          <button type="button" onClick={() => setHidden(false)}>
            Show
          </button>
          <button type="button" onClick={() => setWidth(550)}>
            Width 550
          </button>
          <button type="button" onClick={() => setWidth(450)}>
            Width 450
          </button>
          <button
            type="button"
            onClick={() => {
              bytes = createPdf(mixed, 9, wide, true)
              refresh()
            }}>
            Shrink reading page
          </button>
          <button
            type="button"
            onClick={() => {
              bytes = createPdf(mixed, 3, wide)
              refresh()
            }}>
            Shorten
          </button>
        </div>
      </>
    )
  }
  root.render(<Harness />)
}

const params = new URLSearchParams(location.search)
mountPdfPreview(params.get('mixed') === 'true', params.get('wide') === 'true', params.get('responsive') === 'true')
