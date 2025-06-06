import { Mistral } from '@mistralai/mistralai'
import { Provider } from '@types'

export class MistralClientManager {
  private static instance: MistralClientManager
  private client: Mistral | null = null

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  public static getInstance(): MistralClientManager {
    if (!MistralClientManager.instance) {
      MistralClientManager.instance = new MistralClientManager()
    }
    return MistralClientManager.instance
  }

  public initializeClient(provider: Provider): void {
    if (!this.client) {
      this.client = new Mistral({
        apiKey: provider.apiKey,
        serverURL: provider.apiHost
      })
    }
  }

  public getClient(): Mistral {
    if (!this.client) {
      throw new Error('Mistral client not initialized. Call initializeClient first.')
    }
    return this.client
  }
}
