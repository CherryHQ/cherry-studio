import { mergeAttributes } from '@tiptap/core'
import Link from '@tiptap/extension-link'
import type { MarkType, ResolvedPos } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

// Plugin to handle hover interactions
const linkHoverPlugin = new PluginKey('linkHover')

// Plugin to auto-update empty href links
const linkAutoUpdatePlugin = new PluginKey('linkAutoUpdate')

// Helper function to get the range of a mark at a given position
function getMarkRange($pos: ResolvedPos, markType: MarkType, attrs?: any): { from: number; to: number } | null {
  const { doc } = $pos
  let foundRange: { from: number; to: number } | null = null

  doc.descendants((node, pos) => {
    if (node.isText && node.marks) {
      for (const mark of node.marks) {
        if (mark.type === markType && (!attrs || Object.keys(attrs).every((key) => mark.attrs[key] === attrs[key]))) {
          const from = pos
          const to = pos + node.nodeSize

          // Check if our target position is within this range
          if ($pos.pos >= from && $pos.pos < to) {
            foundRange = { from, to }
            return false // Stop searching
          }
        }
      }
    }
    return true // Continue searching
  })

  return foundRange
}

interface LinkHoverPluginOptions {
  onLinkHover?: (
    attrs: { href: string; text: string; title?: string },
    position: DOMRect,
    element: HTMLElement,
    linkRange?: { from: number; to: number }
  ) => void
  onLinkHoverEnd?: () => void
  editable?: boolean
  hoverDelay?: number
}

const createLinkHoverPlugin = (options: LinkHoverPluginOptions) => {
  let hoverTimeout: NodeJS.Timeout | null = null
  const hoverDelay = options.hoverDelay ?? 500 // Default 500ms delay

  const calculateSmartPosition = (rect: DOMRect): DOMRect => {
    const viewportHeight = window.innerHeight
    const editorOffset = 200 // Approximate height of link editor popup

    const isNearBottom = rect.bottom > viewportHeight - editorOffset

    if (isNearBottom) {
      const adjustedRect = new DOMRect(
        rect.left, // x
        rect.top - editorOffset, // y (position above the link)
        rect.width, // width
        rect.height // height
      )
      return adjustedRect
    }
    return rect
  }

  return new Plugin({
    key: linkHoverPlugin,
    props: {
      handleDOMEvents: {
        mouseover: (view, event) => {
          // Don't process hover if not editable
          if (!options.editable) return false

          const target = event.target as HTMLElement
          const linkElement = target.closest('a[href]') as HTMLAnchorElement

          if (linkElement) {
            // Clear any existing timeout
            if (hoverTimeout) {
              clearTimeout(hoverTimeout)
            }

            // Set up delayed hover
            hoverTimeout = setTimeout(() => {
              const href = linkElement.getAttribute('href') || ''
              const text = linkElement.textContent || ''
              const title = linkElement.getAttribute('title') || ''

              // Use ProseMirror's built-in method to get position from DOM
              let linkRange: { from: number; to: number } | undefined
              let linkRect = linkElement.getBoundingClientRect()

              try {
                // Get the mouse position relative to the editor
                const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })

                if (coords) {
                  const pos = coords.pos
                  const $pos = view.state.doc.resolve(pos)

                  // Find the link mark at this position
                  const linkMark = $pos
                    .marks()
                    .find(
                      (mark) =>
                        (mark.type.name === 'enhancedLink' || mark.type.name === 'link') && mark.attrs.href === href
                    )

                  if (linkMark) {
                    // Use ProseMirror's mark range finding
                    const range = getMarkRange($pos, linkMark.type, linkMark.attrs)
                    if (range) {
                      linkRange = range

                      // Check if this is near the end of the document
                      const docSize = view.state.doc.content.size
                      const isNearDocEnd = range.to >= docSize - 10 // Within 10 characters of doc end

                      if (isNearDocEnd) {
                        // For links near document end, prefer DOM positioning over ProseMirror coords
                        // as ProseMirror coords can be inaccurate at document boundaries
                        const newLinkRect = linkElement.getBoundingClientRect()

                        linkRect = newLinkRect
                      } else {
                        // Calculate the position based on the entire link range for other cases
                        try {
                          const startCoords = view.coordsAtPos(range.from)
                          const endCoords = view.coordsAtPos(range.to)
                          // Use the full range for positioning
                          linkRect = new DOMRect(
                            startCoords.left,
                            startCoords.top,
                            endCoords.right - startCoords.left,
                            Math.max(endCoords.bottom - startCoords.top, 16)
                          )
                        } catch (coordsError) {
                          linkRect = linkElement.getBoundingClientRect()
                        }
                      }
                    }
                  }
                }

                // Fallback: Use DOM positioning
                if (!linkRange) {
                  const startPos = view.posAtDOM(linkElement, 0)
                  if (startPos >= 0) {
                    const $pos = view.state.doc.resolve(startPos)
                    const linkMark = $pos
                      .marks()
                      .find(
                        (mark) =>
                          (mark.type.name === 'enhancedLink' || mark.type.name === 'link') && mark.attrs.href === href
                      )

                    if (linkMark) {
                      const range = getMarkRange($pos, linkMark.type, linkMark.attrs)
                      if (range) {
                        linkRange = range
                      }
                    }
                  }
                }

                // Final fallback
                if (!linkRange && text) {
                  const pos = view.posAtDOM(linkElement, 0)
                  if (pos >= 0) {
                    linkRange = { from: pos, to: pos + text.length }
                  }
                }
              } catch (e) {
                // Ultimate fallback
                const pos = view.posAtDOM(linkElement, 0)
                if (pos >= 0 && text) {
                  linkRange = { from: pos, to: pos + text.length }
                }
              }

              const smartRect = calculateSmartPosition(linkRect)
              options.onLinkHover?.({ href, text, title }, smartRect, linkElement, linkRange)
              hoverTimeout = null
            }, hoverDelay)
          }

          return false
        },
        mouseout: (_, event) => {
          const target = event.target as HTMLElement
          const linkElement = target.closest('a[href]')

          if (linkElement) {
            // Clear hover timeout if leaving the link
            if (hoverTimeout) {
              clearTimeout(hoverTimeout)
              hoverTimeout = null
            }

            // Check if we're still within the link or moving to the popup
            const relatedTarget = event.relatedTarget as HTMLElement
            const isMovingToPopup = relatedTarget?.closest('[data-link-editor]')
            const isStillInLink = relatedTarget?.closest('a[href]') === linkElement

            if (!isMovingToPopup && !isStillInLink) {
              options.onLinkHoverEnd?.()
            }
          }

          return false
        }
      }
    }
  })
}

