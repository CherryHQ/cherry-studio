import { GlobalOutlined } from '@ant-design/icons'
import { RedoOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import ModelSelector from '@renderer/components/ModelSelector'
import { InfoTooltip } from '@renderer/components/TooltipIcons'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@renderer/config/models'
import { TRANSLATE_PROMPT } from '@renderer/config/prompts'
import { useTheme } from '@renderer/context/ThemeProvider'
import { modelGenerating } from '@renderer/hooks/useRuntime'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { getModelUniqId, hasModel } from '@renderer/services/ModelService'
import { useAppDispatch } from '@renderer/store'
import { setTranslateModelPrompt } from '@renderer/store/settings'
import { Model } from '@renderer/types'
import { Button, Divider as AntDivider, Tooltip } from 'antd'
import { find } from 'lodash'
import {
  Brain,
  Cloud,
  Command,
  FileCode,
  Hammer,
  HardDrive,
  Info,
  Languages,
  MessageSquareMore,
  MonitorCog,
  NotebookPen,
  PictureInPicture2,
  Rocket,
  Server,
  Settings2,
  TextCursorInput,
  Zap
} from 'lucide-react'
import { FC, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import { SettingDescription, SettingGroup, SettingTitle } from '..'
import TranslateSettingsPopup from '../TranslateSettingsPopup/TranslateSettingsPopup'
import DefaultAssistantSettings from './DefaultAssistantSettings'
import TopicNamingModalPopup from './QuickModelPopup'

const ModelSettings: FC = () => {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { defaultModel, quickModel, translateModel, setDefaultModel, setQuickModel, setTranslateModel } =
    useDefaultModel()
  const { providers } = useProviders()
  const allModels = providers.map((p) => p.models).flat()
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { translateModelPrompt } = useSettings()

  const dispatch = useAppDispatch()

  const handleSettingsItemClick = useCallback(
    async (path: string) => {
      await modelGenerating()
      navigate(path)
    },
    [navigate]
  )

  const modelPredicate = useCallback(
    (m: Model) => !isEmbeddingModel(m) && !isRerankModel(m) && !isTextToImageModel(m),
    []
  )

  const defaultModelValue = useMemo(
    () => (hasModel(defaultModel) ? getModelUniqId(defaultModel) : undefined),
    [defaultModel]
  )

  const defaultQuickModel = useMemo(() => (hasModel(quickModel) ? getModelUniqId(quickModel) : undefined), [quickModel])

  const defaultTranslateModel = useMemo(
    () => (hasModel(translateModel) ? getModelUniqId(translateModel) : undefined),
    [translateModel]
  )

  const onResetTranslatePrompt = () => {
    dispatch(setTranslateModelPrompt(TRANSLATE_PROMPT))
  }

  return (
    <ModelSettingsContainer theme={theme}>
      <SettingsNavMenu>
        <SettingsNavItem
          onClick={() => handleSettingsItemClick('/settings/provider')}
          $active={pathname.startsWith('/settings/provider')}
          theme={theme}>
          <Cloud size={16} />
          <span>{t('settings.provider.title')}</span>
        </SettingsNavItem>
        <SettingsNavItem
          onClick={() => handleSettingsItemClick('/settings/model')}
          $active={pathname.startsWith('/settings/model')}
          theme={theme}>
          <Settings2 size={16} />
          <span>{t('settings.model')}</span>
        </SettingsNavItem>
        <SettingsNavDivider />
        <SettingsNavItem
          onClick={() => handleSettingsItemClick('/settings/general')}
          $active={pathname.startsWith('/settings/general')}
          theme={theme}>
          <Settings2 size={16} />
          <span>{t('settings.general.label')}</span>
        </SettingsNavItem>
        <SettingsNavItem
          onClick={() => handleSettingsItemClick('/settings/display')}
          $active={pathname.startsWith('/settings/display')}
          theme={theme}>
          <MonitorCog size={16} />
          <span>{t('settings.display.title')}</span>
        </SettingsNavItem>
        <SettingsNavItem
          onClick={() => handleSettingsItemClick('/settings/data')}
          $active={pathname.startsWith('/settings/data')}
          theme={theme}>
          <HardDrive size={16} />
          <span>{t('settings.data.title')}</span>
        </SettingsNavItem>
        <SettingsNavDivider />
        <SettingsNavItem
          onClick={() => handleSettingsItemClick('/settings/mcp')}
          $active={pathname.startsWith('/settings/mcp')}
          theme={theme}>
          <Hammer size={16} />
          <span>{t('settings.mcp.title')}</span>
        </SettingsNavItem>
        <SettingsNavItem
          onClick={() => handleSettingsItemClick('/settings/notes')}
          $active={pathname.startsWith('/settings/notes')}
          theme={theme}>
          <NotebookPen size={16} />
          <span>{t('notes.settings.title')}</span>
        </SettingsNavItem>
        <SettingsNavItem
          onClick={() => handleSettingsItemClick('/settings/websearch')}
          $active={pathname.startsWith('/settings/websearch')}
          theme={theme}>
          <GlobalOutlined style={{ fontSize: 16 }} />
          <span>{t('settings.tool.websearch.title')}</span>
        </SettingsNavItem>
        <SettingsNavItem
          onClick={() => handleSettingsItemClick('/settings/memory')}
          $active={pathname.startsWith('/settings/memory')}
          theme={theme}>
          <Brain size={16} />
          <span>{t('memory.title')}</span>
        </SettingsNavItem>
        <SettingsNavItem
          onClick={() => handleSettingsItemClick('/settings/api-server')}
          $active={pathname.startsWith('/settings/api-server')}
          theme={theme}>
          <Server size={16} />
          <span>{t('apiServer.title')}</span>
        </SettingsNavItem>
        <SettingsNavItem
          onClick={() => handleSettingsItemClick('/settings/docprocess')}
          $active={pathname.startsWith('/settings/docprocess')}
          theme={theme}>
          <FileCode size={16} />
          <span>{t('settings.tool.preprocess.title')}</span>
        </SettingsNavItem>
        <SettingsNavItem
          onClick={() => handleSettingsItemClick('/settings/quickphrase')}
          $active={pathname.startsWith('/settings/quickphrase')}
          theme={theme}>
          <Zap size={16} />
          <span>{t('settings.quickPhrase.title')}</span>
        </SettingsNavItem>
        <SettingsNavItem
          onClick={() => handleSettingsItemClick('/settings/shortcut')}
          $active={pathname.startsWith('/settings/shortcut')}
          theme={theme}>
          <Command size={16} />
          <span>{t('settings.shortcuts.title')}</span>
        </SettingsNavItem>
        <SettingsNavDivider />
        <SettingsNavItem
          onClick={() => handleSettingsItemClick('/settings/quickAssistant')}
          $active={pathname.startsWith('/settings/quickAssistant')}
          theme={theme}>
          <PictureInPicture2 size={16} />
          <span>{t('settings.quickAssistant.title')}</span>
        </SettingsNavItem>
        <SettingsNavItem
          onClick={() => handleSettingsItemClick('/settings/selectionAssistant')}
          $active={pathname.startsWith('/settings/selectionAssistant')}
          theme={theme}>
          <TextCursorInput size={16} />
          <span>{t('selection.name')}</span>
        </SettingsNavItem>
        <SettingsNavDivider />
        <SettingsNavItem
          onClick={() => handleSettingsItemClick('/settings/about')}
          $active={pathname.startsWith('/settings/about')}
          theme={theme}>
          <Info size={16} />
          <span>{t('settings.about.label')}</span>
        </SettingsNavItem>
      </SettingsNavMenu>

      <ModelSettingsContent>
        <SettingGroup theme={theme}>
          <SettingTitle style={{ marginBottom: 12 }}>
            <HStack alignItems="center" gap={10}>
              <MessageSquareMore size={18} color="var(--color-text)" />
              {t('settings.models.default_assistant_model')}
            </HStack>
          </SettingTitle>
          <HStack alignItems="center" style={{ flexWrap: 'wrap', gap: 8 }}>
            <ModelSelector
              providers={providers}
              predicate={modelPredicate}
              value={defaultModelValue}
              defaultValue={defaultModelValue}
              style={{ flex: 1, minWidth: 200 }}
              onChange={(value) => setDefaultModel(find(allModels, JSON.parse(value)) as Model)}
              placeholder={t('settings.models.empty')}
            />
            <Button icon={<Settings2 size={16} />} onClick={DefaultAssistantSettings.show} />
          </HStack>
          <SettingDescription>{t('settings.models.default_assistant_model_description')}</SettingDescription>
        </SettingGroup>
        <SettingGroup theme={theme}>
          <SettingTitle style={{ marginBottom: 12 }}>
            <HStack alignItems="center" gap={10}>
              <Rocket size={18} color="var(--color-text)" />
              {t('settings.models.quick_model.label')}
              <InfoTooltip title={t('settings.models.quick_model.tooltip')} />
            </HStack>
          </SettingTitle>
          <HStack alignItems="center" style={{ flexWrap: 'wrap', gap: 8 }}>
            <ModelSelector
              providers={providers}
              predicate={modelPredicate}
              value={defaultQuickModel}
              defaultValue={defaultQuickModel}
              style={{ flex: 1, minWidth: 200 }}
              onChange={(value) => setQuickModel(find(allModels, JSON.parse(value)) as Model)}
              placeholder={t('settings.models.empty')}
            />
            <Button icon={<Settings2 size={16} />} onClick={TopicNamingModalPopup.show} />
          </HStack>
          <SettingDescription>{t('settings.models.quick_model.description')}</SettingDescription>
        </SettingGroup>
        <SettingGroup theme={theme}>
          <SettingTitle style={{ marginBottom: 12 }}>
            <HStack alignItems="center" gap={10}>
              <Languages size={18} color="var(--color-text)" />
              {t('settings.models.translate_model')}
            </HStack>
          </SettingTitle>
          <HStack alignItems="center" style={{ flexWrap: 'wrap', gap: 8 }}>
            <ModelSelector
              providers={providers}
              predicate={modelPredicate}
              value={defaultTranslateModel}
              defaultValue={defaultTranslateModel}
              style={{ flex: 1, minWidth: 200 }}
              onChange={(value) => setTranslateModel(find(allModels, JSON.parse(value)) as Model)}
              placeholder={t('settings.models.empty')}
            />
            <Button
              icon={<Settings2 size={16} />}
              onClick={() => TranslateSettingsPopup.show()}
            />
            {translateModelPrompt !== TRANSLATE_PROMPT && (
              <Tooltip title={t('common.reset')}>
                <Button icon={<RedoOutlined />} onClick={onResetTranslatePrompt}></Button>
              </Tooltip>
            )}
          </HStack>
          <SettingDescription>{t('settings.models.translate_model_description')}</SettingDescription>
        </SettingGroup>
      </ModelSettingsContent>
    </ModelSettingsContainer>
  )
}

// Component that only shows the model settings content without the navigation menu
// Used when ModelSettings is displayed in the sidebar
export const ModelSettingsContentOnly: FC = () => {
  const { defaultModel, quickModel, translateModel, setDefaultModel, setQuickModel, setTranslateModel } =
    useDefaultModel()
  const { providers } = useProviders()
  const allModels = providers.map((p) => p.models).flat()
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { translateModelPrompt } = useSettings()

  const dispatch = useAppDispatch()

  const modelPredicate = useCallback(
    (m: Model) => !isEmbeddingModel(m) && !isRerankModel(m) && !isTextToImageModel(m),
    []
  )

  const defaultModelValue = useMemo(
    () => (hasModel(defaultModel) ? getModelUniqId(defaultModel) : undefined),
    [defaultModel]
  )

  const defaultQuickModel = useMemo(() => (hasModel(quickModel) ? getModelUniqId(quickModel) : undefined), [quickModel])

  const defaultTranslateModel = useMemo(
    () => (hasModel(translateModel) ? getModelUniqId(translateModel) : undefined),
    [translateModel]
  )

  const onResetTranslatePrompt = () => {
    dispatch(setTranslateModelPrompt(TRANSLATE_PROMPT))
  }

  return (
    <ModelSettingsContent>
      <SettingGroup theme={theme}>
        <SettingTitle style={{ marginBottom: 12 }}>
          <HStack alignItems="center" gap={10}>
            <MessageSquareMore size={18} color="var(--color-text)" />
            {t('settings.models.default_assistant_model')}
          </HStack>
        </SettingTitle>
        <HStack alignItems="center" style={{ flexWrap: 'wrap', gap: 8 }}>
          <ModelSelector
            providers={providers}
            predicate={modelPredicate}
            value={defaultModelValue}
            defaultValue={defaultModelValue}
            style={{ flex: 1, minWidth: 200 }}
            onChange={(value) => setDefaultModel(find(allModels, JSON.parse(value)) as Model)}
            placeholder={t('settings.models.empty')}
          />
          <Button icon={<Settings2 size={16} />} onClick={DefaultAssistantSettings.show} />
        </HStack>
        <SettingDescription>{t('settings.models.default_assistant_model_description')}</SettingDescription>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle style={{ marginBottom: 12 }}>
          <HStack alignItems="center" gap={10}>
            <Rocket size={18} color="var(--color-text)" />
            {t('settings.models.quick_model.label')}
            <InfoTooltip title={t('settings.models.quick_model.tooltip')} />
          </HStack>
        </SettingTitle>
        <HStack alignItems="center" style={{ flexWrap: 'wrap', gap: 8 }}>
          <ModelSelector
            providers={providers}
            predicate={modelPredicate}
            value={defaultQuickModel}
            defaultValue={defaultQuickModel}
            style={{ flex: 1, minWidth: 200 }}
            onChange={(value) => setQuickModel(find(allModels, JSON.parse(value)) as Model)}
            placeholder={t('settings.models.empty')}
          />
          <Button icon={<Settings2 size={16} />} onClick={TopicNamingModalPopup.show} />
        </HStack>
        <SettingDescription>{t('settings.models.quick_model.description')}</SettingDescription>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle style={{ marginBottom: 12 }}>
          <HStack alignItems="center" gap={10}>
            <Languages size={18} color="var(--color-text)" />
            {t('settings.models.translate_model')}
          </HStack>
        </SettingTitle>
        <HStack alignItems="center" style={{ flexWrap: 'wrap', gap: 8 }}>
          <ModelSelector
            providers={providers}
            predicate={modelPredicate}
            value={defaultTranslateModel}
            defaultValue={defaultTranslateModel}
            style={{ flex: 1, minWidth: 200 }}
            onChange={(value) => setTranslateModel(find(allModels, JSON.parse(value)) as Model)}
            placeholder={t('settings.models.empty')}
          />
          <Button
            icon={<Settings2 size={16} />}
            onClick={() => TranslateSettingsPopup.show()}
          />
          {translateModelPrompt !== TRANSLATE_PROMPT && (
            <Tooltip title={t('common.reset')}>
              <Button icon={<RedoOutlined />} onClick={onResetTranslatePrompt}></Button>
            </Tooltip>
          )}
        </HStack>
        <SettingDescription>{t('settings.models.translate_model_description')}</SettingDescription>
      </SettingGroup>
    </ModelSettingsContent>
  )
}

const ModelSettingsContainer = styled.div<{ theme?: string }>`
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 0;
  background: transparent;
`

const SettingsNavMenu = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-border);
`

const SettingsNavItem = styled.button<{ $active: boolean; theme: string }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 0.5px solid ${({ $active }) => ($active ? 'var(--color-primary)' : 'transparent')};
  background-color: ${({ $active, theme }) =>
    $active
      ? theme === 'dark'
        ? 'var(--color-black)'
        : 'var(--color-white)'
      : 'transparent'};
  color: ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-text)')};
  cursor: pointer;
  font-size: 13px;
  font-weight: ${({ $active }) => ($active ? '500' : '400')};
  transition: all 0.2s ease;
  text-align: left;
  width: 100%;

  &:hover {
    background-color: ${({ theme }) => (theme === 'dark' ? 'var(--color-black)' : 'var(--color-background-soft)')};
    border-color: ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-border)')};
  }

  &:active {
    transform: scale(0.98);
  }

  svg,
  .anticon {
    color: ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-text-secondary)')};
    flex-shrink: 0;
  }

  span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`

const SettingsNavDivider = styled(AntDivider)`
  margin: 4px 0;
  border-color: var(--color-border);
`

const ModelSettingsContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

export default ModelSettings
