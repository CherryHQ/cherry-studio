import { CheckOutlined, InfoCircleOutlined, LoadingOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useBlacklist } from '@renderer/hooks/useWebSearchProviders'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setExcludeDomains } from '@renderer/store/websearch'
import { parseMatchPattern, parseSubscribeContent } from '@renderer/utils/blacklistMatchPattern'
import { Alert, Button, Table, TableProps } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { t } from 'i18next'
import { FC, useEffect, useState } from 'react'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'
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
const BlacklistSettings: FC = () => {
  const [errFormat, setErrFormat] = useState(false)
  const [blacklistInput, setBlacklistInput] = useState('')
  const excludeDomains = useAppSelector((state) => state.websearch.excludeDomains)
  const { websearch, setSubscribeSources, addSubscribeSource } = useBlacklist()
  const { theme } = useTheme()
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
    if (excludeDomains) {
      setBlacklistInput(excludeDomains.join('\n'))
    }
  }, [excludeDomains])

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
    <>
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
    </>
  )
}
export default BlacklistSettings
