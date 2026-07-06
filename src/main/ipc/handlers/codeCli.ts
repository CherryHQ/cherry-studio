import { application } from '@application'
import type { codeCliRequestSchemas } from '@shared/ipc/schemas/codeCli'
import type { IpcHandlersFor } from '@shared/ipc/types'

/** Thin adapters: delegate to CodeCliService. */
export const codeCliHandlers: IpcHandlersFor<typeof codeCliRequestSchemas> = {
  'code_cli.run': async (input) => {
    // Provider/model validation (incl. login-flow and providerless-CLI exemptions) is owned by
    // CodeCliService.run() as the single source of truth; the handler just delegates.
    return application
      .get('CodeCliService')
      .run(input.cliTool, input.model, input.providerId, input.directory, input.options)
  },
  'code_cli.get_available_terminals': async () => {
    return application.get('CodeCliService').getAvailableTerminalsForPlatform()
  }
}
