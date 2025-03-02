import { CheckOutlined, InfoCircleOutlined, LoadingOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultWebSearchProvider, useWebSearchProviders } from '@renderer/hooks/useWebSearchProviders'
import WebSearchService from '@renderer/services/WebSearchService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setExcludeDomains, setMaxResult, setSearchWithTime } from '@renderer/store/websearch'
import { parseMatchPattern } from '@renderer/utils/blacklistMatchPattern'
import { Alert, Button, Select, Slider, Switch } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { t } from 'i18next'
import { FC, useEffect, useState } from 'react'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const BasicSettings: FC = () => {
  const { theme } = useTheme()
  const { providers } = useWebSearchProviders()
  const { provider: defaultProvider, setDefaultProvider } = useDefaultWebSearchProvider()
  const [selectedProviderId, setSelectedProviderId] = useState<string>('') // 初始值为空字符串

  const searchWithTime = useAppSelector((state) => state.websearch.searchWithTime)
  const maxResults = useAppSelector((state) => state.websearch.maxResults)
  const excludeDomains = useAppSelector((state) => state.websearch.excludeDomains)
  const [errFormat, setErrFormat] = useState(false)
  const [blacklistInput, setBlacklistInput] = useState('')
  const [apiChecking, setApiChecking] = useState(false)
  const [apiValid, setApiValid] = useState(false)

  const dispatch = useAppDispatch()

  useEffect(() => {
    if (excludeDomains) {
      setBlacklistInput(excludeDomains.join('\n'))
    }
  }, [excludeDomains])

  // 添加一个 useEffect 来监听 defaultProvider 的变化
  useEffect(() => {
    console.log('defaultProvider:', defaultProvider)
    if (defaultProvider && defaultProvider.id && defaultProvider.enabled) {
      setSelectedProviderId(defaultProvider.id)
    } else {
      setSelectedProviderId('') // 如果没有默认提供商，保持为空
    }
  }, [defaultProvider])

  function updateManualBlacklist(blacklist: string) {
    const blacklistDomains = blacklist.split('\n').filter((url) => url.trim() !== '')

    const validDomains: string[] = []
    const hasError = blacklistDomains.some((domain) => {
      const parsed = parseMatchPattern(domain.trim())
      if (parsed === null) {
        return true // 有错误
      }
      validDomains.push(domain.trim())
      return false
    })

    setErrFormat(hasError)
    if (hasError) return

    dispatch(setExcludeDomains(validDomains))
  }

  function updateSelectedWebSearchProvider(providerId: string) {
    setApiValid(false)
    if (!providerId) {
      setSelectedProviderId('')
      return
    }

    const provider = providers.find((p) => p.id === providerId)
    if (!provider) {
      throw new Error(`Web search provider with id ${providerId} not found`)
    }

    setSelectedProviderId(providerId)
    setDefaultProvider(provider) // 这会将选择保存到Redux状态中
  }
  async function checkSearch() {
    setApiChecking(true)
    if (selectedProviderId) {
      const provider = providers.find((p) => p.id === selectedProviderId)
      if (!provider) {
        setApiChecking(false)
        setApiValid(false)
        return
      }
      const valid = await WebSearchService.checkSearch(provider)
      setApiValid(valid)
    } else {
      window.message.info({
        content: t('settings.websearch.no_provider_selected'),
        duration: 4,
        icon: <InfoCircleOutlined />,
        key: 'quick-assistant-info'
      })
      setApiValid(false)
    }
    setApiChecking(false)
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.general.title')}</SettingTitle>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.websearch.search_provider')}</SettingRowTitle>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Select
              value={selectedProviderId || undefined}
              style={{ width: '200px' }}
              onChange={(value: string) => updateSelectedWebSearchProvider(value)}
              placeholder={t('settings.websearch.search_provider_placeholder')}
              options={providers.filter((p) => p.enabled === true).map((p) => ({ value: p.id, label: p.name }))}
            />
            <Button
              type={apiValid ? 'primary' : 'default'}
              onClick={async () => await checkSearch()}
              disabled={apiChecking}>
              {apiChecking ? <LoadingOutlined spin /> : apiValid ? <CheckOutlined /> : t('settings.websearch.check')}
            </Button>
          </div>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.websearch.search_with_time')}</SettingRowTitle>
          <Switch checked={searchWithTime} onChange={(checked) => dispatch(setSearchWithTime(checked))} />
        </SettingRow>
        <SettingDivider style={{ marginTop: 15, marginBottom: 5 }} />
        <SettingRow style={{ marginBottom: -10 }}>
          <SettingRowTitle>{t('settings.websearch.search_max_result')}</SettingRowTitle>
          <Slider
            defaultValue={maxResults}
            style={{ width: '200px' }}
            min={1}
            max={20}
            step={1}
            marks={{ 1: '1', 5: t('settings.websearch.search_result_default'), 20: '20' }}
            onChangeComplete={(value) => dispatch(setMaxResult(value))}
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.websearch.blacklist')}</SettingTitle>
        <SettingDivider />
        <SettingRow style={{ marginBottom: 10 }}>
          <SettingRowTitle>{t('settings.websearch.blacklist_description')}</SettingRowTitle>
        </SettingRow>
        <TextArea
          value={blacklistInput}
          onChange={(e) => setBlacklistInput(e.target.value)}
          placeholder={t('settings.websearch.blacklist_tooltip')}
          autoSize={{ minRows: 4, maxRows: 8 }}
          rows={4}
        />
        <Button onClick={() => updateManualBlacklist(blacklistInput)} style={{ marginTop: 10 }}>
          {t('common.save')}
        </Button>
        {errFormat && <Alert message={t('settings.websearch.blacklist_tooltip')} type="error" />}
      </SettingGroup>
    </SettingContainer>
  )
}
export default BasicSettings
