import { ipcApi } from '@renderer/ipc'

/** Switch MiniMax Code to its official Token Plan login through the public CLI boundary. */
export async function activateMiniMaxCodeOfficial(): Promise<void> {
  const result = await ipcApi.request('code_cli.mcode_provider.activate_official')
  if (!result.success) throw new Error(result.message)
}
