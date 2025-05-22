import { SwapOutlined } from '@ant-design/icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { isEmbeddingModel } from '@renderer/config/models'
import { TranslateLanguageOptions } from '@renderer/config/translate'
import db from '@renderer/databases'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useProviders } from '@renderer/hooks/useProvider'
import { fetchTranslate } from '@renderer/services/ApiService'
import { getDefaultTranslateAssistant } from '@renderer/services/AssistantService'
import { getModelUniqId } from '@renderer/services/ModelService'
import { Assistant } from '@renderer/types'
import { runAsyncFunction } from '@renderer/utils'
import { Select, Space } from 'antd'
import { isEmpty } from 'lodash'
import { find, sortBy } from 'lodash'
import { FC, useCallback, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  text: string
}

let _targetLanguage = 'chinese'

const Translate: FC<Props> = ({ text }) => {
  const [result, setResult] = useState('')
  const [targetLanguage, setTargetLanguage] = useState(_targetLanguage)
  const { translateModel, setTranslateModel } = useDefaultModel()
  const { t } = useTranslation()
  const translatingRef = useRef(false)
  const { providers } = useProviders()
  const allModels = providers.map((p) => p.models).flat()

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

  _targetLanguage = targetLanguage

  const translate = useCallback(async () => {
    if (!text.trim() || !translateModel) return

    if (translatingRef.current) return

    try {
      translatingRef.current = true

      const targetLang = await db.settings.get({ id: 'translate:target:language' })
      const assistant: Assistant = getDefaultTranslateAssistant(targetLang?.value || targetLanguage, text)
      // const message: Message = {
      //   id: uuid(),
      //   role: 'user',
      //   content: '',
      //   assistantId: assistant.id,
      //   topicId: uuid(),
      //   model: translateModel,
      //   createdAt: new Date().toISOString(),
      //   type: 'text',
      //   status: 'sending'
      // }

      await fetchTranslate({ content: text, assistant, onResponse: setResult })

      translatingRef.current = false
    } catch (error) {
      console.error(error)
    } finally {
      translatingRef.current = false
    }
  }, [text, targetLanguage, translateModel])

  useEffect(() => {
    runAsyncFunction(async () => {
      const targetLang = await db.settings.get({ id: 'translate:target:language' })
      targetLang && setTargetLanguage(targetLang.value)
    })
  }, [])

  useEffect(() => {
    translate()
  }, [translate])

  useHotkeys('c', () => {
    navigator.clipboard.writeText(result)
    window.message.success(t('message.copy.success'))
  })

  return (
    <Container>
      <MenuContainer>
        <Select
          showSearch
          value={translateModel ? getModelUniqId(translateModel) : undefined}
          style={{ maxWidth: 280 }}
          onChange={(value) => {
            const model = find(allModels, (m) => getModelUniqId(m) === value)
            if (model) setTranslateModel(model)
          }}
          options={selectOptions}
          placeholder={t('settings.models.empty')}
        />
        <SwapOutlined />
        <Select
          showSearch
          value={targetLanguage}
          style={{ maxWidth: 200, minWidth: 130, flex: 1 }}
          optionFilterProp="label"
          options={TranslateLanguageOptions}
          onChange={async (value) => {
            await db.settings.put({ id: 'translate:target:language', value })
            setTargetLanguage(value)
          }}
          optionRender={(option) => (
            <Space>
              <span role="img" aria-label={option.data.label}>
                {option.data.emoji}
              </span>
              {option.label}
            </Space>
          )}
        />
      </MenuContainer>
      <Main>
        {isEmpty(result) ? (
          <LoadingText>{t('translate.output.placeholder')}...</LoadingText>
        ) : (
          <OutputContainer>
            <ResultText>{result}</ResultText>
          </OutputContainer>
        )}
      </Main>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: 12px;
  /* padding-right: 0; */
  overflow: hidden;
  -webkit-app-region: none;
`

const Main = styled.div`
  display: flex;
  flex: 1;
  width: 100%;
  overflow: hidden;
`

const ResultText = styled.div`
  white-space: pre-wrap;
  word-break: break-word;
  width: 100%;
`

const LoadingText = styled.div`
  color: var(--color-text-2);
  font-style: italic;
`

const MenuContainer = styled.div`
  display: flex;
  width: 100%;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  margin-bottom: 15px;
  gap: 20px;
`

const OutputContainer = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 10px;
`

export default Translate
