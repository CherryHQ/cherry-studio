import { randomUUID } from 'node:crypto'

import * as z from 'zod'

import { type Action, ComputerUseError, type Element, type Snapshot } from '@cherrystudio/computer-use'

import type { ComputerUseService, ComputerUseTask } from '../ComputerUseService'

const ref = z.string().min(1)
const observationSchema = z
  .object({
    maxTreeNodes: z.number().int().min(1).max(1200).default(400),
    maxTreeDepth: z.number().int().min(1).max(64).default(64),
    textLimit: z.number().int().min(1).max(2000).default(200)
  })
  .strict()
const pageSchema = z.object({ cursor: ref }).strict()
const schemas = {
  click: z.object({ ref }).strict(),
  clickAt: z.object({ x: z.number().nonnegative(), y: z.number().nonnegative() }).strict(),
  drag: z
    .object({
      from: z.object({ x: z.number().nonnegative(), y: z.number().nonnegative() }).strict(),
      to: z.object({ x: z.number().nonnegative(), y: z.number().nonnegative() }).strict()
    })
    .strict(),
  typeText: z.object({ text: ref }).strict(),
  pressKey: z.object({ key: ref }).strict(),
  setValue: z.object({ ref, value: z.string() }).strict(),
  scroll: z
    .object({ ref: ref.optional(), direction: z.enum(['up', 'down', 'left', 'right']), pages: z.number().positive() })
    .strict(),
  performSecondaryAction: z.object({ ref, actionId: ref }).strict()
}

interface AppBinding {
  sessionId: string
  snapshot?: Snapshot
  refs: Map<string, string>
  coordinates: boolean
  page?: { id: string; offset: number; cursor?: string }
}

export class ComputerAutomationSession {
  private readonly apps = new Map<string, AppBinding>()

  constructor(
    private readonly service: ComputerUseService,
    private readonly task: ComputerUseTask
  ) {}

  async execute(name: string, args: Record<string, unknown>, target: string | undefined, signal: AbortSignal) {
    if (name === 'listApps') {
      z.object({}).strict().parse(args)
      return { value: await this.service.listApps(this.task, signal) }
    }
    if (name === 'getApp') {
      const { query } = z
        .object({ query: ref.max(512) })
        .strict()
        .parse(args)
      const app = await this.service.resolveApp(this.task, query, signal)
      const binding = { sessionId: app.id, refs: new Map<string, string>(), coordinates: false }
      this.apps.set(query, binding)
      try {
        return await this.observe(binding, query, 'getAXState', signal, observationSchema.parse({}), 4_000)
      } catch (cause) {
        if (cause instanceof ComputerUseError)
          throw new ComputerUseError(
            cause.code,
            `Application was resolved; initial observation failed: ${cause.message}`,
            { effect: 'possible', cause }
          )
        throw cause
      }
    }
    const continuation = name === 'getAXState' && 'cursor' in args ? pageSchema.parse(args) : undefined
    const observation =
      !continuation && ['getAXState', 'getScreenshot', 'getAXStateAndScreenshot'].includes(name)
        ? observationSchema.parse(args)
        : undefined
    let binding = target ? this.apps.get(target) : undefined
    if (!binding && target && observation) {
      const app = await this.service.resolveApp(this.task, target, signal, false)
      binding = { sessionId: app.id, refs: new Map(), coordinates: false }
      this.apps.set(target, binding)
    }
    if (!binding)
      throw new ComputerUseError(
        'STALE_SNAPSHOT',
        'Observe through the retained app handle with getAXState() before acting in this run. Rebind only if the target is no longer available.'
      )
    if (continuation) {
      signal.throwIfAborted()
      this.service.validateAppSession(this.task, binding.sessionId)
      if (!binding.page || binding.page.cursor !== continuation.cursor)
        throw new ComputerUseError('STALE_SNAPSHOT', 'AX page cursor expired; obtain a fresh observation.')
      return this.page(binding, target!, 'getAXState')
    }
    if (observation) {
      return this.observe(binding, target!, name, signal, observation)
    }
    if (!Object.hasOwn(schemas, name)) throw new ComputerUseError('INVALID_ARGUMENT', 'Unknown application method')
    schemas[name as keyof typeof schemas].parse(args)
    const snapshot = binding.snapshot
    if (!snapshot) throw new ComputerUseError('STALE_SNAPSHOT', 'Observe the app before acting.')
    const common = { appSessionId: binding.sessionId, snapshotId: snapshot.id }
    const element = (ref: string) => {
      const id = binding.refs.get(ref)
      if (!id) throw new ComputerUseError('STALE_SNAPSHOT', 'Element reference expired; obtain a fresh AX observation.')
      return id
    }
    let action: Action
    switch (name) {
      case 'click':
        action = { ...common, type: 'click', elementId: element(schemas.click.parse(args).ref) }
        break
      case 'clickAt':
        if (!binding.coordinates)
          throw new ComputerUseError('STALE_SNAPSHOT', 'Obtain a fresh screenshot before coordinate input.')
        action = { ...common, type: 'click', ...schemas.clickAt.parse(args) }
        break
      case 'typeText':
        action = { ...common, type: 'typeText', ...schemas.typeText.parse(args) }
        break
      case 'drag':
        if (!binding.coordinates)
          throw new ComputerUseError('STALE_SNAPSHOT', 'Obtain a fresh screenshot before coordinate input.')
        action = { ...common, type: 'drag', ...schemas.drag.parse(args) }
        break
      case 'pressKey':
        action = { ...common, type: 'pressKey', ...schemas.pressKey.parse(args) }
        break
      case 'setValue': {
        const p = schemas.setValue.parse(args)
        action = { ...common, type: 'setValue', elementId: element(p.ref), value: p.value }
        break
      }
      case 'scroll': {
        const { ref, ...p } = schemas.scroll.parse(args)
        action = { ...common, type: 'scroll', ...p, ...(ref ? { elementId: element(ref) } : {}) }
        break
      }
      case 'performSecondaryAction': {
        const p = schemas.performSecondaryAction.parse(args)
        action = { ...common, type: 'performSecondaryAction', elementId: element(p.ref), actionId: p.actionId }
        break
      }
      default:
        throw new ComputerUseError('INVALID_ARGUMENT', 'Unknown application method')
    }
    this.invalidate(binding)
    const updated = await this.service.perform(this.task, action, signal)
    binding.snapshot = updated.targetRetained ? snapshot : updated.snapshot
    return { value: { status: 'completed' } }
  }

