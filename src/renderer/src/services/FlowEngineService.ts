import FlowEngineProvider from '@renderer/providers/FlowEngineProvider'
import { FlowConfig, FlowEngine } from '@renderer/types'

export async function check(provider: FlowEngine, workflow: FlowConfig) {
  const flowEngineProvider = new FlowEngineProvider(provider)
  return await flowEngineProvider.check(workflow)
}