// Plugin to automatically update empty href with text content
const createLinkAutoUpdatePlugin = () => {
  return new Plugin({
    key: linkAutoUpdatePlugin,
    appendTransaction: (transactions, _oldState, newState) => {
      let tr = newState.tr
      let hasUpdates = false

      // Only process if there were actual document changes
      const hasDocChanges = transactions.some((transaction) => transaction.docChanged)
      if (!hasDocChanges) return null

      newState.doc.descendants((node, pos) => {
        if (node.isText && node.marks) {
          node.marks.forEach((mark) => {
            if (mark.type.name === 'enhancedLink') {
              const text = node.text || ''
              const currentHref = mark.attrs.href || ''

              if (text.trim()) {
                // Determine what the href should be based on the text
                let expectedHref = text.trim()
                if (
                  !expectedHref.startsWith('http://') &&
                  !expectedHref.startsWith('https://') &&
                  !expectedHref.startsWith('mailto:') &&
                  !expectedHref.startsWith('tel:')
                ) {
                  // Only add https:// if it looks like a domain (contains a dot)
                  if (expectedHref.includes('.')) {
                    expectedHref = `https://${expectedHref}`
                  }
                }

                // Only update if the current href doesn't match what it should be
                // and if the current href looks like it was auto-generated (either empty or matches a previous text state)
                const shouldUpdate =
                  currentHref !== expectedHref &&
                  (currentHref === '' || // Empty href
                    currentHref === text.trim() || // Href matches text without protocol
                    currentHref === `https://${text.trim()}` || // Href matches text with https
                    text.trim().startsWith(currentHref.replace(/^https?:\/\//, ''))) // Text is an extension of current href

                if (shouldUpdate) {
                  // Update the mark with the new href
                  tr = tr.removeMark(pos, pos + node.nodeSize, mark.type)
                  tr = tr.addMark(pos, pos + node.nodeSize, mark.type.create({ ...mark.attrs, href: expectedHref }))
                  hasUpdates = true
                }
              }
            }
          })
        }
      })

      return hasUpdates ? tr : null
    }
  })
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    enhancedLink: {
      setEnhancedLink: (attributes: { href: string; title?: string }) => ReturnType
      toggleEnhancedLink: (attributes: { href: string; title?: string }) => ReturnType
      unsetEnhancedLink: () => ReturnType
      updateLinkText: (text: string) => ReturnType
    }
  }
}

export interface EnhancedLinkOptions {
  onLinkHover?: (
    attrs: { href: string; text: string; title?: string },
    position: DOMRect,
    element: HTMLElement,
    linkRange?: { from: number; to: number }
  ) => void
  onLinkHoverEnd?: () => void
  editable?: boolean
  hoverDelay?: number
}

export const EnhancedLink = Link.extend<EnhancedLinkOptions>({
  name: 'enhancedLink',

  addOptions() {
    return {
      ...this.parent?.(),
      protocols: ['http', 'https', 'mailto', 'tel'],
      openOnClick: true,
      onLinkHover: undefined,
      onLinkHoverEnd: undefined,
      editable: true,
      hoverDelay: 500
    }
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setEnhancedLink:
        (attributes) =>
        ({ commands }) => {
          return commands.setLink(attributes)
        },
      toggleEnhancedLink:
        (attributes) =>
        ({ commands }) => {
          return commands.toggleLink(attributes)
        },
      unsetEnhancedLink:
        () =>
        ({ commands }) => {
          return commands.unsetLink()
        },
      updateLinkText:
        (text: string) =>
        ({ tr, state, dispatch }) => {
          const { selection } = state
          const { from, to } = selection

          if (dispatch) {
            tr.insertText(text, from, to)
          }

          return true
        }
    }
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() || []),
      createLinkHoverPlugin({
        onLinkHover: this.options.onLinkHover,
        onLinkHoverEnd: this.options.onLinkHoverEnd,
        editable: this.options.editable,
        hoverDelay: this.options.hoverDelay
      }),
      createLinkAutoUpdatePlugin()
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        class: 'rich-editor-link'
      }),
      0
    ]
  },

  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: (element) => element.getAttribute('href'),
        renderHTML: (attributes) => {
          if (!attributes.href) {
            return {}
          }
          return {
            href: attributes.href
          }
        }
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute('title'),
        renderHTML: (attributes) => {
          if (!attributes.title) {
            return {}
          }
          return {
            title: attributes.title
          }
        }
      }
    }
  }
})
