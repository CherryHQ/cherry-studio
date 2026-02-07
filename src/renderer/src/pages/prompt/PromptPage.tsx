import { SendOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { CopyIcon } from '@renderer/components/Icons'
import ModelSelectButton from '@renderer/components/ModelSelectButton'
import { isEmbeddingModel, isRerankModel, isTextToImageModel } from '@renderer/config/models'
import { PROMPT_METAPROMPT } from '@renderer/config/prompts'
import db from '@renderer/databases'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import { useTemporaryValue } from '@renderer/hooks/useTemporaryValue'
import {
  extractPromptFromResponse,
  extractVariables,
  findFreeFloatingVariables,
  fixFloatingVariables,
  generatePromptTemplate,
  replaceVariables,
  testPrompt
} from '@renderer/services/PromptService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setPromptMetaprompt } from '@renderer/store/settings'
import type { Model } from '@renderer/types'
import { uuid } from '@renderer/utils'
import { abortCompletion } from '@renderer/utils/abortController'
import { formatErrorMessageWithPrefix, isAbortError } from '@renderer/utils/error'
import { Button, Input, Modal, Popover, Tooltip } from 'antd'
import type { TextAreaRef } from 'antd/es/input/TextArea'
import TextArea from 'antd/es/input/TextArea'
import { throttle } from 'lodash'
import { AlertCircle, Check, CirclePause, Play, RotateCcw, Settings2, Wrench } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('PromptPage')

const PromptPage: FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const promptMetaprompt = useAppSelector((state) => state.settings.promptMetaprompt)
  const { translateModel: promptModel, setTranslateModel: setPromptModel } = useDefaultModel()

  // States
  const [taskInput, setTaskInput] = useState('')
  const [generatedPrompt, setGeneratedPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useTemporaryValue(false, 2000)
  const [settingsVisible, setSettingsVisible] = useState(false)
  const [editedMetaprompt, setEditedMetaprompt] = useState('')
  const [abortKey, setAbortKey] = useState<string | null>(null)

  // New states for variable handling and testing
  const [extractedVariables, setExtractedVariables] = useState<string[]>([])
  const [variableValues, setVariableValues] = useState<Record<string, string>>({})
  const [freeFloatingVariables, setFreeFloatingVariables] = useState<string[]>([])
  const [testModalVisible, setTestModalVisible] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')
  const [fixing, setFixing] = useState(false)

  // Refs
  const textAreaRef = useRef<TextAreaRef>(null)

  // Initialize edited metaprompt when settings modal opens
  useEffect(() => {
    if (settingsVisible) {
      // Use current value or fallback to default if empty
      setEditedMetaprompt(promptMetaprompt || PROMPT_METAPROMPT)
    }
  }, [settingsVisible, promptMetaprompt])

  // Extract variables when prompt changes
  useEffect(() => {
    if (generatedPrompt) {
      // Extract prompt from response if needed
      const cleanedPrompt = extractPromptFromResponse(generatedPrompt)
      const variables = extractVariables(cleanedPrompt)
      setExtractedVariables(variables)

      // Initialize variable values using functional update to avoid dependency
      setVariableValues((prev) => {
        const initialValues: Record<string, string> = {}
        variables.forEach((v) => {
          initialValues[v] = prev[v] || ''
        })
        return initialValues
      })

      // Check for free-floating variables
      const floating = findFreeFloatingVariables(cleanedPrompt)
      setFreeFloatingVariables(floating)
    } else {
      setExtractedVariables([])
      setVariableValues({})
      setFreeFloatingVariables([])
    }
  }, [generatedPrompt])

  // Handle model change
  const handleModelChange = (model: Model) => {
    setPromptModel(model)
    db.settings.put({ id: 'prompt:model', value: model.id })
  }

  // Copy to clipboard
  const handleCopy = useCallback(async () => {
    try {
      const contentToCopy = extractPromptFromResponse(generatedPrompt)
      await navigator.clipboard.writeText(contentToCopy)
      setCopied(true)
      window.toast.success(t('common.copied'))
    } catch (error) {
      logger.error('Failed to copy text to clipboard:', error as Error)
      window.toast.error(t('common.copy_failed'))
    }
  }, [generatedPrompt, setCopied, t])

  // Generate prompt
  const handleGenerate = useCallback(async () => {
    if (!taskInput.trim()) {
      window.toast.warning(t('prompt.error.empty_task'))
      return
    }
    if (!promptModel) {
      window.toast.error(t('prompt.error.no_model'))
      return
    }

    setGenerating(true)
    setGeneratedPrompt('')
    setTestResult('')
    const currentAbortKey = uuid()
    setAbortKey(currentAbortKey)

    try {
      await generatePromptTemplate({
        taskDescription: taskInput,
        metaprompt: promptMetaprompt || PROMPT_METAPROMPT,
        model: promptModel,
        abortKey: currentAbortKey,
        onResponse: throttle((text, isComplete) => {
          setGeneratedPrompt(text)
          if (isComplete) {
            setGenerating(false)
          }
        }, 100)
      })
      window.toast.success(t('prompt.success.generated'))
    } catch (error) {
      if (isAbortError(error)) {
        window.toast.info(t('prompt.info.aborted'))
      } else {
        logger.error('Failed to generate prompt:', error as Error)
        window.toast.error(formatErrorMessageWithPrefix(error, t('prompt.error.generate_failed')))
      }
    } finally {
      setGenerating(false)
      setAbortKey(null)
    }
  }, [taskInput, promptMetaprompt, promptModel, t])

  // Fix floating variables
  const handleFixFloatingVariables = useCallback(async () => {
    if (!generatedPrompt || freeFloatingVariables.length === 0) {
      return
    }
    if (!promptModel) {
      window.toast.error(t('prompt.error.no_model'))
      return
    }

    setFixing(true)
    const currentAbortKey = uuid()
    setAbortKey(currentAbortKey)

    try {
      const cleanedPrompt = extractPromptFromResponse(generatedPrompt)
      const fixedPrompt = await fixFloatingVariables({
        prompt: cleanedPrompt,
        model: promptModel,
        abortKey: currentAbortKey
      })
      setGeneratedPrompt(fixedPrompt)
      window.toast.success(t('prompt.success.fixed'))
    } catch (error) {
      if (isAbortError(error)) {
        window.toast.info(t('prompt.info.aborted'))
      } else {
        logger.error('Failed to fix floating variables:', error as Error)
        window.toast.error(formatErrorMessageWithPrefix(error, t('prompt.error.fix_failed')))
      }
    } finally {
      setFixing(false)
      setAbortKey(null)
    }
  }, [generatedPrompt, freeFloatingVariables, promptModel, t])

  // Test prompt with variables
  const handleTestPrompt = useCallback(async () => {
    if (!generatedPrompt) {
      return
    }
    if (!promptModel) {
      window.toast.error(t('prompt.error.no_model'))
      return
    }

    // Check if all variables have values
    const missingVariables = extractedVariables.filter((v) => !variableValues[v]?.trim())
    if (missingVariables.length > 0) {
      window.toast.warning(t('prompt.error.missing_variables', { variables: missingVariables.join(', ') }))
      return
    }

    setTesting(true)
    setTestResult('')
    const currentAbortKey = uuid()
    setAbortKey(currentAbortKey)

    try {
      const cleanedPrompt = extractPromptFromResponse(generatedPrompt)
      const promptWithValues = replaceVariables(cleanedPrompt, variableValues)

      await testPrompt({
        prompt: promptWithValues,
        model: promptModel,
        abortKey: currentAbortKey,
        onResponse: throttle((text, isComplete) => {
          setTestResult(text)
          if (isComplete) {
            setTesting(false)
          }
        }, 100)
      })
      window.toast.success(t('prompt.success.tested'))
    } catch (error) {
      if (isAbortError(error)) {
        window.toast.info(t('prompt.info.aborted'))
      } else {
        logger.error('Failed to test prompt:', error as Error)
        window.toast.error(formatErrorMessageWithPrefix(error, t('prompt.error.test_failed')))
      }
    } finally {
      setTesting(false)
      setAbortKey(null)
    }
  }, [generatedPrompt, extractedVariables, variableValues, promptModel, t])

  // Abort generation
  const handleAbort = useCallback(() => {
    if (abortKey) {
      abortCompletion(abortKey)
    }
  }, [abortKey])

  // Handle Enter key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const isEnterPressed = e.key === 'Enter'
      if (isEnterPressed && !e.nativeEvent.isComposing && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        handleGenerate()
      }
    },
    [handleGenerate]
  )

  // Save metaprompt
  const handleSaveMetaprompt = useCallback(() => {
    dispatch(setPromptMetaprompt(editedMetaprompt))
    window.toast.success(t('prompt.success.metaprompt_saved'))
    setSettingsVisible(false)
  }, [editedMetaprompt, dispatch, t])

  // Reset metaprompt to default
  const handleResetMetaprompt = useCallback(() => {
    setEditedMetaprompt(PROMPT_METAPROMPT)
    window.toast.success(t('prompt.success.metaprompt_reset'))
  }, [t])

  // Model filter
  const modelPredicate = useCallback(
    (m: Model) => !isEmbeddingModel(m) && !isRerankModel(m) && !isTextToImageModel(m),
    []
  )

  // Can generate
  const canGenerate = useMemo(() => {
    return taskInput.trim().length > 0 && !generating
  }, [taskInput, generating])

  // Can test
  const canTest = useMemo(() => {
    return generatedPrompt.trim().length > 0 && !testing && !generating
  }, [generatedPrompt, testing, generating])

  return (
    <Container id="prompt-page">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none', gap: 10 }}>{t('prompt.title')}</NavbarCenter>
      </Navbar>
      <ContentContainer>
        <OperationBar>
          <InnerOperationBar style={{ justifyContent: 'flex-start' }}>
            <GenerateButton
              generating={generating}
              onGenerate={handleGenerate}
              canGenerate={canGenerate}
              onAbort={handleAbort}
            />
            {freeFloatingVariables.length > 0 && (
              <Tooltip title={t('prompt.tooltip.fix_floating_variables')}>
                <Button
                  type="default"
                  icon={<Wrench size={14} />}
                  onClick={handleFixFloatingVariables}
                  loading={fixing}>
                  {t('prompt.button.fix_variables')} ({freeFloatingVariables.length})
                </Button>
              </Tooltip>
            )}
            {extractedVariables.length > 0 && (
              <Popover
                content={
                  <VariablesPopoverContent>
                    <VariablesPopoverTitle>
                      {t('prompt.variables.title')} ({extractedVariables.length})
                    </VariablesPopoverTitle>
                    <VariablesPopoverList>
                      {extractedVariables.map((variable) => (
                        <VariableTag key={variable} $isFloating={freeFloatingVariables.includes(`{$${variable}}`)}>
                          {`{$${variable}}`}
                        </VariableTag>
                      ))}
                    </VariablesPopoverList>
                    {freeFloatingVariables.length > 0 && (
                      <WarningText style={{ marginTop: 8 }}>
                        <AlertCircle size={12} />
                        {t('prompt.variables.floating_warning')}
                      </WarningText>
                    )}
                  </VariablesPopoverContent>
                }
                trigger="hover"
                placement="bottom">
                <Button
                  type="default"
                  icon={<Play size={14} />}
                  onClick={() => setTestModalVisible(true)}
                  disabled={!canTest}>
                  {t('prompt.button.test')} ({extractedVariables.length})
                </Button>
              </Popover>
            )}
          </InnerOperationBar>
          <InnerOperationBar style={{ justifyContent: 'flex-end' }}>
            <ModelSelectButton
              model={promptModel}
              onSelectModel={handleModelChange}
              modelFilter={modelPredicate}
              tooltipProps={{ placement: 'bottom' }}
            />
            <Button type="text" icon={<Settings2 size={18} />} onClick={() => setSettingsVisible(true)} />
          </InnerOperationBar>
        </OperationBar>
        <AreaContainer>
          <InputContainer>
            <Textarea
              ref={textAreaRef}
              variant="borderless"
              placeholder={t('prompt.input.placeholder')}
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={generating}
              autoFocus
            />
          </InputContainer>
          <OutputContainer>
            <CopyButton
              type="text"
              size="small"
              className="copy-button"
              onClick={handleCopy}
              disabled={!generatedPrompt}
              icon={copied ? <Check size={16} color="var(--color-primary)" /> : <CopyIcon size={16} />}
            />
            <OutputText className="selectable">
              {!generatedPrompt ? (
                <div style={{ color: 'var(--color-text-3)', userSelect: 'none' }}>{t('prompt.output.placeholder')}</div>
              ) : (
                <div className="plain">{extractPromptFromResponse(generatedPrompt)}</div>
              )}
            </OutputText>
          </OutputContainer>
        </AreaContainer>
      </ContentContainer>

      {/* Settings Modal */}
      <Modal
        title={t('prompt.settings.title')}
        open={settingsVisible}
        onOk={handleSaveMetaprompt}
        onCancel={() => setSettingsVisible(false)}
        width={800}
        okText={t('common.save')}
        cancelText={t('common.cancel')}>
        <SettingsContent>
          <SettingsLabel>{t('prompt.settings.metaprompt_label')}</SettingsLabel>
          <SettingsDescription>{t('prompt.settings.metaprompt_description')}</SettingsDescription>
          <MetapromptTextArea
            value={editedMetaprompt}
            onChange={(e) => setEditedMetaprompt(e.target.value)}
            placeholder={t('prompt.settings.metaprompt_placeholder')}
            rows={15}
          />
          <ResetButton type="default" icon={<RotateCcw size={14} />} onClick={handleResetMetaprompt}>
            {t('prompt.settings.reset_to_default')}
          </ResetButton>
        </SettingsContent>
      </Modal>

      {/* Test Modal */}
      <Modal
        title={t('prompt.test.modal_title')}
        open={testModalVisible}
        onCancel={() => setTestModalVisible(false)}
        footer={null}
        width={800}>
        <TestModalContent>
          <TestSection>
            <TestSectionTitle>{t('prompt.test.variables_title')}</TestSectionTitle>
            {extractedVariables.length > 0 ? (
              <VariableInputList>
                {extractedVariables.map((variable) => (
                  <VariableInputItem key={variable}>
                    <VariableInputLabel>{`{$${variable}}`}</VariableInputLabel>
                    <Input.TextArea
                      value={variableValues[variable] || ''}
                      onChange={(e) =>
                        setVariableValues((prev) => ({
                          ...prev,
                          [variable]: e.target.value
                        }))
                      }
                      placeholder={t('prompt.test.variable_placeholder', { variable })}
                      rows={2}
                    />
                  </VariableInputItem>
                ))}
              </VariableInputList>
            ) : (
              <NoVariablesText>{t('prompt.test.no_variables')}</NoVariablesText>
            )}
          </TestSection>
          <TestActions>
            <Button
              type="primary"
              icon={<Play size={14} />}
              onClick={handleTestPrompt}
              loading={testing}
              disabled={!canTest}>
              {t('prompt.button.run_test')}
            </Button>
          </TestActions>
          {testResult && (
            <TestResultSection>
              <TestSectionTitle>{t('prompt.test.result_title')}</TestSectionTitle>
              <TestResultText>{testResult}</TestResultText>
            </TestResultSection>
          )}
        </TestModalContent>
      </Modal>
    </Container>
  )
}

