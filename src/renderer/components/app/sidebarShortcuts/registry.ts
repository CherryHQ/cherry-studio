import type { SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'

import type { SidebarShortcutProvider } from './types'

export class SidebarShortcutRegistry {
  private readonly providers: ReadonlyMap<string, SidebarShortcutProvider>

  constructor(providers: readonly SidebarShortcutProvider[]) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]))
    if (this.providers.size !== providers.length) throw new Error('Sidebar shortcut provider ids must be unique')
  }

  get(providerId: string): SidebarShortcutProvider | undefined {
    return this.providers.get(providerId)
  }

  resolve(target: SidebarShortcutTarget): SidebarShortcutProvider | undefined {
    const provider = this.get(target.locator.providerId)
    return provider?.validate(target) ? provider : undefined
  }
}
