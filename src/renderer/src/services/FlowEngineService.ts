import FlowEngineProvider from '@renderer/providers/FlowEngineProvider'
import { Flow, FlowEngine } from '@renderer/types'

export async function check(provider: FlowEngine, workflow: Flow) {
  const flowEngineProvider = new FlowEngineProvider(provider)
  return await flowEngineProvider.check(workflow)
}
