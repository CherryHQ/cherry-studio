import { loggerService } from '@logger'
import type { OcrProvider, OcrTaskResult, OcrTaskStartResult, OcrTaskStatus, SupportedOcrFile } from '@renderer/types'
import { isOcrApiProvider } from '@renderer/types'

import { OcrApiClientFactory } from './clients/OcrApiClientFactory'

const logger = loggerService.withContext('renderer:OcrService')

type LocalRendererTaskRecord = {
  status: OcrTaskStatus['status']
  progress: number
  result?: OcrTaskResult['result']
  error?: Error
}

const localTasks = new Map<string, LocalRendererTaskRecord>()

export const start = async (file: SupportedOcrFile, provider: OcrProvider): Promise<OcrTaskStartResult> => {
  logger.info(`start ocr task for file ${file.path}`)

  if (!isOcrApiProvider(provider)) {
    return window.api.ocr.start(file, provider)
  }

  const client = OcrApiClientFactory.create(provider)
  const taskId = crypto.randomUUID()

  localTasks.set(taskId, {
    status: 'processing',
    progress: 1
  })

  void client
    .ocr(file, provider.config)
    .then((result) => {
      localTasks.set(taskId, {
        status: 'completed',
        progress: 100,
        result: {
          text: result.text,
          pages: [{ text: result.text }]
        }
      })
    })
    .catch((error) => {
      localTasks.set(taskId, {
        status: 'failed',
        progress: 0,
        error: error instanceof Error ? error : new Error(String(error))
      })
    })

  return {
    taskId,
    providerTaskId: taskId,
    status: 'processing'
  }
}

export const getStatus = async (taskId: string, provider: OcrProvider): Promise<OcrTaskStatus> => {
  if (!isOcrApiProvider(provider)) {
    return window.api.ocr.getStatus(taskId, provider)
  }

  const task = getLocalTask(taskId)

  return {
    taskId,
    providerTaskId: taskId,
    status: task.status,
    progress: task.progress
  }
}

export const getResult = async (taskId: string, provider: OcrProvider): Promise<OcrTaskResult> => {
  if (!isOcrApiProvider(provider)) {
    return window.api.ocr.getResult(taskId, provider)
  }

  const task = getLocalTask(taskId)

  if (task.status === 'failed') {
    throw task.error ?? new Error(`OCR task ${taskId} failed`)
  }

  if (task.status !== 'completed' || !task.result) {
    throw new Error(`OCR task ${taskId} is not completed`)
  }

  return {
    taskId,
    providerTaskId: taskId,
    status: 'completed',
    progress: 100,
    result: task.result
  }
}

function getLocalTask(taskId: string): LocalRendererTaskRecord {
  const task = localTasks.get(taskId)
  if (!task) {
    throw new Error(`OCR task ${taskId} was not found`)
  }
  return task
}
