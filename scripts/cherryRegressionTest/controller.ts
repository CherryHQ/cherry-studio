import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { type Browser, chromium, type Locator, type Page } from '@playwright/test'

import type { ConfigRef, RegressionTestConfig } from './config'
import { getConfigRef } from './config'
import { type FileEvidenceOptions, validateFileEvidence } from './fileEvidence'
import { readAppRecord } from './lifecycle'
import type { RunPaths } from './paths'
import { resolveAllowedPath } from './paths'
import { observeOwnedProcess } from './processEvidence'

export type WindowScope = 'any' | 'main' | 'quick-assistant' | 'selection-assistant'

export interface LocatorDescriptor {
  scope?: WindowScope
  role?: string
  name?: string
  nameConfigRef?: ConfigRef
  label?: string
  placeholder?: string
  text?: string
  textConfigRef?: ConfigRef
  testId?: string
  css?: string
  exact?: boolean
  nth?: number
}

export type InteractionAction =
  | 'check'
  | 'click'
  | 'download'
  | 'fill'
  | 'focus'
  | 'hover'
  | 'press'
  | 'select'
  | 'set-files'
  | 'uncheck'
  | 'wait'

export interface InteractionRequest {
  action: InteractionAction
  locator?: LocatorDescriptor
  value?: string
  configRef?: ConfigRef
  key?: string
  files?: string[]
  waitMs?: number
}

export interface UiObservation {
  ariaSnapshot: string
  count: number
  page: { title: string; url: string }
  text: string
  visible: boolean
}

function truncate(value: string, maximum = 12_000): string {
  return value.length > maximum ? `${value.slice(0, maximum)}\n…[truncated]` : value
}

function classifyPage(page: Page): Exclude<WindowScope, 'any'> | 'other' {
  const pathname = new URL(page.url()).pathname.toLowerCase()
  if (pathname.endsWith('/windows/main/index.html')) return 'main'
  if (pathname.includes('/windows/quickassistant/')) return 'quick-assistant'
  if (pathname.includes('/windows/selection/')) return 'selection-assistant'
  return 'other'
}

export class RegressionController {
  private browser?: Browser

  constructor(
    private readonly paths: RunPaths,
    private readonly config: RegressionTestConfig,
    private readonly redact: <T>(value: T) => T
  ) {}

  async dispose(): Promise<void> {
    this.browser = undefined
  }

