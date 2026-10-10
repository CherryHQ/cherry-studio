import { useEffect, useRef, useState } from 'react'

import { usePreviewHost, usePreviewLogger } from '../../previewContext'
import { type PreviewDocument, PreviewError, readPreviewDocument } from '../../source'
import type { PreviewResources } from '../../types'
import type { WorkbookRenderModel, XlsxParseRequest, XlsxParseResponse } from './renderModel'

/** Files above this size are not parsed and fall back to opening in an external app. */
export const XLSX_PREVIEW_MAX_SIZE_BYTES = 20 * 1024 * 1024

export type XlsxWorkbookState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; model: WorkbookRenderModel }
  | { status: 'error'; message: string }
  | { status: 'oversize'; sizeBytes: number }

type XlsxWorker = Pick<Worker, 'postMessage' | 'terminate'> & {
  onmessage: ((event: MessageEvent<XlsxParseResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

export function useXlsxWorkbook(document: PreviewDocument, fileName: string): XlsxWorkbookState {
  const logger = usePreviewLogger('useXlsxWorkbook')
  const { failDocument, resources } = usePreviewHost()
  const { baseUrl, createWorker } = resources ?? {}
  const [state, setState] = useState<XlsxWorkbookState>({ status: 'idle' })
  const workerRef = useRef<XlsxWorker | null>(null)
  const requestIdRef = useRef(0)
  const loggedWarningsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const requestId = ++requestIdRef.current

    if (document.size > XLSX_PREVIEW_MAX_SIZE_BYTES) {
      failDocument?.(new PreviewError('too_large', 'Workbook exceeds the preview size limit'))
      setState({ status: 'oversize', sizeBytes: document.size })
      return
    }

    setState({ status: 'loading' })

    void (async () => {
      let bytes: ArrayBuffer
      try {
        const raw = await readPreviewDocument(document, XLSX_PREVIEW_MAX_SIZE_BYTES, controller.signal)
        if (cancelled || requestId !== requestIdRef.current) return
        bytes = raw.slice().buffer
      } catch (error) {
        if (cancelled || requestId !== requestIdRef.current) return
        const normalized = error instanceof Error ? error : new Error(String(error))
        failDocument?.(normalized)
        setState({ status: 'error', message: normalized.message })
        return
      }

      let worker: XlsxWorker
      try {
        worker = createXlsxWorker(baseUrl, createWorker)
      } catch (error) {
        if (cancelled || requestId !== requestIdRef.current) return
        const normalized = error instanceof Error ? error : new Error(String(error))
        failDocument?.(normalized)
        setState({ status: 'error', message: normalized.message })
        return
      }
      // A newer request superseded this one while the worker was spawning; terminate the orphan instead of leaking it.
      if (cancelled || requestId !== requestIdRef.current) {
        worker.terminate()
        return
      }
      workerRef.current = worker

      worker.onmessage = (event: MessageEvent<XlsxParseResponse>) => {
        if (cancelled || event.data.id !== requestIdRef.current) return
        // The response is this worker's only job — free the isolate now instead of holding it until cleanup.
        worker.terminate()
        if (workerRef.current === worker) workerRef.current = null
        if (event.data.ok) {
          for (const warning of event.data.model.warnings) {
            if (loggedWarningsRef.current.has(warning)) continue
            loggedWarningsRef.current.add(warning)
            logger.warn(warning)
          }
          setState({ status: 'ready', model: event.data.model })
        } else {
          failDocument?.(new Error(event.data.message))
          setState({ status: 'error', message: event.data.message })
        }
      }
      worker.onerror = (event: ErrorEvent) => {
        if (cancelled || requestId !== requestIdRef.current) return
        worker.terminate()
        if (workerRef.current === worker) workerRef.current = null
        failDocument?.(event.error instanceof Error ? event.error : new Error(event.message))
        setState({ status: 'error', message: event.message })
      }

      const request: XlsxParseRequest = { id: requestId, fileName, data: bytes }
      try {
        worker.postMessage(request, [bytes])
      } catch (error) {
        worker.terminate()
        if (workerRef.current === worker) workerRef.current = null
        if (cancelled || requestId !== requestIdRef.current) return
        const normalized = error instanceof Error ? error : new Error(String(error))
        failDocument?.(normalized)
        setState({ status: 'error', message: normalized.message })
      }
    })()

    // Terminating here (not just on unmount) frees the CPU held by a slow in-flight parse the moment the user
    // switches files, and detaches the old worker's id-less onerror so its crash can't flip the new request to error.
    return () => {
      cancelled = true
      controller.abort()
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [document, fileName, logger, failDocument, baseUrl, createWorker])

  return state
}

function createXlsxWorker(
  baseUrl: PreviewResources['baseUrl'],
  createWorker: PreviewResources['createWorker']
): XlsxWorker {
  if (createWorker) return createWorker('xlsx')
  if (baseUrl) return new Worker(new URL('xlsx.worker.js', new URL(baseUrl, document.baseURI)), { type: 'module' })
  return new Worker(new URL('./worker/xlsxParser.worker.ts', import.meta.url), { type: 'module' })
}