  private invalidate(binding: AppBinding): void {
    for (const app of this.apps.values()) {
      if (app.sessionId !== binding.sessionId) continue
      app.refs.clear()
      app.coordinates = false
      app.snapshot = undefined
      app.page = undefined
    }
  }

  private async observe(
    binding: AppBinding,
    target: string,
    mode: string,
    signal: AbortSignal,
    options = observationSchema.parse({}),
    budget = 16_000
  ) {
    this.invalidate(binding)
    const state = await this.service.getAppState(
      this.task,
      { ...options, appSessionId: binding.sessionId, includeScreenshot: mode !== 'getAXState' },
      signal
    )
    binding.snapshot = state
    binding.page = { id: randomUUID(), offset: 0 }
    try {
      return this.page(binding, target, mode, budget)
    } catch (error) {
      this.invalidate(binding)
      throw error
    }
  }

  private page(binding: AppBinding, target: string, mode: string, budget = 16_000) {
    const state = binding.snapshot!
    const page = binding.page!
    const ax = mode !== 'getScreenshot'
    const screenshot = mode !== 'getAXState'
    const image = screenshot && state.screenshot.status === 'available' ? state.screenshot.image : undefined
    const elements: Element[] = []
    const available = ax && state.tree.status === 'available' ? state.tree : undefined
    const pagination = available
      ? {
          offset: page.offset,
          returned: 0,
          total: available.elements.length,
          nextCursor: randomUUID() as string | undefined
        }
      : undefined
    const displayValue = {
      id: page.id,
      target,
      app: state.app,
      window: state.window,
      ...(ax
        ? { tree: available ? { status: 'available' as const, elements, truncated: available.truncated } : state.tree }
        : {}),
      ...(pagination ? { page: pagination } : {}),
      ...(screenshot
        ? { screenshot: image ? { status: 'available', width: image.width, height: image.height } : state.screenshot }
        : {})
    }
    let bytes = Buffer.byteLength(JSON.stringify(displayValue))
    if (bytes + 32 > budget)
      throw new ComputerUseError('INVALID_ARGUMENT', 'AX observation metadata exceeds the page budget.')
    if (available && pagination) {
      for (const element of available.elements.slice(page.offset)) {
        const mapped = {
          ...element,
          id: `${page.id}:${element.id}`,
          ...(element.parentId !== undefined ? { parentId: `${page.id}:${element.parentId}` } : {})
        }
        const size = Buffer.byteLength(JSON.stringify(mapped)) + 1
        // Reserve room for counters; budget serialized UTF-8, including escaped UI text.
        if (bytes + size + 32 > budget) {
          if (!elements.length)
            throw new ComputerUseError(
              'INVALID_ARGUMENT',
              'One AX node exceeds the page budget. Request getAXState({ textLimit: 200 }) or a screenshot.'
            )
          break
        }
        elements.push(mapped)
        bytes += size
      }
      pagination.returned = elements.length
      pagination.nextCursor =
        page.offset + elements.length < available.elements.length ? pagination.nextCursor : undefined
      page.offset += elements.length
      page.cursor = pagination.nextCursor
      for (const element of available.elements.slice(pagination.offset, page.offset))
        binding.refs.set(`${page.id}:${element.id}`, element.id)
    }
    const parents = new Map(
      available?.elements.map((element) => [
        `${page.id}:${element.id}`,
        element.parentId === undefined ? undefined : `${page.id}:${element.parentId}`
      ])
    )
    const text = available
      ? elements
          .map((element) => {
            let depth = 0
            let parent = element.parentId
            while (parent && depth < 64) {
              depth++
              parent = parents.get(parent)
            }
            const value = element.value === undefined ? '' : ` value=${JSON.stringify(element.value)}`
            const secondary = element.secondaryActions.length
              ? ` secondaryActions=${JSON.stringify(element.secondaryActions)}`
              : ''
            return `${'  '.repeat(depth)}${element.id} ${element.role} ${JSON.stringify(element.name)}${value} actions=${element.actions.join(',')}${secondary}`
          })
          .join('\n')
      : undefined
    if (screenshot) binding.coordinates = Boolean(image)
    return {
      observation: true,
      value: { ...displayValue, ...(text !== undefined ? { text } : {}) },
      displayValue,
      images: image ? [{ data: Buffer.from(image.data).toString('base64'), mimeType: image.mimeType }] : []
    }
  }
}