// Generate Button Component
const GenerateButton: FC<{
  generating: boolean
  onGenerate: () => void
  canGenerate: boolean
  onAbort: () => void
}> = ({ generating, onGenerate, canGenerate, onAbort }) => {
  const { t } = useTranslation()
  return (
    <Tooltip
      mouseEnterDelay={0.5}
      placement="bottom"
      styles={{ body: { fontSize: '12px' } }}
      title={
        <div style={{ textAlign: 'center' }}>
          Enter: {t('prompt.button.generate')}
          <br />
          Shift + Enter: {t('prompt.tooltip.newline')}
        </div>
      }>
      {!generating ? (
        <Button type="primary" onClick={onGenerate} disabled={!canGenerate} icon={<SendOutlined />}>
          {t('prompt.button.generate')}
        </Button>
      ) : (
        <Button danger type="primary" onClick={onAbort} icon={<CirclePause size={14} />}>
          {t('common.stop')}
        </Button>
      )}
    </Tooltip>
  )
}

// Styled Components
const Container = styled.div`
  flex: 1;
`

const ContentContainer = styled.div`
  height: calc(100vh - var(--navbar-height));
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  padding: 12px;
  position: relative;
  [navbar-position='left'] & {
    padding: 12px 16px;
  }
`

const AreaContainer = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  flex: 1;
  gap: 8px;
