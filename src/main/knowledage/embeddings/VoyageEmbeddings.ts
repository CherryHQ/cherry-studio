import { BaseEmbeddings } from '@cherrystudio/embedjs-interfaces'
import { VoyageEmbeddings as _VoyageEmbeddings } from '@langchain/community/embeddings/voyage'

import { VOYAGE_SUPPORTED_DIM_MODELS } from './utils'

/**
 * 支持设置嵌入维度的模型
 */
export class VoyageEmbeddings extends BaseEmbeddings {
  private model: _VoyageEmbeddings
  constructor(private readonly configuration?: ConstructorParameters<typeof _VoyageEmbeddings>[0]) {
    super()
    if (!this.configuration) {
      throw new Error('Pass in a configuration.')
    }
    if (!this.configuration.modelName) this.configuration.modelName = 'voyage-3'

    if (!VOYAGE_SUPPORTED_DIM_MODELS.includes(this.configuration.modelName) && this.configuration.outputDimension) {
      console.error(`VoyageEmbeddings only supports ${VOYAGE_SUPPORTED_DIM_MODELS.join(', ')} to set outputDimension.`)
      this.model = new _VoyageEmbeddings({ ...this.configuration, outputDimension: undefined })
    } else {
      this.model = new _VoyageEmbeddings(this.configuration)
    }
  }
  override async getDimensions(): Promise<number> {
    return this.configuration?.outputDimension ?? (this.configuration?.modelName === 'voyage-code-2' ? 1536 : 1024)
  }

  override async embedDocuments(texts: string[]): Promise<number[][]> {
    return this.model.embedDocuments(texts)
  }

  override async embedQuery(text: string): Promise<number[]> {
    return this.model.embedQuery(text)
  }
}
