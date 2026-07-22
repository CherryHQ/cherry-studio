import { loggerService } from '@logger'
import type { CherryInEndpointSelection, CherryInHostMode } from '@shared/config/cherryin'
import { Select } from 'antd'
import type { FC } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('CherryINSettings')

interface CherryINSettingsProps {
  apiHost: string
  setApiHost: (host: string) => void
}

const CherryINSettings: FC<CherryINSettingsProps> = ({ apiHost, setApiHost }) => {
  const { t } = useTranslation()
  const [selection, setSelection] = useState<CherryInEndpointSelection | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let active = true

    window.api.cherryin
      .getEndpointSelection()
      .then((result) => {
        if (!active) return
        setSelection(result)
        setApiHost(result.host)
      })
      .catch((error) => {
        logger.warn('Failed to load CherryIN endpoint selection', error as Error)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [setApiHost])

  const handleModeChange = useCallback(
    async (mode: CherryInHostMode) => {
      setIsLoading(true)
      try {
        const result = await window.api.cherryin.setHostMode(mode)
        setSelection(result)
        setApiHost(result.host)
      } catch (error) {
        logger.error('Failed to change CherryIN host mode', error as Error)
        window.toast.error(t('settings.provider.cherryin_route.error'))
      } finally {
        setIsLoading(false)
      }
    },
    [setApiHost, t]
  )

  const options = [
    { value: 'auto', label: t('settings.provider.cherryin_route.auto') },
    { value: 'china', label: t('settings.provider.cherryin_route.china') },
    { value: 'global', label: t('settings.provider.cherryin_route.global') }
  ] satisfies Array<{ value: CherryInHostMode; label: string }>

  return (
    <Container>
      <Select
        value={selection?.mode ?? 'auto'}
        loading={isLoading}
        onChange={handleModeChange}
        options={options}
        style={{ width: '100%' }}
      />
      <CurrentHost>{t('settings.provider.cherryin_route.current', { host: selection?.host ?? apiHost })}</CurrentHost>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  margin: 5px 0 10px;
`

const CurrentHost = styled.div`
  min-height: 18px;
  padding-left: 6px;
  color: var(--color-text-3);
  font-size: 12px;
  line-height: 18px;
  word-break: break-all;
`

export default CherryINSettings
