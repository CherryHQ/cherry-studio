import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import WebSocket from 'ws'

export type CdpWindowScope = 'any' | 'main' | 'quick-assistant' | 'selection-assistant'

export interface CdpLocatorDescriptor {
  scope?: CdpWindowScope
  role?: string
  name?: string
  label?: string
  placeholder?: string
  text?: string
  testId?: string
  css?: string
  exact?: boolean
  nth?: number
}

type DomOperation = 'check' | 'click' | 'element' | 'fill' | 'focus' | 'hover' | 'inspect' | 'select' | 'uncheck'

interface DomOperationRequest {
  descriptor: CdpLocatorDescriptor
  operation: DomOperation
  value?: string
}

interface DomOperationResult {
  ariaSnapshot: string
  bounds?: { x: number; y: number }
  count: number
  inputType: string | null
  inputValue: string
  text: string
  title: string
  url: string
  visible: boolean
}

interface CdpTarget {
  id: string
  title: string
  type: string
  url: string
  webSocketDebuggerUrl?: string
}

interface CdpMessage {
  error?: { code: number; message: string }
  id?: number
  method?: string
  params?: unknown
  result?: unknown
}

interface RuntimeEvaluation {
  exceptionDetails?: {
    exception?: { description?: string }
    text?: string
  }
  result: {
    objectId?: string
    value?: unknown
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

export function classifyCdpTarget(url: string): Exclude<CdpWindowScope, 'any'> | 'other' {
  const pathname = new URL(url).pathname.toLowerCase()
  if (pathname.endsWith('/windows/main/index.html')) return 'main'
  if (pathname.includes('/windows/quickassistant/')) return 'quick-assistant'
  if (pathname.includes('/windows/selection/')) return 'selection-assistant'
  return 'other'
}

export function runDomOperation(request: DomOperationRequest): unknown {
  const normalize = (value: string | null | undefined): string => value?.replace(/\s+/g, ' ').trim() ?? ''
  const matches = (actual: string, expected: string, exact: boolean): boolean => {
    const normalizedActual = normalize(actual).toLocaleLowerCase()
    const normalizedExpected = normalize(expected).toLocaleLowerCase()
    return exact ? normalizedActual === normalizedExpected : normalizedActual.includes(normalizedExpected)
  }
  const ignoredContent = (element: Element): boolean =>
    ['NOSCRIPT', 'SCRIPT', 'STYLE', 'TEMPLATE'].includes(element.tagName)
  const visible = (element: Element): boolean => {
    if (ignoredContent(element) || element.closest('noscript, script, style, template')) return false
    const style = window.getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
    if (element.closest('[hidden], [aria-hidden="true"]')) return false
    return element === document.body || element.getClientRects().length > 0
  }
  const fallbackText = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (!(node instanceof Element) || ignoredContent(node)) return ''
    return Array.from(node.childNodes).map(fallbackText).join(' ')
  }
  const text = (element: Element): string => {
    if (ignoredContent(element)) return ''
    const innerText = (element as HTMLElement).innerText
    return normalize(typeof innerText === 'string' ? innerText : fallbackText(element))
  }
  const role = (element: Element): string => {
    const explicit = element.getAttribute('role')?.split(/\s+/)[0]
    if (explicit) return explicit
    const tag = element.tagName.toLowerCase()
    if (tag === 'button') return 'button'
    if (tag === 'a' && element.hasAttribute('href')) return 'link'
    if (/^h[1-6]$/.test(tag)) return 'heading'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'select') return element.hasAttribute('multiple') ? 'listbox' : 'combobox'
    if (tag === 'option') return 'option'
    if (tag === 'img') return 'img'
    if (tag === 'nav') return 'navigation'
    if (tag === 'main') return 'main'
    if (tag === 'table') return 'table'
    if (tag === 'tr') return 'row'
    if (tag === 'td') return 'cell'
    if (tag === 'th') return 'columnheader'
    if (tag === 'ul' || tag === 'ol') return 'list'
    if (tag === 'li') return 'listitem'
    if (tag !== 'input') return ''
    const inputType = (element.getAttribute('type') ?? 'text').toLowerCase()
    if (inputType === 'checkbox') return 'checkbox'
    if (inputType === 'radio') return 'radio'
    if (inputType === 'range') return 'slider'
    if (inputType === 'number') return 'spinbutton'
    if (inputType === 'button' || inputType === 'submit' || inputType === 'reset') return 'button'
    if (inputType === 'search') return 'searchbox'
    return ['email', 'password', 'tel', 'text', 'url'].includes(inputType) ? 'textbox' : ''
  }
  const accessibleName = (element: Element): string => {
    const ariaLabel = element.getAttribute('aria-label')
    if (ariaLabel) return normalize(ariaLabel)
    const labelledBy = element.getAttribute('aria-labelledby')
    if (labelledBy) {
      const value = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
      if (normalize(value)) return normalize(value)
    }
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      const value = Array.from(element.labels ?? [])
        .map((label) => label.textContent ?? '')
        .join(' ')
      if (normalize(value)) return normalize(value)
    }
    return normalize(
      element.getAttribute('alt') ??
        element.getAttribute('title') ??
        (element instanceof HTMLInputElement && ['button', 'reset', 'submit'].includes(element.type)
          ? element.value
          : text(element))
    )
  }
  const all = (): Element[] => Array.from(document.querySelectorAll('*'))
  const descriptor = request.descriptor
  const exact = descriptor.exact ?? false
  const hasSelector = Boolean(
    descriptor.css ||
      descriptor.testId ||
      descriptor.role ||
      descriptor.name !== undefined ||
      descriptor.label !== undefined ||
      descriptor.placeholder !== undefined ||
      descriptor.text !== undefined
  )
  let candidates = descriptor.css
    ? Array.from(document.querySelectorAll(descriptor.css))
    : hasSelector
      ? all()
      : document.body
        ? [document.body]
        : []
  if (descriptor.testId) {
    candidates = candidates.filter((element) => element.getAttribute('data-testid') === descriptor.testId)
  }
  if (descriptor.role) {
    candidates = candidates.filter(
      (element) => role(element).toLocaleLowerCase() === descriptor.role?.toLocaleLowerCase()
    )
  }
  if (descriptor.name !== undefined) {
    candidates = candidates.filter((element) => matches(accessibleName(element), descriptor.name ?? '', exact))
  }
  if (descriptor.label !== undefined) {
    candidates = candidates.filter((element) => {
      if (!role(element)) return false
      return matches(accessibleName(element), descriptor.label ?? '', exact)
    })
  }
  if (descriptor.placeholder !== undefined) {
    candidates = candidates.filter((element) =>
      matches(element.getAttribute('placeholder') ?? '', descriptor.placeholder ?? '', exact)
    )
  }
  if (descriptor.text !== undefined) {
    candidates = candidates.filter((element) => matches(text(element), descriptor.text ?? '', exact))
    const hasStructuralSelector = Boolean(
      descriptor.css ||
        descriptor.testId ||
        descriptor.role ||
        descriptor.name !== undefined ||
        descriptor.label !== undefined ||
        descriptor.placeholder !== undefined
    )
    if (!hasStructuralSelector) {
      candidates = candidates.filter(
        (element) =>
          !Array.from(element.children).some(
            (child) => visible(child) && matches(text(child), descriptor.text ?? '', exact)
          )
      )
    }
  }

  const selected =
    descriptor.nth === undefined
      ? (candidates.find((element) => visible(element)) ?? candidates[0])
      : candidates[descriptor.nth]
  if (request.operation === 'element') return selected
  const result: DomOperationResult = {
    ariaSnapshot: '',
    count: candidates.length,
    inputType: selected?.getAttribute('type') ?? null,
    inputValue:
      selected instanceof HTMLInputElement ||
      selected instanceof HTMLTextAreaElement ||
      selected instanceof HTMLSelectElement
        ? selected.value
        : '',
    text: selected ? text(selected) : '',
    title: document.title,
    url: window.location.href,
    visible: selected ? visible(selected) : false
  }
  if (!selected) return result

  if (request.operation === 'inspect') {
    const elements = [selected, ...Array.from(selected.querySelectorAll('*'))]
      .filter((element) => visible(element))
      .filter((element) => role(element) || (element.children.length === 0 && accessibleName(element)))
      .slice(0, 200)
    result.ariaSnapshot = elements
      .map((element) => {
        const elementRole = role(element) || element.tagName.toLowerCase()
        const name = accessibleName(element) || text(element).slice(0, 200)
        return `- ${elementRole}${name ? ` "${name}"` : ''}`
      })
      .join('\n')
    return result
  }

  selected.scrollIntoView({ block: 'center', inline: 'center' })
  if (request.operation === 'click') {
    const bounds = selected.getBoundingClientRect()
    result.bounds = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
  } else if (request.operation === 'fill') {
    if (request.value === undefined) throw new Error('fill requires value')
    if (selected instanceof HTMLInputElement || selected instanceof HTMLTextAreaElement) {
      const prototype =
        selected instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
      setter?.call(selected, request.value)
      selected.dispatchEvent(new InputEvent('input', { bubbles: true, data: request.value, inputType: 'insertText' }))
      selected.dispatchEvent(new Event('change', { bubbles: true }))
    } else if (selected instanceof HTMLElement && selected.isContentEditable) {
      selected.textContent = request.value
      selected.dispatchEvent(new InputEvent('input', { bubbles: true, data: request.value, inputType: 'insertText' }))
    } else {
      throw new Error('fill target is not editable')
    }
  } else if (request.operation === 'check' || request.operation === 'uncheck') {
    if (!(selected instanceof HTMLInputElement) || !['checkbox', 'radio'].includes(selected.type)) {
      throw new Error(`${request.operation} target is not a checkbox or radio`)
    }
    const desired = request.operation === 'check'
    if (selected.checked !== desired) selected.click()
  } else if (request.operation === 'select') {
    if (request.value === undefined) throw new Error('select requires value')
    if (!(selected instanceof HTMLSelectElement)) throw new Error('select target is not a select element')
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(selected, request.value)
    selected.dispatchEvent(new Event('input', { bubbles: true }))
    selected.dispatchEvent(new Event('change', { bubbles: true }))
  } else if (request.operation === 'focus') {
    ;(selected as HTMLElement).focus()
  } else if (request.operation === 'hover') {
    const bounds = selected.getBoundingClientRect()
    result.bounds = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
  }
  return result
}

