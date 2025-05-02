import { IUploadFileResponse, IUserInputForm } from '@dify-chat/api'
import FlowEngineProvider from '@renderer/providers/FlowEngineProvider'
import { Flow, FlowEngine } from '@renderer/types'

export async function check(provider: FlowEngine, workflow: Flow) {
  const flowEngineProvider = new FlowEngineProvider(provider)
  return await flowEngineProvider.check(workflow)
}

export async function getAppParameters(provider: FlowEngine, workflow: Flow): Promise<IUserInputForm[]> {
  const flowEngineProvider = new FlowEngineProvider(provider)
  return await flowEngineProvider.getAppParameters(workflow)
}

export async function uploadFile(provider: FlowEngine, workflow: Flow, file: File): Promise<IUploadFileResponse> {
  const flowEngineProvider = new FlowEngineProvider(provider)
  return await flowEngineProvider.uploadFile(workflow, file)
}
