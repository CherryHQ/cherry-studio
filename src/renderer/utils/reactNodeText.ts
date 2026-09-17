import { isValidElement, type ReactNode } from 'react'

/**
 * Concatenated text of a ReactNode tree. aria-hidden subtrees are excluded so
 * icon glyphs never leak into labels or content classification.
 */
export const getNodeText = (node: ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map(getNodeText).join('')
  }

  if (isValidElement<{ children?: ReactNode; 'aria-hidden'?: boolean | 'true' | 'false' }>(node)) {
    // Only the canonical hidden forms count; "false" is an explicit opt-out.
    if (node.props['aria-hidden'] === true || node.props['aria-hidden'] === 'true') {
      return ''
    }
    return getNodeText(node.props.children)
  }

  return ''
}
