import { application } from '@application'
import { notifyLocalModelChange, syncLocalAgentConfigModel } from '@main/ai/runtime/localAgent/selectModel'
import { t } from '@main/i18n'
import type { codeCliRequestSchemas } from '@shared/ipc/schemas/codeCli'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** Thin adapters: delegate to CodeCliService. */
export const codeCliHandlers: IpcHandlersFor<typeof codeCliRequestSchemas> = {
  'code_cli.run': async (input) => {
    // Provider/model validation (incl. login-flow and providerless-CLI exemptions) is owned by
    // CodeCliService.run() as the single source of truth; the handler just delegates.
    return application.get('CodeCliService').run(input)
  },
  'code_cli.read_config': async (input) => {
    // Non-ENOENT read errors propagate to the router's error model by design.
    return { files: await application.get('CodeCliService').readConfigFiles(input.targets) }
  },
  'code_cli.write_config': async (input) => {
    try {
      let agentId: string | undefined
      await application.get('CodeCliService').updateConfigFiles(
        input.cliTool,
        input.expectedFiles?.map((file) => file.target) ?? [],
        (current) => {
          if (
            input.expectedFiles?.some(
              (file) => current.find((entry) => entry.target === file.target)?.content !== file.content
            )
          ) {
            throw new Error(t('code_cli.config_changed'))
          }
          return input.files
        },
        () => {
          agentId = syncLocalAgentConfigModel(input.cliTool, input.files, input.preserveModelSource)
        }
      )
      if (agentId) notifyLocalModelChange(agentId)
      return { success: true as const }
    } catch (error) {
      return { success: false as const, message: error instanceof Error ? error.message : 'Unknown error' }
    }
  },
  'code_cli.get_available_terminals': async () => {
    // Project to the contract's { id, name }. The service's TerminalConfig also carries a macOS
    // bundleId used internally for LaunchServices resolution; the renderer never consumes it, so keep it
    // off the wire (the router does not re-parse handler output, so extra fields would leak).
    const terminals = await application.get('CodeCliService').getAvailableTerminalsForPlatform()
    return terminals.map(({ id, name }) => ({ id, name }))
  }
}
