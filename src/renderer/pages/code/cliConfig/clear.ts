import { ipcApi } from '@renderer/ipc'
import { isFileConfiguredCli } from '@shared/utils/cliConfig'

import { getAdapter } from './adapters'

export interface ClearCliConfigArgs {
  /** CLI tool whose config file should be scrubbed. */
  cliTool: string
}

/** Remove every Cherry-managed key from a CLI tool's config file, leaving user-owned keys intact. */
export async function clearCliConfig(args: ClearCliConfigArgs): Promise<void> {
  const { cliTool } = args
  if (!isFileConfiguredCli(cliTool)) return
  const files = (await getAdapter(cliTool)?.buildClearFiles()) ?? []
  if (!files.length) return
  const result = await ipcApi.request('code_cli.write_config', { cliTool, files })
  if (!result.success) {
    throw new Error(result.message)
  }
}
