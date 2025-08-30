import { getProviderLabel } from '@renderer/i18n/label'
import NavigationService from '@renderer/services/NavigationService'
import { Model } from '@renderer/types'
import { ArrowUpRight } from 'lucide-react'
import { FC, MouseEvent } from 'react'
import styled from 'styled-components'

import IndicatorLight from './IndicatorLight'
import SelectModelPopup from './Popups/SelectModelPopup'
import CustomTag from './Tags/CustomTag'

interface Props {
  model: Model
  showLabel?: boolean
}

export const FreeTrialModelTag: FC<Props> = ({ model, showLabel = true }) => {
  if (model.provider !== 'cherryin') {
    return null
  }

  let providerId

  if (model.id === 'glm-4.5-flash') {
    providerId = 'zhipu'
  }

  if (model.id === 'Qwen/Qwen3-8B') {
    providerId = 'silicon'
  }

  const onSelectProvider = () => {
    NavigationService.navigate!(`/settings/provider?id=${providerId}`)
  }

  const onNavigateProvider = (e: MouseEvent) => {
    e.stopPropagation()
    SelectModelPopup.hide()
    NavigationService.navigate!(`/settings/provider?id=${providerId}`)
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
      <PoweredBy>Powered by </PoweredBy>
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