  private async connect(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser
    const record = readAppRecord(this.paths)
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${record.cdpPort}`)
    return this.browser
  }

  private async pages(): Promise<Page[]> {
    const browser = await this.connect()
    return browser.contexts().flatMap((context) => context.pages())
  }

  private async page(scope: WindowScope = 'main'): Promise<Page> {
    const deadline = Date.now() + 15_000
    do {
      const pages = await this.pages()
      const matched =
        scope === 'any'
          ? (pages.find((candidate) => classifyPage(candidate) === 'main') ?? pages[0])
          : pages.find((candidate) => classifyPage(candidate) === scope)
      if (matched) return matched
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
    } while (Date.now() < deadline)
    throw new Error(`Cherry Studio window is not available: ${scope}`)
  }

  private locate(page: Page, descriptor: LocatorDescriptor = {}): Locator {
    const exact = descriptor.exact ?? false
    const name = descriptor.nameConfigRef ? getConfigRef(this.config, descriptor.nameConfigRef) : descriptor.name
    const text = descriptor.textConfigRef ? getConfigRef(this.config, descriptor.textConfigRef) : descriptor.text
    let locator: Locator
    if (descriptor.role) {
      locator = page.getByRole(descriptor.role as Parameters<Page['getByRole']>[0], {
        exact,
        name
      })
    } else if (descriptor.label) {
      locator = page.getByLabel(descriptor.label, { exact })
    } else if (descriptor.placeholder) {
      locator = page.getByPlaceholder(descriptor.placeholder, { exact })
    } else if (text) {
      locator = page.getByText(text, { exact })
    } else if (descriptor.testId) {
      locator = page.getByTestId(descriptor.testId)
    } else if (descriptor.css) {
      locator = page.locator(descriptor.css)
    } else {
      locator = page.locator('body')
    }
    return descriptor.nth === undefined ? locator : locator.nth(descriptor.nth)
  }

  async listWindows(): Promise<Array<{ scope: string; title: string; url: string }>> {
    const result = await Promise.all(
      (await this.pages()).map(async (page) => ({
        scope: classifyPage(page),
        title: await page.title(),
        url: page.url()
      }))
    )
    return this.redact(result)
  }

  private async inspectRaw(descriptor: LocatorDescriptor = {}): Promise<UiObservation> {
    const page = await this.page(descriptor.scope)
    const locator = this.locate(page, descriptor)
    const count = await locator.count()
    if (count === 0) {
      return {
        ariaSnapshot: '',
        count,
        page: { title: await page.title(), url: page.url() },
        text: '',
        visible: false
      }
    }
    const first = locator.first()
    const [ariaSnapshot, text, visible] = await Promise.all([
      first.ariaSnapshot({ timeout: 10_000 }).catch(() => ''),
      first.innerText({ timeout: 10_000 }).catch(() => ''),
      first.isVisible().catch(() => false)
    ])
    return {
      ariaSnapshot: truncate(ariaSnapshot),
      count,
      page: { title: await page.title(), url: page.url() },
      text: truncate(text),
      visible
    }
  }

  async inspect(descriptor: LocatorDescriptor = {}): Promise<UiObservation> {
    return this.redact(await this.inspectRaw(descriptor))
  }

  async interact(request: InteractionRequest): Promise<unknown> {
    if (request.action === 'wait') {
      const waitMs = Math.min(Math.max(request.waitMs ?? 1_000, 0), 30_000)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, waitMs))
      return { waitedMs: waitMs }
    }
    if (!request.locator) throw new Error(`${request.action} requires a locator`)
    const page = await this.page(request.locator.scope)
    const locator = this.locate(page, request.locator)
    await locator.waitFor({ state: request.action === 'set-files' ? 'attached' : 'visible', timeout: 15_000 })

    switch (request.action) {
      case 'click':
        await locator.click()
        break
      case 'fill': {
        const value = request.configRef ? getConfigRef(this.config, request.configRef) : request.value
        if (value === undefined) throw new Error('fill requires value or configRef')
        await locator.fill(value)
        break
      }
      case 'press':
        if (!request.key) throw new Error('press requires key')
        await locator.press(request.key)
        break
      case 'check':
        await locator.check()
        break
      case 'uncheck':
        await locator.uncheck()
        break
      case 'select':
        {
          const value = request.configRef ? getConfigRef(this.config, request.configRef) : request.value
          if (value === undefined) throw new Error('select requires value or configRef')
          await locator.selectOption(value)
        }
        break
      case 'set-files': {
        if (!request.files?.length) throw new Error('set-files requires at least one file')
        const files = request.files.map((filePath) =>
          resolveAllowedPath(filePath, [this.paths.fixtures, this.paths.workspace, this.paths.evidence])
        )
        await locator.setInputFiles(files)
        break
      }
      case 'download': {
        const downloads = join(this.paths.evidence, 'downloads')
        mkdirSync(downloads, { recursive: true })
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), locator.click()])
        const target = join(downloads, `${randomUUID()}-${basename(download.suggestedFilename())}`)
        await download.saveAs(target)
        return { downloadedFile: target }
      }
      case 'hover':
        await locator.hover()
        break
      case 'focus':
        await locator.focus()
        break
      default:
        throw new Error(`Unsupported interaction: ${request.action satisfies never}`)
    }

    return {
      action: request.action,
      locator: request.locator,
      value: request.configRef
        ? `[CONFIG:${request.configRef}]`
        : request.action === 'fill'
          ? '[USER_VALUE]'
          : request.value,
      window: { title: await page.title(), url: page.url() }
    }
  }

  async recordUi(
    caseId: string,
    evidenceId: string,
    locator: LocatorDescriptor,
    expectedTexts: string[]
  ): Promise<unknown> {
    if (expectedTexts.length === 0 || expectedTexts.some((text) => text.trim().length < 2)) {
      throw new Error('UI evidence requires expected text values with at least two characters')
    }
    if (
      !locator.role &&
      !locator.label &&
      !locator.placeholder &&
      !locator.text &&
      !locator.textConfigRef &&
      !locator.testId &&
      !locator.css
    ) {
      throw new Error('UI evidence requires a locator selector, not only a window scope')
    }
    const rawObservation = await this.inspectRaw(locator)
    const passed =
      rawObservation.visible && expectedTexts.every((expectedText) => rawObservation.text.includes(expectedText))
    const observation = this.redact(rawObservation)
    const artifactPath = join(this.paths.evidence, caseId, `${evidenceId}.json`)
    mkdirSync(join(this.paths.evidence, caseId), { recursive: true })
    writeFileSync(artifactPath, `${JSON.stringify(this.redact({ expectedTexts, observation }), null, 2)}\n`, {
      mode: 0o600
    })
    return { artifactPath, details: observation, passed }
  }

  async recordMaskedInput(
    caseId: string,
    evidenceId: string,
    locatorDescriptor: LocatorDescriptor,
    configuredValue: string
  ): Promise<unknown> {
    const page = await this.page(locatorDescriptor.scope)
    const locator = this.locate(page, locatorDescriptor).first()
    await locator.waitFor({ state: 'visible', timeout: 15_000 })
    const [inputType, inputValue, visible] = await Promise.all([
      locator.getAttribute('type'),
      locator.inputValue(),
      locator.isVisible()
    ])
    const details = {
      hasConfiguredValue: inputValue === configuredValue,
      inputType,
      visible
    }
    const artifactPath = join(this.paths.evidence, caseId, `${evidenceId}.json`)
    mkdirSync(join(this.paths.evidence, caseId), { recursive: true })
    writeFileSync(artifactPath, `${JSON.stringify(details, null, 2)}\n`, { mode: 0o600 })
    return {
      artifactPath,
      details,
      passed: visible && inputType === 'password' && inputValue === configuredValue
    }
  }

  async recordWindowAbsent(caseId: string, evidenceId: string, scope: WindowScope): Promise<unknown> {
    const deadline = Date.now() + 5_000
    let windows = await this.listWindows()
    while (windows.some((window) => window.scope === scope) && Date.now() < deadline) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
      windows = await this.listWindows()
    }
    const artifactPath = join(this.paths.evidence, caseId, `${evidenceId}.json`)
    mkdirSync(join(this.paths.evidence, caseId), { recursive: true })
    writeFileSync(artifactPath, `${JSON.stringify({ absentScope: scope, windows }, null, 2)}\n`, { mode: 0o600 })
    return {
      artifactPath,
      details: { absentScope: scope, windows },
      passed: !windows.some((window) => window.scope === scope)
    }
  }

  async recordScreenshot(caseId: string, evidenceId: string, scope: WindowScope = 'main'): Promise<unknown> {
    const page = await this.page(scope)
    const directory = join(this.paths.evidence, caseId)
    const artifactPath = join(directory, `${evidenceId}.png`)
    mkdirSync(directory, { recursive: true })
    await page.screenshot({ animations: 'disabled', path: artifactPath })
    return {
      artifactPath,
      details: this.redact({ title: await page.title(), url: page.url() }),
      passed: true
    }
  }

  async recordFile(candidatePath: string, options: FileEvidenceOptions): Promise<unknown> {
    const filePath = resolveAllowedPath(candidatePath, [
      this.paths.artifacts,
      this.paths.evidence,
      this.paths.fixtures,
      this.paths.installed,
      this.paths.workspace
    ])
    const details = await validateFileEvidence(filePath, options)
    return { artifactPath: filePath, details, passed: true }
  }

  async recordProcess(
    commandFragment: string,
    expectedRunning: boolean,
    baselinePids: ReadonlySet<number>
  ): Promise<unknown> {
    const observation = observeOwnedProcess(readAppRecord(this.paths), commandFragment, expectedRunning, baselinePids)
    return {
      details: this.redact({
        ...observation,
        baselineProcessCount: baselinePids.size,
        commandFragment,
        expectedRunning
      }),
      passed: observation.passed
    }
  }

  async recordRestart(
    locator: LocatorDescriptor,
    expectedTexts: string[],
    baselineRestartCount: number
  ): Promise<unknown> {
    const after = readAppRecord(this.paths)
    const rawObservation = await this.inspectRaw(locator)
    const observation = this.redact(rawObservation)
    return {
      details: this.redact({
        observation,
        restartCount: after.restartCount
      }),
      passed:
        after.restartCount > baselineRestartCount &&
        rawObservation.visible &&
        expectedTexts.every((expectedText) => rawObservation.text.includes(expectedText))
    }
  }
}
