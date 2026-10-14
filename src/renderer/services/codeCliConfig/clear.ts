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
  const files = await prepareCliConfigClear(cliTool)
  if (!files.length) return
  const result = await ipcApi.request('code_cli.write_config', { cliTool, files })
  if (!result.success) {
    throw new Error(result.message)
  }
}

export async function prepareCliConfigClear(cliTool: string, configBlob?: Record<string, unknown>) {
  const adapter = getAdapter(cliTool)
  const files = (await adapter?.buildClearFiles()) ?? []
  if (configBlob && adapter?.buildOwnLoginDraft) {
    for (const { target, content } of await adapter.buildOwnLoginDraft(configBlob)) {
      const index = files.findIndex((file) => file.target === target)
      if (index < 0) files.push({ target, content })
      else files[index] = { target, content }
    }
  }
  return files
}
