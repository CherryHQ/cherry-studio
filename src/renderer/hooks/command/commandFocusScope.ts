import { createContext } from 'react'

import { RENDERER_COMMAND_TARGETS } from '@renderer/utils/command'
import type { ContextReader, ContextValue } from '@shared/types/command'
import type { CommandId } from '@shared/utils/command'

import type { CommandHandler, CommandHandlerOptions, CommandHandlerSource, CommandRuntime } from './useCommandRuntime'

interface HandlerEntry {
  handler: CommandHandlerSource
  options: CommandHandlerOptions
}

export interface FocusScopeOptions {
  element: () => HTMLElement | null
  active: () => boolean
  context: () => Readonly<Record<string, ContextValue>>
  boundary?: boolean
  kind?: 'tab'
}

export class CommandFocusScopeState {
  readonly handlers = new Map<CommandId, HandlerEntry[]>()
  readonly values = new Map<string, { value: ContextValue }[]>()
  mounted = true
  private version = 0
  private readonly listeners = new Set<() => void>()

  readonly getVersion = (): number => this.version + (this.parent?.getVersion() ?? 0)
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    const unsubscribeParent = this.parent?.subscribe(listener)
    return () => {
      this.listeners.delete(listener)
      unsubscribeParent?.()
    }
  }

  publish(): void {
    this.version++
    for (const listener of this.listeners) listener()
    this.parent?.publish()
  }

  constructor(
    readonly parent: CommandFocusScopeState | null,
    readonly options: FocusScopeOptions,
    readonly owner: CommandFocusScopeState | null = parent
  ) {}

  isActive(): boolean {
    return this.mounted && this.options.active() && (!this.owner || this.owner.isActive())
  }

  registerHandler(command: CommandId, handler: CommandHandlerSource, options: CommandHandlerOptions = {}): () => void {
    const entries = this.handlers.get(command) ?? []
    const entry = { handler, options }
    entries.push(entry)
    this.handlers.set(command, entries)
    this.publish()
    return () => {
      const remaining = (this.handlers.get(command) ?? []).filter((candidate) => candidate !== entry)
      if (remaining.length) this.handlers.set(command, remaining)
      else this.handlers.delete(command)
      this.publish()
    }
  }

  registerContext(key: string, value: ContextValue): () => void {
    const entries = this.values.get(key) ?? []
    const entry = { value }
    entries.push(entry)
    this.values.set(key, entries)
    this.publish()
    return () => {
      const index = entries.indexOf(entry)
      if (index >= 0) entries.splice(index, 1)
      if (!entries.length) this.values.delete(key)
      this.publish()
    }
  }
}

export function readRegisteredHandler(entry: HandlerEntry): CommandHandler {
  return typeof entry.handler === 'function' ? entry.handler : entry.handler.current
}

export interface CommandInvocation {
  command: CommandId
  owner: CommandFocusScopeState
  entry: HandlerEntry
  handler: CommandHandler
}

function isHandlerEnabled(entry: HandlerEntry): boolean {
  const enabled = entry.options.enabled
  return typeof enabled === 'function' ? enabled() : enabled !== false
}

export function isCommandInvocationActive(invocation: CommandInvocation): boolean {
  const { command, owner, entry } = invocation
  return owner.isActive() && Boolean(owner.handlers.get(command)?.includes(entry)) && isHandlerEnabled(entry)
}

function tabOwner(scope: CommandFocusScopeState): CommandFocusScopeState | undefined {
  for (let current: CommandFocusScopeState | null = scope; current; current = current.owner) {
    if (current.options.kind === 'tab') return current
  }
  return undefined
}

function keyboardBoundary(scope: CommandFocusScopeState): CommandFocusScopeState | undefined {
  for (let current: CommandFocusScopeState | null = scope; current; current = current.parent) {
    if (current.options.boundary) return current
  }
  return undefined
}

export function readScopeContext(scope: CommandFocusScopeState | null, base: ContextReader): ContextReader {
  return (key) => {
    for (let current = scope; current; current = current.parent) {
      const entries = current.values.get(key)
      if (entries?.length) return entries.at(-1)?.value
      const context = current.options.context()
      if (Object.hasOwn(context, key)) return context[key]
    }
    if (typeof base === 'function') return base(key)
    return base instanceof Map ? base.get(key) : Reflect.get(base, key)
  }
}

export class CommandFocusRegistry {
  readonly roots = new WeakMap<HTMLElement, CommandFocusScopeState>()
  private readonly scopes = new Set<CommandFocusScopeState>()

