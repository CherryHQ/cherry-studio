import { application } from '@application'
import type { codeCliRequestSchemas } from '@shared/ipc/schemas/codeCli'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** Thin adapters: delegate to CodeCliService. */
export const codeCliHandlers: IpcHandlersFor<typeof codeCliRequestSchemas> = {
  'code_cli.run': async (input, { senderId }) => {
    if (senderId == null) throw new Error('code_cli.run requires a managed window')

    // Provider/model validation (incl. login-flow and providerless-CLI exemptions) is owned by
    // CodeCliService.run() as the single source of truth; the handler just delegates.
    return application.get('CodeCliService').run(input)
  },
  'code_cli.write_config': async (input) => {
    try {
      await application.get('CodeCliService').writeConfigFiles(input.cliTool, input.files)
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