`

const InputContainer = styled.div`
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: 10px 5px;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  height: calc(100vh - var(--navbar-height) - 70px);
  overflow: hidden;
`

const Textarea = styled(TextArea)`
  display: flex;
  flex: 1;
  border-radius: 0;
  .ant-input {
    resize: none;
    padding: 5px 16px;
  }
  .ant-input-clear-icon {
    font-size: 16px;
  }
`

const OutputContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  position: relative;
  background-color: var(--color-background-soft);
  border-radius: 10px;
  padding: 10px 5px;
  height: calc(100vh - var(--navbar-height) - 70px);
  overflow: hidden;

  &:hover .copy-button {
    opacity: 1;
    visibility: visible;
  }
`

const CopyButton = styled(Button)`
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
  opacity: 0;
  visibility: hidden;
  transition:
    opacity 0.2s ease-in-out,
    visibility 0.2s ease-in-out;
`

const OutputText = styled.div`
  min-height: 0;
  flex: 1;
  padding: 5px 16px;
  overflow-y: auto;

  .plain {
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }
`

const OperationBar = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding-bottom: 4px;
`

const InnerOperationBar = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  overflow: hidden;
`

// Settings Modal Styles
const SettingsContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const SettingsLabel = styled.div`
  font-weight: 500;
  font-size: 14px;
`

