import { BailianStrategy } from './BailianStrategy'
import { DefaultStrategy } from './DefaultStrategy'
import { JinaStrategy } from './JinaStrategy'
import { RerankStrategy } from './RerankStrategy'
import { TEIStrategy } from './TeiStrategy'
import { VoyageAIStrategy } from './VoyageStrategy'
export class StrategyFactory {
  static createStrategy(provider?: string): RerankStrategy {
    switch (provider) {
      case 'voyageai':
        return new VoyageAIStrategy()
      case 'bailian':
        return new BailianStrategy()
      case 'jina':
        return new JinaStrategy()
      default:
        if (provider?.includes('tei')) {
          return new TEIStrategy()
        }
        return new DefaultStrategy()
    }
  }
}
