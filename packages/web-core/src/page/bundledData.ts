import { IpcChannel } from '@shared/IpcChannel'

import agentsEnUrl from '../../../../resources/data/agents-en.json?url'
import agentsZhUrl from '../../../../resources/data/agents-zh.json?url'
import { handleInPage } from './electron'

/** The files under the desktop's `resources/data` that the Web page reads, bundled with the app. */
const bundledData: Record<string, string> = {
  'agents-en.json': agentsEnUrl,
  'agents-zh.json': agentsZhUrl
}

/**
 * Answers the desktop's `fs.read` of its bundled data, such as the assistant presets, by fetching the
 * copy the app ships; the file is downloaded only when it is first read.
 */
export function installBundledData(): void {
  handleInPage(IpcChannel.Fs_Read, async (path, encoding) => {
    const [folder, name] = String(path).split('/').slice(-2)
    const url = folder === 'data' ? bundledData[name] : undefined
    if (!url) throw new Error(`${String(path)} is not bundled with the Web edition`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Could not load ${name}: HTTP ${response.status}`)
    return encoding ? response.text() : new Uint8Array(await response.arrayBuffer())
  })
}
