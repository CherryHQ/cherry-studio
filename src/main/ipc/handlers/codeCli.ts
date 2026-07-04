import { application } from '@application'
import type { codeCliRequestSchemas } from '@shared/ipc/schemas/codeCli'
import type { IpcHandlersFor } from '@shared/ipc/types'
import { CodeCli } from '@shared/types/codeCli'

/** Thin adapters: delegate to CodeCliService. */
export const codeCliHandlers: IpcHandlersFor<typeof codeCliRequestSchemas> = {
  'code_cli.run': async (input) => {
    const isLoginFlow = input.cliTool === CodeCli.CLAUDE_CODE && input.options.loginFlow === true
    const isProviderlessCli = input.cliTool === CodeCli.QODER_CLI || input.cliTool === CodeCli.GITHUB_COPILOT_CLI
    if (!isProviderlessCli && !isLoginFlow && input.providerId.trim().length === 0) {
      return {
        success: false,
        message: 'Invalid model provider: provider id is required for this CLI tool',
        command: ''
      }
    }
    if (!isProviderlessCli && !isLoginFlow && input.model.trim().length === 0) {
      return {
        success: false,
        message: 'Invalid model: model name is required for this CLI tool',
        command: ''
      }
    }

    return application
      .get('CodeCliService')
      .run(input.cliTool, input.model, input.providerId, input.directory, input.options)
  },
  'code_cli.get_available_terminals': async () => {
    return application.get('CodeCliService').getAvailableTerminalsForPlatform()
  }
}
