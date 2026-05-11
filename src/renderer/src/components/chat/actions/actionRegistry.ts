import type { MessageActionContext, MessageActionProvider, MessageActionReference } from './actionTypes'

export type MessageActionProviderRegistration = () => void

export class MessageActionRegistry {
  private readonly providers = new Map<string, MessageActionProvider>()

  register(provider: MessageActionProvider): MessageActionProviderRegistration {
    this.providers.set(provider.id, provider)

    return () => {
      if (this.providers.get(provider.id) === provider) {
        this.providers.delete(provider.id)
      }
    }
  }

  unregister(id: string): void {
    this.providers.delete(id)
  }

  listProviders(): MessageActionProvider[] {
    return Array.from(this.providers.values())
  }

  resolve(context: MessageActionContext): MessageActionReference[] {
    return this.listProviders().flatMap((provider) => provider.resolve(context))
  }

  clear(): void {
    this.providers.clear()
  }
}

export function createMessageActionRegistry(): MessageActionRegistry {
  return new MessageActionRegistry()
}
