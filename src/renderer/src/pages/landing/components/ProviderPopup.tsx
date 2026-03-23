import GeneralPopup from '@renderer/components/Popups/GeneralPopup'
import { ProviderAvatar } from '@renderer/components/ProviderAvatar'
import Scrollbar from '@renderer/components/Scrollbar'
import { useAllProviders } from '@renderer/hooks/useProvider'
import type { Provider } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils'
import { Input } from 'antd'
import { isEmpty } from 'lodash'
import { Search } from 'lucide-react'
import type { FC } from 'react'
import { startTransition, useState } from 'react'

import ProviderSetting from '../../../pages/settings/ProviderSettings/ProviderSetting'

const ProviderPopupContent: FC = () => {
  const providers = useAllProviders()
  const [selectedProvider, _setSelectedProvider] = useState<Provider>(providers[0])
  const [searchText, setSearchText] = useState('')

  const setSelectedProvider = (provider: Provider) => {
    startTransition(() => _setSelectedProvider(provider))
  }

  const filteredProviders = providers.filter((p) => {
    if (!searchText) return true
    return getFancyProviderName(p).toLowerCase().includes(searchText.toLowerCase())
  })

  return (
    <div className="flex h-full w-full">
      {/* 左侧服务商列表 */}
      <div className="flex w-64 shrink-0 flex-col border-(--color-border) border-r">
        <div className="px-3 pt-3 pb-1">
          <Input
            placeholder="搜索模型平台..."
            prefix={<Search size={14} className="text-(--color-text-3)" />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
          />
        </div>
        <Scrollbar className="flex-1">
          <div className="flex flex-col gap-1 p-2">
            {filteredProviders.map((provider) => (
              <div
                key={provider.id}
                className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 transition-colors ${
                  selectedProvider?.id === provider.id
                    ? 'bg-(--color-background-soft)'
                    : 'hover:bg-(--color-background-soft)'
                }`}
                onClick={() => setSelectedProvider(provider)}>
                <div className="flex items-center gap-2">
                  <ProviderAvatar provider={provider} size={24} />
                  <span className="text-sm">{getFancyProviderName(provider)}</span>
                </div>
                {provider.enabled && !isEmpty(provider.apiKey) && (
                  <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-green-600 text-xs">ON</span>
                )}
              </div>
            ))}
          </div>
        </Scrollbar>
      </div>

      {/* 右侧配置面板 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {selectedProvider && (
          <Scrollbar className="flex-1">
            <ProviderSetting key={selectedProvider.id} providerId={selectedProvider.id} />
          </Scrollbar>
        )}
      </div>
    </div>
  )
}

export default class ProviderPopup {
  static show() {
    return GeneralPopup.show({
      title: '选择其他服务商',
      content: <ProviderPopupContent />,
      footer: null,
      width: 900,
      styles: {
        header: {
          borderBottom: '1px solid var(--color-border)',
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          paddingBottom: 12,
          paddingTop: 12,
          marginBottom: 0
        },
        body: { padding: 0, height: '70vh', display: 'flex' },
        content: { paddingBottom: 0 }
      }
    })
  }

  static hide() {
    GeneralPopup.hide()
  }
}
