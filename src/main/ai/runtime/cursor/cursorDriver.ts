import { application } from '@application'
import { withStartupSignal } from '@cherrystudio/agent-runtime/stdio'
import { getShellEnv } from '@main/utils/shellEnv'
import type { LocalAgentAccount, LocalAgentConfiguration, LocalAgentRuntime } from '@shared/ai/localAgent'

import type { LocalRuntimeConnectInput } from '../types'

export async function connect(input: LocalRuntimeConnectInput, config: LocalAgentRuntime, cwd: string) {
  const { CursorConnection } = await import('./CursorConnection')
  const live = new CursorConnection(input.sessionId, input.agentId, config, input.localTarget, input.headless)
  return withStartupSignal(
    AbortSignal.timeout(30_000),
    () => live.start(cwd, input.resumeToken),
    () => live.close()
  )
}

type CursorBoundConfiguration = LocalAgentConfiguration & { account?: LocalAgentAccount }

export function cursorCredentialSelection(config: CursorBoundConfiguration) {
  const methodId = config.account?.methodId
  return methodId ? { methodId, sdkAuthPath: application.getPath('external.cursor.sdk_auth.file') } : undefined
}

export async function listModels(config: CursorBoundConfiguration) {
  const { listCursorModels } = await import('@cherrystudio/agent-runtime-cursor')
  return {
    models: await listCursorModels(
      config.env,
      getShellEnv,
      AbortSignal.timeout(30_000),
      cursorCredentialSelection(config)
    )
  }
}

export async function bindAccount(config: CursorBoundConfiguration) {
  const { bindCursorAccount } = await import('@cherrystudio/agent-runtime-cursor')
  return bindCursorAccount(
    config.env,
    getShellEnv,
    application.getPath('external.cursor.sdk_auth.file'),
    config.account?.methodId
  )
}

export async function check(config: CursorBoundConfiguration): Promise<void> {
  await listModels(config)
}
