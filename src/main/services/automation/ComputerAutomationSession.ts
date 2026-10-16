import { randomUUID } from 'node:crypto'

import * as z from 'zod'

import { type Action, ComputerUseError, type Snapshot } from '@cherrystudio/computer-use'

import type { ComputerUseService, ComputerUseTask } from '../ComputerUseService'

const ref = z.string().min(1)
const observationSchema = z
  .object({
    maxTreeNodes: z.number().int().min(1).max(1200).default(400),
    maxTreeDepth: z.number().int().min(1).max(64).default(64),
    textLimit: z.number().int().min(1).max(2000).default(200)
  })
  .strict()
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
        return await this.observe(binding, query, 'getAXState', signal)
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
    const observation = ['getAXState', 'getScreenshot', 'getAXStateAndScreenshot'].includes(name)
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
    binding.refs.clear()
    binding.coordinates = false
    binding.snapshot = undefined
    const updated = await this.service.perform(this.task, action, signal)
    binding.snapshot = updated.targetRetained ? snapshot : updated.snapshot
    return { value: { status: 'completed' } }
  }

  private async observe(
    binding: AppBinding,
    target: string,
    mode: string,
    signal: AbortSignal,
    options = observationSchema.parse({})
  ) {
    binding.refs.clear()
    binding.coordinates = false
    binding.snapshot = undefined
    const state = await this.service.getAppState(
      this.task,
      { ...options, appSessionId: binding.sessionId, includeScreenshot: mode !== 'getAXState' },
      signal
    )
    binding.snapshot = state
    const id = randomUUID()
    const ax = mode !== 'getScreenshot'
    const screenshot = mode !== 'getAXState'
    const elements =
      ax && state.tree.status === 'available'
        ? state.tree.elements.map((element) => {
            const ref = `${id}:${element.id}`
            binding.refs.set(ref, element.id)
            return { ...element, id: ref, ...(element.parentId ? { parentId: `${id}:${element.parentId}` } : {}) }
          })
        : undefined
    const parents = new Map(elements?.map((element) => [element.id, element.parentId]))
    const text = elements
      ?.map((element) => {
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
    const image = screenshot && state.screenshot.status === 'available' ? state.screenshot.image : undefined
    binding.coordinates = Boolean(image)
    return {
      observation: true,
      value: {
        id,
        target,
        app: state.app,
        window: state.window,
        ...(ax
          ? {
              text,
              tree:
                state.tree.status === 'available'
                  ? { status: 'available', truncated: state.tree.truncated }
                  : state.tree
            }
          : {}),
        ...(screenshot
          ? { screenshot: image ? { status: 'available', width: image.width, height: image.height } : state.screenshot }
          : {})
      },
      images: image ? [{ data: Buffer.from(image.data).toString('base64'), mimeType: image.mimeType }] : []
    }
  }
}
