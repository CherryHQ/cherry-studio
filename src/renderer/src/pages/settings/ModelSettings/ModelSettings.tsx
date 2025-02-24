import { EditOutlined, MessageOutlined, RedoOutlined, SettingOutlined, TranslationOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { isEmbeddingModel } from '@renderer/config/models'
import { TRANSLATE_PROMPT } from '@renderer/config/prompts'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import { getModelUniqId, hasModel } from '@renderer/services/ModelService'
import { useAppDispatch } from '@renderer/store'
import { setTranslateModelPrompt } from '@renderer/store/settings'
import { Model } from '@renderer/types'
import { Button, Select, Tooltip } from 'antd'
import { find, sortBy } from 'lodash'
import { FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingContainer, SettingDescription, SettingGroup, SettingTitle } from '..'
import DefaultAssistantSettings from './DefaultAssistantSettings'
import TopicNamingModalPopup from './TopicNamingModalPopup'

const ModelSettings: FC = () => {
  const { defaultModel, topicNamingModel, translateModel, setDefaultModel, setTopicNamingModel, setTranslateModel } =
    useDefaultModel()
  const { providers } = useProviders()
  const allModels = providers.map((p) => p.models).flat()
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { translateModelPrompt } = useSettings()

  const dispatch = useAppDispatch()

  const selectOptions = providers
    .filter((p) => p.models.length > 0)
    .map((p) => ({
      label: p.isSystem ? t(`provider.${p.id}`) : p.name,
      title: p.name,
      options: sortBy(p.models, 'name')
        .filter((m) => !isEmbeddingModel(m))
        .map((m) => ({
          label: m.name,
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
          <div>
            <MessageOutlined style={iconStyle} />
            {t('settings.models.default_assistant_model')}
          </div>
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
          <Button icon={<SettingOutlined />} style={{ marginLeft: 8 }} onClick={DefaultAssistantSettings.show} />
        </HStack>
        <SettingDescription>{t('settings.models.default_assistant_model_description')}</SettingDescription>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle style={{ marginBottom: 12 }}>
          <div>
            <EditOutlined style={iconStyle} />
            {t('settings.models.topic_naming_model')}
          </div>
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
          <Button icon={<SettingOutlined />} style={{ marginLeft: 8 }} onClick={TopicNamingModalPopup.show} />
        </HStack>
        <SettingDescription>{t('settings.models.topic_naming_model_description')}</SettingDescription>
      </SettingGroup>
      <SettingGroup theme={theme}>
        <SettingTitle style={{ marginBottom: 12 }}>
          <div>
            <TranslationOutlined style={iconStyle} />
            {t('settings.models.translate_model')}
          </div>
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
          <Button icon={<SettingOutlined />} style={{ marginLeft: 8 }} onClick={onUpdateTranslateModel} />
          {translateModelPrompt !== TRANSLATE_PROMPT && (
            <Tooltip title={t('common.reset')}>
              <Button icon={<RedoOutlined />} style={{ marginLeft: 8 }} onClick={onResetTranslatePrompt}></Button>
            </Tooltip>
          )}
        </HStack>
        <SettingDescription>{t('settings.models.translate_model_description')}</SettingDescription>
      </SettingGroup>
    </SettingContainer>
  )
}

const iconStyle = { fontSize: 16, marginRight: 8 }

export default ModelSettings
