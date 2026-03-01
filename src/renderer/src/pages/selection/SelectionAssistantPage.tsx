import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import SelectionAssistantSettings from '@renderer/pages/settings/SelectionAssistantSettings/SelectionAssistantSettings'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const SelectionAssistantPage: FC = () => {
  const { t } = useTranslation()

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('selection.name')}</NavbarCenter>
      </Navbar>
      <ContentContainer>
        <SelectionAssistantSettings />
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  overflow-y: auto;
`

export default SelectionAssistantPage
