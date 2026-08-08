import type { JSONContent } from '@tiptap/core'
import { Fragment, type Node as ProseMirrorNode, Slice } from '@tiptap/pm/model'

const IMAGE_NODE_TYPES = new Set(['image', 'imagePlaceholder'])

export function stripImageNodes(doc: JSONContent): { doc: JSONContent; removedImages: boolean } {
  let removedImages = false

  const stripNode = (node: JSONContent): JSONContent | null => {
    if (node.type && IMAGE_NODE_TYPES.has(node.type)) {
      removedImages = true
      return null
    }

    if (!node.content) return node

    return {
      ...node,
      content: node.content.map(stripNode).filter((child): child is JSONContent => child !== null)
    }
  }

  return { doc: stripNode(doc) ?? { type: 'doc', content: [] }, removedImages }
}

function stripImagesFromFragment(fragment: Fragment): { fragment: Fragment; removedImages: boolean } {
  const kept: ProseMirrorNode[] = []
  let removedImages = false

  fragment.forEach((node) => {
    if (IMAGE_NODE_TYPES.has(node.type.name)) {
      removedImages = true
      return
    }

    const child = stripImagesFromFragment(node.content)
    if (!child.removedImages) {
      kept.push(node)
      return
    }

    removedImages = true
    // Emptying a container whose content spec requires children (an image-only table cell) would
    // leave it invalid, so refill it with the minimum its own spec demands.
    const filler = node.type.contentMatch.fillBefore(child.fragment, true)
    kept.push(node.copy(filler ? filler.append(child.fragment) : child.fragment))
  })

  return { fragment: removedImages ? Fragment.fromArray(kept) : fragment, removedImages }
}

/**
 * Drop image nodes out of a pasted or dropped slice.
 *
 * `handlePaste` reads the clipboard itself, so it never sees ProseMirror's drop path: an external
 * drag builds its slice by parsing the drag event's `text/html`, and `EnhancedImage` stays in the
 * schema even when image insertion is off, so an `<img>` dragged in from a webpage would become a
 * real image node. Running this from `transformPasted` closes that path — and every paste that falls
 * through to ProseMirror's default handling — in one place.
 *
 * `transformPasted` also receives slices from *internal* drags, which ProseMirror performs as moves:
 * whatever this drops is deleted from the source position and never reinserted. That is only sound
 * while an images-off editor cannot hold an image in the first place — preserve that invariant if
 * you add a caller.
 */
export function stripImageNodesFromSlice(slice: Slice): Slice {
  const { fragment, removedImages } = stripImagesFromFragment(slice.content)
  if (!removedImages) return slice
  if (fragment.childCount === 0) return Slice.empty

  // `imagePlaceholder` is an atom but not a leaf, so a removed one may have contributed depth to
  // `openStart` / `openEnd`; clamp both to what the rebuilt fragment can actually carry.
  const maxOpen = Slice.maxOpen(fragment)
  return new Slice(fragment, Math.min(slice.openStart, maxOpen.openStart), Math.min(slice.openEnd, maxOpen.openEnd))
}

/**
 * Pick the inline content of a single-paragraph markdown parse.
 *
 * Used when pasting a single line into a non-empty block: parsing the clipboard markdown turns
 * markers like `**bold**` / `[text](url)` into real marks rather than literal text (which the
 * serializer would later escape), and returning only the paragraph's inline children lets the caller
 * splice them in without wrapping the paste in a new block.
 *
 * Returns null for anything that is not a lone paragraph (a heading / list / blockquote line, or an
 * empty parse) so the caller can fall back to inserting the raw text verbatim.
 */
export function pickInlinePasteContent(doc: JSONContent | undefined): JSONContent[] | null {
  const blocks = doc?.content
  if (blocks?.length === 1 && blocks[0].type === 'paragraph' && blocks[0].content?.length) {
    return blocks[0].content
  }
  return null
}
