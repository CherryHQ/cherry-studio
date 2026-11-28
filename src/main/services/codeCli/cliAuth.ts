import { application } from '@application'
import type { RuntimeLoginHost, RuntimeLoginRequest } from '@cherrystudio/agent-runtime'
import { type CliAuthCommandSpec, planCliLogin } from '@cherrystudio/agent-runtime/cli'
import { runCliLogin } from '@cherrystudio/agent-runtime/stdio'
import { spawnLocalAgentStdio } from '@main/ai/runtime/stdioProcess'
import { getLocalAgentProtocol, type LocalAgentConfiguration, localCliPresetById } from '@shared/ai/localAgent'

import { resolveLocalAgentCli } from './localAgentCli'

export type { CliAuthCommandSpec }
export type CliAuthOptions = Omit<RuntimeLoginRequest, 'methodId'>

export function resolveCliAuthCommand(presetId: string | undefined, methodId: string, options?: CliAuthOptions) {
  return planCliLogin(presetId ? localCliPresetById.get(presetId) : undefined, { methodId, ...options })
}

export async function authenticateViaCli(
  config: LocalAgentConfiguration,
  spec: CliAuthCommandSpec,
  host: RuntimeLoginHost,
  signal: AbortSignal
) {
  const prepareLogin =
    getLocalAgentProtocol(config.presetId) === 'acp'
      ? (await import('@main/ai/runtime/acp/acpPresets')).acpPreset(config.presetId)?.prepareLoginCommand
      : undefined
  const launch = prepareLogin
    ? prepareLogin({
        ...(await (await import('@main/ai/runtime/acp/acpLaunch')).resolveAcpLaunch(config, signal, 'account')),
        args: spec.args
      })
    : { ...(await resolveLocalAgentCli(config, signal)), args: spec.args }
  let openedUrl: string | undefined
  await runCliLogin(
    { ...launch, cwd: application.getPath('cherry.bin') },
    spawnLocalAgentStdio,
    signal,
    spec.stdin,
    (prompt) => {
      host.showPrompt(prompt)
      const { url } = prompt
      if (spec.autoOpenUrl && url && url !== openedUrl) {
        openedUrl = url
        void host.openBrowser(url).catch(() => undefined)
      }
    }
  )
}
