import { SettingOutlined } from '@ant-design/icons'
import { ErrorDetailModal } from '@renderer/components/ErrorDetailModal'
import { useTimer } from '@renderer/hooks/useTimer'
import { getHttpMessageLabel, getProviderLabel } from '@renderer/i18n/label'
import type { DiagnosisResult } from '@renderer/services/ErrorDiagnosisService'
import { classifyErrorByAI } from '@renderer/services/ErrorDiagnosisService'
import { getProviderById } from '@renderer/services/ProviderService'
import { useAppDispatch } from '@renderer/store'
import { removeBlocksThunk } from '@renderer/store/thunk/messageThunk'
import type { ErrorMessageBlock, Message } from '@renderer/types/newMessage'
import { classifyError } from '@renderer/utils/errorClassifier'
import { Button } from 'antd'
import { Alert as AntdAlert } from 'antd'
import React, { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

const HTTP_ERROR_CODES = [400, 401, 403, 404, 429, 500, 502, 503, 504]

interface Props {
  block: ErrorMessageBlock
  message: Message
}

const ErrorBlock: React.FC<Props> = ({ block, message }) => {
  return <MessageErrorInfo block={block} message={message} />
}

const ErrorMessage: React.FC<{ block: ErrorMessageBlock }> = ({ block }) => {
  const { t, i18n } = useTranslation()

  const i18nKey = block.error && 'i18nKey' in block.error ? `error.${block.error?.i18nKey}` : ''
  const errorKey = `error.${block.error?.message}`
  const errorStatus =
    block.error && ('status' in block.error || 'statusCode' in block.error)
      ? block.error?.status || block.error?.statusCode
      : undefined

  if (i18n.exists(i18nKey)) {
    const providerId = block.error && 'providerId' in block.error ? block.error?.providerId : undefined
    if (providerId && typeof providerId === 'string') {
      return (
        <Trans
          i18nKey={i18nKey}
          values={{ provider: getProviderLabel(providerId) }}
          components={{
            provider: (
              <Link
                style={{ color: 'var(--color-link)' }}
                to={`/settings/provider`}
                state={{ provider: getProviderById(providerId) }}
              />
            )
          }}
        />
      )
    }
  }

  if (i18n.exists(errorKey)) {
    return t(errorKey)
  }

  if (typeof errorStatus === 'number' && HTTP_ERROR_CODES.includes(errorStatus)) {
    return (
      <h5>
        {getHttpMessageLabel(errorStatus.toString())} {block.error?.message}
      </h5>
    )
  }

  return block.error?.message || ''
}

const MessageErrorInfo: React.FC<{ block: ErrorMessageBlock; message: Message }> = ({ block, message }) => {
  const dispatch = useAppDispatch()
  const { setTimeoutTimer } = useTimer()
  const [showDetailModal, setShowDetailModal] = useState(false)
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [aiSummary, setAiSummary] = useState<string>('')

  const classification = useMemo(() => classifyError(block.error), [block.error])

  // AI fallback: when rule-based classification returns 'unknown', ask AI for a one-line summary
  useEffect(() => {
    if (classification.category !== 'unknown' || !block.error) return
    let cancelled = false
    classifyErrorByAI(block.error, i18n.language)
      .then((summary) => {
        if (!cancelled && summary) setAiSummary(summary)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [classification.category, block.error, i18n.language])

  const onRemoveBlock = (e: React.MouseEvent) => {
    e.stopPropagation()
    setTimeoutTimer('onRemoveBlock', () => dispatch(removeBlocksThunk(message.topicId, message.id, [block.id])), 350)
  }

  const showErrorDetail = () => {
    setShowDetailModal(true)
  }

  const onNavigate = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (classification.navTarget) {
      navigate(classification.navTarget)
    }
  }

  const getAlertDescription = () => {
    return (
      <div>
        <div>{block.error?.message || <ErrorMessage block={block} />}</div>
        {classification.navTarget && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <Button size="small" type="primary" icon={<SettingOutlined />} onClick={onNavigate}>
              {t('error.diagnosis.go_to_settings')}
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <Alert
        message={
          classification.category === 'unknown'
            ? aiSummary || (block.error?.message as string) || t(classification.i18nKey)
            : t(classification.i18nKey)
        }
        description={getAlertDescription()}
        type="error"
        closable
        onClose={onRemoveBlock}
        onClick={showErrorDetail}
        style={{ cursor: 'pointer' }}
        action={
          <>
            <Button size="middle" color="default" variant="text" onClick={showErrorDetail}>
              {t('common.detail')}
            </Button>
          </>
        }
      />
      <ErrorDetailModal
        open={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        error={block.error}
        failingModelId={block.error?.modelId as string | undefined}
        blockId={block.id}
        cachedDiagnosis={(block as any).metadata?.diagnosis as DiagnosisResult | undefined}
        diagnosisContext={{
          errorSource: 'chat',
          providerName: block.error?.providerId as string | undefined,
          modelId: block.error?.modelId as string | undefined
        }}
      />
    </>
  )
}

const Alert = styled(AntdAlert)`
  margin: 0.5rem 0 !important;
  padding: 10px;
  font-size: 12px;
  align-items: center;
  & .ant-alert-close-icon {
    margin: 5px;
  }
`

export default React.memo(ErrorBlock)
