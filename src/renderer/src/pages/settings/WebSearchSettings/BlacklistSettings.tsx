import type { ColumnDef } from '@cherrystudio/ui'
import { Alert, Button, DataTable, Textarea } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useTimer } from '@renderer/hooks/useTimer'
import { useBlacklist } from '@renderer/hooks/useWebSearchProviders'
import { parseMatchPattern, parseSubscribeContent } from '@renderer/utils/blacklistMatchPattern'
import { t } from 'i18next'
import { Check, Info, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'
import AddSubscribePopup from './AddSubscribePopup'

interface DataType {
  key: React.Key
  url: string
  name: string
}

const logger = loggerService.withContext('BlacklistSettings')

const columns: ColumnDef<DataType>[] = [
  {
    accessorKey: 'name',
    header: t('common.name'),
    meta: { width: 200 }
  },
  {
    accessorKey: 'url',
    header: 'URL',
    meta: { width: 'calc(100% - 244px)' }
  }
]

const BlacklistSettings: FC = () => {
  const [errFormat, setErrFormat] = useState(false)
  const [blacklistInput, setBlacklistInput] = useState('')
  const { subscribeSources, excludeDomains, setExcludeDomains, setSubscribeSources, addSubscribeSource } =
    useBlacklist()
  const { theme } = useTheme()
  const [subscribeAction, setSubscribeAction] = useState<'add' | 'update' | null>(null)
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

  const subscribeChecking = subscribeAction !== null

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
      if (trimmedDomain.startsWith('/') && trimmedDomain.endsWith('/')) {
        try {
          const regexPattern = trimmedDomain.slice(1, -1)
          new RegExp(regexPattern, 'i')
          validDomains.push(trimmedDomain)
          return false
        } catch {
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
      timeout: 4000,
      icon: <Info className="size-4" />
    })
  }

  const onSelectChange = (newSelectedRowKeys: React.Key[]) => {
    logger.info('selectedRowKeys changed: ', newSelectedRowKeys)
    setSelectedRowKeys(newSelectedRowKeys)
  }

  async function updateSubscribe() {
    setSubscribeAction('update')

    try {
      const selectedSources = dataSource.filter((item) => selectedRowKeys.includes(item.key))

      const updatedSources: {
        key: number
        url: string
        name: string
        blacklist: string[]
      }[] = []

      for (const source of selectedSources) {
        try {
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
          window.toast.warning({
            title: t('settings.tool.websearch.subscribe_update_failed', { url: source.url }),
            timeout: 3000
          })
        }
      }

      if (updatedSources.length > 0) {
        await setSubscribeSources(updatedSources)
        setSubscribeValid(true)
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
    } finally {
      setSubscribeAction(null)
    }
  }

  async function handleAddSubscribe() {
    const result = await AddSubscribePopup.show({
      title: t('settings.tool.websearch.subscribe_add')
    })

    if (!result?.url) {
      return
    }

    setSubscribeAction('add')
    try {
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
      window.toast.success({
        title: t('settings.tool.websearch.subscribe_add_success'),
        timeout: 2000
      })
      setTimeoutTimer('handleAddSubscribe', () => setSubscribeValid(false), 3000)
    } catch {
      setSubscribeValid(false)
      window.toast.error({
        title: t('settings.tool.websearch.subscribe_add_failed'),
        timeout: 2000
      })
    } finally {
      setSubscribeAction(null)
    }
  }

  async function handleDeleteSubscribe() {
    try {
      const remainingSources = subscribeSources.filter((source) => !selectedRowKeys.includes(source.key))
      await setSubscribeSources(remainingSources)
      setSelectedRowKeys([])
    } catch (error) {
      logger.error('Error deleting subscribes:', error as Error)
    }
  }

  return (
    <>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.tool.websearch.blacklist')}</SettingTitle>
        <SettingDivider />
        <SettingRow className="pt-2 pb-3">
          <SettingRowTitle className="text-foreground-muted leading-5">
            {t('settings.tool.websearch.blacklist_description')}
          </SettingRowTitle>
        </SettingRow>
        <Textarea.Input
          value={blacklistInput}
          onChange={(e) => setBlacklistInput(e.target.value)}
          placeholder={t('settings.tool.websearch.blacklist_tooltip')}
          className="max-h-48 min-h-28 rounded-lg text-sm leading-5 shadow-none"
          rows={4}
        />
        <div className="mt-2.5 flex justify-end">
          <Button type="button" size="sm" variant="outline" onClick={() => void updateManualBlacklist(blacklistInput)}>
            {t('common.save')}
          </Button>
        </div>
        {errFormat && (
          <Alert className="mt-2.5" message={t('settings.tool.websearch.blacklist_tooltip')} type="error" />
        )}
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.tool.websearch.subscribe')}</SettingTitle>
        <SettingDivider />
        <div className="mt-3">
          <DataTable
            data={dataSource}
            columns={columns}
            rowKey="key"
            emptyText={t('common.no_results')}
            selection={{
              type: 'multiple',
              selectedRowKeys,
              onChange: onSelectChange
            }}
            tableLayout="fixed"
            headerRight={
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={subscribeAction === 'update'}
                  disabled={subscribeChecking || selectedRowKeys.length === 0}
                  onClick={() => void updateSubscribe()}>
                  {subscribeValid ? <Check className="size-3.5" /> : <RefreshCw className="size-3.5" />}
                  {t('settings.tool.websearch.subscribe_update')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  disabled={subscribeChecking || selectedRowKeys.length === 0}
                  onClick={() => void handleDeleteSubscribe()}>
                  <Trash2 className="size-3.5" />
                  {t('settings.tool.websearch.subscribe_delete')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={subscribeAction === 'add'}
                  disabled={subscribeChecking}
                  onClick={() => void handleAddSubscribe()}>
                  <Plus className="size-3.5" />
                  {t('settings.tool.websearch.subscribe_add')}
                </Button>
              </div>
            }
          />
        </div>
      </SettingGroup>
    </>
  )
}
export default BlacklistSettings
