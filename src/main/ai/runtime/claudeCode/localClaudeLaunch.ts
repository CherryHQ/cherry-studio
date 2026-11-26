import type { LocalClaudeLaunch } from '@cherrystudio/agent-runtime-claude-code'
import { claudeCli, claudeModelProfile, scheduledClaudeEnvironment } from '@cherrystudio/agent-runtime-claude-code/cli'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'

import { requireInstallation, resolveCliProgram } from '../cli/cliProgram'

export async function resolveClaudeLaunch(
  config: LocalAgentConfiguration,
  cwd: string,
  signal: AbortSignal,
  purpose: 'chat' | 'scheduled-chat' | 'models'
): Promise<LocalClaudeLaunch & { env: Record<string, string>; nativeModel?: string }> {
  const program = await resolveCliProgram(config, purpose === 'models' ? 'models' : 'session', signal, {
    profile: claudeModelProfile,
    componentId: claudeCli.executable,
    windowsShell: claudeCli.windowsShell,
    ...(purpose === 'scheduled-chat' && {
      scheduledEnvironment: { target: claudeCli.modelConfig.target, merge: scheduledClaudeEnvironment }
    })
  })
  return {
    installation: requireInstallation(program.installation, claudeCli.executable),
    cwd,
    env: program.env,
    args: program.args,
    nativeModel: program.nativeModel
  }
}
