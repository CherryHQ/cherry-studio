import { RedoOutlined } from '@ant-design/icons'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { HStack } from '@renderer/components/Layout'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { isEmbeddingModel, isRerankModel } from '@renderer/config/models'
import { TRANSLATE_PROMPT } from '@renderer/config/prompts'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAssistants, useDefaultAssistant, useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { getModelUniqId, hasModel } from '@renderer/services/ModelService'
import { useAppSelector } from '@renderer/store'
import { useAppDispatch } from '@renderer/store'
import { setQuickAssistantId } from '@renderer/store/llm'
import { setTranslateModelPrompt } from '@renderer/store/settings'
import { Model } from '@renderer/types'
import { Button, Select, Tooltip } from 'antd'
import { find, sortBy } from 'lodash'
import { CircleHelp, FolderPen, Languages, MessageSquareMore, Rocket, Settings2 } from 'lucide-react'
import { FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDescription, SettingGroup, SettingTitle } from '..'
import DefaultAssistantSettings from './DefaultAssistantSettings'
import TopicNamingModalPopup from './TopicNamingModalPopup'

const ModelSettings: FC = () => {
  const { defaultModel, topicNamingModel, translateModel, setDefaultModel, setTopicNamingModel, setTranslateModel } =
    useDefaultModel()
  const { defaultAssistant } = useDefaultAssistant()
  const { assistants } = useAssistants()
  const { providers } = useProviders()
  const allModels = providers.map((p) => p.models).flat()
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { translateModelPrompt } = useSettings()

  const dispatch = useAppDispatch()
  const { quickAssistantId } = useAppSelector((state) => state.llm)

  const selectOptions = providers
    .filter((p) => p.models.length > 0)
    .map((p) => ({
      label: p.isSystem ? t(`provider.${p.id}`) : p.name,
      title: p.name,
      options: sortBy(p.models, 'name')
        .filter((m) => !isEmbeddingModel(m) && !isRerankModel(m))
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
        <HStack alignItems="center" style={{ marginBottom: 12 }}>
          <SettingTitle>
            <HStack alignItems="center" gap={10}>
              <Rocket size={18} color="var(--color-text)" />
              {t('settings.models.quick_assistant_model')}
              <Tooltip title={t('selection.settings.user_modal.model.tooltip')} arrow>
                <QuestionIcon size={12} />
              </Tooltip>
              <Spacer />
            </HStack>
            <HStack alignItems="center" gap={0}>
              <StyledButton
                type={!quickAssistantId ? 'primary' : 'default'}
                onClick={() => dispatch(setQuickAssistantId(''))}
                selected={!quickAssistantId}>
                {t('settings.models.use_model')}
              </StyledButton>
              <StyledButton
                type={quickAssistantId ? 'primary' : 'default'}
                onClick={() => {
                  dispatch(setQuickAssistantId(defaultAssistant.id))
                }}
                selected={!!quickAssistantId}>
                {t('settings.models.use_assistant')}
              </StyledButton>
            </HStack>
          </SettingTitle>
        </HStack>
        {!quickAssistantId ? null : (
          <HStack alignItems="center" style={{ marginTop: 12 }}>
            <Select
              value={quickAssistantId || defaultAssistant.id}
              style={{ width: 360 }}
              onChange={(value) => dispatch(setQuickAssistantId(value))}
              placeholder={t('settings.models.quick_assistant_selection')}>
              <Select.Option key={defaultAssistant.id} value={defaultAssistant.id}>
                <AssistantItem>
                  <ModelAvatar model={defaultAssistant.model || defaultModel} size={18} />
                  <AssistantName>{defaultAssistant.name}</AssistantName>
                  <Spacer />
                  <DefaultTag isCurrent={true}>{t('settings.models.quick_assistant_default_tag')}</DefaultTag>
                </AssistantItem>
              </Select.Option>
              {assistants
                .filter((a) => a.id !== defaultAssistant.id)
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

const QuestionIcon = styled(CircleHelp)`
  cursor: pointer;
  color: var(--color-text-3);
`

const StyledButton = styled(Button)<{ selected: boolean }>`
  border-radius: ${(props) => (props.selected ? '6px' : '6px')};
  z-index: ${(props) => (props.selected ? 1 : 0)};
  min-width: 80px;

  &:first-child {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    border-right-width: 0; // No right border for the first button when not selected
  }

  &:last-child {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    border-left-width: 1px; // Ensure left border for the last button
  }

  // Override Ant Design's default hover and focus styles for a cleaner look

  &:hover,
  &:focus {
    z-index: 1;
    border-color: ${(props) => (props.selected ? 'var(--ant-primary-color)' : 'var(--ant-primary-color-hover)')};
    box-shadow: ${(props) =>
      props.selected ? '0 0 0 2px var(--ant-primary-color-outline)' : '0 0 0 2px var(--ant-primary-color-outline)'};
  }
`

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

const DefaultTag = styled.span<{ isCurrent: boolean }>`
  color: ${(props) => (props.isCurrent ? 'var(--color-primary)' : 'var(--color-text-3)')};
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 4px;
`

export default ModelSettings
