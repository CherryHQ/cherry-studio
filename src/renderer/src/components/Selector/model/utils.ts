import { getProviderLabel } from '@renderer/i18n/label'
import type { Provider } from '@shared/data/types/provider'

/**
 * 获取服务商展示名。
 *
 * 内置服务商 = `provider.id === provider.presetProviderId`（provider 本身就是 preset）。
 * 基于 preset 派生的自定义 provider（id 已换成用户自己的），`presetProviderId` 同样存在
 * 但 id 不同，此时走用户设置的 `provider.name`，避免多个派生 provider 全部被翻译成同名。
 */
export function getProviderDisplayName(provider: Provider): string {
  if (provider.presetProviderId && provider.id === provider.presetProviderId) {
    return getProviderLabel(provider.presetProviderId)
  }
  return provider.name
}
