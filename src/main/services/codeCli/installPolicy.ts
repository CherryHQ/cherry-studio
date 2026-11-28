import { application } from '@application'
import { antigravityInstaller } from '@cherrystudio/agent-runtime-antigravity-acp/cli'
import { codeBuddyCli } from '@cherrystudio/agent-runtime-codebuddy-acp/cli'
import { dshCli } from '@cherrystudio/agent-runtime-deepseek-harness-acp/cli'
import { hermesCli, hermesInstaller } from '@cherrystudio/agent-runtime-hermes-acp/cli'
import { kiroCli, kiroInstaller } from '@cherrystudio/agent-runtime-kiro-acp/cli'
import { openClawCli } from '@cherrystudio/agent-runtime-openclaw-acp/cli'
import { traeCli, traeInstall } from '@cherrystudio/agent-runtime-trae-acp/cli'
import { vibeCli, vibeInstall } from '@cherrystudio/agent-runtime-vibe-acp/cli'
import type { CliInstaller, CliInstallPlan } from '@cherrystudio/agent-runtime/cli'

export const presetInstallRecipe: ReadonlyMap<string, (platform: string) => CliInstallPlan | undefined> = new Map<
  string,
  (platform: string) => CliInstallPlan | undefined
>([
  [kiroCli.id, kiroInstaller.script],
  [traeCli.id, traeInstall],
  [vibeCli.id, vibeInstall]
])

export const cliInstallers: ReadonlyMap<string, CliInstaller & { file?: () => string }> = new Map<
  string,
  CliInstaller & { file?: () => string }
>([
  [
    kiroInstaller.executable,
    { ...kiroInstaller, file: () => application.getPath('external.acp.bin', kiroInstaller.executable) }
  ],
  [
    antigravityInstaller.executable,
    { ...antigravityInstaller, file: () => application.getPath('external.antigravity.cli.file') }
  ],
  [hermesInstaller.executable, hermesInstaller]
])

export async function stopAgentHostForUninstall(presetId: string): Promise<boolean> {
  switch (presetId) {
    case openClawCli.id:
      return (await application.get('OpenClawService').stopGateway({ requirePortFree: true })).success
    case dshCli.id:
      await application.get('DeepSeekHarnessService').stop()
      break
    case codeBuddyCli.id:
      await application.get('CodeBuddyWebUiService').stop()
      break
    case hermesCli.id:
      await application.get('HermesDashboardService').stop()
      break
  }
  return true
}

export async function customRemoval(executable: string) {
  if (executable !== traeCli.executable) return undefined
  const { traeRemoval } = await import('@cherrystudio/agent-runtime-trae-acp/installer')
  return (path: string, env: Record<string, string>, run: Parameters<typeof traeRemoval>[3]) =>
    traeRemoval(
      path,
      env,
      {
        bin: application.getPath('external.acp.bin'),
        installation: application.getPath('external.trae.installation')
      },
      run
    )
}
