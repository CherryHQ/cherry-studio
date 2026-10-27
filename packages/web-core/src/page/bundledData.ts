import { IpcChannel } from '@shared/IpcChannel'

import agentsEnUrl from '../../../../resources/data/agents-en.json?url'
import agentsZhUrl from '../../../../resources/data/agents-zh.json?url'
import { answerInPage, handleInPage } from './electron'

/** The files under the desktop's `resources/data` that the Web page reads, bundled with the app. */
const bundledData: Record<string, string> = {
  'agents-en.json': agentsEnUrl,
  'agents-zh.json': agentsZhUrl
}

async function fetchBytes(url: string, name: string): Promise<Response> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not load ${name}: HTTP ${response.status}`)
  return response
}

/**
 * Answers the desktop's reads of the data it ships, such as the assistant presets and pdf.js's
 * resources, by fetching the copy the app bundles; a file is downloaded only when it is first read.
 */
export function installBundledData(): void {
  handleInPage(IpcChannel.Fs_Read, async (path, encoding) => {
    const [folder, name] = String(path).split('/').slice(-2)
    const url = folder === 'data' ? bundledData[name] : undefined
    if (!url) throw new Error(`${String(path)} is not bundled with the Web edition`)
    const response = await fetchBytes(url, name)
    return encoding ? response.text() : new Uint8Array(await response.arrayBuffer())
  })
  answerInPage('pdfjs.resource.read', async ({ kind, name }) => {
    const url = (await import('./pdfResources')).pdfResourceUrl(kind, name)
    if (!url) throw new Error(`pdf.js has no ${kind} named ${name}`)
    return { content: new Uint8Array(await (await fetchBytes(url, name)).arrayBuffer()) }
  })
}
