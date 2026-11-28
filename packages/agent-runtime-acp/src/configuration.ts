import { isDeepStrictEqual } from 'node:util'

import { RequestError } from '@agentclientprotocol/sdk'

import { acpModelCatalog, type AcpSession } from './client'
import type { AcpModelSelection } from './profile'
import type { AcpSessionConfiguration } from './types'

type Commit = (change: () => boolean) => void | Promise<void>
type ModelWrite = { kind: 'standard'; id: string } | { kind: 'legacy' }

export class AcpControlError extends Error {
  constructor(
    readonly status: 'unsupported' | 'rejected',
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export class AcpSessionControls {
  private configuration: AcpSessionConfiguration = {}
  private legacy?: AcpSession['legacyModels']
  private catalog = acpModelCatalog(undefined, undefined)
  private optionsRevision = 0
  private modeRevision = 0
  private standardModelRevision = 0
  private unsupported?: ModelWrite
  private signInRequired = false
  private writing = false

  get busy() {
    return this.writing
  }

  get snapshot() {
    return this.configuration
  }

  get extraOptions() {
    return this.configuration.configOptions?.filter(({ id }) => id !== this.catalog.configId)
  }

  get standardModelId() {
    return this.catalog.configId ? this.catalog.activeModel?.id : undefined
  }

  get modelRevision() {
    return this.standardModelRevision
  }

  private get modelWrite(): ModelWrite | undefined {
    if (this.catalog.configId) return { kind: 'standard', id: this.catalog.configId }
    if (this.legacy) return { kind: 'legacy' }
    return undefined
  }

  private isUnsupported(write: ModelWrite) {
    const unsupported = this.unsupported
    return (
      !!unsupported &&
      write.kind === unsupported.kind &&
      (write.kind === 'legacy' || (unsupported.kind === 'standard' && write.id === unsupported.id))
    )
  }

  get model() {
    const write = this.modelWrite
    const { activeModel, models } = this.catalog
    return {
      activeModel,
      models,
      status: this.signInRequired
        ? ('sign-in-required' as const)
        : !write || this.isUnsupported(write)
          ? ('unsupported' as const)
          : !models.length
            ? ('empty' as const)
            : models.some(({ id }) => id !== activeModel?.id)
              ? ('selectable' as const)
              : ('current-only' as const)
    }
  }

  initialize(configuration: AcpSessionConfiguration, legacy: AcpSession['legacyModels']) {
    this.legacy = legacy
    // A load can deliver current options before returning its initial configuration.
    this.configuration = { ...configuration, ...this.configuration }
    this.refreshCatalog()
  }

  acceptOptions(options: AcpSessionConfiguration['configOptions']) {
    if (!this.signInRequired && isDeepStrictEqual(this.configuration.configOptions, options)) return false
    this.configuration = { ...this.configuration, configOptions: options }
    this.refreshCatalog()
    return true
  }

  acceptMode(modeId: string) {
    const modes = this.configuration.modes
    if (!modes?.availableModes.some(({ id }) => id === modeId)) return false
    this.configuration = { ...this.configuration, modes: { ...modes, currentModeId: modeId } }
    this.modeRevision++
    return true
  }

  private refreshCatalog() {
    this.optionsRevision++
    const previousModel = this.standardModelId
    this.catalog = acpModelCatalog(this.configuration.configOptions, this.legacy)
    if (this.standardModelId !== previousModel) this.standardModelRevision++
    this.signInRequired = false
  }

  private assertIdle() {
    if (this.writing)
      throw new AcpControlError('rejected', 'control-busy', 'An ACP session control is already changing')
  }

  private async write(operation: () => Promise<void>) {
    this.assertIdle()
    this.writing = true
    try {
      await operation()
    } finally {
      this.writing = false
    }
  }

  async setMode(session: AcpSession, modeId: string, commit: Commit) {
    if (!this.configuration.modes?.availableModes.some(({ id }) => id === modeId))
      throw new AcpControlError('unsupported', 'unsupported-mode', 'This ACP mode is unavailable')
    await this.write(async () => {
      const revision = this.modeRevision
      await session.setMode(modeId)
      await commit(() => this.modeRevision === revision && this.acceptMode(modeId))
    })
  }

  async setOption(session: AcpSession, configId: string, value: string | boolean, commit: Commit) {
    const option = this.configuration.configOptions?.find(({ id }) => id === configId)
    if (!option) throw new AcpControlError('unsupported', 'unsupported-config', 'This ACP option is unavailable')
    if (
      option.type === 'boolean'
        ? typeof value !== 'boolean'
        : typeof value !== 'string' ||
          !option.options.some((entry) =>
            ('group' in entry ? entry.options : [entry]).some(({ value: id }) => id === value)
          )
    )
      throw new AcpControlError(
        'rejected',
        'invalid-config-value',
        'This ACP option does not offer the requested value'
      )
    if (configId === this.catalog.configId && typeof value === 'string') {
      await this.selectModel(session, value, commit)
      return
    }

    await this.write(async () => {
      const revision = this.optionsRevision
      const { configOptions } = await session.setConfigOption(configId, value)
      await commit(
        () => this.optionsRevision === revision && configOptions != null && this.acceptOptions(configOptions)
      )
    })
  }

  async selectModel(session: AcpSession, modelId: string, commit: Commit, initial?: AcpModelSelection) {
    this.assertIdle()
    const { activeModel, models } = this.catalog
    if (activeModel?.id === modelId) return
    const write = this.modelWrite
    if (!write || this.isUnsupported(write)) {
      if (initial?.implicit === modelId && !models.length) {
        await commit(() => {
          this.catalog = { ...this.catalog, activeModel: { id: modelId } }
          return true
        })
        return
      }
      throw new AcpControlError('unsupported', 'unsupported-model', 'This ACP session does not support model switching')
    }
    if (
      !models.some(({ id }) => id === modelId) &&
      !(initial && (!models.length || (initial.allowUnlisted && write.kind === 'standard')))
    )
      throw new AcpControlError('rejected', 'invalid-model', 'This model is no longer available in the ACP session')

    await this.write(() => this.writeModel(session, write, modelId, commit))
  }

  private async writeModel(session: AcpSession, write: ModelWrite, modelId: string, commit: Commit) {
    const revision = this.optionsRevision
    try {
      const legacy = this.legacy
      if (write.kind === 'standard') {
        const { configOptions } = await session.setConfigOption(write.id, modelId)
        const confirmation = configOptions?.find(({ id }) => id === write.id)
        await commit(
          () =>
            this.optionsRevision === revision &&
            confirmation?.type === 'select' &&
            confirmation.currentValue === modelId &&
            this.acceptOptions(configOptions)
        )
      } else if (legacy) {
        // The legacy response acknowledges the requested ID without returning options.
        await legacy.select(modelId)
        await commit(() => {
          this.legacy = { ...legacy, currentModelId: modelId }
          this.refreshCatalog()
          return true
        })
      }
      if (this.catalog.activeModel?.id !== modelId)
        throw new AcpControlError('rejected', 'model-unconfirmed', 'The ACP session did not confirm the selected model')
    } catch (error) {
      if (error instanceof RequestError && error.code === RequestError.methodNotFound('').code) {
        await commit(() => {
          this.unsupported = write
          return true
        })
        throw new AcpControlError(
          'unsupported',
          'unsupported-model',
          'This ACP session does not support model switching'
        )
      }
      if (error instanceof RequestError && error.code === RequestError.authRequired().code) {
        await commit(() => {
          this.signInRequired = true
          return true
        })
      }
      throw error
    }
  }
}
