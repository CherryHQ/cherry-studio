import { ErrorDetailModal } from '@renderer/components/ErrorDetailModal'
import { FreeTrialModelTag } from '@renderer/components/FreeTrialModelTag'
import { type HealthResult, HealthStatusIndicator } from '@renderer/components/HealthStatusIndicator'
import { HStack } from '@renderer/components/Layout'
import ModelIdWithTags from '@renderer/components/ModelIdWithTags'
import { getModelLogo } from '@renderer/config/models'
import type { Model } from '@renderer/types'
import type { SerializedError } from '@renderer/types/error'
import type { ModelWithStatus } from '@renderer/types/healthCheck'
import { HealthStatus } from '@renderer/types/healthCheck'
import { maskApiKey } from '@renderer/utils/api'
import { Avatar, Button, Tooltip } from 'antd'
import { Bolt, Minus } from 'lucide-react'
import React, { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ModelListItemProps {
  ref?: React.RefObject<HTMLDivElement>
  model: Model
  modelStatus: ModelWithStatus | undefined
  disabled?: boolean
  onEdit: (model: Model) => void
  onRemove: (model: Model) => void
}

const ModelListItem: React.FC<ModelListItemProps> = ({ ref, model, modelStatus, disabled, onEdit, onRemove }) => {
  const { t } = useTranslation()
  const isChecking = modelStatus?.checking === true
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [selectedError, setSelectedError] = useState<SerializedError | undefined>()

  const healthResults = useMemo(
    () =>
      modelStatus?.keyResults?.map((kr) => ({
        status: kr.status,
        latency: kr.latency,
        error: kr.error,
        label: maskApiKey(kr.key)
      })) || [],
    [modelStatus?.keyResults]
  )

  const hasFailedResult = useMemo(() => healthResults.some((r) => r.status === HealthStatus.FAILED), [healthResults])

  const handleErrorClick = useMemo(() => {
    if (!hasFailedResult) return undefined
    return (result: HealthResult) => {
      if (result.error) {
        setSelectedError(result.error)
        setShowErrorModal(true)
      }
    }
  }, [hasFailedResult])

  const handleCloseErrorModal = useCallback(() => {
    setShowErrorModal(false)
    setSelectedError(undefined)
  }, [])

  const handleEdit = useCallback(() => {
    onEdit(model)
  }, [model, onEdit])

  const handleRemove = useCallback(() => {
    onRemove(model)
  }, [model, onRemove])

  return (
    <>
      <ListItem ref={ref}>
        <HStack alignItems="center" gap={10} style={{ flex: 1 }}>
          <Avatar src={getModelLogo(model)} size={24}>
            {model?.name?.[0]?.toUpperCase()}
          </Avatar>
          <ModelIdWithTags
            model={model}
            style={{
              flex: 1,
              width: 0,
              overflow: 'hidden'
            }}
          />
          <FreeTrialModelTag model={model} />
        </HStack>
        <HStack alignItems="center" gap={6}>
          <HealthStatusIndicator
            results={healthResults}
            loading={isChecking}
            showLatency
            onErrorClick={handleErrorClick}
          />
          <HStack alignItems="center" gap={0}>
            <Tooltip title={t('models.edit')} mouseLeaveDelay={0}>
              <Button type="text" onClick={handleEdit} disabled={disabled} icon={<Bolt size={14} />} />
            </Tooltip>
            <Tooltip title={t('settings.models.manage.remove_model')} mouseLeaveDelay={0}>
              <Button type="text" onClick={handleRemove} disabled={disabled} icon={<Minus size={14} />} />
            </Tooltip>
          </HStack>
        </HStack>
      </ListItem>
      {hasFailedResult && (
        <ErrorDetailModal open={showErrorModal} onClose={handleCloseErrorModal} error={selectedError} />
      )}
    </>
  )
}

const ListItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  color: var(--color-text);
  font-size: 14px;
  line-height: 1;
`

export default memo(ModelListItem)
