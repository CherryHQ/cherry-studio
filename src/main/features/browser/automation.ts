import { randomUUID } from 'node:crypto'

import * as z from 'zod'

import { application } from '@application'

import { selectOption } from './actions/forms'
import { pressKey, typeText } from './actions/keyboard'
import { click, hover, scroll } from './actions/mouse'
import { settleAction } from './actions/settle'
import type { BrowserController } from './mcp/browserController'
import { BrowserSessionError } from './session/BrowserSessionError'
import { sanitizeSnapshotUrl } from './snapshot/serializeSnapshot'

const ref = z.string().min(1)
const schemas = {
  getTab: z.object({}).strict(),
  getAXState: z.object({ scope: ref.optional(), maxChars: z.number().int().min(256).max(40_000).optional() }).strict(),
  getScreenshot: z
    .object({ ref: ref.optional(), fullPage: z.boolean().optional(), cursor: z.string().optional() })
    .strict()
    .refine((value) => !(value.ref && value.fullPage)),
  goto: z.object({ url: z.string().min(1) }).strict(),
  evaluate: z.object({ code: z.string().min(1).max(64_000) }).strict(),
  goBack: z.object({}).strict(),
  goForward: z.object({}).strict(),
  listWebTools: z.object({}).strict(),
  callWebTool: z.object({ toolId: ref, args: z.record(z.string(), z.unknown()).default({}) }).strict(),
  getConsoleMessages: z
    .object({ level: z.enum(['error', 'warning', 'all']).default('all'), clear: z.boolean().default(false) })
    .strict(),
  getNetworkRequests: z.object({ clear: z.boolean().default(false) }).strict(),
  waitFor: z
    .object({
      text: z.string().optional(),
      ref: ref.optional(),
      gone: z.boolean().default(false),
      timeoutMs: z.number().int().min(1).max(30_000).default(10_000)
    })
    .strict()
    .refine((value) => value.ref !== undefined || value.text !== undefined),
  click: z
    .object({
      ref,
      button: z.enum(['left', 'right', 'middle']).default('left'),
      count: z.number().int().min(1).max(3).default(1)
    })
    .strict(),
  hover: z.object({ ref }).strict(),
  type: z
    .object({ ref, text: z.string(), clear: z.boolean().default(true), submit: z.boolean().default(false) })
    .strict(),
  pressKey: z.object({ key: ref }).strict(),
  scroll: z.object({ ref: ref.optional(), pages: z.number().default(1) }).strict(),
  selectOption: z.object({ ref, values: z.array(z.string()).min(1) }).strict(),
  find: z
    .object({ role: ref.optional(), name: ref.optional() })
    .strict()
    .refine((value) => value.role || value.name),
  blockAds: z
    .object({
      css: z.string().min(1).max(500).optional(),
      urlFilter: z.string().min(1).max(500).optional(),
      note: z.string().max(200).optional()
    })
    .strict()
    .refine((value) => (value.css === undefined) !== (value.urlFilter === undefined)),
  handleDialog: z.object({ accept: z.boolean(), promptText: z.string().optional() }).strict()
}

export interface BrowserAutomationResult {
  value: Record<string, unknown>
  observation?: boolean
  images?: { data: string; mimeType: string }[]
}

