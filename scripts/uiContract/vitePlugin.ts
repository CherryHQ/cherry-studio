import { resolve } from 'node:path'

import type { Plugin } from 'vite'

import { readRegistry, reconcileRegistry, registryIdMap, serializeRegistry } from './registry'
import { isUiSourceFile, scanUiSources, windowNameFromHtml } from './scan'
import { assertUniqueUiNodeIds, normalizeSourceFile, uiContractForDescriptor } from './semanticId'
import { transformHtml, transformJsx, UI_CONTRACT_RUNTIME_MODULE_ID } from './transform'
import { UI_CONTRACT_VERSION, type UiContractManifest, type UiContractManifestNode } from './types'

export interface UiContractPluginOptions {
  manifestFileName?: string
  root?: string
}

const RESOLVED_RUNTIME_MODULE_ID = `\0${UI_CONTRACT_RUNTIME_MODULE_ID}`

export function uiContractPlugin(options: UiContractPluginOptions = {}): Plugin {
  const root = resolve(options.root ?? process.cwd())
  const manifestFileName = options.manifestFileName ?? 'ui-contract.json'
  let command: 'build' | 'serve' = 'serve'
  let idByAnchor = new Map<string, string>()
  let warnedAboutProvisionalId = false
  const manifestNodes = new Map<string, UiContractManifestNode>()

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
    configResolved(config) {
      command = config.command
    },
    async buildStart() {
      manifestNodes.clear()
      const previous = await readRegistry(root)
      idByAnchor = registryIdMap(previous)
      if (command === 'serve') return

      const descriptors = await scanUiSources(root)
      const expected = reconcileRegistry(previous, descriptors)
      idByAnchor = registryIdMap(expected)

      if (serializeRegistry(previous) !== serializeRegistry(expected)) {
        this.error('UI contract registry is stale. Run `pnpm ui:contract:sync` and commit the result.')
      }
    },
    transform(source, id) {
      const file = id.split('?')[0]
      if (!isUiSourceFile(file) || !/\.(?:jsx|tsx)$/.test(file)) return null
      const sourceFile = normalizeSourceFile(root, file)
      if (sourceFile.startsWith('../')) return null

      const result = transformJsx(source, {
        contractForDescriptor: (descriptor) => {
          const id = idByAnchor.get(descriptor.anchorHash)
          if (id) return { id, semanticId: descriptor.semanticId }
          if (!warnedAboutProvisionalId) {
            this.warn('New UI nodes are using provisional IDs. Run `pnpm ui:contract:sync` before committing.')
            warnedAboutProvisionalId = true
          }
          return uiContractForDescriptor(descriptor)
        },
        sourceFile
      })
      for (const descriptor of result.descriptors) {
        const id = idByAnchor.get(descriptor.anchorHash) ?? uiContractForDescriptor(descriptor).id
        manifestNodes.set(descriptor.anchorHash, { ...descriptor, id })
      }
      return { code: result.code, map: result.map }
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (!context.filename) return html
        const sourceFile = normalizeSourceFile(root, context.filename)
        const result = transformHtml(html, {
          contractForDescriptor: (descriptor) => {
            const id = idByAnchor.get(descriptor.anchorHash)
            if (id) return { id, semanticId: descriptor.semanticId }
            if (!warnedAboutProvisionalId) {
              this.warn('New UI nodes are using provisional IDs. Run `pnpm ui:contract:sync` before committing.')
              warnedAboutProvisionalId = true
            }
            return uiContractForDescriptor(descriptor)
          },
          sourceFile,
          windowName: windowNameFromHtml(sourceFile)
        })
        for (const descriptor of result.descriptors) {
          const id = idByAnchor.get(descriptor.anchorHash) ?? uiContractForDescriptor(descriptor).id
          manifestNodes.set(descriptor.anchorHash, { ...descriptor, id })
        }
        return result.code
      }
    },
    generateBundle() {
      const nodes = [...manifestNodes.values()].sort((left, right) => left.id.localeCompare(right.id))
      assertUniqueUiNodeIds(nodes)
      const components = [...new Set(nodes.map((node) => node.component))].sort()
      const elements = [...new Set(nodes.map((node) => node.element))].sort()
      const semantics = [...new Set(nodes.map((node) => node.semanticId))].sort()
      const sources = [...new Set(nodes.map((node) => node.sourceFile))].sort()
      const componentIndex = new Map(components.map((value, index) => [value, index]))
      const elementIndex = new Map(elements.map((value, index) => [value, index]))
      const semanticIndex = new Map(semantics.map((value, index) => [value, index]))
      const sourceIndex = new Map(sources.map((value, index) => [value, index]))
      const manifest: UiContractManifest = {
        columns: ['id', 'semantic', 'element', 'source', 'offset', 'component', 'kind'],
        components,
        elements,
        nodes: nodes.map((node) => [
          node.id,
          semanticIndex.get(node.semanticId)!,
          elementIndex.get(node.element)!,
          sourceIndex.get(node.sourceFile)!,
          node.sourceOffset,
          componentIndex.get(node.component)!,
          node.kind === 'html' ? 0 : 1
        ]),
        semantics,
        sources,
        version: UI_CONTRACT_VERSION
      }
      this.emitFile({
        fileName: manifestFileName,
        source: JSON.stringify(manifest),
        type: 'asset'
      })
    }
  }
}
