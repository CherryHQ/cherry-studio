import type { ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'

export function createPiRuntimeContextExtension(
  resolveTurnContext: () => Promise<string | undefined>
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.on('before_agent_start', async (event) => {
      const turnContext = await resolveTurnContext()
      if (!turnContext) return undefined
      return { systemPrompt: [event.systemPrompt, turnContext].filter(Boolean).join('\n\n') }
    })
  }
}
