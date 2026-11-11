import { pathToFileURL } from 'node:url'

import { clipboard, ClipboardItem } from 'electron'

import type { AbsoluteFilePath } from '@shared/types/file'

/** Electron maps text/uri-list to the OS copied-files format. */
export async function writeFileToClipboard(target: AbsoluteFilePath): Promise<void> {
  await clipboard.write([new ClipboardItem({ 'text/uri-list': pathToFileURL(target).href })])
}
