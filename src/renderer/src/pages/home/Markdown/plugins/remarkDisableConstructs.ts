import type { Plugin } from 'unified'

/**
 * Custom remark plugin to disable specific markdown constructs
 *
 * This plugin allows you to disable specific markdown constructs by passing
 * them as micromark extensions to the underlying parser.
 *
 * @see https://github.com/micromark/micromark
 *
 * @example
 * ```typescript
 * // Disable indented code blocks
 * remarkDisableConstructs(['codeIndented'])
 *
 * // Disable multiple constructs
 * remarkDisableConstructs(['codeIndented', 'autolink', 'htmlFlow'])
 * ```
 */

/**
 * Helper function to add values to plugin data
 * @param data - The plugin data object
 * @param field - The field name to add to
 * @param value - The value to add
 */
function add(data: any, field: string, value: unknown): void {
  const list = data[field] ? data[field] : (data[field] = [])
  list.push(value)
}

/**
 * Remark plugin to disable specific markdown constructs
 * @param constructs - Array of construct names to disable (e.g., ['codeIndented', 'autolink'])
 * @returns A remark plugin function
 */
function remarkDisableConstructs(constructs: string[] = []): Plugin<[], any, any> {
  return function () {
    const data = this.data()

    if (constructs.length > 0) {
      const disableExtension = {
        disable: {
          null: constructs
        }
      }

      add(data, 'micromarkExtensions', disableExtension)
    }
  }
}

export default remarkDisableConstructs
