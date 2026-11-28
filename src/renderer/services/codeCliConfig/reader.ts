import { ipcApi } from '@renderer/ipc'
import type { CliConfigFileReader } from '@shared/utils/cliConfig'

/** Batch-reads CLI config files through the target-enum IPC route; Main resolves each absolute path. */
export const readConfigFiles: CliConfigFileReader = async (targets) => {
  if (!targets.length) return new Map()
  const { files } = await ipcApi.request('code_cli.read_config', { targets: [...targets] })
  return new Map(files.map((file) => [file.target, file]))
}
