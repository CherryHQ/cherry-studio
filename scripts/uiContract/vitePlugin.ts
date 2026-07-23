import { resolve } from 'node:path'

import type { Plugin } from 'vite'

import { isUiSourceFile, windowNameFromHtml } from './scan'
import { normalizeSourceFile } from './semanticId'
import { transformHtml, transformJsx, UI_CONTRACT_RUNTIME_MODULE_ID } from './transform'

export interface UiContractPluginOptions {
  root?: string
}

const RESOLVED_RUNTIME_MODULE_ID = `\0${UI_CONTRACT_RUNTIME_MODULE_ID}`

export function uiContractPlugin(options: UiContractPluginOptions = {}): Plugin {
  const root = resolve(options.root ?? process.cwd())

  return {
    name: 'cherry-ui-contract',
    enforce: 'pre',
    resolveId(id) {
      return id === UI_CONTRACT_RUNTIME_MODULE_ID ? RESOLVED_RUNTIME_MODULE_ID : null
    },
    load(id) {
      if (id !== RESOLVED_RUNTIME_MODULE_ID) return null
      const runtimePath = resolve(root, 'scripts/uiContract/runtime.ts')
      return `
import { Slot } from '@radix-ui/react-slot'
import { Children, cloneElement, createElement, forwardRef, isValidElement } from 'react'
import { mergeDataUi } from ${JSON.stringify(runtimePath)}
export { mergeDataUi, mergeUiProps } from ${JSON.stringify(runtimePath)}

export const UiDataSlot = forwardRef(function UiDataSlot(props, ref) {
  const { children, ...slotProps } = props
  // Dynamic asChild={false} renders this wrapper without cloned props. Active
  // slot implementations may forward behavior props without forwarding data-ui.
  if (Object.keys(slotProps).length === 0 && ref == null) return children
  const slotDataUi = typeof slotProps['data-ui'] === 'string' ? slotProps['data-ui'] : ''
  if (Children.count(children) !== 1 || !isValidElement(children)) return null
  const child = children

  const childDataUi = typeof child.props['data-ui'] === 'string' ? child.props['data-ui'] : ''
  const dataUi = mergeDataUi(childDataUi, slotDataUi)
  const mergedChild = cloneElement(child, { 'data-ui': dataUi })
  return createElement(Slot, { ...slotProps, ref }, mergedChild)
})
`
    },
    transform(source, id) {
      const file = id.split('?')[0]
      if (!isUiSourceFile(file) || !/\.(?:jsx|tsx)$/.test(file)) return null
      const sourceFile = normalizeSourceFile(root, file)
      if (sourceFile.startsWith('../')) return null

      const result = transformJsx(source, {
        injectDataUi: true,
        sourceFile
      })
      return { code: result.code, map: result.map }
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (!context.filename) return html
        const sourceFile = normalizeSourceFile(root, context.filename)
        const result = transformHtml(html, {
          injectDataUi: true,
          sourceFile,
          windowName: windowNameFromHtml(sourceFile)
        })
        return result.code
      }
    }
  }
}
