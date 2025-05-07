import { IUploadFileResponse, IUserInputForm } from '@dify-chat/api'

import BaseFlowEngineProvider from './BaseFlowEngineProvider'

export default class DefaultFlowEngineProvider extends BaseFlowEngineProvider {
  workflowCompletion(): Promise<void> {
    throw new Error('Method not implemented.')
  }
  getAppParameters(): Promise<IUserInputForm[]> {
    throw new Error('Method not implemented.')
  }
  uploadFile(): Promise<IUploadFileResponse> {
    throw new Error('Method not implemented.')
  }
  chatflowCompletion(): Promise<void> {
    throw new Error('Method not implemented.')
  }
  check(): Promise<{ valid: boolean; error: Error | null }> {
    throw new Error('Method not implemented.')
  }
}
