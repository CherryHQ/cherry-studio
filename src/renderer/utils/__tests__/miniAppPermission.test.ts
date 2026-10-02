import { describe, expect, it } from 'vitest'

import enUs from '@renderer/i18n/locales/en-us.json'
import zhCn from '@renderer/i18n/locales/zh-cn.json'
import { MINI_APP_NAMESPACES, MINI_APP_PERMISSIONS } from '@shared/types/miniAppManifest'

import { groupPermissionsByNamespace, permissionLabel } from '../miniAppPermission'

/**
 * `t()` with a dynamic key is invisible to the i18n checker, so a capability added to
 * `MINI_APP_METHODS` without copy would reach the consent card as `storage.new`. This
 * is the check that catches it, in the two catalogs that are hand-maintained.
 */
describe('mini app permission copy', () => {
  const catalogs: Record<string, Record<string, string>> = { 'en-us': enUs, 'zh-cn': zhCn }

  it.each(Object.keys(catalogs))('%s names every grantable leaf and namespace', (locale) => {
    const catalog = catalogs[locale]
    const missing = [
      ...MINI_APP_PERMISSIONS.map((leaf) => `miniApp.permission.leaf.${leaf}`),
      ...MINI_APP_NAMESPACES.flatMap((ns) => [
        `miniApp.permission.ns.${ns}.title`,
        `miniApp.permission.ns.${ns}.description`
      ])
    ].filter((key) => !catalog[key])
    expect(missing).toEqual([])
  })

  it('falls back to the technical name for a leaf the catalog does not know', () => {
    // A bare name is worse than a translation, but it is better than a missing-key
    // marker; the contract test above is what makes this path unreachable in practice.
    const t = ((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key) as never
    expect(permissionLabel(t, 'future.thing')).toBe('future · future.thing')
  })

  it('orders namespaces AI → network → sandbox regardless of how the manifest lists them', () => {
    // A manifest that names the network last still shows it right under AI: the order is
    // the reader's, not the author's. Leaves keep the order given.
    expect(
      groupPermissionsByNamespace([
        'storage.set',
        'notification.show',
        'file.save',
        'ai.chat',
        'clipboard.write',
        'storage.get',
        'network.fetch'
      ])
    ).toEqual([
      { namespace: 'ai', leaves: ['ai.chat'] },
      { namespace: 'network', leaves: ['network.fetch'] },
      { namespace: 'clipboard', leaves: ['clipboard.write'] },
      { namespace: 'file', leaves: ['file.save'] },
      { namespace: 'storage', leaves: ['storage.set', 'storage.get'] },
      { namespace: 'notification', leaves: ['notification.show'] }
    ])
  })

  it('puts a namespace it does not know after the known ones', () => {
    expect(groupPermissionsByNamespace(['future.thing', 'ai.chat']).map((g) => g.namespace)).toEqual(['ai', 'future'])
  })
})
