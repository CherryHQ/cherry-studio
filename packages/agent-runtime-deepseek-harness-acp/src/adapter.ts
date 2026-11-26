import type { AcpLaunch, AcpModelSelection } from '@cherrystudio/agent-runtime-acp/profile'

import { DSH_PERMISSION_MODES, dshCli, dshMode } from './cli'

export function dshEnvironment(directory: string) {
  return { DSH_HOME: directory }
}

function dshSelection(configured: string | undefined, launch: AcpLaunch): AcpModelSelection {
  return { model: configured ?? launch.nativeModel }
}

export async function prepareDshChat(
  overrides: Record<string, string>,
  launch: AcpLaunch,
  saved: { configId: string; value: string } | undefined,
  prepare: (defaultProfile: boolean) => Promise<
    | {
        nativeModel?: string
        gateway?: { patchPath: string; env: Record<string, string | undefined>; dispose(): Promise<void> }
      }
    | undefined
  >
) {
  const selected =
    (saved?.configId === DSH_PERMISSION_MODES.id ? saved.value : undefined) ?? overrides.DSH_PERMISSION_MODE
  const mode = dshMode(selected)
  launch.env.DSH_PERMISSION_MODE = mode.currentValue
  if (overrides.DSH_HOME) return { mode }
  const defaultProfile = launch.args.length === 2 && launch.args[0] === '--profile' && launch.args[1] === 'acp'
  const prepared = await prepare(defaultProfile)
  launch.nativeModel = prepared?.nativeModel
  const gateway = prepared?.gateway
  if (gateway) {
    launch.args = [...launch.args, '--patch', gateway.patchPath]
    Object.assign(launch.env, gateway.env)
  }
  return { mode, gateway }
}

export const dshPreset = {
  id: dshCli.id,
  selectModel: dshSelection,
  installation: 'native-cli'
} as const
