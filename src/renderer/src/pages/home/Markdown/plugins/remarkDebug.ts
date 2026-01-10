import type { Root } from 'mdast'
import type { Plugin } from 'unified'

/**
 * Custom remark plugin for debugging markdown syntax tree
 *
 * This plugin logs the processed markdown AST (Abstract Syntax Tree) to the console
 * for debugging purposes. It's designed to be used only in development environment.
 *
 * @example
 * ```typescript
 * // Add to remark plugins array
 * remarkPlugins.push(remarkDebug())
 *
 * // With custom options
 * remarkPlugins.push(remarkDebug({
 *   label: 'Custom Debug',
 *   detailed: true
 * }))
 * ```
 */

interface RemarkDebugOptions {
  /**
   * Custom label for the debug output
   * @default "Markdown 语法树调试信息"
   */
  label?: string
  /**
   * Whether to show detailed node information
   * @default true
   */
  detailed?: boolean
  /**
   * Whether to show node positions
   * @default false
   */
  showPositions?: boolean
}

/**
 * Remark plugin to debug markdown syntax tree
 * @param options - Debug options
 * @returns A remark plugin function
 */
function remarkDebug(options: RemarkDebugOptions = {}): Plugin<[], Root, Root> {
  const { label = 'Markdown 语法树调试信息', detailed = true, showPositions = false } = options

  return function () {
    return function (tree: Root) {
      // Only log in development environment
      if (process.env.NODE_ENV === 'development') {
        console.group(`🌳 ${label}`)

        if (detailed) {
          // Create a clean copy of the tree for logging
          const cleanTree = showPositions
            ? tree
            : JSON.parse(
                JSON.stringify(tree, (key, value) => {
                  // Remove position data to make output cleaner unless explicitly requested
                  if (key === 'position') return undefined
                  return value
                })
              )

          console.debug('处理后的语法树:', cleanTree)
          console.debug('节点数量:', countNodes(tree))
          console.debug('树的深度:', getTreeDepth(tree))
        } else {
          console.debug('语法树类型:', tree.type)
          console.debug('子节点数量:', tree.children?.length || 0)
        }

        console.groupEnd()
      }

      return tree
    }
  }
}

/**
 * Count total number of nodes in the tree
 */
function countNodes(node: any): number {
  let count = 1
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child)
    }
  }
  return count
}

/**
 * Calculate the maximum depth of the tree
 */
function getTreeDepth(node: any, currentDepth = 0): number {
  if (!node.children || node.children.length === 0) {
    return currentDepth
  }

  let maxDepth = currentDepth
  for (const child of node.children) {
    const depth = getTreeDepth(child, currentDepth + 1)
    maxDepth = Math.max(maxDepth, depth)
  }

  return maxDepth
}

export default remarkDebug
