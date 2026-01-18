import { InfoCircleOutlined } from '@ant-design/icons'
import { Button, Textarea } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useWebSearchSettings } from '@renderer/hooks/useWebSearch'
import { parseMatchPattern } from '@renderer/utils/blacklistMatchPattern'
import { Alert } from 'antd'
import { t } from 'i18next'
import type { FC } from 'react'
import { useEffect, useState } from 'react'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const BlacklistSettings: FC = () => {
  const [errFormat, setErrFormat] = useState(false)
  const [blacklistInput, setBlacklistInput] = useState('')
  const { excludeDomains, setExcludeDomains } = useWebSearchSettings()
  const { theme } = useTheme()

  useEffect(() => {
    if (excludeDomains) {
      setBlacklistInput(excludeDomains.join('\n'))
    }
  }, [excludeDomains])

  function updateManualBlacklist(blacklist: string) {
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

    setExcludeDomains(validDomains)
    window.toast.info({
      title: t('message.save.success.title'),
      timeout: 4000,
      icon: <InfoCircleOutlined />
    })
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.tool.websearch.blacklist')}</SettingTitle>
      <SettingDivider />
      <SettingRow style={{ marginBottom: 10 }}>
        <SettingRowTitle>{t('settings.tool.websearch.blacklist_description')}</SettingRowTitle>
      </SettingRow>
      <Textarea.Input
        value={blacklistInput}
        onValueChange={setBlacklistInput}
        placeholder={t('settings.tool.websearch.blacklist_tooltip')}
        rows={4}
        className="max-h-[200px] min-h-[100px]"
      />
      <Button onClick={() => updateManualBlacklist(blacklistInput)} style={{ marginTop: 10 }}>
        {t('common.save')}
      </Button>
      {errFormat && (
        <Alert style={{ marginTop: 10 }} message={t('settings.tool.websearch.blacklist_tooltip')} type="error" />
      )}
    </SettingGroup>
  )
}

export default BlacklistSettings
