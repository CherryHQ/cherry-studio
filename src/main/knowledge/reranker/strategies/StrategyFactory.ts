import { BailianStrategy } from './BailianStrategy'
import { DefaultStrategy } from './DefaultStrategy'
import { JinaStrategy } from './JinaStrategy'
import type { RerankStrategy } from './RerankStrategy'
import { TeiStrategy } from './TeiStrategy'
import { isTeiProvider, RERANKER_PROVIDERS } from './types'
import { VoyageAiStrategy } from './VoyageStrategy'

export class StrategyFactory {
  static createStrategy(provider?: string): RerankStrategy {
    switch (provider) {
      case RERANKER_PROVIDERS.VOYAGEAI:
        return new VoyageAiStrategy()
      case RERANKER_PROVIDERS.BAILIAN:
        return new BailianStrategy()
      case RERANKER_PROVIDERS.JINA:
        return new JinaStrategy()
      default:
        if (isTeiProvider(provider)) {
          return new TeiStrategy()
        }
        return new DefaultStrategy()
    }
  }
}
