import { createContext } from 'react'

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
  }

  constructor(
    readonly parent: CommandFocusScopeState | null,
    readonly options: FocusScopeOptions
  ) {}

  isActive(): boolean {
    return this.mounted && this.options.active() && (!this.parent || this.parent.isActive())
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

export function findScopeHandler(scope: CommandFocusScopeState, command: CommandId): HandlerEntry | undefined {
  if (!scope.isActive()) return undefined
  const entries = scope.handlers.get(command)
  if (entries?.length) {
    return entries.findLast(({ options }) => {
      const enabled = options.enabled
      return typeof enabled === 'function' ? enabled() : enabled !== false
    })
  }
  const inherited = scope.parent ? findScopeHandler(scope.parent, command) : undefined
  return scope.options.boundary && !inherited?.options.allowInKeyboardLayer ? undefined : inherited
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
  readonly boundaries: CommandFocusScopeState[] = []

  attach(scope: CommandFocusScopeState): () => void {
    scope.mounted = true
    const element = scope.options.element()
    if (element) this.roots.set(element, scope)
    return () => {
      scope.mounted = false
      if (element && this.roots.get(element) === scope) this.roots.delete(element)
    }
  }

  openBoundary(scope: CommandFocusScopeState): () => void {
    this.boundaries.push(scope)
    return () => {
      const index = this.boundaries.indexOf(scope)
      if (index >= 0) this.boundaries.splice(index, 1)
    }
  }

  resolve(event: KeyboardEvent, root: CommandFocusScopeState): CommandFocusScopeState {
    const boundary = this.boundaries.findLast((scope) => scope.options.active())
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
