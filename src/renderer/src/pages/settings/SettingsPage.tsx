import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { ModelSettingsContentOnly } from '@renderer/pages/settings/ModelSettings/ModelSettings'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { Route, Routes } from 'react-router-dom'
import styled from 'styled-components'

import AboutSettings from './AboutSettings'
import DataSettings from './DataSettings/DataSettings'
import DisplaySettings from './DisplaySettings/DisplaySettings'
import DocProcessSettings from './DocProcessSettings'
import GeneralSettings from './GeneralSettings'
import MCPSettings from './MCPSettings'
import MemorySettings from './MemorySettings'
import NotesSettings from './NotesSettings'
import { ProviderList } from './ProviderSettings'
import QuickAssistantSettings from './QuickAssistantSettings'
import QuickPhraseSettings from './QuickPhraseSettings'
import SelectionAssistantSettings from './SelectionAssistantSettings/SelectionAssistantSettings'
import ShortcutSettings from './ShortcutSettings'
import { ApiServerSettings } from './ToolSettings/ApiServerSettings'
import WebSearchSettings from './WebSearchSettings'

const SettingsPage: FC = () => {
  const { t } = useTranslation()

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('settings.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <SettingContent>
          <Routes>
            <Route path="provider" element={<ProviderList />} />
            <Route path="model" element={<ModelSettingsContentOnly />} />
            <Route path="websearch" element={<WebSearchSettings />} />
            <Route path="api-server" element={<ApiServerSettings />} />
            <Route path="docprocess" element={<DocProcessSettings />} />
            <Route path="quickphrase" element={<QuickPhraseSettings />} />
            <Route path="mcp/*" element={<MCPSettings />} />
            <Route path="memory" element={<MemorySettings />} />
            <Route path="general/*" element={<GeneralSettings />} />
            <Route path="display" element={<DisplaySettings />} />
            <Route path="shortcut" element={<ShortcutSettings />} />
            <Route path="quickAssistant" element={<QuickAssistantSettings />} />
            <Route path="selectionAssistant" element={<SelectionAssistantSettings />} />
            <Route path="data" element={<DataSettings />} />
            <Route path="notes" element={<NotesSettings />} />
            <Route path="about" element={<AboutSettings />} />
          </Routes>
        </SettingContent>
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  height: calc(100vh - var(--navbar-height));
  padding: 1px 0;
`

const SettingContent = styled.div`
  display: flex;
  height: 100%;
  flex: 1;
`

export default SettingsPage