  resolveInvocation(
    origin: CommandFocusScopeState,
    root: CommandFocusScopeState,
    command: CommandId,
    trigger: 'keyboard' | 'explicit' = 'explicit'
  ): CommandInvocation | undefined {
    if (!origin.isActive()) return undefined
    const policy = RENDERER_COMMAND_TARGETS.get(command)
    if (!policy) return undefined
    let owners: CommandFocusScopeState[] = []
    if (policy === 'focused') {
      for (let current: CommandFocusScopeState | null = origin; current; current = current.parent) {
        if (current.handlers.has(command)) {
          owners = [current]
          break
        }
      }
    } else {
      let targetTab = tabOwner(origin)
      if (policy === 'active-tab' && !targetTab) {
        const tabs = [...this.scopes].filter((scope) => scope.options.kind === 'tab')
        if (tabs.length) {
          if (trigger === 'explicit') return undefined
          const activeTabs = tabs.filter((scope) => scope.isActive())
          if (activeTabs.length !== 1) return undefined
          targetTab = activeTabs[0]
        }
      }
      owners = [root, ...this.scopes].filter((scope) => policy === 'window' || tabOwner(scope) === targetTab)
    }
    const boundary = keyboardBoundary(origin)
    const candidates = owners.flatMap((owner) => {
      if (!owner.isActive()) return []
      return (owner.handlers.get(command) ?? []).flatMap((entry) => {
        const ownerBoundary = keyboardBoundary(owner)
        if (ownerBoundary !== boundary && (ownerBoundary || !entry.options.allowInKeyboardLayer)) return []
        const invocation = { command, owner, entry, handler: readRegisteredHandler(entry) }
        return isHandlerEnabled(entry) ? [invocation] : []
      })
    })
    return candidates.length === 1 ? candidates[0] : undefined
  }
  private readonly boundaries: {
    scope: CommandFocusScopeState
    activation: { active: boolean; order: number }
  }[] = []
  private readonly boundaryActivations = new WeakMap<CommandFocusScopeState, { active: boolean; order: number }>()
  private nextBoundaryOrder = 0

  updateBoundaryActivation(scope: CommandFocusScopeState, active: boolean) {
    const activation = this.boundaryActivations.get(scope) ?? { active: false, order: 0 }
    if (active && !activation.active) activation.order = ++this.nextBoundaryOrder
    activation.active = active
    this.boundaryActivations.set(scope, activation)
    return activation
  }

  attach(scope: CommandFocusScopeState): () => void {
    scope.mounted = true
    this.scopes.add(scope)
    const element = scope.options.element()
    if (element) this.roots.set(element, scope)
    scope.publish()
    return () => {
      scope.mounted = false
      this.scopes.delete(scope)
      if (element && this.roots.get(element) === scope) this.roots.delete(element)
      scope.publish()
    }
  }

  openBoundary(scope: CommandFocusScopeState): () => void {
    const entry = { scope, activation: this.updateBoundaryActivation(scope, scope.options.active()) }
    this.boundaries.push(entry)
    return () => {
      const index = this.boundaries.indexOf(entry)
      if (index >= 0) this.boundaries.splice(index, 1)
    }
  }

  resolve(event: KeyboardEvent, root: CommandFocusScopeState): CommandFocusScopeState {
    const active = this.boundaries
      .filter(
        ({ scope, activation }) =>
          activation.active && scope.options.active() && (!scope.owner || scope.owner.isActive())
      )
      .sort((left, right) => right.activation.order - left.activation.order)
    let boundary = active[0]?.scope
    // Activation order survives effect replay; an active descendant still owns its reopened parent.
    while (boundary) {
      const parent = boundary
      const nested = active.find(({ scope }) => {
        for (let owner = scope.owner; owner; owner = owner.owner) {
          if (owner === parent) return true
        }
        return false
      })
      if (!nested) break
      boundary = nested.scope
    }

    for (const node of event.composedPath()) {
      if (!(node instanceof HTMLElement)) continue
      const scope = this.roots.get(node)
      if (!scope) continue
      if (!scope.isActive() || !node.isConnected) return scope
      if (boundary) {
        let ancestor: CommandFocusScopeState | null = scope
        while (ancestor && ancestor !== boundary) ancestor = ancestor.parent
        if (!ancestor) return boundary
      }
      return scope
    }
    return boundary ?? root
  }
}

export const CommandFocusScopeContext = createContext<CommandFocusScopeState | null>(null)
export interface CommandFocusHost {
  registry: CommandFocusRegistry
  rootScope: CommandFocusScopeState
  forScope: (scope: CommandFocusScopeState) => CommandRuntime
}

export const CommandFocusHostContext = createContext<CommandFocusHost | null>(null)
