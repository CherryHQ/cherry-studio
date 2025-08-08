import { BaseEmbeddings } from '@cherrystudio/embedjs-interfaces'
import { VoyageEmbeddings as _VoyageEmbeddings } from '@langchain/community/embeddings/voyage'

/**
 * 支持设置嵌入维度的模型
 */
export class VoyageEmbeddings extends BaseEmbeddings {
  private model: _VoyageEmbeddings
  constructor(private readonly configuration?: ConstructorParameters<typeof _VoyageEmbeddings>[0]) {
    super()
    if (!this.configuration) {
      throw new Error('Invalid configuration')
    }
    if (!this.configuration.modelName) this.configuration.modelName = 'voyage-3'

    this.model = new _VoyageEmbeddings(this.configuration)
  }
  override async getDimensions(): Promise<number> {
    return this.configuration?.outputDimension ?? (this.configuration?.modelName === 'voyage-code-2' ? 1536 : 1024)
  }

  override async embedDocuments(texts: string[]): Promise<number[][]> {
    try {
      return this.model.embedDocuments(texts)
    } catch (error) {
      throw new Error('Embedding documents failed - you may have hit the rate limit or there is an internal error', {
        cause: error
      })
    }
  }

  override async embedQuery(text: string): Promise<number[]> {
    return this.model.embedQuery(text)
  }
}
