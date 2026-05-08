import { Tabs, TabsContent, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { useTheme } from '@renderer/context/ThemeProvider'
import AgentTodoListPanel from '@renderer/pages/agents/components/AgentTodoListPanel'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingGroup, SettingTitle } from '.'
import ComponentLabAgentSelectorSettings from './ComponentLabAgentSelectorSettings'
import ComponentLabAssistantSelectorSettings from './ComponentLabAssistantSelectorSettings'
import ComponentLabModelSelectorSettings from './ComponentLabModelSelectorSettings'

const ComponentLabSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.componentLab.title')}</SettingTitle>
        <Tabs defaultValue="assistant-selector" variant="line" className="mt-4 gap-4">
          <TabsList>
            <TabsTrigger value="assistant-selector">{t('settings.componentLab.assistantSelector.title')}</TabsTrigger>
            <TabsTrigger value="agent-selector">{t('settings.componentLab.agentSelector.title')}</TabsTrigger>
            <TabsTrigger value="model-selector">{t('settings.componentLab.modelSelector.title')}</TabsTrigger>
            <TabsTrigger value="agent-todo-list">{t('settings.componentLab.agentTodoList.title')}</TabsTrigger>
          </TabsList>

          <TabsContent value="assistant-selector" className="mt-0">
            <ComponentLabAssistantSelectorSettings />
          </TabsContent>
          <TabsContent value="agent-selector" className="mt-0">
            <ComponentLabAgentSelectorSettings />
          </TabsContent>
          <TabsContent value="model-selector" className="mt-0">
            <ComponentLabModelSelectorSettings />
          </TabsContent>
          <TabsContent value="agent-todo-list" className="mt-0 max-w-3xl">
            <AgentTodoListPanel />
          </TabsContent>
        </Tabs>
      </SettingGroup>
    </SettingContainer>
  )
}

export default ComponentLabSettings
