import { loggerService } from '@logger'
import { useEffect, useRef, useState } from 'react'

import type { WorkbookRenderModel, XlsxParseRequest, XlsxParseResponse } from './renderModel'

const logger = loggerService.withContext('XlsxPreviewPanel')

/** 超过此体积不解析,降级为外部应用打开 */
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

/** window.api.fs.read 经 IPC 结构化克隆后落地为 Uint8Array-like 对象;归一化为真正的 ArrayBuffer(postMessage transfer 需要)。 */
const toArrayBuffer = (data: unknown): ArrayBuffer => {
  if (data instanceof ArrayBuffer) return data
  if (ArrayBuffer.isView(data)) {
    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    return view.slice().buffer
  }
  return data as ArrayBuffer
}

/**
 * 读文件字节(window.api.fs.read)→ Worker 解析 → 状态机。
 * 体积上限、Worker 惰性创建、请求 id 递增丢弃过期响应、refreshKey 重解析均在此实现。
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

      try {
        workerRef.current ??= (await createXlsxWorker()) as unknown as XlsxWorker
      } catch (error) {
        if (cancelled || requestId !== requestIdRef.current) return
        const normalized = error instanceof Error ? error : new Error(String(error))
        logger.error('Failed to create xlsx parser worker', normalized)
        setState({ status: 'error', message: normalized.message })
        return
      }

      const worker = workerRef.current
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

    return () => {
      cancelled = true
    }
  }, [filePath, refreshKey, sourceSize])

  useEffect(
    () => () => {
      workerRef.current?.terminate()
      workerRef.current = null
    },
    []
  )

  return state
}

async function createXlsxWorker(): Promise<Worker> {
  const WorkerModule = await import('./worker/xlsxParser.worker?worker')
  return new WorkerModule.default()
}
