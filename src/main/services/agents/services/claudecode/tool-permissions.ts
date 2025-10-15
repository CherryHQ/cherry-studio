import { loggerService } from '@logger'

const logger = loggerService.withContext('ClaudeCodeService')

export async function promptForToolApproval(toolName: string, input: any) {
  logger.info(`Requesting user approval for tool: ${toolName} with input: ${JSON.stringify(input).slice(0, 100)}`)

  // TODO Get user approval (replace with your UI logic)
  // it need use ipc and communicate with render process in UI, and wait for user response
  async function getUserApproval(): Promise<boolean> {
    // Simulate user approval for demonstration purposes
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve(true) // Simulate user approval
      }, 1000)
    })
  }

  const approved = await getUserApproval()

  if (approved) {
    return {
      behavior: 'allow',
      updatedInput: input
    }
  } else {
    return {
      behavior: 'deny',
      message: 'User denied permission for this tool'
    }
  }
}