export async function executeBrowserOperation(
  controller: BrowserController,
  name: string,
  args: Record<string, unknown>,
  tabId: string | undefined,
  signal: AbortSignal
): Promise<BrowserAutomationResult> {
  if (!Object.hasOwn(schemas, name)) throw new BrowserSessionError('not_allowed')
  schemas[name as keyof typeof schemas].parse(args)
  const target = await controller.getSession(false, tabId)
  const options = {
    deadline: Date.now() + 30_000,
    signal: AbortSignal.any([signal, ...(target.signal ? [target.signal] : [])]),
    pointer: target.pointer,
    focusInput: target.focusInput
  }
  const session = target.session
  if (name === 'blockAds') {
    const input = schemas.blockAds.parse(args)
    const service = application.get('AdblockService')
    if (!service.isAiRuleWritingEnabled()) {
      throw Object.assign(new Error('Automatic ad rules are turned off in Settings → Browser.'), {
        code: 'ADBLOCK_DISABLED',
        effect: 'none'
      })
    }
    // The rule is scoped to the page the agent is actually looking at. Taking
    // the domain from the model would let one page's rule hide content on
    // another host.
    const pageUrl = session.guest.getURL()
    let hostname: string
    try {
      const parsed = new URL(pageUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol')
      hostname = parsed.hostname
    } catch {
      throw Object.assign(new Error('Ad rules can only be saved for an HTTP or HTTPS page.'), {
        code: 'ADBLOCK_UNAVAILABLE',
        effect: 'none'
      })
    }
    const result = await service.addCustomRule({
      domain: hostname,
      kind: input.css ? 'cosmetic' : 'network',
      value: input.css ?? input.urlFilter!,
      note: input.note,
      source: 'ai'
    })
    return {
      value: {
        tabId: target.tabId,
        url: sanitizeSnapshotUrl(pageUrl),
        id: result.rule.id,
        domain: result.rule.domain,
        kind: result.rule.kind,
        value: result.rule.value,
        updated: result.existing,
        applied: true,
        status: 'completed'
      }
    }
  }
  if (name === 'evaluate')
    return {
      value: {
        result: await controller.execute(schemas.evaluate.parse(args).code, 5000, false, target.tabId, options.signal)
      }
    }
  if (name === 'goto') {
    const result = await controller.open(schemas.goto.parse(args).url, 10_000, false, false, true, signal)
    return {
      observation: result.tabId !== target.tabId,
      value: {
        ...result,
        ...(result.tabId !== target.tabId
          ? {
              handleInvalidated: true,
              message:
                'Navigation completed in a replacement guest. Call browser.getTab() before continuing; the previous tab handle is no longer valid.'
            }
          : {})
      }
    }
  }
  if (name === 'getScreenshot') {
    const { images, ...metadata } = await controller.screenshot(
      schemas.getScreenshot.parse(args),
      false,
      target.tabId,
      options.signal
    )
    return {
      observation: true,
      value: {
        ...metadata,
        id: randomUUID(),
        tabId: target.tabId,
        images: images.map(({ region, scale, index }) => ({ region, scale, index }))
      },
      images
    }
  }
  return session.run(async () => {
    const metadata = () => ({
      tabId: target.tabId,
      url: sanitizeSnapshotUrl(session.guest.getURL()),
      title: session.guest.getTitle(),
      ...(session.pendingDialog ? { dialog: session.pendingDialog } : {}),
      ...session.takeEvents(),
      ...controller.takeHostEvents?.(target.tabId)
    })
    if (name === 'getTab' || name === 'getAXState') {
      try {
        const state = await session.snapshot({ ...schemas.getAXState.parse(args), full: true }, options)
        return {
          observation: true,
          value: { ...metadata(), id: randomUUID(), text: state.text, complete: !state.snapshot.truncated }
        }
      } catch (error) {
        if (name !== 'getTab' || !(error instanceof BrowserSessionError) || error.code !== 'dialog_open') throw error
        options.signal.throwIfAborted()
        return {
          observation: true,
          value: {
            ...metadata(),
            id: randomUUID(),
            dialog: error.dialog,
            complete: false,
            text: 'Initial observation blocked by a dialog. Use tab.handleDialog(), then tab.getAXState().'
          }
        }
      }
    }
    if (name === 'find') return { value: { ...metadata(), ...(await session.find(schemas.find.parse(args), options)) } }
    if (name === 'listWebTools') return { value: { ...metadata(), ...(await session.webTools.list(options)) } }
    if (name === 'callWebTool') {
      const input = schemas.callWebTool.parse(args)
      const result = await session.webTools.call(input.toolId, input.args, options)
      return { value: { ...metadata(), ...result } }
    }
    if (name === 'getConsoleMessages') {
      const input = schemas.getConsoleMessages.parse(args)
      await session.send('Runtime.enable', undefined, options)
      return { value: { ...metadata(), ...session.consoleMessages(input.level, input.clear) } }
    }
    if (name === 'getNetworkRequests') {
      await session.send('Network.enable', undefined, options)
      return { value: { ...metadata(), ...session.networkRequests(schemas.getNetworkRequests.parse(args).clear) } }
    }
    if (name === 'waitFor') {
      const input = schemas.waitFor.parse(args)
      options.deadline = Date.now() + input.timeoutMs
      while (true) {
        options.signal.throwIfAborted()
        if (Date.now() >= options.deadline) throw new BrowserSessionError('timeout')
        if (input.ref && !input.gone) session.resolveRef(input.ref)
        const state = await session.snapshot({ full: true }, options)
        const checks: boolean[] = []
        if (input.text !== undefined) checks.push(state.snapshot.nodes.some((node) => node.name.includes(input.text!)))
        if (input.ref !== undefined) checks.push(state.snapshot.nodes.some((node) => node.ref === input.ref))
        if (checks.every((present) => (input.gone ? !present : present)))
          return {
            observation: true,
            value: { ...metadata(), id: randomUUID(), text: state.text, complete: !state.snapshot.truncated }
          }
        await session.pause(250, options)
      }
    }
    const { value, navigated } = await settleAction(
      session,
      async () => {
        switch (name) {
          case 'click': {
            const p = schemas.click.parse(args)
            return click(session, p.ref, p.button, p.count, options)
          }
          case 'hover':
            return hover(session, schemas.hover.parse(args).ref, options)
          case 'type': {
            const p = schemas.type.parse(args)
            return typeText(session, p.ref, p.text, p.clear, p.submit, options)
          }
          case 'pressKey':
            return pressKey(session, schemas.pressKey.parse(args).key, options)
          case 'scroll': {
            const p = schemas.scroll.parse(args)
            return scroll(session, p.ref, p.pages, options)
          }
          case 'selectOption': {
            const p = schemas.selectOption.parse(args)
            return selectOption(session, p.ref, p.values, options)
          }
          case 'handleDialog':
            if (!session.pendingDialog) throw new BrowserSessionError('not_found')
            return session.send('Page.handleJavaScriptDialog', schemas.handleDialog.parse(args), options)
          case 'goBack':
          case 'goForward': {
            const history = await session.send('Page.getNavigationHistory', undefined, options)
            const entry = history.entries[history.currentIndex + (name === 'goBack' ? -1 : 1)]
            if (!entry) throw new BrowserSessionError('not_found')
            if (entry.url !== 'about:blank') controller.validateUrl(entry.url)
            return session.send('Page.navigateToHistoryEntry', { entryId: entry.id }, options)
          }
        }
      },
      options
    )
    return { value: { ...metadata(), ...value, navigated, status: 'completed' } }
  }, options)
}
