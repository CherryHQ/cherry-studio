import { IpcChannel } from '@shared/IpcChannel'

import { handleInPage } from './electron'

function download(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName })
  link.click()
  // The download has started once `click` returns; revoking later keeps slow browsers safe.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Answers the desktop save dialogs (saving a message or an export to a file, saving an image) with a
 * browser download, which goes to the download folder or asks where, as the browser is set up to.
 */
export function installFileDownloads(): void {
  handleInPage(IpcChannel.File_Save, async (fileName, content) => {
    download(String(fileName), new Blob([content as BlobPart]))
    return fileName
  })
  handleInPage(IpcChannel.File_SaveImage, async (name, dataUrl) => {
    download(`${String(name)}.png`, await (await fetch(String(dataUrl))).blob())
    return true
  })
}