const SettingsDescription = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
`

const MetapromptTextArea = styled(Input.TextArea)`
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 12px;
`

const ResetButton = styled(Button)`
  align-self: flex-start;
`

// Variables Popover Styles
const VariablesPopoverContent = styled.div`
  max-width: 300px;
`

const VariablesPopoverTitle = styled.div`
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-2);
  margin-bottom: 8px;
`

const VariablesPopoverList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const WarningText = styled.span`
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--color-warning);
  font-size: 11px;
`

const VariableTag = styled.span<{ $isFloating?: boolean }>`
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  background-color: ${(props) => (props.$isFloating ? 'var(--color-warning-bg)' : 'var(--color-primary-bg)')};
  color: ${(props) => (props.$isFloating ? 'var(--color-warning)' : 'var(--color-primary)')};
  border: 1px solid ${(props) => (props.$isFloating ? 'var(--color-warning)' : 'var(--color-primary)')};
`

// Test Modal Styles
const TestModalContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 60vh;
  overflow-y: auto;
`

const TestSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const TestSectionTitle = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-1);
  margin-bottom: 4px;
`

const VariableInputList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const VariableInputItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const VariableInputLabel = styled.label`
  font-size: 12px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  color: var(--color-primary);
`

const NoVariablesText = styled.div`
  color: var(--color-text-3);
  font-size: 13px;
  padding: 8px 0;
`

const TestActions = styled.div`
  display: flex;
  justify-content: flex-start;
  padding-top: 8px;
`

const TestResultSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const TestResultText = styled.div`
  padding: 12px;
  background-color: var(--color-background-soft);
  border-radius: 8px;
  font-size: 13px;
  white-space: pre-wrap;
  overflow-y: auto;
  max-height: 300px;
  border: 1px solid var(--color-border-soft);
`

export default PromptPage
