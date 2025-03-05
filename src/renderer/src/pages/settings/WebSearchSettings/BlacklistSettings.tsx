import { useTheme } from '@renderer/context/ThemeProvider'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setExcludeDomains } from '@renderer/store/websearch'
import { parseMatchPattern } from '@renderer/utils/blacklistMatchPattern'
import { Alert, Button } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import { t } from 'i18next'
import { FC, useEffect, useState } from 'react'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const BlacklistSettings: FC = () => {
  const [errFormat, setErrFormat] = useState(false)
  const [blacklistInput, setBlacklistInput] = useState('')
  const excludeDomains = useAppSelector((state) => state.websearch.excludeDomains)
  const { theme } = useTheme()

  const dispatch = useAppDispatch()

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
      </SettingGroup>
    </>
  )
}
export default BlacklistSettings
