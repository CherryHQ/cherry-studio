import { IpcError } from '@shared/ipc/errors'
import { isOfficePreviewErrorCode, officePreviewErrorCodes } from '@shared/ipc/errors/officePreview'

import { renderOfficePreviewHtml } from './renderOfficePreviewHtml'
import type { OfficePreviewWorkerRequest, OfficePreviewWorkerResponse, UtilityParentPort } from './types'

const parentPort = (process as NodeJS.Process & { parentPort?: UtilityParentPort }).parentPort

function postMessage(message: OfficePreviewWorkerResponse): void {
  parentPort?.postMessage(message)
}

async function handleRender(input: OfficePreviewWorkerRequest): Promise<void> {
  try {
    const html = await renderOfficePreviewHtml(input.targetRealPath, input.extension)
    postMessage({ ok: true, html })
  } catch (error) {
    const code =
      error instanceof IpcError && isOfficePreviewErrorCode(error.code)
        ? error.code
        : officePreviewErrorCodes.PARSE_FAILED
    postMessage({
      ok: false,
      code,
      message: error instanceof Error ? error.message : String(error)
    })
  } finally {
    setImmediate(() => process.exit(0))
  }
}

if (!parentPort) {
  process.exit(1)
} else {
  parentPort.once('message', (event) => {
    void handleRender(event.data)
  })
}
