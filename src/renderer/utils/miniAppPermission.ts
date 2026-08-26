import type { TFunction } from 'i18next'

/**
 * Human-readable copy for capability leaves (`storage.get`) and their namespaces.
 *
 * The registry (`MINI_APP_METHODS`) is shared and knows nothing about locales; the
 * words a user reads live in the renderer catalog under `miniApp.permission.*`. The
 * contract test next to this file keeps the two in step: every grantable leaf and
 * namespace must have an entry, or a new capability ships as a bare technical name.
 */

export const permissionNamespaceOf = (leaf: string): string => leaf.split('.')[0]

export const permissionNamespaceTitle = (t: TFunction, namespace: string): string =>
  t(`miniApp.permission.ns.${namespace}.title`, { defaultValue: namespace })

export const permissionNamespaceDescription = (t: TFunction, namespace: string): string =>
  t(`miniApp.permission.ns.${namespace}.description`, { defaultValue: '' })

export const permissionLeafLabel = (t: TFunction, leaf: string): string =>
  t(`miniApp.permission.leaf.${leaf}`, { defaultValue: leaf })

/** `Storage · Read` — the one-line form for lists that mix namespaces. */
export const permissionLabel = (t: TFunction, leaf: string): string =>
  `${permissionNamespaceTitle(t, permissionNamespaceOf(leaf))} · ${permissionLeafLabel(t, leaf)}`

/** The rows' order: what the app can reach out to first, then what it keeps in its sandbox. */
const NAMESPACE_ORDER = ['ai', 'network', 'clipboard', 'file', 'storage', 'notification']

const namespaceRank = (namespace: string): number => {
  const index = NAMESPACE_ORDER.indexOf(namespace)
  return index === -1 ? NAMESPACE_ORDER.length : index
}

/** Namespaces in `NAMESPACE_ORDER` (unknown ones last, first-seen), leaves in the order given. */
export function groupPermissionsByNamespace(keys: readonly string[]): Array<{ namespace: string; leaves: string[] }> {
  const groups = new Map<string, string[]>()
  for (const key of keys) {
    const namespace = permissionNamespaceOf(key)
    groups.set(namespace, [...(groups.get(namespace) ?? []), key])
  }
  return [...groups]
    .map(([namespace, leaves]) => ({ namespace, leaves }))
    .sort((a, b) => namespaceRank(a.namespace) - namespaceRank(b.namespace))
}
