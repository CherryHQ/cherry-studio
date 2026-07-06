import { loggerService } from '@logger'
import { useEffect, useRef, useState } from 'react'

import type { WorkbookRenderModel, XlsxParseRequest, XlsxParseResponse } from './renderModel'

const logger = loggerService.withContext('XlsxPreviewPanel')

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

/** Normalize window.api.fs.read output to a real ArrayBuffer after IPC structured cloning. Needed for postMessage transfer. */
const toArrayBuffer = (data: unknown): ArrayBuffer => {
  if (data instanceof ArrayBuffer) return data
  if (ArrayBuffer.isView(data)) {
    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    return view.slice().buffer
  }
  return data as ArrayBuffer
}

/**
 * Reads file bytes with window.api.fs.read, parses them in a Worker, and exposes a state machine.
 * Handles size limits, request ids for stale-response discards, and refreshKey reparsing. Each request owns a
 * dedicated worker that is terminated when the request is superseded or the component unmounts, so a slow parse
 * can't pin a shared worker (queuing the next file behind it) or leak its crash onto the next request.
 */
export function useXlsxWorkbook(filePath: string, refreshKey: number, sourceSize?: number): XlsxWorkbookState {
  const [state, setState] = useState<XlsxWorkbookState>({ status: 'idle' })
  const workerRef = useRef<XlsxWorker | null>(null)
  const requestIdRef = useRef(0)
  const loggedWarningsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    const requestId = ++requestIdRef.current

    // Skip the read when the on-disk size already blows the limit — don't pull a huge
    // workbook into memory just to reject it after the fact. The post-read byte check
    // below still guards callers that don't pass sourceSize.
    if (typeof sourceSize === 'number' && sourceSize > XLSX_PREVIEW_MAX_SIZE_BYTES) {
      setState({ status: 'oversize', sizeBytes: sourceSize })
      return
    }

    setState({ status: 'loading' })

    void (async () => {
      let bytes: ArrayBuffer
      try {
        const raw = await window.api.fs.read(filePath)
        if (cancelled || requestId !== requestIdRef.current) return
        bytes = toArrayBuffer(raw)
      } catch (error) {
        if (cancelled || requestId !== requestIdRef.current) return
        const normalized = error instanceof Error ? error : new Error(String(error))
        logger.error(`Failed to read file: ${filePath}`, normalized)
        setState({ status: 'error', message: normalized.message })
        return
      }

      if (bytes.byteLength > XLSX_PREVIEW_MAX_SIZE_BYTES) {
        setState({ status: 'oversize', sizeBytes: bytes.byteLength })
        return
      }

      let worker: XlsxWorker
      try {
        worker = (await createXlsxWorker()) as unknown as XlsxWorker
      } catch (error) {
        if (cancelled || requestId !== requestIdRef.current) return
        const normalized = error instanceof Error ? error : new Error(String(error))
        logger.error('Failed to create xlsx parser worker', normalized)
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
        if (event.data.ok) {
          for (const warning of event.data.model.warnings) {
            if (loggedWarningsRef.current.has(warning)) continue
            loggedWarningsRef.current.add(warning)
            logger.warn(warning)
          }
          setState({ status: 'ready', model: event.data.model })
        } else {
          setState({ status: 'error', message: event.data.message })
        }
      }
      worker.onerror = (event: ErrorEvent) => {
        if (cancelled || requestId !== requestIdRef.current) return
        logger.error(
          'xlsx parser worker crashed',
          event.error instanceof Error ? event.error : new Error(event.message)
        )
        setState({ status: 'error', message: event.message })
      }

      const fileName = filePath.split('/').pop() ?? filePath
      const request: XlsxParseRequest = { id: requestId, fileName, data: bytes }
      worker.postMessage(request, [bytes])
    })()

    // Terminating here (not just on unmount) frees the CPU held by a slow in-flight parse the moment the user
    // switches files, and detaches the old worker's id-less onerror so its crash can't flip the new request to error.
    return () => {
      cancelled = true
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [filePath, refreshKey, sourceSize])

  return state
}

async function createXlsxWorker(): Promise<Worker> {
  const WorkerModule = await import('./worker/xlsxParser.worker?worker')
  return new WorkerModule.default()
}
