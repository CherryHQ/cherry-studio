import { useEffect, useState } from 'react'

import { pptdMediaMime } from './pptdImage'
import { isRemotePptdSource, type PptdProjectFileReader } from './pptdProject'

export interface PptdMediaState {
  url?: string
  error?: string
}

/**
 * Resolves an element's src to a displayable URL: remote https sources pass
 * through; project-relative paths are read through the host and exposed as
 * object URLs, revoked on cleanup.
 */
export function usePptdMediaUrl(reader: PptdProjectFileReader | undefined, src: string): PptdMediaState {
  const [state, setState] = useState<PptdMediaState>(() => (isRemotePptdSource(src) ? { url: src } : {}))

  useEffect(() => {
    if (isRemotePptdSource(src)) {
      setState({ url: src })
      return
    }
    if (!reader) {
      setState({ error: 'no-project-file-reader' })
      return
    }
    const controller = new AbortController()
    let objectUrl: string | undefined
    setState({})
    reader(src, controller.signal)
      .then((bytes) => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: pptdMediaMime(src) }))
        setState({ url: objectUrl })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ error: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [reader, src])

  return state
}
