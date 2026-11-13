import { parentPort, workerData } from 'node:worker_threads'

import { decodeTextBufferIfText, decodeTextWithAutoEncoding } from '@main/utils/textEncoding'

import { allocateInlineCaps } from './attachmentInlineBudget'
import type { AttachmentWorkerInput } from './attachmentWorkerTypes'

if (!parentPort) throw new Error('Attachment worker requires a parent port')
const port = parentPort
const task: AttachmentWorkerInput = workerData
const logger = {
  warn: (message: string) => port.postMessage({ type: 'log', level: 'warn', message }),
  error: (message: string) => port.postMessage({ type: 'log', level: 'error', message })
}

switch (task.type) {
  case 'decode': {
    const buffer = Buffer.from(task.input.content)
    const text = task.input.conservative ? decodeTextBufferIfText(buffer) : decodeTextWithAutoEncoding(buffer, logger)
    port.postMessage({ type: 'result', value: text?.trim() ?? null })
    break
  }
  case 'allocate':
    port.postMessage({ type: 'result', value: allocateInlineCaps(task.input.bodies, task.input.tokens) })
    break
}
