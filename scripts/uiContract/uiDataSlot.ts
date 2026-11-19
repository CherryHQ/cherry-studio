import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type ReactPortal,
  type Ref,
  useMemo,
  useRef
} from 'react'

import { mergeDataUi } from './runtime'

type AnyProps = Record<string, unknown>
type RefTarget = Ref<unknown> | null | undefined

// Match React event callback variance while retaining the callback's result.
type SlotHandler<Result> = { invoke(...args: unknown[]): Result }['invoke']
type SlotProps<Result> = AnyProps & {
  [Name in `on${Capitalize<string>}`]?: SlotHandler<Result>
}
type UiDataSlotProps<Result> = SlotProps<Result> & {
  children?: ReactElement<SlotProps<Result>> | ReactPortal | Exclude<ReactNode, ReactElement>
  ref?: RefTarget
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- React asChild refs may hold DOM nodes or custom imperative handles; forward the opaque instance and preserve cleanup semantics.
function setForwardedRef(ref: RefTarget, node: unknown): void | (() => void) {
  if (typeof ref === 'function') return ref(node)
  if (ref !== null && ref !== undefined) ref.current = node
  return undefined
}

/**
 * Verbatim Radix Slot semantics (@radix-ui/react-slot mergeProps), inlined so
 * UiDataSlot can merge slot props itself — see the UiDataSlot comment.
 */
function mergeSlotProps<Result>(slotProps: SlotProps<Result>, childProps: SlotProps<Result>): SlotProps<Result> {
  const overrideProps: SlotProps<Result> = { ...childProps }
  for (const propName in childProps) {
    const slotPropValue = slotProps[propName]
    const childPropValue = childProps[propName]
    if (/^on[A-Z]/.test(propName)) {
      if (slotPropValue && childPropValue) {
        overrideProps[propName] = (...args: unknown[]) => {
          // SAFETY: matching event keys carry the child callback declared by the input props.
          const result = (childPropValue as SlotHandler<Result>)(...args)
          // SAFETY: the slot callback follows the same declared event-result contract.
          ;(slotPropValue as SlotHandler<Result>)(...args)
          return result
        }
      } else if (slotPropValue) {
        overrideProps[propName] = slotPropValue
      }
    } else if (propName === 'style') {
      overrideProps[propName] = { ...(slotPropValue as object), ...(childPropValue as object) }
    } else if (propName === 'className') {
      overrideProps[propName] = [slotPropValue, childPropValue].filter(Boolean).join(' ')
    }
  }
  return { ...slotProps, ...overrideProps }
}

/** Verbatim Radix Slot semantics (@radix-ui/react-slot getElementRef). */
function getElementRef(element: ReactElement): RefTarget {
  const props = element.props as AnyProps
  let getter = Object.getOwnPropertyDescriptor(props, 'ref')?.get
  let mayWarn = getter && 'isReactWarning' in getter && getter.isReactWarning
  if (mayWarn) return (element as unknown as { ref?: RefTarget }).ref
  getter = Object.getOwnPropertyDescriptor(element, 'ref')?.get
  mayWarn = getter && 'isReactWarning' in getter && getter.isReactWarning
  if (mayWarn) return props.ref as RefTarget
  return (props.ref as RefTarget) || (element as unknown as { ref?: RefTarget }).ref
}

/**
 * Slot wrapper injected around dynamic `asChild` children to forward `data-ui`
 * without changing slot behavior.
 *
 * React 19 detaches and re-attaches a DOM ref whenever its callback identity
 * changes. An enclosing Radix SlotClone recreates its composed ref on every
 * render, and a state-setter ref in that chain (e.g. Radix PopperAnchor's)
 * then pulses null/node; during interrupted mounts the pulses can land in
 * separate commits and self-sustain until "Maximum update depth exceeded"
 * (reproduced via the agent composer toolbar tooltips). Delegating to another
 * Slot would rebuild the leaf's composed ref each render, so this wrapper
 * merges slot props itself and hands the leaf ONE pinned ref identity that
 * reads the latest targets at attach time.
 */
export function UiDataSlot<Result>({ ref, children, ...slotProps }: UiDataSlotProps<Result>): ReactNode {
  const latest = useRef<{ forwarded: RefTarget; child: RefTarget }>({ forwarded: undefined, child: undefined })
  latest.current.forwarded = ref
  const stableRef = useMemo(() => {
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The cloned child's React ref owns the instance type; this stable callback transparently forwards it to both captured targets.
    return (node: unknown) => {
      const refs = [latest.current.forwarded, latest.current.child]
      let hasCleanup = false
      const cleanups = refs.map((target) => {
        const cleanup = setForwardedRef(target, node)
        if (!hasCleanup && typeof cleanup === 'function') hasCleanup = true
        return cleanup
      })
      if (hasCleanup) {
        return () => {
          for (let index = 0; index < cleanups.length; index += 1) {
            const cleanup = cleanups[index]
            if (typeof cleanup === 'function') cleanup()
            else setForwardedRef(refs[index], null)
          }
        }
      }
      return undefined
    }
  }, [])
  // Dynamic asChild={false} renders this wrapper without cloned props. Active
  // slot implementations may forward behavior props without forwarding data-ui.
  if (Object.keys(slotProps).length === 0 && ref == null) return children
  const slotDataUi = typeof slotProps['data-ui'] === 'string' ? slotProps['data-ui'] : ''
  // eslint-disable-next-line @eslint-react/no-children-count -- a slot must validate its single child, like Radix's Slot.
  if (Children.count(children) !== 1 || !isValidElement(children)) {
    // Verbatim Radix Slot semantics: empty children render as-is; anything else
    // that cannot slot is an authoring error and must throw, never vanish.
    if (children || children === 0) {
      throw new Error('UiDataSlot failed to slot onto its children. Expected a single React element child.')
    }
    return children
  }
  const child = children

  // SAFETY: the validated element is the child accepted by this component's typed props.
  const childProps = child.props as SlotProps<Result>
  const childDataUi = typeof childProps['data-ui'] === 'string' ? childProps['data-ui'] : ''
  const dataUi = mergeDataUi(childDataUi, slotDataUi)
  latest.current.child = getElementRef(child)
  const mergedProps = mergeSlotProps(slotProps, childProps)
  mergedProps['data-ui'] = dataUi
  if (child.type !== Fragment) mergedProps.ref = stableRef
  // eslint-disable-next-line @eslint-react/no-clone-element -- merging props onto the child element is the point of a slot, like Radix's SlotClone.
  return cloneElement(child, mergedProps)
}
