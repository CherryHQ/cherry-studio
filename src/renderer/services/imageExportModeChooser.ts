/**
 * Image-mode chooser seam for Markdown image exports. Hooks and services call
 * `chooseImageExportMode`; the real implementation (a popup component) is
 * registered once from the composition layer, so no hook ever imports a
 * component upward (renderer-architecture §3: components → hooks/services).
 */
import { loggerService } from '@logger'
import type { ImageExportMode } from '@renderer/services/markdownImageExport'

const logger = loggerService.withContext('imageExportModeChooser')

export type ImageModeChooserFn = (imageCount: number) => Promise<ImageExportMode | null | undefined>

let chooser: ImageModeChooserFn | undefined

/** Composition-layer registration; the registrant owns lazy-loading the popup. */
export function registerImageModeChooser(fn: ImageModeChooserFn): void {
  chooser = fn
}

/**
 * Undefined = no implementation registered (the export aborts, same as a missing
 * injected chooser); null = the user cancelled.
 */
export async function chooseImageExportMode(imageCount: number): Promise<ImageExportMode | null | undefined> {
  if (!chooser) {
    logger.warn('No image-mode chooser registered; aborting an image-bearing markdown export')
    return undefined
  }
  return chooser(imageCount)
}
