import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type CdpLocatorDescriptor, ElectronCdpClient } from './cdp-client'
import { completeCherryInOauth } from './cherryin-oauth'
import type { ConfigRef, RegressionTestConfig } from './config'
import { getConfigRef } from './config'
import { type FileEvidenceOptions, validateFileEvidence } from './file-evidence'
import { readAppRecord, sendProtocolUrlToOwnedApp } from './lifecycle'
import type { RunPaths } from './paths'
import { resolveAllowedPath } from './paths'
import { observeOwnedProcess } from './process-evidence'

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
  | 'context-menu'
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

export class RegressionController {
  private client?: ElectronCdpClient
  private cdpPort?: number

  constructor(
    private readonly paths: RunPaths,
    private readonly config: RegressionTestConfig,
    private readonly redact: <T>(value: T) => T
  ) {}

  async dispose(): Promise<void> {
    this.client = undefined
    this.cdpPort = undefined
  }

  private connect(): ElectronCdpClient {
    const record = readAppRecord(this.paths)
    if (!this.client || this.cdpPort !== record.cdpPort) {
      this.client = new ElectronCdpClient(record.cdpPort)
      this.cdpPort = record.cdpPort
    }
    return this.client
  }

  private resolvedLocator(descriptor: LocatorDescriptor = {}): CdpLocatorDescriptor {
    const name = descriptor.nameConfigRef ? getConfigRef(this.config, descriptor.nameConfigRef) : descriptor.name
    const text = descriptor.textConfigRef ? getConfigRef(this.config, descriptor.textConfigRef) : descriptor.text
    return {
      css: descriptor.css,
      exact: descriptor.exact,
      label: descriptor.label,
      name,
      nth: descriptor.nth,
      placeholder: descriptor.placeholder,
      role: descriptor.role,
      scope: descriptor.scope,
      testId: descriptor.testId,
      text
    }
  }

  async listWindows(): Promise<Array<{ scope: string; title: string; url: string }>> {
    return this.redact(await this.connect().listWindows())
  }

  private async inspectRaw(descriptor: LocatorDescriptor = {}): Promise<UiObservation> {
    const observation = await this.connect().inspect(this.resolvedLocator(descriptor))
    return {
      ariaSnapshot: truncate(observation.ariaSnapshot),
      count: observation.count,
      page: { title: observation.title, url: observation.url },
      text: truncate(observation.text),
      visible: observation.visible
    }
  }

  async inspect(descriptor: LocatorDescriptor = {}): Promise<UiObservation> {
    return this.redact(await this.inspectRaw(descriptor))
  }

  async authenticateCherryIn(): Promise<{ authenticated: true }> {
    const loginButton: CdpLocatorDescriptor = {
      exact: true,
      name: 'Authorize with CherryIN',
      role: 'button',
      scope: 'main'
    }
    const client = this.connect()
    await client.waitFor(loginButton, false)
    const authorizationUrl = await client.captureWindowOpenUrl(loginButton)
    const callback = await completeCherryInOauth(authorizationUrl, {
      account: this.config.cherryIn.account,
      password: this.config.cherryIn.password
    })
    sendProtocolUrlToOwnedApp(readAppRecord(this.paths), callback)

    const deadline = Date.now() + 60_000
    do {
      const observation = await client.inspect(loginButton)
      if (observation.count === 0) return { authenticated: true }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
    } while (Date.now() < deadline)
    throw new Error('CherryIN authorization callback did not complete within 60000ms')
  }

  async interact(request: InteractionRequest): Promise<unknown> {
    if (request.action === 'wait') {
      const waitMs = Math.min(Math.max(request.waitMs ?? 1_000, 0), 30_000)
      await new Promise((resolvePromise) => setTimeout(resolvePromise, waitMs))
      return { waitedMs: waitMs }
    }
    if (!request.locator) throw new Error(`${request.action} requires a locator`)
    const locator = this.resolvedLocator(request.locator)
    const client = this.connect()
    await client.waitFor(locator, request.action === 'set-files')
    let window: { title: string; url: string }

    switch (request.action) {
      case 'click':
        window = await client.interact(locator, 'click')
        break
      case 'context-menu':
        window = await client.openContextMenu(locator)
        break
      case 'fill': {
        const value = request.configRef ? getConfigRef(this.config, request.configRef) : request.value
        if (value === undefined) throw new Error('fill requires value or configRef')
        window = await client.interact(locator, 'fill', value)
        break
      }
      case 'press':
        if (!request.key) throw new Error('press requires key')
        window = await client.press(locator, request.key)
        break
      case 'check':
        window = await client.interact(locator, 'check')
        break
      case 'uncheck':
        window = await client.interact(locator, 'uncheck')
        break
      case 'select':
        {
          const value = request.configRef ? getConfigRef(this.config, request.configRef) : request.value
          if (value === undefined) throw new Error('select requires value or configRef')
          window = await client.interact(locator, 'select', value)
        }
        break
      case 'set-files': {
        if (!request.files?.length) throw new Error('set-files requires at least one file')
        const files = request.files.map((filePath) =>
          resolveAllowedPath(filePath, [this.paths.fixtures, this.paths.workspace, this.paths.evidence])
        )
        window = await client.setFiles(locator, files)
        break
      }
      case 'download': {
        const downloads = join(this.paths.evidence, 'downloads')
        return { downloadedFile: await client.download(locator, downloads) }
      }
      case 'hover':
        window = await client.interact(locator, 'hover')
        break
      case 'focus':
        window = await client.interact(locator, 'focus')
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
      window
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
    const locator = this.resolvedLocator(locatorDescriptor)
    const client = this.connect()
    await client.waitFor(locator, false)
    const observation = await client.inspect(locator)
    const details = {
      hasConfiguredValue: observation.inputValue === configuredValue,
      inputType: observation.inputType,
      visible: observation.visible
    }
    const artifactPath = join(this.paths.evidence, caseId, `${evidenceId}.json`)
    mkdirSync(join(this.paths.evidence, caseId), { recursive: true })
    writeFileSync(artifactPath, `${JSON.stringify(details, null, 2)}\n`, { mode: 0o600 })
    return {
      artifactPath,
      details,
      passed: observation.visible && observation.inputType === 'password' && observation.inputValue === configuredValue
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
    const directory = join(this.paths.evidence, caseId)
    const artifactPath = join(directory, `${evidenceId}.png`)
    mkdirSync(directory, { recursive: true })
    const page = await this.connect().screenshot(scope, artifactPath)
    return {
      artifactPath,
      details: this.redact(page),
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