function domExpression(request: DomOperationRequest): string {
  return `(() => { const __name = (target) => target; return (${runDomOperation.toString()})(${JSON.stringify(request)}); })()`
}

class CdpConnection {
  private nextId = 1
  private readonly pending = new Map<
    number,
    { reject: (error: Error) => void; resolve: (value: unknown) => void; timer: NodeJS.Timeout }
  >()

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => {
      let message: CdpMessage
      try {
        message = JSON.parse(data.toString()) as CdpMessage
      } catch {
        return
      }
      if (message.id === undefined) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(`CDP ${message.error.code}: ${message.error.message}`))
      else pending.resolve(message.result)
    })
    const rejectPending = (error: Error): void => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(error)
      }
      this.pending.clear()
    }
    socket.on('close', () => rejectPending(new Error('CDP connection closed')))
    socket.on('error', (error) => rejectPending(error))
  }

  static async open(url: string): Promise<CdpConnection> {
    const socket = new WebSocket(url, { handshakeTimeout: 5_000 })
    await new Promise<void>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        socket.terminate()
        reject(new Error(`CDP connection timed out: ${url}`))
      }, 5_000)
      socket.once('open', () => {
        clearTimeout(timer)
        resolvePromise()
      })
      socket.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    return new CdpConnection(socket)
  }

  async send<T>(method: string, params: Record<string, unknown> = {}, timeout = 15_000): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP command timed out: ${method}`))
      }, timeout)
      this.pending.set(id, {
        reject,
        resolve: (value) => resolvePromise(value as T),
        timer
      })
      this.socket.send(JSON.stringify({ id, method, params }), (error) => {
        if (!error) return
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  close(): void {
    this.socket.close()
  }
}

function evaluationValue<T>(evaluation: RuntimeEvaluation): T {
  if (evaluation.exceptionDetails) {
    throw new Error(
      evaluation.exceptionDetails.exception?.description ??
        evaluation.exceptionDetails.text ??
        'CDP Runtime.evaluate failed'
    )
  }
  return evaluation.result.value as T
}

function keyDefinition(key: string): { code: string; key: string; text?: string; windowsVirtualKeyCode: number } {
  const special: Record<string, { code: string; key: string; text?: string; windowsVirtualKeyCode: number }> = {
    ArrowDown: { code: 'ArrowDown', key: 'ArrowDown', windowsVirtualKeyCode: 40 },
    ArrowLeft: { code: 'ArrowLeft', key: 'ArrowLeft', windowsVirtualKeyCode: 37 },
    ArrowRight: { code: 'ArrowRight', key: 'ArrowRight', windowsVirtualKeyCode: 39 },
    ArrowUp: { code: 'ArrowUp', key: 'ArrowUp', windowsVirtualKeyCode: 38 },
    Backspace: { code: 'Backspace', key: 'Backspace', windowsVirtualKeyCode: 8 },
    Delete: { code: 'Delete', key: 'Delete', windowsVirtualKeyCode: 46 },
    End: { code: 'End', key: 'End', windowsVirtualKeyCode: 35 },
    Enter: { code: 'Enter', key: 'Enter', text: '\r', windowsVirtualKeyCode: 13 },
    Escape: { code: 'Escape', key: 'Escape', windowsVirtualKeyCode: 27 },
    Home: { code: 'Home', key: 'Home', windowsVirtualKeyCode: 36 },
    PageDown: { code: 'PageDown', key: 'PageDown', windowsVirtualKeyCode: 34 },
    PageUp: { code: 'PageUp', key: 'PageUp', windowsVirtualKeyCode: 33 },
    Space: { code: 'Space', key: ' ', text: ' ', windowsVirtualKeyCode: 32 },
    Tab: { code: 'Tab', key: 'Tab', windowsVirtualKeyCode: 9 }
  }
  if (special[key]) return special[key]
  if (key.length !== 1) throw new Error(`Unsupported key: ${key}`)
  const upper = key.toUpperCase()
  return {
    code: /[A-Z]/.test(upper) ? `Key${upper}` : /[0-9]/.test(key) ? `Digit${key}` : '',
    key,
    text: key,
    windowsVirtualKeyCode: upper.charCodeAt(0)
  }
}

function modifierValue(parts: string[]): number {
  return parts.reduce((value, part) => {
    if (part === 'Alt') return value | 1
    if (part === 'Control' || part === 'Ctrl') return value | 2
    if (part === 'Meta' || part === 'Command') return value | 4
    if (part === 'Shift') return value | 8
    return value
  }, 0)
}

export class ElectronCdpClient {
  constructor(private readonly port: number) {}

  private async targets(): Promise<CdpTarget[]> {
    const response = await fetch(`http://127.0.0.1:${this.port}/json/list`, {
      signal: AbortSignal.timeout(5_000)
    })
    if (!response.ok) throw new Error(`CDP target discovery failed with HTTP ${response.status}`)
    const targets = (await response.json()) as CdpTarget[]
    return targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl)
  }

  private async target(scope: CdpWindowScope = 'main'): Promise<CdpTarget> {
    const deadline = Date.now() + 15_000
    do {
      const targets = await this.targets()
      const matched =
        scope === 'any'
          ? (targets.find((candidate) => classifyCdpTarget(candidate.url) === 'main') ?? targets[0])
          : targets.find((candidate) => classifyCdpTarget(candidate.url) === scope)
      if (matched) return matched
      await delay(500)
    } while (Date.now() < deadline)
    throw new Error(`Cherry Studio window is not available: ${scope}`)
  }

  private async withTarget<T>(
    scope: CdpWindowScope | undefined,
    operation: (connection: CdpConnection, target: CdpTarget) => Promise<T>
  ): Promise<T> {
    const target = await this.target(scope)
    const connection = await CdpConnection.open(target.webSocketDebuggerUrl as string)
    try {
      return await operation(connection, target)
    } finally {
      connection.close()
    }
  }

  private async evaluate<T>(connection: CdpConnection, expression: string, returnByValue = true): Promise<T> {
    const evaluation = await connection.send<RuntimeEvaluation>('Runtime.evaluate', {
      awaitPromise: true,
      expression,
      returnByValue,
      userGesture: true
    })
    return evaluationValue<T>(evaluation)
  }

  private async domOperation(
    connection: CdpConnection,
    descriptor: CdpLocatorDescriptor,
    operation: DomOperation,
    value?: string
  ): Promise<DomOperationResult> {
    return this.evaluate<DomOperationResult>(connection, domExpression({ descriptor, operation, value }))
  }

  private async dispatchClick(connection: CdpConnection, result: DomOperationResult): Promise<void> {
    if (!result.bounds) throw new Error('Click target has no visible bounds')
    const position = { x: result.bounds.x, y: result.bounds.y }
    await connection.send('Input.dispatchMouseEvent', { ...position, type: 'mouseMoved' })
    await connection.send('Input.dispatchMouseEvent', {
      ...position,
      button: 'left',
      clickCount: 1,
      type: 'mousePressed'
    })
    await connection.send('Input.dispatchMouseEvent', {
      ...position,
      button: 'left',
      clickCount: 1,
      type: 'mouseReleased'
    })
  }

  async listWindows(): Promise<Array<{ scope: string; title: string; url: string }>> {
    return (await this.targets()).map((target) => ({
      scope: classifyCdpTarget(target.url),
      title: target.title,
      url: target.url
    }))
  }

  async inspect(descriptor: CdpLocatorDescriptor = {}): Promise<DomOperationResult> {
    return this.withTarget(descriptor.scope, (connection) => this.domOperation(connection, descriptor, 'inspect'))
  }

  async waitFor(descriptor: CdpLocatorDescriptor, attached: boolean): Promise<void> {
    const deadline = Date.now() + 15_000
    do {
      const observation = await this.inspect(descriptor)
      if (observation.count > 0 && (attached || observation.visible)) return
      await delay(250)
    } while (Date.now() < deadline)
    throw new Error(`Locator did not become ${attached ? 'attached' : 'visible'} within 15000ms`)
  }

  async interact(
    descriptor: CdpLocatorDescriptor,
    action: Exclude<DomOperation, 'element' | 'inspect'>,
    value?: string
  ): Promise<{ title: string; url: string }> {
    return this.withTarget(descriptor.scope, async (connection) => {
      const result = await this.domOperation(connection, descriptor, action, value)
      if (action === 'click') {
        await this.dispatchClick(connection, result)
      } else if (action === 'hover' && result.bounds) {
        await connection.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: result.bounds.x,
          y: result.bounds.y
        })
      }
      return { title: result.title, url: result.url }
    })
  }

  async press(descriptor: CdpLocatorDescriptor, shortcut: string): Promise<{ title: string; url: string }> {
    return this.withTarget(descriptor.scope, async (connection) => {
      const focused = await this.domOperation(connection, descriptor, 'focus')
      const parts = shortcut.split('+')
      const key = keyDefinition(parts.pop() ?? '')
      const modifiers = modifierValue(parts)
      await connection.send('Input.dispatchKeyEvent', {
        ...key,
        modifiers,
        text: modifiers === 0 ? key.text : undefined,
        type: key.text && modifiers === 0 ? 'keyDown' : 'rawKeyDown'
      })
      await connection.send('Input.dispatchKeyEvent', {
        ...key,
        modifiers,
        text: undefined,
        type: 'keyUp'
      })
      return { title: focused.title, url: focused.url }
    })
  }

  async setFiles(descriptor: CdpLocatorDescriptor, files: string[]): Promise<{ title: string; url: string }> {
    return this.withTarget(descriptor.scope, async (connection, target) => {
      const observation = await this.domOperation(connection, descriptor, 'inspect')
      const evaluation = await connection.send<RuntimeEvaluation>('Runtime.evaluate', {
        expression: domExpression({ descriptor, operation: 'element' }),
        returnByValue: false,
        userGesture: true
      })
      if (evaluation.exceptionDetails) evaluationValue(evaluation)
      const objectId = evaluation.result.objectId
      if (!objectId) throw new Error('set-files locator did not resolve to a DOM node')
      try {
        await connection.send('DOM.setFileInputFiles', { files, objectId })
      } finally {
        await connection.send('Runtime.releaseObject', { objectId }).catch(() => undefined)
      }
      return { title: observation.title || target.title, url: observation.url || target.url }
    })
  }

  async download(descriptor: CdpLocatorDescriptor, directory: string): Promise<string> {
    mkdirSync(directory, { recursive: true })
    const before = new Map(
      readdirSync(directory).map((name) => {
        const stats = statSync(join(directory, name))
        return [name, { modified: stats.mtimeMs, size: stats.size }] as const
      })
    )
    const startedAt = Date.now()
    await this.withTarget(descriptor.scope, async (connection) => {
      await connection.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: directory })
      await this.dispatchClick(connection, await this.domOperation(connection, descriptor, 'click'))
    })
    const deadline = Date.now() + 60_000
    let stablePath = ''
    let stableSize = -1
    while (Date.now() < deadline) {
      const candidates = readdirSync(directory)
        .filter((name) => !name.endsWith('.crdownload'))
        .map((name) => ({ name, path: join(directory, name), stats: statSync(join(directory, name)) }))
        .filter(({ name, stats }) => {
          const previous = before.get(name)
          return (
            stats.mtimeMs >= startedAt - 1_000 &&
            (!previous || previous.modified !== stats.mtimeMs || previous.size !== stats.size)
          )
        })
        .sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs)
      const candidate = candidates[0]
      if (
        candidate &&
        candidate.path === stablePath &&
        candidate.stats.size > 0 &&
        candidate.stats.size === stableSize
      ) {
        const target = join(directory, `${randomUUID()}-${basename(candidate.path)}`)
        renameSync(candidate.path, target)
        return target
      }
      stablePath = candidate?.path ?? ''
      stableSize = candidate?.stats.size ?? -1
      await delay(250)
    }
    throw new Error('Download did not complete within 60000ms')
  }

  async screenshot(scope: CdpWindowScope, path: string): Promise<{ title: string; url: string }> {
    return this.withTarget(scope, async (connection, target) => {
      const result = await connection.send<{ data: string }>('Page.captureScreenshot', {
        captureBeyondViewport: false,
        format: 'png',
        fromSurface: true
      })
      writeFileSync(path, Buffer.from(result.data, 'base64'), { mode: 0o600 })
      return { title: target.title, url: target.url }
    })
  }
}
