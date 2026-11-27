import type { LocalClaudeLaunch } from '@cherrystudio/agent-runtime-claude-code'
import { claudeCli, claudeModelProfile, scheduledClaudeEnvironment } from '@cherrystudio/agent-runtime-claude-code/cli'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

import { requireInstallation, resolveCliProgram } from '../cli/cliProgram'

export async function resolveClaudeLaunch(
  config: LocalAgentConfiguration,
  cwd: string,
  signal: AbortSignal,
  purpose: 'chat' | 'scheduled-chat' | 'models',
  sessionId?: string
) {
  const program = await resolveCliProgram(
    config,
    purpose === 'models' ? 'models' : 'session',
    signal,
    {
      profile: claudeModelProfile,
      componentId: claudeCli.executable,
      windowsShell: claudeCli.windowsShell,
      ...(purpose === 'scheduled-chat' && {
        scheduledEnvironment: { target: claudeCli.modelConfig.target, merge: scheduledClaudeEnvironment }
      })
    },
    { sessionId, bindModel: purpose !== 'models' }
  )
  const binding = program.modelBinding
  return {
    installation: requireInstallation(program.installation, claudeCli.executable),
    cwd,
    env: program.env,
    args: program.args,
    ...(program.nativeModel && { nativeModel: program.nativeModel }),
    ...(binding?.contextWindow && { contextWindow: { model: binding.model, tokens: binding.contextWindow } }),
    ...(binding && { modelBinding: binding })
  } satisfies LocalClaudeLaunch & {
    env: Record<string, string>
    nativeModel?: string
    contextWindow?: { model: string; tokens: number }
    modelBinding?: unknown
  }
}
