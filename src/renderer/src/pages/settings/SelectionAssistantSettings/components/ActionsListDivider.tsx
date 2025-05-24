import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface DividerProps {
  enabledCount: number
  maxEnabled: number
}

const ActionsListDivider = memo(({ enabledCount, maxEnabled }: DividerProps) => {
  const { t } = useTranslation()

  return (
    <DividerContainer>
      <DividerLine />
      <DividerText>{t('selection.settings.actions.drag_hint', { enabled: enabledCount, max: maxEnabled })}</DividerText>
      <DividerLine />
    </DividerContainer>
  )
})

const DividerContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--color-text-3);
  margin: 16px 12px;
`

const DividerLine = styled.div`
  flex: 1;
  height: 2px;
  background: var(--color-border);
`

const DividerText = styled.span`
  margin: 0 16px;
`

export default ActionsListDivider
