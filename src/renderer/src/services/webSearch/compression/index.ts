import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n'

import type { ICompressionStrategy } from '../interfaces'
import { CutoffCompressionStrategy } from './CutoffCompressionStrategy'
import { NullCompressionStrategy } from './NullCompressionStrategy'
import { RagCompressionStrategy } from './RagCompressionStrategy'

const logger = loggerService.withContext('CompressionStrategyFactory')

export class CompressionStrategyFactory {
  private strategies: Map<string, ICompressionStrategy>

  constructor() {
    this.strategies = new Map<string, ICompressionStrategy>()
    this.strategies.set('cutoff', new CutoffCompressionStrategy())
    this.strategies.set('rag', new RagCompressionStrategy())
    this.strategies.set('none', new NullCompressionStrategy())
  }

  async getStrategy(): Promise<ICompressionStrategy> {
    const method = await preferenceService.get('chat.websearch.compression.method')
    const selected = method ?? 'none'
    const strategy = this.strategies.get(selected)

    if (!strategy) {
      logger.warn(`Unknown compression method: ${selected}, falling back to none`)
      window.toast.warning({
        timeout: 5000,
        title: i18n.t('settings.tool.websearch.compression.error.unknown_method', { method: selected })
      })
      return this.strategies.get('none')!
    }

    return strategy
  }

  registerStrategy(name: string, strategy: ICompressionStrategy): void {
    this.strategies.set(name, strategy)
  }
}

export { CutoffCompressionStrategy } from './CutoffCompressionStrategy'
export { NullCompressionStrategy } from './NullCompressionStrategy'
export { RagCompressionStrategy } from './RagCompressionStrategy'
