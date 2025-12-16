import { Alert, Button, Space } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import { useAppDispatch, useAppSelector } from '../../store'
import { clearCredentialIssues } from '../../store/runtime'

const CredentialIssuesBanner = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const issues = useAppSelector((state) => state.runtime.credentialIssues)
  const llmProviders = useAppSelector((state) => state.llm.providers)
  const preprocessProviders = useAppSelector((state) => state.preprocess.providers)
  const webSearchProviders = useAppSelector((state) => state.websearch.providers)

  const affectedNames = useMemo(() => {
    const names = new Set<string>()
    for (const issue of issues) {
      const scope = issue.meta?.scope
      const providerId = issue.meta?.providerId
      if (typeof providerId !== 'string') continue

      if (scope === 'llm') {
        const provider = llmProviders?.find((p: any) => p?.id === providerId)
        names.add(provider?.name || providerId)
        continue
      }

      if (scope === 'preprocess') {
        const provider = preprocessProviders?.find((p: any) => p?.id === providerId)
        names.add(provider?.name || providerId)
        continue
      }

      if (scope === 'websearch') {
        const provider = webSearchProviders?.find((p: any) => p?.id === providerId)
        names.add(provider?.name || providerId)
        continue
      }
    }

    return Array.from(names)
  }, [issues, llmProviders, preprocessProviders, webSearchProviders])

  const affectedPreview = useMemo(() => {
    if (affectedNames.length === 0) return null
    const preview = affectedNames.slice(0, 5).join(', ')
    return affectedNames.length > 5 ? `${preview}…` : preview
  }, [affectedNames])

  const showProviderSettings = issues.some((issue) => issue.meta?.scope === 'llm')
  const showWebSearchSettings = issues.some((issue) => issue.meta?.scope === 'websearch')
  const showDocProcessSettings = issues.some((issue) => issue.meta?.scope === 'preprocess')
  const showDataSettings = issues.some(
    (issue) =>
      issue.meta?.scope === 'settings' ||
      issue.meta?.scope === 'nutstore' ||
      (typeof issue.id === 'string' && issue.id.startsWith('localStorage.'))
  )

  if (!issues.length) {
    return null
  }

  const actions = (
    <Space direction="vertical">
      {showProviderSettings && (
        <Button size="small" type="primary" onClick={() => navigate('/settings/provider')}>
          {t('settings.security.credentials_invalid.action_provider')}
        </Button>
      )}
      {showWebSearchSettings && (
        <Button size="small" onClick={() => navigate('/settings/websearch')}>
          {t('settings.security.credentials_invalid.action_websearch')}
        </Button>
      )}
      {showDocProcessSettings && (
        <Button size="small" onClick={() => navigate('/settings/docprocess')}>
          {t('settings.security.credentials_invalid.action_docprocess')}
        </Button>
      )}
      {showDataSettings && (
        <Button size="small" onClick={() => navigate('/settings/data')}>
          {t('settings.security.credentials_invalid.action_data')}
        </Button>
      )}
      <Button size="small" onClick={() => dispatch(clearCredentialIssues())}>
        {t('settings.security.credentials_invalid.dismiss')}
      </Button>
    </Space>
  )

  return (
    <Container>
      <Alert
        type="warning"
        showIcon
        message={t('settings.security.credentials_invalid.title')}
        description={
          <Description>
            <div>{t('settings.security.credentials_invalid.description')}</div>
            {affectedPreview ? (
              <Affected>{t('settings.security.credentials_invalid.affected', { items: affectedPreview })}</Affected>
            ) : null}
          </Description>
        }
        action={actions}
      />
    </Container>
  )
}

const Container = styled.div`
  padding: 10px;
`

const Description = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`

const Affected = styled.div`
  opacity: 0.9;
`

export default CredentialIssuesBanner
