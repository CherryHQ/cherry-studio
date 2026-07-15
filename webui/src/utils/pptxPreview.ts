type PptxPreviewHandle = {
  readonly destroy: () => void
}

const EXTERNAL_TARGET_MODE = 'external'
const EXTERNAL_MEDIA_RELATIONSHIP_TYPES = new Set(['image', 'audio', 'video', 'media'])

const throwIfAborted = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException('Preview aborted', 'AbortError')
}

const getRelationshipTypeName = (type: string) => type.trim().toLowerCase().split('/').at(-1) ?? ''

const stripExternalMediaRelationshipMap = (rels: Map<string, { type: string; targetMode?: string }>) => {
  for (const [id, relationship] of rels) {
    if (
      relationship.targetMode?.trim().toLowerCase() === EXTERNAL_TARGET_MODE &&
      EXTERNAL_MEDIA_RELATIONSHIP_TYPES.has(getRelationshipTypeName(relationship.type))
    ) {
      rels.delete(id)
    }
  }
}

export const mountPptxPreview = async (
  container: HTMLElement,
  data: ArrayBuffer,
  signal: AbortSignal
): Promise<PptxPreviewHandle> => {
  throwIfAborted(signal)
  const { buildPresentation, parseZipLazyMedia, PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import(
    '@aiden0z/pptx-renderer'
  )
  throwIfAborted(signal)

  const files = await parseZipLazyMedia(data, RECOMMENDED_ZIP_LIMITS)
  throwIfAborted(signal)
  const presentation = buildPresentation(files, { lazySlides: true })
  for (const slide of presentation.slides) stripExternalMediaRelationshipMap(slide.rels)
  for (const layout of presentation.layouts.values()) stripExternalMediaRelationshipMap(layout.rels)
  for (const master of presentation.masters.values()) stripExternalMediaRelationshipMap(master.rels)
  throwIfAborted(signal)

  const viewerRoot = document.createElement('div')
  viewerRoot.className = 'workspace-pptx-viewer'
  container.appendChild(viewerRoot)
  const viewer = new PptxViewer(viewerRoot, {
    fitMode: 'contain',
    lazyMedia: true,
    lazySlides: true,
    pdfjs: false,
    scrollContainer: container,
    zipLimits: RECOMMENDED_ZIP_LIMITS
  })
  let destroyed = false
  const destroy = () => {
    if (destroyed) return
    destroyed = true
    signal.removeEventListener('abort', destroy)
    viewer.destroy()
    viewerRoot.remove()
  }
  signal.addEventListener('abort', destroy, { once: true })

  try {
    viewer.load(presentation)
    await viewer.renderList({
      batchSize: 4,
      initialSlides: 3,
      overscanViewport: 2,
      windowed: true
    })
    throwIfAborted(signal)
    container.querySelector('[data-pptx-preview-loading]')?.remove()
    return { destroy }
  } catch (error) {
    destroy()
    throw error
  }
}
