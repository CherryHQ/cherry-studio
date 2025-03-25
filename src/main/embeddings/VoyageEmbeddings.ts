import { VoyageEmbeddings as _VoyageEmbeddings } from '@langchain/community/embeddings/voyage'
import { BaseEmbeddings } from '@llm-tools/embedjs-interfaces'

export default class VoyageEmbeddings extends BaseEmbeddings {
  private model: _VoyageEmbeddings
  constructor(private readonly configuration?: ConstructorParameters<typeof _VoyageEmbeddings>[0]) {
    super()
    if (!this.configuration) this.configuration = {}
    if (!this.configuration.modelName) this.configuration.modelName = 'voyage-3'

    if (!this.configuration.outputDimension) {
      throw new Error('You need to pass in the optional dimensions parameter for this model')
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
