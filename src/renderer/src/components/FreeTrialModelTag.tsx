import type { ClassifiableModel } from '@renderer/config/models/classifiable'
import { getModelProviderId } from '@renderer/config/models/classifiable'
import { getProviderLabel } from '@renderer/i18n/label'
import NavigationService from '@renderer/services/NavigationService'
import { ArrowUpRight } from 'lucide-react'
import type { FC, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import IndicatorLight from './IndicatorLight'
import { SelectModelPopup } from './Popups/SelectModelPopup'
import CustomTag from './Tags/CustomTag'

interface Props {
  model: ClassifiableModel
  showLabel?: boolean
}

export const FreeTrialModelTag: FC<Props> = ({ model, showLabel = true }) => {
  const { t } = useTranslation()

  if (getModelProviderId(model) !== 'cherryai') {
    return null
  }

  const rawId = model.id.includes('::') ? model.id.slice(model.id.indexOf('::') + 2) : model.id
  const cherryInModels = ['Qwen/Qwen3-8B', 'Qwen/Qwen3-Next-80B-A3B-Instruct']
  const providerId = cherryInModels.includes(rawId) ? 'cherryin' : ''
  if (!providerId) return null

  const onSelectProvider = () => {
    void NavigationService.navigate!({ to: `/settings/provider`, search: { id: providerId } })
  }

  const onNavigateProvider = (e: MouseEvent) => {
    e.stopPropagation()
    SelectModelPopup.hide()
    void NavigationService.navigate?.({ to: '/settings/provider', search: { id: providerId } })
  }

  if (!showLabel) {
    return (
      <Container>
        <CustomTag
          color="var(--color-link)"
          size={11}
          onClick={onNavigateProvider}
          style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {getProviderLabel(providerId)}
          <ArrowUpRight size={12} />
        </CustomTag>
      </Container>
    )
  }

  return (
    <Container>
      <IndicatorLight size={6} color="var(--color-primary)" animation={false} shadow={false} />
      <PoweredBy>{t('common.powered_by')}</PoweredBy>
      <LinkText onClick={onSelectProvider}>{getProviderLabel(providerId)}</LinkText>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
`

const PoweredBy = styled.span`
  font-size: 12px;
  color: var(--color-text-2);
`

const LinkText = styled.a`
  font-size: 12px;
  color: var(--color-link);
`
