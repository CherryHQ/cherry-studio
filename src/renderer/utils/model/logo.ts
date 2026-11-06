import type { IconRef } from '@cherrystudio/ui/icons'
import { providerIconRef, resolveIconRef, resolveModelIconRef } from '@cherrystudio/ui/icons'
import { getLowerBaseModelName } from '@renderer/utils/naming'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'

type LogoModel = {
  id: string
  name: string
  apiModelId?: string
  provider?: string
  providerId?: string
}

type LogoProvider = { id: string; presetProviderId?: string }

/**
 * Resolve a model's logo to an IconRef (meta catalogs only — no icon components
 * on this path). Render the component via `useIcon(ref)`.
 *
 * v2 `Model.id` is a UniqueModelId ("providerId::modelId"), so we must match on
 * the real model id — `apiModelId` when present, else the `modelId` half of the
 * unique id — reduced to its lowercased base name (drops any `vendor/` namespace
 * and `:free`/`:cloud` suffix). The `@cherrystudio/ui` registry can't import
 * `@renderer`/`@shared`, so this id derivation is the single caller-side entry
 * point — prefer it over calling `resolveIconRef` directly with a raw id.
 */
export function getModelLogoRef(
  model: LogoModel | undefined | null,
  provider?: string | LogoProvider
): IconRef | undefined {
  if (!model) return undefined
  const identity = isUniqueModelId(model.id) ? parseUniqueModelId(model.id) : undefined
  const rawId = model.apiModelId ?? identity?.modelId ?? model.id
  const id = getLowerBaseModelName(rawId ?? '')
  const name = model.name ? getLowerBaseModelName(model.name) : ''
  const pid =
    (typeof provider === 'string' ? provider : provider?.id) ??
    model.providerId ??
    model.provider ??
    identity?.providerId
  const icon = pid
    ? (resolveIconRef(id, pid) ?? resolveIconRef(name, pid))
    : (resolveModelIconRef(id) ?? resolveModelIconRef(name))

  if (icon?.kind === 'model' && icon.key === 'qwen') {
    const platform = typeof provider === 'object' ? (provider.presetProviderId ?? provider.id) : pid
    if (platform === 'dashscope' || platform === 'qwencloud') {
      return providerIconRef(platform)
    }
  }
  return icon
}
