import { CheckOutlined, LoadingOutlined } from '@ant-design/icons'
import { Button } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import { useBlacklist } from '@renderer/hooks/useWebSearchProviders'
import { parseMatchPattern, parseSubscribeContent } from '@renderer/utils/blacklistMatchPattern'
import type { TableProps } from 'antd'
import { Alert, Table } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { t } from 'i18next'
import type { FC } from 'react'
import { useEffect, useState } from 'react'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'
import AddSubscribePopup from './AddSubscribePopup'

type TableRowSelection<T extends object = object> = TableProps<T>['rowSelection']
interface DataType {
  key: React.Key
  url: string
  name: string
}

const logger = loggerService.withContext('BlacklistSettings')

const columns: TableProps<DataType>['columns'] = [
  { title: t('common.name'), dataIndex: 'name', key: 'name' },
  {
    title: 'URL',
    dataIndex: 'url',
    key: 'url'
  }
]

const BlacklistSettings: FC = () => {
  const [errFormat, setErrFormat] = useState(false)
  const [blacklistInput, setBlacklistInput] = useState('')
  const { subscribeSources, excludeDomains, setExcludeDomains, setSubscribeSources, addSubscribeSource } =
    useBlacklist()
  const { theme } = useTheme()
  const [subscribeChecking, setSubscribeChecking] = useState(false)
  const [subscribeValid, setSubscribeValid] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
  const [dataSource, setDataSource] = useState<DataType[]>(
    subscribeSources.map((source) => ({
      key: source.key,
      url: source.url,
      name: source.name
    }))
  )
  const { setTimeoutTimer } = useTimer()
  useEffect(() => {
    setDataSource(
      subscribeSources.map((source) => ({
        key: source.key,
        url: source.url,
        name: source.name
      }))
    )
    logger.info('subscribeSources', subscribeSources)
  }, [subscribeSources])

  useEffect(() => {
    if (excludeDomains) {
      setBlacklistInput(excludeDomains.join('\n'))
    }
  }, [excludeDomains])

  async function updateManualBlacklist(blacklist: string) {
    const blacklistDomains = blacklist.split('\n').filter((url) => url.trim() !== '')
    const validDomains: string[] = []
    const hasError = blacklistDomains.some((domain) => {
      const trimmedDomain = domain.trim()
      // 正则表达式
      if (trimmedDomain.startsWith('/') && trimmedDomain.endsWith('/')) {
        try {
          const regexPattern = trimmedDomain.slice(1, -1)
          new RegExp(regexPattern, 'i')
          validDomains.push(trimmedDomain)
          return false
        } catch (error) {
          return true
        }
      } else {
        const parsed = parseMatchPattern(trimmedDomain)
        if (parsed === null) {
          return true
        }
        validDomains.push(trimmedDomain)
        return false
      }
    })

    setErrFormat(hasError)
    if (hasError) return

    await setExcludeDomains(validDomains)
    window.toast.info({
      title: t('message.save.success.title'),
      timeout: 4000
    })
  }
  const onSelectChange = (newSelectedRowKeys: React.Key[]) => {
    logger.info('selectedRowKeys changed: ', newSelectedRowKeys)
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
          logger.error(`Error updating subscribe source ${source.url}:`, error as Error)
          // 显示具体源更新失败的消息
          window.toast.warning({
            title: t('settings.tool.websearch.subscribe_update_failed', { url: source.url }),
            timeout: 3000
          })
        }
      }

      if (updatedSources.length > 0) {
        const updatedSourceMap = new Map(updatedSources.map((source) => [source.key, source]))
        await setSubscribeSources(subscribeSources.map((source) => updatedSourceMap.get(source.key) ?? source))
        setSubscribeValid(true)
        // 显示成功消息
        window.toast.success({
          title: t('settings.tool.websearch.subscribe_update_success'),
          timeout: 2000
        })
        setTimeoutTimer('updateSubscribe', () => setSubscribeValid(false), 3000)
      } else {
        setSubscribeValid(false)
        throw new Error('No valid sources updated')
      }
    } catch (error) {
      logger.error('Error updating subscribes:', error as Error)
      window.toast.error({
        title: t('settings.tool.websearch.subscribe_update_failed'),
        timeout: 2000
      })
    }
    setSubscribeChecking(false)
  }

  // 修改 handleAddSubscribe 函数
  async function handleAddSubscribe() {
    setSubscribeChecking(true)
    const result = await AddSubscribePopup.show({
      title: t('settings.tool.websearch.subscribe_add')
    })

    if (result && result.url) {
      try {
        // 获取并解析订阅源内容
        const blacklist = await parseSubscribeContent(result.url)

        if (blacklist.length === 0) {
          throw new Error('No valid patterns found in subscribe content')
        }
        await addSubscribeSource({
          url: result.url,
          name: result.name || result.url,
          blacklist
        })
        setSubscribeValid(true)
        // 显示成功消息
        window.toast.success({
          title: t('settings.tool.websearch.subscribe_add_success'),
          timeout: 2000
        })
        setTimeoutTimer('handleAddSubscribe', () => setSubscribeValid(false), 3000)
      } catch (error) {
        setSubscribeValid(false)
        window.toast.error({
          title: t('settings.tool.websearch.subscribe_add_failed'),
          timeout: 2000
        })
      }
    }
    setSubscribeChecking(false)
  }
  async function handleDeleteSubscribe() {
    try {
      const remainingSources = subscribeSources.filter((source) => !selectedRowKeys.includes(source.key))

      await setSubscribeSources(remainingSources)

      setSelectedRowKeys([])
    } catch (error) {
      logger.error('Error deleting subscribes:', error as Error)
      window.toast.error({
        title: t('error.diagnosis.unknown'),
        timeout: 2000
      })
    }
  }

  return (
    <>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.tool.websearch.blacklist')}</SettingTitle>
        <SettingDivider />
        <SettingRow style={{ marginBottom: 10 }}>
          <SettingRowTitle>{t('settings.tool.websearch.blacklist_description')}</SettingRowTitle>
        </SettingRow>
        <TextArea
          value={blacklistInput}
          onChange={(e) => setBlacklistInput(e.target.value)}
          placeholder={t('settings.tool.websearch.blacklist_tooltip')}
          autoSize={{ minRows: 4, maxRows: 8 }}
          rows={4}
        />
        <Button onClick={() => updateManualBlacklist(blacklistInput)} style={{ marginTop: 10 }}>
          {t('common.save')}
        </Button>
        {errFormat && (
          <Alert style={{ marginTop: 10 }} message={t('settings.tool.websearch.blacklist_tooltip')} type="error" />
        )}
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>
          {t('settings.tool.websearch.subscribe')}
          <Button
            variant={subscribeValid ? 'ghost' : 'default'}
            disabled={subscribeChecking}
            onClick={handleAddSubscribe}>
            {t('settings.tool.websearch.subscribe_add')}
          </Button>
        </SettingTitle>
        <SettingDivider />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <Table<DataType>
            rowSelection={{ type: 'checkbox', ...rowSelection }}
            columns={columns}
            dataSource={dataSource}
            pagination={{ position: ['none'] }}
            tableLayout="fixed"
          />
          <SettingRow style={{ height: 50 }}>
            <Button
              variant={subscribeValid ? 'ghost' : 'default'}
              disabled={subscribeChecking || selectedRowKeys.length === 0}
              style={{ width: 100 }}
              onClick={updateSubscribe}>
              {subscribeChecking ? (
                <LoadingOutlined spin />
              ) : subscribeValid ? (
                <CheckOutlined />
              ) : (
                t('settings.tool.websearch.subscribe_update')
              )}
            </Button>
            <Button style={{ width: 100 }} disabled={selectedRowKeys.length === 0} onClick={handleDeleteSubscribe}>
              {t('settings.tool.websearch.subscribe_delete')}
            </Button>
          </SettingRow>
        </div>
      </SettingGroup>
    </>
  )
}
export default BlacklistSettings
