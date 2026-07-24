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
import { Children, cloneElement, forwardRef, Fragment, isValidElement, useMemo, useRef } from 'react'
import { mergeDataUi } from ${JSON.stringify(runtimePath)}
export { mergeDataUi, mergeUiProps } from ${JSON.stringify(runtimePath)}

function setForwardedRef(ref, node) {
  if (typeof ref === 'function') return ref(node)
  if (ref !== null && ref !== undefined) ref.current = node
}

// Verbatim Radix Slot semantics (@radix-ui/react-slot mergeProps/getElementRef),
// inlined so this wrapper can merge slot props itself — see UiDataSlot comment.
function mergeSlotProps(slotProps, childProps) {
  const overrideProps = { ...childProps }
  for (const propName in childProps) {
    const slotPropValue = slotProps[propName]
    const childPropValue = childProps[propName]
    if (/^on[A-Z]/.test(propName)) {
      if (slotPropValue && childPropValue) {
        overrideProps[propName] = (...args) => {
          const result = childPropValue(...args)
          slotPropValue(...args)
          return result
        }
      } else if (slotPropValue) {
        overrideProps[propName] = slotPropValue
      }
    } else if (propName === 'style') {
      overrideProps[propName] = { ...slotPropValue, ...childPropValue }
    } else if (propName === 'className') {
      overrideProps[propName] = [slotPropValue, childPropValue].filter(Boolean).join(' ')
    }
  }
  return { ...slotProps, ...overrideProps }
}

function getElementRef(element) {
  let getter = Object.getOwnPropertyDescriptor(element.props, 'ref')?.get
  let mayWarn = getter && 'isReactWarning' in getter && getter.isReactWarning
  if (mayWarn) return element.ref
  getter = Object.getOwnPropertyDescriptor(element, 'ref')?.get
  mayWarn = getter && 'isReactWarning' in getter && getter.isReactWarning
  if (mayWarn) return element.props.ref
  return element.props.ref || element.ref
}

export const UiDataSlot = forwardRef(function UiDataSlot(props, ref) {
  const { children, ...slotProps } = props
  // React 19 detaches and re-attaches a DOM ref whenever its callback identity
  // changes. An enclosing Radix SlotClone recreates its composed ref on every
  // render, and a state-setter ref in that chain (e.g. Radix PopperAnchor's)
  // then pulses null/node; during interrupted mounts the pulses can land in
  // separate commits and self-sustain until "Maximum update depth exceeded"
  // (reproduced via the agent composer toolbar tooltips). Delegating to another
  // Slot would rebuild the leaf's composed ref each render, so this wrapper
  // merges slot props itself and hands the leaf ONE pinned ref identity that
  // reads the latest targets at attach time.
  const latest = useRef({ forwarded: undefined, child: undefined })
  latest.current.forwarded = ref
  const stableRef = useMemo(() => {
    return (node) => {
      const refs = [latest.current.forwarded, latest.current.child]
      let hasCleanup = false
      const cleanups = refs.map((target) => {
        const cleanup = setForwardedRef(target, node)
        if (!hasCleanup && typeof cleanup === 'function') hasCleanup = true
        return cleanup
      })
      if (hasCleanup) {
        return () => {
          for (let i = 0; i < cleanups.length; i++) {
            const cleanup = cleanups[i]
            if (typeof cleanup === 'function') cleanup()
            else setForwardedRef(refs[i], null)
          }
        }
      }
    }
  }, [])
  // Dynamic asChild={false} renders this wrapper without cloned props. Active
  // slot implementations may forward behavior props without forwarding data-ui.
  if (Object.keys(slotProps).length === 0 && ref == null) return children
  const slotDataUi = typeof slotProps['data-ui'] === 'string' ? slotProps['data-ui'] : ''
  if (Children.count(children) !== 1 || !isValidElement(children)) return null
  const child = children

  const childDataUi = typeof child.props['data-ui'] === 'string' ? child.props['data-ui'] : ''
  const dataUi = mergeDataUi(childDataUi, slotDataUi)
  latest.current.child = getElementRef(child)
  const mergedProps = mergeSlotProps(slotProps, child.props)
  mergedProps['data-ui'] = dataUi
  if (child.type !== Fragment) mergedProps.ref = stableRef
  return cloneElement(child, mergedProps)
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
