import { ipcApi } from '@renderer/ipc'

/**
 * pdf.js reader factories backed by the packaged pdfjs-dist bundle over IPC.
 *
 * The default DOMCMapReaderFactory / DOMStandardFontDataFactory fetch from a
 * `cMapUrl` / `standardFontDataUrl`, which the packaged renderer cannot do: it
 * loads over `file://`, where asset fetches are blocked. These factories read
 * the bytes through the `pdfjs.resource.read` IPC route instead.
 *
 * Why they matter: a PDF whose CJK text uses a non-embedded CID-keyed font
 * (common for Word/WPS exports in Chinese) carries no usable Unicode mapping
 * itself — pdf.js needs the binary CMaps to decode it. Without them the text
 * layer decodes to nothing and the canvas draws no glyphs at all.
 */
export class PdfjsBundledCMapReaderFactory {
  async fetch({ name }: { name: string }): Promise<{ cMapData: Uint8Array; isCompressed: boolean }> {
    if (!name) throw new Error('CMap name must be specified.')

    const { content } = await ipcApi.request('pdfjs.resource.read', { kind: 'cmap', name })
    return { cMapData: content, isCompressed: true }
  }
}

export class PdfjsBundledStandardFontDataFactory {
  async fetch({ filename }: { filename: string }): Promise<Uint8Array> {
    if (!filename) throw new Error('Font filename must be specified.')

    const { content } = await ipcApi.request('pdfjs.resource.read', { kind: 'standard_font', name: filename })
    return content
  }
}
