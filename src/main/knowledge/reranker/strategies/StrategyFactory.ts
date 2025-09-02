import { BailianStrategy } from './BailianStrategy'
import { DefaultStrategy } from './DefaultStrategy'
import { JinaStrategy } from './JinaStrategy'
import { RerankStrategy } from './RerankStrategy'
import { TEIStrategy } from './TeiStrategy'
import { isTEIProvider, RERANKER_PROVIDERS } from './types'
import { VoyageAIStrategy } from './VoyageStrategy'

export class StrategyFactory {
  static createStrategy(provider?: string): RerankStrategy {
    switch (provider) {
      case RERANKER_PROVIDERS.VOYAGEAI:
        return new VoyageAIStrategy()
      case RERANKER_PROVIDERS.BAILIAN:
        return new BailianStrategy()
      case RERANKER_PROVIDERS.JINA:
        return new JinaStrategy()
      default:
        if (isTEIProvider(provider)) {
          return new TEIStrategy()
        }
        return new DefaultStrategy()
    }
  }
}
