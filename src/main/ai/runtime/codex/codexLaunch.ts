import { codexCli } from '@cherrystudio/agent-runtime-codex/cli'
import type { CodexLaunch } from '@cherrystudio/agent-runtime-codex/launcher'
import { tomlModelField } from '@cherrystudio/agent-runtime/cli'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

import { requireInstallation, resolveCliProgram } from '../cli/cliProgram'
import type { LaunchModelBinding } from '../cli/launchBinding'

export const codexCliBinding = {
  profile: tomlModelField(codexCli.modelConfig.target, codexCli.modelConfig.field)
}

export async function resolveCodexLaunch(
  config: LocalAgentConfiguration,
  cwd: string,
  signal: AbortSignal,
  purpose: 'chat' | 'models' = 'chat',
  sessionId?: string
): Promise<CodexLaunch & { modelBinding?: LaunchModelBinding }> {
  const program = await resolveCliProgram(
    config,
    purpose === 'chat' ? 'session' : purpose,
    signal,
    { ...codexCliBinding, componentId: codexCli.executable },
    { sessionId, bindModel: purpose === 'chat' }
  )
  return {
    ...(program.modelBinding && { modelBinding: program.modelBinding }),
    installation: requireInstallation(program.installation, codexCli.executable),
    cwd,
    env: program.env,
    args: program.args,
    executableOverride: config.executableOverride !== undefined
  }
}
