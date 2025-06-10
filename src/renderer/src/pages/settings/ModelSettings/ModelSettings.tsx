import { RedoOutlined } from '@ant-design/icons'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { HStack } from '@renderer/components/Layout'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { isEmbeddingModel } from '@renderer/config/models'
import { TRANSLATE_PROMPT } from '@renderer/config/prompts'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAssistants, useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { getModelUniqId, hasModel } from '@renderer/services/ModelService'
import { useAppSelector } from '@renderer/store'
import { useAppDispatch } from '@renderer/store'
import { setQuickAssistantRefersToAssistantId, setUseAssistantForQuickAssistant } from '@renderer/store/llm'
import { setTranslateModelPrompt } from '@renderer/store/settings'
import { Model } from '@renderer/types'
import { Button, Select, Tooltip } from 'antd'
import { find, sortBy } from 'lodash'
import { FolderPen, Languages, MessageSquareMore, Rocket, Settings2 } from 'lucide-react'
import { FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDescription, SettingGroup, SettingTitle } from '..'
import DefaultAssistantSettings from './DefaultAssistantSettings'
import QuickAssistantSettings from './QuickAssistantSettings'
import TopicNamingModalPopup from './TopicNamingModalPopup'

const ModelSettings: FC = () => {
  const {
    defaultModel,
    topicNamingModel,
    translateModel,
    quickAssistantModel,
    setDefaultModel,
    setTopicNamingModel,
    setTranslateModel,
    setQuickAssistantModel
  } = useDefaultModel()
  const { assistants } = useAssistants()
  const { providers } = useProviders()
  const allModels = providers.map((p) => p.models).flat()
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { translateModelPrompt } = useSettings()

  const dispatch = useAppDispatch()
  const { quickAssistantRefersToAssistantId, useAssistantForQuickAssistant } = useAppSelector((state) => state.llm)

  const selectOptions = providers
    .filter((p) => p.models.length > 0)
    .map((p) => ({
      label: p.isSystem ? t(`provider.${p.id}`) : p.name,
      title: p.name,
      options: sortBy(p.models, 'name')
        .filter((m) => !isEmbeddingModel(m))
        .map((m) => ({
          label: `${m.name} | ${p.isSystem ? t(`provider.${p.id}`) : p.name}`,
          value: getModelUniqId(m)
        }))
    }))

  const defaultModelValue = useMemo(
    () => (hasModel(defaultModel) ? getModelUniqId(defaultModel) : undefined),
    [defaultModel]
  )

  const defaultTopicNamingModel = useMemo(
    () => (hasModel(topicNamingModel) ? getModelUniqId(topicNamingModel) : undefined),
    [topicNamingModel]
  )

  const defaultTranslateModel = useMemo(
    () => (hasModel(translateModel) ? getModelUniqId(translateModel) : undefined),
    [translateModel]
  )

  const defaultQuickAssistantModel = useMemo(
    () => (hasModel(quickAssistantModel) ? getModelUniqId(quickAssistantModel) : undefined),
    [quickAssistantModel]
  )

  const onUpdateTranslateModel = async () => {
    const prompt = await PromptPopup.show({
      title: t('settings.models.translate_model_prompt_title'),
      message: t('settings.models.translate_model_prompt_message'),
      defaultValue: translateModelPrompt,
      inputProps: {
        rows: 10,
        onPressEnter: () => {}
      }
    })
    if (prompt) {
      dispatch(setTranslateModelPrompt(prompt))
    }
  }

  const onResetTranslatePrompt = () => {
    dispatch(setTranslateModelPrompt(TRANSLATE_PROMPT))
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle style={{ marginBottom: 12 }}>
          <HStack alignItems="center" gap={10}>
            <MessageSquareMore size={18} color="var(--color-text)" />
            {t('settings.models.default_assistant_model')}
          </HStack>
        </SettingTitle>
        <HStack alignItems="center">
          <Select
            value={defaultModelValue}
            defaultValue={defaultModelValue}
            style={{ width: 360 }}
            onChange={(value) => setDefaultModel(find(allModels, JSON.parse(value)) as Model)}
            options={selectOptions}
            showSearch
            placeholder={t('settings.models.empty')}
          />
          <Button icon={<Settings2 size={16} />} style={{ marginLeft: 8 }} onClick={DefaultAssistantSettings.show} />
        </HStack>
        <SettingDescription>{t('settings.models.default_assistant_model_description')}</SettingDescription>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle style={{ marginBottom: 12 }}>
          <HStack alignItems="center" gap={10}>
            <FolderPen size={18} color="var(--color-text)" />
            {t('settings.models.topic_naming_model')}
          </HStack>
        </SettingTitle>
        <HStack alignItems="center">
          <Select
            value={defaultTopicNamingModel}
            defaultValue={defaultTopicNamingModel}
            style={{ width: 360 }}
            onChange={(value) => setTopicNamingModel(find(allModels, JSON.parse(value)) as Model)}
            options={selectOptions}
            showSearch
            placeholder={t('settings.models.empty')}
          />
          <Button icon={<Settings2 size={16} />} style={{ marginLeft: 8 }} onClick={TopicNamingModalPopup.show} />
        </HStack>
        <SettingDescription>{t('settings.models.topic_naming_model_description')}</SettingDescription>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle style={{ marginBottom: 12 }}>
          <HStack alignItems="center" gap={10}>
            <Languages size={18} color="var(--color-text)" />
            {t('settings.models.translate_model')}
          </HStack>
        </SettingTitle>
        <HStack alignItems="center">
          <Select
            value={defaultTranslateModel}
            defaultValue={defaultTranslateModel}
            style={{ width: 360 }}
            onChange={(value) => setTranslateModel(find(allModels, JSON.parse(value)) as Model)}
            options={selectOptions}
            showSearch
            placeholder={t('settings.models.empty')}
          />
          <Button icon={<Settings2 size={16} />} style={{ marginLeft: 8 }} onClick={onUpdateTranslateModel} />
          {translateModelPrompt !== TRANSLATE_PROMPT && (
            <Tooltip title={t('common.reset')}>
              <Button icon={<RedoOutlined />} style={{ marginLeft: 8 }} onClick={onResetTranslatePrompt}></Button>
            </Tooltip>
          )}
        </HStack>
        <SettingDescription>{t('settings.models.translate_model_description')}</SettingDescription>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle style={{ marginBottom: 12 }}>
          <HStack alignItems="center" gap={10}>
            <Rocket size={18} color="var(--color-text)" />
            {t('settings.models.quick_assistant_model')}
          </HStack>
        </SettingTitle>
        <HStack alignItems="center" gap={12}>
          <Button
            type={!useAssistantForQuickAssistant ? 'primary' : 'default'}
            onClick={() => dispatch(setUseAssistantForQuickAssistant(false))}
            style={{ minWidth: 120 }}>
            {t('settings.models.use_model')}
          </Button>
          <Button
            type={useAssistantForQuickAssistant ? 'primary' : 'default'}
            onClick={() => {
              dispatch(setUseAssistantForQuickAssistant(true))
              // 設定為第一個可用的助手，如果沒有則保持當前值
              const firstAssistant = assistants.find((a) => a.type !== 'system' && a.id !== 'quick-assistant')
              if (firstAssistant && !quickAssistantRefersToAssistantId) {
                dispatch(setQuickAssistantRefersToAssistantId(firstAssistant.id))
              }
            }}
            style={{ minWidth: 120 }}>
            {t('settings.models.use_assistant')}
          </Button>
        </HStack>

        {!useAssistantForQuickAssistant ? (
          <HStack alignItems="center" style={{ marginTop: 12 }}>
            <Select
              value={defaultQuickAssistantModel}
              defaultValue={defaultQuickAssistantModel}
              style={{ width: 360 }}
              onChange={(value) => setQuickAssistantModel(find(allModels, JSON.parse(value)) as Model)}
              options={selectOptions}
              showSearch
              placeholder={t('settings.models.empty')}
            />
            <Button icon={<Settings2 size={16} />} style={{ marginLeft: 8 }} onClick={QuickAssistantSettings.show} />
          </HStack>
        ) : (
          <HStack alignItems="center" style={{ marginTop: 12 }}>
            <Select
              value={quickAssistantRefersToAssistantId}
              style={{ width: 360 }}
              onChange={(value) => dispatch(setQuickAssistantRefersToAssistantId(value))}
              placeholder={t('settings.quickAssistant.selectAssistant')}>
              {assistants
                .filter((a) => a.id !== quickAssistantModel.id)
                .map((a) => (
                  <Select.Option key={a.id} value={a.id}>
                    <AssistantItem>
                      <ModelAvatar model={a.model || defaultModel} size={18} />
                      <AssistantName>{a.name}</AssistantName>
                      <Spacer />
                    </AssistantItem>
                  </Select.Option>
                ))}
            </Select>
          </HStack>
        )}
        <SettingDescription>{t('settings.models.quick_assistant_model_description')}</SettingDescription>
      </SettingGroup>
    </SettingContainer>
  )
}

const AssistantItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  height: 28px;
`

const AssistantName = styled.span`
  max-width: calc(100% - 60px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const Spacer = styled.div`
  flex: 1;
`

export default ModelSettings
