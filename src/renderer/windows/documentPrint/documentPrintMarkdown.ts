import type { Definition, Root } from 'mdast'
import type { CodeHighlighterPlugin } from 'streamdown'
import type { Plugin } from 'unified'
import { visit } from 'unist-util-visit'

export const remarkPrintImages: Plugin<[{ images: Record<string, string> }], Root> = ({ images }) => {
  const normalizeSource = (source: string) => {
    try {
      return decodeURI(source)
    } catch {
      return source
    }
  }
  const verifiedSources = new Map(Object.entries(images).map(([source, image]) => [normalizeSource(source), image]))
  const verifiedImages = new Set(Object.values(images))
  const resolveImage = (source: string) => {
    const image = verifiedImages.has(source) ? source : verifiedSources.get(normalizeSource(source))
    if (!image?.startsWith('data:image/png;base64,')) throw new Error('Document contains an unverified image')
    return image
  }
  return (tree) => {
    const definitions = new Map<string, Definition>()
    visit(tree, 'definition', (node) => {
      definitions.set(node.identifier, node)
    })
    visit(tree, 'image', (node) => {
      node.url = resolveImage(node.url)
    })
    visit(tree, 'imageReference', (node, index, parent) => {
      const definition = definitions.get(node.identifier)
      if (!definition || !parent || index === undefined) throw new Error('Document contains an unresolved image')
      parent.children[index] = {
        type: 'image',
        url: resolveImage(definition.url),
        alt: node.alt,
        title: definition.title
      }
    })
  }
}

export function trackPrintHighlighting(plugin: CodeHighlighterPlugin) {
  let pending = 0
  let completed = 0
  const code: CodeHighlighterPlugin = {
    ...plugin,
    highlight(options, callback) {
      pending += 1
      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        pending -= 1
        completed += 1
      }
      const result = plugin.highlight(options, (highlighted) => {
        callback?.(highlighted)
        settle()
      })
      if (result) settle()
      return result
    }
  }
  return {
    code,
    isReady: (element: HTMLElement) =>
      pending === 0 && completed >= element.querySelectorAll('[data-streamdown="code-block"]').length
  }
}

export async function waitForPrintReady(element: HTMLElement, isHighlightingReady: () => boolean, signal: AbortSignal) {
  let revision = 0
  const observer = new MutationObserver(() => {
    revision += 1
  })
  observer.observe(element, { attributes: true, characterData: true, childList: true, subtree: true })
  const deadline = performance.now() + 25_000
  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  try {
    for (;;) {
      signal.throwIfAborted()
      if (performance.now() > deadline) throw new Error('Document rendering did not finish before the print deadline')
      await nextFrame()
      if (!isHighlightingReady()) continue
      const currentRevision = revision
      await Promise.all(Array.from(element.querySelectorAll('img'), (image) => image.decode()))
      await document.fonts.ready
      await nextFrame()
      await nextFrame()
      signal.throwIfAborted()
      if (isHighlightingReady() && currentRevision === revision) return
    }
  } finally {
    observer.disconnect()
  }
}
