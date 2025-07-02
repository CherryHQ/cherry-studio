import { BaseEmbeddings } from '@cherrystudio/embedjs-interfaces'
import { VoyageEmbeddings as _VoyageEmbeddings } from '@langchain/community/embeddings/voyage'

/**
 * 支持设置嵌入维度的模型
 */
export const SUPPORTED_DIM_MODELS = ['voyage-3-large', 'voyage-3.5', 'voyage-3.5-lite', 'voyage-code-3']
export class VoyageEmbeddings extends BaseEmbeddings {
  private model: _VoyageEmbeddings
  constructor(private readonly configuration?: ConstructorParameters<typeof _VoyageEmbeddings>[0]) {
    super()
    if (!this.configuration) this.configuration = {}
    if (!this.configuration.modelName) this.configuration.modelName = 'voyage-3'
    if (!SUPPORTED_DIM_MODELS.includes(this.configuration.modelName) && this.configuration.outputDimension) {
      throw new Error(`VoyageEmbeddings only supports ${SUPPORTED_DIM_MODELS.join(', ')}`)
    }

    this.model = new _VoyageEmbeddings(this.configuration)
  }
  override async getDimensions(): Promise<number> {
    if (!this.configuration?.outputDimension) {
      throw new Error('You need to pass in the optional dimensions parameter for this model')
    }
    return this.configuration?.outputDimension
  }

  override async embedDocuments(texts: string[]): Promise<number[][]> {
    return this.model.embedDocuments(texts)
  }

  override async embedQuery(text: string): Promise<number[]> {
    return this.model.embedQuery(text)
  }
}
