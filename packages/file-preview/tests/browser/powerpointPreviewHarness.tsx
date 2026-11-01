import '@cherrystudio/file-preview/styles.css'
import { Activity, useState } from 'react'
import { createRoot } from 'react-dom/client'

import type { PreviewSource } from '@cherrystudio/file-preview/core'
import { Preview } from '@cherrystudio/file-preview/react'

const source: PreviewSource = {
  id: 'slides.pptx',
  name: 'slides.pptx',
  async open(signal) {
    const response = await fetch('/slides.pptx', { signal })
    const bytes = new Uint8Array(await response.arrayBuffer())
    return {
      size: bytes.length,
      revision: response.headers.get('ETag') ?? '',
      async readRange(offset, length) {
        return bytes.slice(offset, offset + length)
      },
      async close() {}
    }
  }
}

function Harness() {
  const [refreshKey, setRefreshKey] = useState(0)
  const [hidden, setHidden] = useState(false)
  return (
    <>
      <div style={{ width: 600, height: 450 }}>
        <Activity mode={hidden ? 'hidden' : 'visible'}>
          <Preview source={source} refreshKey={refreshKey} />
        </Activity>
      </div>
      <div style={{ position: 'fixed', right: 0, top: 0 }}>
        <button type="button" onClick={() => setRefreshKey((key) => key + 1)}>
          Refresh
        </button>
        <button type="button" onClick={() => setHidden(true)}>
          Hide
        </button>
        <button type="button" onClick={() => setHidden(false)}>
          Show
        </button>
      </div>
    </>
  )
}

createRoot(document.body.appendChild(document.createElement('div'))).render(<Harness />)
