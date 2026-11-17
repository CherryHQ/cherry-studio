import type { PreviewResources } from '../../types'

export function createPdfResourceFactories(read: NonNullable<PreviewResources['readPdfResource']>) {
  return {
    CMapReaderFactory: class {
      async fetch({ name }: { name: string }) {
        if (!name) throw new Error('CMap name must be specified.')
        return { cMapData: await read('cmap', name), isCompressed: true }
      }
    },
    StandardFontDataFactory: class {
      async fetch({ filename }: { filename: string }) {
        if (!filename) throw new Error('Font filename must be specified.')
        return read('standard_font', filename)
      }
    }
  }
}
