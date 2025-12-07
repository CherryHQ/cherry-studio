import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

/**
 * Resolves relative image paths to absolute file:// URLs dynamically during rendering
 * This keeps markdown files portable while allowing proper image display
 */
export const RelativeImageResolver = Extension.create({
  name: 'relativeImageResolver',

  addOptions() {
    return {
      // Current markdown file path for resolving relative paths
      currentFilePath: undefined as string | undefined
    }
  },

  addProseMirrorPlugins() {
    const { currentFilePath } = this.options

    if (!currentFilePath) {
      return []
    }

    return [
      new Plugin({
        // Apply view plugin for post-render processing
        view(view) {
          const resolveImages = () => {
            const dom = view.dom
            const images = dom.querySelectorAll('img[src]')

            images.forEach((img) => {
              if (img instanceof HTMLImageElement) {
                const src = img.getAttribute('src')
                if (src && isRelativePath(src)) {
                  const resolvedSrc = resolveRelativePath(src, currentFilePath)
                  img.setAttribute('src', resolvedSrc)
                }
              }
            })
          }

          // Initial resolution
          setTimeout(resolveImages, 0)

          // Set up a mutation observer to handle dynamically added images
          const observer = new MutationObserver((mutations) => {
            let shouldResolve = false
            for (const mutation of mutations) {
              if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                // Check if any added nodes contain images
                for (const node of mutation.addedNodes) {
                  if (node.nodeType === Node.ELEMENT_NODE) {
                    const element = node as Element
                    if (element.tagName === 'IMG' || element.querySelector('img')) {
                      shouldResolve = true
                      break
                    }
                  }
                }
              }
            }
            if (shouldResolve) {
              setTimeout(resolveImages, 0)
            }
          })

          observer.observe(view.dom, {
            childList: true,
            subtree: true
          })

          return {
            destroy: () => {
              observer.disconnect()
            }
          }
        }
      })
    ]
  }
})

/**
 * Checks if a path is relative (not starting with http://, https://, file://, or /)
 */
function isRelativePath(path: string): boolean {
  return !path.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//) && !path.startsWith('/')
}

/**
 * Resolves a relative path against a base directory to create an absolute file:// URL
 */
function resolveRelativePath(relativePath: string, baseFilePath: string): string {
  // Remove any './' prefix and normalize path separators
  const normalizedRelative = relativePath.replace(/^\.\//, '').replace(/\\/g, '/')

  // Get the directory of the current file
  const baseDirectory = baseFilePath ? baseFilePath.substring(0, baseFilePath.lastIndexOf('/')) : ''

  if (!baseDirectory) {
    return relativePath
  }

  // Combine base directory with relative path
  const combinedPath = baseDirectory + '/' + normalizedRelative

  // Handle '..' segments
  const pathSegments = combinedPath.split('/')
  const resolvedSegments: string[] = []

  for (const segment of pathSegments) {
    if (segment === '..') {
      resolvedSegments.pop() // Remove the previous segment
    } else if (segment !== '') {
      resolvedSegments.push(segment)
    }
  }

  // Reconstruct the path
  const resolvedPath = '/' + resolvedSegments.join('/')

  // Convert to file:// URL with proper URL encoding
  const encodedPath = encodeURI(resolvedPath)
  return 'file://' + encodedPath
}
