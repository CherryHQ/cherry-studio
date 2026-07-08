import { getAdapter } from './adapters'
import { FILE_CONFIGURED_CLI_TOOLS } from './targets'

export interface ClearCliConfigArgs {
  /** CLI tool whose config file should be scrubbed. */
  cliTool: string
}

/** Remove every Cherry-managed key from a CLI tool's config file, leaving user-owned keys intact. */
export async function clearCliConfig(args: ClearCliConfigArgs): Promise<void> {
  const { cliTool } = args
  if (!FILE_CONFIGURED_CLI_TOOLS.has(cliTool)) return
  await getAdapter(cliTool)?.clear()
}
