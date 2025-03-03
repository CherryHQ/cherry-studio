import { CheckOutlined, InfoCircleOutlined, LoadingOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useWebSearch } from '@renderer/hooks/useWebSearch'
import { useDefaultWebSearchProvider, useWebSearchProviders } from '@renderer/hooks/useWebSearchProviders'
import WebSearchService from '@renderer/services/WebSearchService'
import { useAppDispatch } from '@renderer/store'
import { setExcludeDomains, setMaxResult, setSearchWithTime } from '@renderer/store/websearch'
import { parseMatchPattern, parseSubscribeContent } from '@renderer/utils/blacklist'
import type { TableProps } from 'antd'
import { Alert, Button, Select, Slider, Switch, Table } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { t } from 'i18next'
import { FC, useEffect, useState } from 'react'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'
import AddSubscribePopup from './AddSubscribePopup'

type TableRowSelection<T extends object = object> = TableProps<T>['rowSelection']
interface DataType {
  key: React.Key
  url: string
  name: string
}
const columns: TableProps<DataType>['columns'] = [
  { title: t('common.name'), dataIndex: 'name', key: 'name' },
  {
    title: 'URL',
    dataIndex: 'url',
    key: 'url'
  }
]
const BasicSettings: FC = () => {
  const { theme } = useTheme()
  const { providers } = useWebSearchProviders()
  const { provider: defaultProvider, setDefaultProvider } = useDefaultWebSearchProvider()
  const [selectedProviderId, setSelectedProviderId] = useState<string>('') // 初始值为空字符串
  const { websearch, setSubscribeSources, addSubscribeSource } = useWebSearch()

  const [errFormat, setErrFormat] = useState(false)
  const [blacklistInput, setBlacklistInput] = useState('')
  const [apiChecking, setApiChecking] = useState(false)
  const [apiValid, setApiValid] = useState(false)
  const [subscribeChecking, setSubscribeChecking] = useState(false)
  const [subscribeValid, setSubscribeValid] = useState(false)

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [dataSource, setDataSource] = useState<DataType[]>(
    websearch.subscribeSources?.map((source) => ({
      key: source.key,
      url: source.url,
      name: source.name
    })) || []
  )

  const dispatch = useAppDispatch()

  // 添加 useEffect 以监听 subscribeSources 的变化
  useEffect(() => {
    setDataSource(
      (websearch.subscribeSources || []).map((source) => ({
        key: source.key,
        url: source.url,
        name: source.name
      }))
    )
    console.log('subscribeSources', websearch.subscribeSources)
  }, [websearch.subscribeSources])

  useEffect(() => {
    if (websearch.excludeDomains) {
      setBlacklistInput(websearch.excludeDomains.join('\n'))
    }
  }, [websearch.excludeDomains])

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
    window.message.info({
      content: t('message.save.success.title'),
      duration: 4,
      icon: <InfoCircleOutlined />,
      key: 'save-blacklist-info'
    })
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
      const { valid, error } = await WebSearchService.checkSearch(provider)
      const errorMessage = error && error?.message ? ' ' + error?.message : ''

      window.message[valid ? 'success' : 'error']({
        key: 'api-check',
        style: { marginTop: '3vh' },
        duration: valid ? 2 : 8,
        content: valid ? t('message.api.connection.success') : t('message.api.connection.failed') + errorMessage
      })
      setApiValid(valid)
      setApiChecking(false)
      setTimeout(() => setApiValid(false), 3000)
    } else {
      window.message.info({
        content: t('settings.websearch.no_provider_selected'),
        duration: 4,
        icon: <InfoCircleOutlined />,
        key: 'quick-assistant-info'
      })
      setApiValid(false)
      setApiChecking(false)
    }
  }
  const onSelectChange = (newSelectedRowKeys: React.Key[]) => {
    console.log('selectedRowKeys changed: ', newSelectedRowKeys)
    setSelectedRowKeys(newSelectedRowKeys)
  }

  const rowSelection: TableRowSelection<DataType> = {
    selectedRowKeys,
    onChange: onSelectChange
  }
  async function updateSubscribe() {
    setSubscribeChecking(true)

    try {
      // 获取选中的订阅源
      const selectedSources = dataSource.filter((item) => selectedRowKeys.includes(item.key))

      // 用于存储所有成功解析的订阅源数据
      const updatedSources: {
        key: number
        url: string
        name: string
        blacklist: string[]
      }[] = []

      // 为每个选中的订阅源获取并解析内容
      for (const source of selectedSources) {
        try {
          // 获取并解析订阅源内容
          const blacklist = await parseSubscribeContent(source.url)

          if (blacklist.length > 0) {
            updatedSources.push({
              key: Number(source.key),
              url: source.url,
              name: source.name,
              blacklist
            })
          }
        } catch (error) {
          console.error(`Error updating subscribe source ${source.url}:`, error)
          // 显示具体源更新失败的消息
          window.message.warning({
            content: t('settings.websearch.subscribe_source_update_failed', { url: source.url }),
            duration: 3
          })
        }
      }

      if (updatedSources.length > 0) {
        // 更新 Redux store
        setSubscribeSources(updatedSources)
        setSubscribeValid(true)
        // 显示成功消息
        window.message.success({
          content: t('settings.websearch.subscribe_update_success'),
          duration: 2
        })
        setTimeout(() => setSubscribeValid(false), 3000)
      } else {
        setSubscribeValid(false)
        throw new Error('No valid sources updated')
      }
    } catch (error) {
      console.error('Error updating subscribes:', error)
      window.message.error({
        content: t('settings.websearch.subscribe_update_failed'),
        duration: 2
      })
    }
    setSubscribeChecking(false)
  }

  // 修改 handleAddSubscribe 函数
  async function handleAddSubscribe() {
    setSubscribeChecking(true)
    const result = await AddSubscribePopup.show({
      title: t('settings.websearch.subscribe_add')
    })

    if (result && result.url) {
      try {
        // 获取并解析订阅源内容
        const blacklist = await parseSubscribeContent(result.url)

        if (blacklist.length === 0) {
          throw new Error('No valid patterns found in subscribe content')
        }
        // 添加到 Redux store
        addSubscribeSource({
          url: result.url,
          name: result.name || result.url,
          blacklist
        })
        setSubscribeValid(true)
        // 显示成功消息
        window.message.success({
          content: t('settings.websearch.subscribe_add_success'),
          duration: 2
        })
        setTimeout(() => setSubscribeValid(false), 3000)
      } catch (error) {
        setSubscribeValid(false)
        window.message.error({
          content: t('settings.websearch.subscribe_add_failed'),
          duration: 2
        })
      }
    }
    setSubscribeChecking(false)
  }
  function handleDeleteSubscribe() {
    try {
      // 过滤掉被选中要删除的项目
      const remainingSources =
        websearch.subscribeSources?.filter((source) => !selectedRowKeys.includes(source.key)) || []

      // 更新 Redux store
      setSubscribeSources(remainingSources)

      // 清空选中状态
      setSelectedRowKeys([])
    } catch (error) {
      console.error('Error deleting subscribes:', error)
    }
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
              ghost={apiValid}
              onClick={async () => await checkSearch()}
              disabled={apiChecking}>
              {apiChecking ? <LoadingOutlined spin /> : apiValid ? <CheckOutlined /> : t('settings.websearch.check')}
            </Button>
          </div>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.websearch.search_with_time')}</SettingRowTitle>
          <Switch checked={websearch.searchWithTime} onChange={(checked) => dispatch(setSearchWithTime(checked))} />
        </SettingRow>
        <SettingDivider style={{ marginTop: 15, marginBottom: 5 }} />
        <SettingRow style={{ marginBottom: -10 }}>
          <SettingRowTitle>{t('settings.websearch.search_max_result')}</SettingRowTitle>
          <Slider
            defaultValue={websearch.maxResults}
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
        <SettingDivider />
        <SettingTitle>{t('settings.websearch.subscribe')}</SettingTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <SettingRow>
            {t('settings.websearch.subscribe_tooltip')}
            <Button
              type={subscribeValid ? 'primary' : 'default'}
              ghost={subscribeValid}
              disabled={subscribeChecking}
              onClick={handleAddSubscribe}>
              {t('settings.websearch.subscribe_add')}
            </Button>
          </SettingRow>
          <Table<DataType>
            rowSelection={{ type: 'checkbox', ...rowSelection }}
            columns={columns}
            dataSource={dataSource}
            pagination={{ position: ['none'] }}
          />
          <SettingRow>
            <Button
              type={subscribeValid ? 'primary' : 'default'}
              ghost={subscribeValid}
              disabled={subscribeChecking || selectedRowKeys.length === 0}
              style={{ width: 100 }}
              onClick={updateSubscribe}>
              {subscribeChecking ? (
                <LoadingOutlined spin />
              ) : subscribeValid ? (
                <CheckOutlined />
              ) : (
                t('settings.websearch.subscribe_update')
              )}
            </Button>
            <Button style={{ width: 100 }} disabled={selectedRowKeys.length === 0} onClick={handleDeleteSubscribe}>
              {t('settings.websearch.subscribe_delete')}
            </Button>
          </SettingRow>
        </div>
      </SettingGroup>
    </SettingContainer>
  )
}
export default BasicSettings
