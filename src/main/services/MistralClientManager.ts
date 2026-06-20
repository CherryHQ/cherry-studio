import type { Provider } from '@main/data/migration/v2/legacyTypes'
import { Mistral } from '@mistralai/mistralai'

export class MistralClientManager {
  private client: Mistral | null = null

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

export const mistralClientManager = new MistralClientManager()
