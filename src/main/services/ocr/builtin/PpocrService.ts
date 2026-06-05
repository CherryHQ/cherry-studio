import { paddleOcrSdkService } from '@main/services/paddleocr/PaddleOcrSdkService'
import type {
  OcrPpocrConfig,
  OcrTaskResult,
  OcrTaskStartResult,
  OcrTaskStatus,
  SupportedOcrFile
} from '@types'
import { isImageFileMetadata } from '@types'

import { OcrBaseService } from './OcrBaseService'

export class PpocrService extends OcrBaseService {
  private readonly providerTaskIds = new Map<string, string>()

  public startTask = async (file: SupportedOcrFile, options?: OcrPpocrConfig): Promise<OcrTaskStartResult> => {
    if (!isImageFileMetadata(file)) {
      throw new Error('Only image files are supported currently')
    }

    const config = this.getRequiredConfig(options)
    const taskId = crypto.randomUUID()
    const task = await paddleOcrSdkService.startImageOcr({
      taskId,
      token: config.accessToken,
      baseUrl: config.apiUrl,
      filePath: file.path
    })

    this.providerTaskIds.set(task.taskId, task.providerTaskId)
    return task
  }

  public getTaskStatus = async (taskId: string, options?: OcrPpocrConfig): Promise<OcrTaskStatus> => {
    const config = this.getRequiredConfig(options)

    return paddleOcrSdkService.getImageOcrStatus({
      taskId,
      providerTaskId: this.getProviderTaskId(taskId),
      token: config.accessToken,
      baseUrl: config.apiUrl
    })
  }

  public getTaskResult = async (taskId: string, options?: OcrPpocrConfig): Promise<OcrTaskResult> => {
    const config = this.getRequiredConfig(options)

    return paddleOcrSdkService.getImageOcrResult({
      taskId,
      providerTaskId: this.getProviderTaskId(taskId),
      token: config.accessToken,
      baseUrl: config.apiUrl
    })
  }

  private getRequiredConfig(options?: OcrPpocrConfig): Required<Pick<OcrPpocrConfig, 'apiUrl'>> & Pick<OcrPpocrConfig, 'accessToken'> {
    if (!options?.apiUrl) {
      throw new Error('API URL is required')
    }

    return {
      apiUrl: options.apiUrl,
      accessToken: options.accessToken
    }
  }

  private getProviderTaskId(taskId: string): string {
    const providerTaskId = this.providerTaskIds.get(taskId)

    if (!providerTaskId) {
      throw new Error(`PaddleOCR task ${taskId} was not found`)
    }

    return providerTaskId
  }
}

export const ppocrService = new PpocrService()
