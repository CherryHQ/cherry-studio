import { application } from '@application'
import type { codeCliRequestSchemas } from '@shared/ipc/schemas/codeCli'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** Thin adapters: delegate to CodeCliService. */
export const codeCliHandlers: IpcHandlersFor<typeof codeCliRequestSchemas> = {
  'code_cli.run': async (input) => {
    return application
      .get('CodeCliService')
      .run(input.cliTool, input.model, input.providerId, input.directory, input.env, input.options)
  },
  'code_cli.get_available_terminals': async () => {
    return application.get('CodeCliService').getAvailableTerminalsForPlatform()
  },
  'code_cli.set_custom_terminal_path': async (input) => {
    application.get('CodeCliService').setCustomTerminalPath(input.terminalId, input.path)
  },
  'code_cli.get_custom_terminal_path': async (input) => {
    return application.get('CodeCliService').getCustomTerminalPath(input.terminalId)
  },
  'code_cli.remove_custom_terminal_path': async (input) => {
    application.get('CodeCliService').removeCustomTerminalPath(input.terminalId)
  }
}
