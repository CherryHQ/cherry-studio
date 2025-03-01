import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { Box, HStack } from '@renderer/components/Layout'
import ModelTags from '@renderer/components/ModelTags'
import Scrollbar from '@renderer/components/Scrollbar'
import { TopView } from '@renderer/components/TopView'
import { getModelLogo } from '@renderer/config/models'
import { checkApi } from '@renderer/services/ApiService'
import { Model, Provider } from '@renderer/types'
import { Avatar, Button, List, Modal, Radio, Segmented, Space, Spin, Tooltip, Typography } from 'antd'
import { TFunction } from 'i18next'
import { useCallback, useMemo, useReducer } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const ModelNameRow = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
`

/**
 * Extract color constants
 */
const STATUS_COLORS = {
  success: '#52c41a',
  error: '#ff4d4f',
  warning: '#faad14'
}

/**
 * Enum for model check status states
 */
export enum ModelCheckStatus {
  NOT_CHECKED = 'not_checked',
  SUCCESS = 'success',
  FAILED = 'failed',
  PARTIAL = 'partial' // Some API keys worked, some failed
}

interface ShowParams {
  title: string
  provider: Provider
  apiKeys: string[]
}

interface ResolveData {
  checkedModels?: ModelStatus[]
}

interface Props extends ShowParams {
  resolve: (data: ResolveData) => void
}

/**
 * Interface representing the check status of a single API key
 */
interface ApiKeyStatus {
  key: string
  isValid: boolean
  error?: string
  checkTime?: number // Check latency in milliseconds
}

/**
 * Interface representing the status of a model, including the results of API key checks
 */
interface ModelStatus {
  model: Model
  status?: ModelCheckStatus
  checking?: boolean
  error?: string
  keyResults?: ApiKeyStatus[]
  checkTime?: number // Check latency in milliseconds (uses the fastest successful check)
}

/**
 * Component state type definition
 */
type State = {
  open: boolean
  selectedKeyIndex: number
  keyCheckMode: 'single' | 'all' // Whether to check with single key or all keys
  isChecking: boolean
  isConcurrent: boolean
  modelStatuses: ModelStatus[]
}

/**
 * Reducer action type definition
 */
type Action =
  | { type: 'SET_OPEN'; payload: boolean }
  | { type: 'SET_KEY_INDEX'; payload: number }
  | { type: 'SET_KEY_CHECK_MODE'; payload: 'single' | 'all' }
  | { type: 'SET_CHECKING'; payload: boolean }
  | { type: 'SET_CONCURRENT'; payload: boolean }
  | { type: 'UPDATE_MODEL_STATUS'; payload: { index: number; status: Partial<ModelStatus> } }
  | { type: 'SET_MODEL_STATUSES'; payload: ModelStatus[] }

/**
 * Reducer function to handle state updates
 */
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_OPEN':
      return { ...state, open: action.payload }
    case 'SET_KEY_INDEX':
      return { ...state, selectedKeyIndex: action.payload }
    case 'SET_KEY_CHECK_MODE':
      return { ...state, keyCheckMode: action.payload }
    case 'SET_CHECKING':
      return { ...state, isChecking: action.payload }
    case 'SET_CONCURRENT':
      return { ...state, isConcurrent: action.payload }
    case 'UPDATE_MODEL_STATUS':
      return {
        ...state,
        modelStatuses: state.modelStatuses.map((status, idx) =>
          idx === action.payload.index ? { ...status, ...action.payload.status } : status
        )
      }
    case 'SET_MODEL_STATUSES':
      return { ...state, modelStatuses: action.payload }
    default:
      return state
  }
}

/**
 * Interface for the result of a model check operation
 */
interface ModelCheckResult {
  valid: boolean
  error: Error | null
}

/**
 * Type definition for model check function
 */
type ModelCheckFn = (provider: Provider, model: Model) => Promise<ModelCheckResult>

/**
 * Type definition for processing the results of API key checks
 */
type ProcessResultsFn = (keyResults: ApiKeyStatus[]) => {
  status: ModelCheckStatus
  error?: string
  keyResults?: ApiKeyStatus[]
  checkTime?: number
}

/**
 * Helper function to check a model with a specific API key
 */
async function checkModelWithKey(
  provider: Provider,
  model: Model,
  key: string,
  checkFn: ModelCheckFn
): Promise<ApiKeyStatus> {
  try {
    const startTime = performance.now()
    const { valid, error } = await checkFn({ ...provider, apiKey: key }, model)
    const checkTime = performance.now() - startTime
    return { key, isValid: valid, error: error?.message, checkTime }
  } catch (err) {
    return {
      key,
      isValid: false,
      error: err instanceof Error ? err.message : String(err),
      checkTime: undefined
    }
  }
}

/**
 * Process results and update model status
 */
function updateModelStatus(
  modelIndex: number,
  keyResults: ApiKeyStatus[],
  processResultsFn: ProcessResultsFn,
  dispatch: React.Dispatch<Action>
) {
  const processedResult = processResultsFn(keyResults)

  dispatch({
    type: 'UPDATE_MODEL_STATUS',
    payload: {
      index: modelIndex,
      status: {
        checking: false,
        ...processedResult
      }
    }
  })
}

/**
 * Main function to perform model checks
 * Handles both concurrent and serial checking modes
 */
async function performModelChecks({
  modelStatuses,
  provider,
  keysToUse,
  isConcurrent,
  checkFn,
  processResultsFn,
  dispatch
}: {
  modelStatuses: ModelStatus[]
  provider: Provider
  keysToUse: string[]
  isConcurrent: boolean
  checkFn: ModelCheckFn
  processResultsFn: ProcessResultsFn
  dispatch: React.Dispatch<Action>
}) {
  // Set global checking state to true
  dispatch({ type: 'SET_CHECKING', payload: true })

  try {
    if (isConcurrent) {
      // Mark all models as checking
      modelStatuses.forEach((_, modelIndex) => {
        dispatch({
          type: 'UPDATE_MODEL_STATUS',
          payload: { index: modelIndex, status: { checking: true } }
        })
      })

      // Create promises for each model check
      const checkPromises = modelStatuses.map(async (status, modelIndex) => {
        try {
          // Check all keys for this model concurrently
          const keyResults = await Promise.all(
            keysToUse.map((key) => checkModelWithKey(provider, status.model, key, checkFn))
          )

          // Update model status immediately
          updateModelStatus(modelIndex, keyResults, processResultsFn, dispatch)
        } catch (error) {
          console.error(`Error checking model at index ${modelIndex}:`, error)
          dispatch({
            type: 'UPDATE_MODEL_STATUS',
            payload: {
              index: modelIndex,
              status: {
                checking: false,
                status: ModelCheckStatus.FAILED,
                error: error instanceof Error ? error.message : String(error)
              }
            }
          })
        }
      })

      await Promise.all(checkPromises)
    } else {
      // Serial processing
      for (let m = 0; m < modelStatuses.length; m++) {
        dispatch({
          type: 'UPDATE_MODEL_STATUS',
          payload: { index: m, status: { checking: true } }
        })

        const keyResults: ApiKeyStatus[] = []

        // Process each key for the current model
        for (let k = 0; k < keysToUse.length; k++) {
          const result = await checkModelWithKey(provider, modelStatuses[m].model, keysToUse[k], checkFn)
          keyResults.push(result)
        }

        // Update model status
        updateModelStatus(m, keyResults, processResultsFn, dispatch)
      }
    }
  } finally {
    // Always reset the global checking state when done
    dispatch({ type: 'SET_CHECKING', payload: false })
  }
}

/**
 * Helper hook for formatting utilities
 */
function useFormatUtils() {
  const formatCheckTime = useCallback((time?: number) => {
    if (!time) return ''
    return `${(time / 1000).toFixed(2)}s`
  }, [])

  const maskApiKey = useCallback((key: string) => {
    return key.length > 6 ? `${key.slice(0, 2)}****${key.slice(-4)}` : key
  }, [])

  return { formatCheckTime, maskApiKey }
}

/**
 * Hook for processing API key check results
 */
function useResultProcessors(t: TFunction) {
  /**
   * Process the result of a single API key check
   */
  const processSingleKeyResult = useCallback(
    (keyResults: ApiKeyStatus[]): { status: ModelCheckStatus; error?: string; checkTime?: number } => {
      const result = keyResults[0] // Only one result when using a single key
      return {
        status: result.isValid ? ModelCheckStatus.SUCCESS : ModelCheckStatus.FAILED,
        error: result.error,
        // Only return time for successful checks
        checkTime: result.isValid ? result.checkTime : undefined
      }
    },
    []
  )

  /**
   * Process the results of multiple API key checks
   * Calculates an aggregate status and finds the fastest successful check time
   */
  const processMultipleKeysResult = useCallback(
    (
      keyResults: ApiKeyStatus[]
    ): { status: ModelCheckStatus; error?: string; keyResults: ApiKeyStatus[]; checkTime?: number } => {
      const validKeyCount = keyResults.filter((kr) => kr.isValid).length
      const invalidKeyCount = keyResults.length - validKeyCount

      let modelStatus: ModelCheckStatus = ModelCheckStatus.NOT_CHECKED
      let modelError: string | undefined = undefined

      // Determine the model status based on API key check results
      if (validKeyCount > 0 && invalidKeyCount > 0) {
        // Some keys passed, some failed
        modelStatus = ModelCheckStatus.PARTIAL
        modelError = t('settings.models.check.keys_status_count', {
          count_passed: validKeyCount,
          count_failed: invalidKeyCount
        })
      } else if (validKeyCount > 0) {
        // All keys passed
        modelStatus = ModelCheckStatus.SUCCESS
      } else {
        // All keys failed
        modelStatus = ModelCheckStatus.FAILED
        // Combine unique error messages
        const errors = keyResults
          .filter((kr) => kr.error)
          .map((kr) => kr.error)
          .filter((v, i, a) => a.indexOf(v) === i)
        modelError = errors.join('; ')
      }

      // Calculate the fastest response time from valid API keys
      const validKeyResults = keyResults.filter((kr) => kr.isValid && kr.checkTime !== undefined)
      let checkTime: number | undefined = undefined

      if (validKeyResults.length > 0) {
        // Find the minimum check time
        checkTime = Math.min(...validKeyResults.map((kr) => kr.checkTime as number))
      }

      return {
        status: modelStatus,
        error: modelError,
        keyResults,
        checkTime
      }
    },
    [t]
  )

  return { processSingleKeyResult, processMultipleKeysResult }
}

/**
 * Hook for modal dialog actions
 */
function useModalActions(
  resolve: (data: ResolveData) => void,
  modelStatuses: ModelStatus[],
  dispatch: React.Dispatch<Action>
) {
  const onOk = useCallback(() => {
    resolve({ checkedModels: modelStatuses })
    dispatch({ type: 'SET_OPEN', payload: false })
  }, [modelStatuses, resolve, dispatch])

  const onCancel = useCallback(() => {
    dispatch({ type: 'SET_OPEN', payload: false })
  }, [dispatch])

  const onClose = useCallback(() => {
    resolve({})
  }, [resolve])

  return { onOk, onCancel, onClose }
}

/**
 * Hook for handling model check operations
 */
function useModelChecks({
  apiKeys,
  provider,
  modelStatuses,
  selectedKeyIndex,
  keyCheckMode,
  isConcurrent,
  dispatch,
  processSingleKeyResult,
  processMultipleKeysResult
}: {
  apiKeys: string[]
  provider: Provider
  modelStatuses: ModelStatus[]
  selectedKeyIndex: number
  keyCheckMode: 'single' | 'all'
  isConcurrent: boolean
  dispatch: React.Dispatch<Action>
  processSingleKeyResult: (keyResults: ApiKeyStatus[]) => {
    status: ModelCheckStatus
    error?: string
    checkTime?: number
  }
  processMultipleKeysResult: (keyResults: ApiKeyStatus[]) => {
    status: ModelCheckStatus
    error?: string
    keyResults: ApiKeyStatus[]
    checkTime?: number
  }
}) {
  /**
   * Check all models with a single selected API key
   */
  const checkAllModels = useCallback(async () => {
    const apiKey = apiKeys[selectedKeyIndex]
    await performModelChecks({
      modelStatuses,
      provider,
      keysToUse: [apiKey], // Only use the selected API key
      isConcurrent,
      checkFn: checkApi,
      processResultsFn: processSingleKeyResult,
      dispatch
    })
  }, [apiKeys, provider, selectedKeyIndex, modelStatuses, isConcurrent, processSingleKeyResult, dispatch])

  /**
   * Check all models with all available API keys
   */
  const checkAllModelsWithAllKeys = useCallback(async () => {
    await performModelChecks({
      modelStatuses,
      provider,
      keysToUse: apiKeys, // Use all API keys
      isConcurrent,
      checkFn: checkApi,
      processResultsFn: processMultipleKeysResult,
      dispatch
    })
  }, [apiKeys, provider, modelStatuses, isConcurrent, processMultipleKeysResult, dispatch])

  /**
   * Initiate model checking based on the selected mode
   */
  const onCheckModels = useCallback(async () => {
    if (keyCheckMode === 'single') {
      await checkAllModels()
    } else {
      await checkAllModelsWithAllKeys()
    }
  }, [keyCheckMode, checkAllModels, checkAllModelsWithAllKeys])

  return { onCheckModels }
}

/**
 * Hook for rendering model status UI elements
 */
function useModelStatusRendering(
  t: TFunction,
  formatCheckTime: (time?: number) => string,
  maskApiKey: (key: string) => string
) {
  /**
   * Generate tooltip content for model check results
   */
  const renderKeyCheckResultTooltip = useCallback(
    (status: ModelStatus) => {
      const statusTitle =
        status.status === ModelCheckStatus.SUCCESS
          ? t('settings.models.check.passed')
          : t('settings.models.check.failed')

      if (!status.keyResults || status.keyResults.length === 0) {
        // Simple tooltip for single key result
        return (
          <div>
            <strong>{statusTitle}</strong>
            {status.error && <div style={{ marginTop: 5, color: STATUS_COLORS.error }}>{status.error}</div>}
          </div>
        )
      }

      // Detailed tooltip for multiple key results
      return (
        <div>
          {statusTitle}
          {status.error && <div style={{ marginTop: 5, marginBottom: 5 }}>{status.error}</div>}
          <div style={{ marginTop: 5 }}>
            <ul style={{ maxHeight: '300px', overflowY: 'auto', margin: 0, padding: 0, listStyleType: 'none' }}>
              {status.keyResults.map((kr, idx) => {
                // Mask API key for security
                const maskedKey = maskApiKey(kr.key)

                return (
                  <li
                    key={idx}
                    style={{ marginBottom: '5px', color: kr.isValid ? STATUS_COLORS.success : STATUS_COLORS.error }}>
                    {maskedKey}: {kr.isValid ? t('settings.models.check.passed') : t('settings.models.check.failed')}
                    {kr.error && !kr.isValid && ` (${kr.error})`}
                    {kr.checkTime && kr.isValid && ` (${formatCheckTime(kr.checkTime)})`}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )
    },
    [t, formatCheckTime, maskApiKey]
  )

  /**
   * Render the appropriate status indicator based on the model's check status
   */
  const renderStatusIndicator = useCallback(
    (status: ModelStatus) => {
      if (status.checking) {
        return <Spin indicator={<LoadingOutlined spin />} />
      }

      switch (status.status) {
        case ModelCheckStatus.SUCCESS:
          return (
            <Tooltip title={renderKeyCheckResultTooltip(status)}>
              <CheckCircleFilled style={{ color: STATUS_COLORS.success }} />
            </Tooltip>
          )
        case ModelCheckStatus.FAILED:
          return (
            <Tooltip title={renderKeyCheckResultTooltip(status)}>
              <CloseCircleFilled style={{ color: STATUS_COLORS.error }} />
            </Tooltip>
          )
        case ModelCheckStatus.PARTIAL:
          return (
            <Tooltip title={renderKeyCheckResultTooltip(status)}>
              <ExclamationCircleFilled style={{ color: STATUS_COLORS.warning }} />
            </Tooltip>
          )
        default:
          return <span>{t('settings.models.check.not_checked')}</span>
      }
    },
    [t, renderKeyCheckResultTooltip]
  )

  return { renderKeyCheckResultTooltip, renderStatusIndicator }
}

const PopupContainer: React.FC<Props> = ({ title, provider, apiKeys, resolve }) => {
  const { t } = useTranslation()

  // Initialize state with reducer
  const [state, dispatch] = useReducer(reducer, {
    open: true,
    selectedKeyIndex: 0,
    keyCheckMode: 'single',
    isChecking: false,
    isConcurrent: false,
    modelStatuses: provider.models.map((model) => ({ model }))
  })

  const { open, selectedKeyIndex, keyCheckMode, isChecking, isConcurrent, modelStatuses } = state

  // Use custom hooks
  const { formatCheckTime, maskApiKey } = useFormatUtils()
  const { processSingleKeyResult, processMultipleKeysResult } = useResultProcessors(t)
  const { onCheckModels } = useModelChecks({
    apiKeys,
    provider,
    modelStatuses,
    selectedKeyIndex,
    keyCheckMode,
    isConcurrent,
    dispatch,
    processSingleKeyResult,
    processMultipleKeysResult
  })
  const { renderStatusIndicator } = useModelStatusRendering(t, formatCheckTime, maskApiKey)
  const { onOk, onCancel, onClose } = useModalActions(resolve, modelStatuses, dispatch)

  // Check if we have multiple API keys
  const hasMultipleKeys = useMemo(() => apiKeys.length > 1, [apiKeys.length])

  return (
    <Modal
      title={title}
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      afterClose={onClose}
      centered
      maskClosable={false}
      width={600}
      footer={
        <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Space>
            <Space align="center">
              <Typography.Text strong>{t('settings.models.check.use_all_keys')}</Typography.Text>
              <Segmented
                value={keyCheckMode}
                onChange={(value) => dispatch({ type: 'SET_KEY_CHECK_MODE', payload: value as 'single' | 'all' })}
                disabled={isChecking}
                size="small"
                options={[
                  { value: 'single', label: t('settings.models.check.single') },
                  { value: 'all', label: t('settings.models.check.all') }
                ]}
              />
            </Space>
            <Space align="center">
              <Typography.Text strong>{t('settings.models.check.enable_concurrent')}</Typography.Text>
              <Segmented
                value={isConcurrent ? 'enabled' : 'disabled'}
                onChange={(value) => dispatch({ type: 'SET_CONCURRENT', payload: value === 'enabled' })}
                disabled={isChecking}
                size="small"
                options={[
                  { value: 'disabled', label: t('settings.models.check.disabled') },
                  { value: 'enabled', label: t('settings.models.check.enabled') }
                ]}
              />
            </Space>
          </Space>
          <Space>
            <Button key="check" type="primary" ghost onClick={onCheckModels} disabled={isChecking}>
              {isChecking ? (
                <Spin indicator={<LoadingOutlined style={{ fontSize: 16 }} spin />} />
              ) : (
                t('settings.models.check.check_all_models')
              )}
            </Button>
          </Space>
        </Space>
      }>
      {/* API key selection section - only shown for 'single' mode and multiple keys */}
      {keyCheckMode === 'single' && hasMultipleKeys && (
        <Box style={{ marginBottom: 16 }}>
          <strong>{t('settings.models.check.select_api_key')}</strong>
          <Radio.Group
            value={selectedKeyIndex}
            onChange={(e) => dispatch({ type: 'SET_KEY_INDEX', payload: e.target.value })}
            style={{ display: 'block', marginTop: 8 }}
            disabled={isChecking}>
            {apiKeys.map((key, index) => (
              <Radio key={index} value={index} style={{ display: 'block', marginBottom: 8 }}>
                <Typography.Text copyable={{ text: key }} style={{ maxWidth: '450px' }}>
                  {maskApiKey(key)}
                </Typography.Text>
              </Radio>
            ))}
          </Radio.Group>
        </Box>
      )}

      {/* Model list with check status */}
      <Scrollbar style={{ maxHeight: '50vh', overflowX: 'hidden' }}>
        <List
          dataSource={modelStatuses}
          renderItem={(status) => (
            <List.Item>
              <HStack style={{ width: '100%', justifyContent: 'space-between' }}>
                <Space>
                  <Avatar src={getModelLogo(status.model.id)} size={22} style={{ marginRight: '2px' }}>
                    {status.model?.name?.[0]?.toUpperCase()}
                  </Avatar>
                  <ModelNameRow>
                    <span>{status.model?.name}</span>
                    <ModelTags model={status.model} />
                  </ModelNameRow>
                  {/* Display response time for successful or partially successful models */}
                  {status.checkTime &&
                    (status.status === ModelCheckStatus.SUCCESS || status.status === ModelCheckStatus.PARTIAL) && (
                      <Typography.Text type="secondary">{formatCheckTime(status.checkTime)}</Typography.Text>
                    )}
                </Space>
                <Space>{renderStatusIndicator(status)}</Space>
              </HStack>
            </List.Item>
          )}
        />
      </Scrollbar>
    </Modal>
  )
}

/**
 * Static class for showing the Model Health Check popup
 * Uses TopView to display as a modal
 */
export default class ModelHealthCheckPopup {
  static readonly topviewId = 'ModelHealthCheckPopup'

  /**
   * Hide the popup
   */
  static hide(): void {
    TopView.hide(this.topviewId)
  }

  /**
   * Show the popup and return a promise that resolves with the check results
   * @param props Popup configuration
   * @returns Promise with check results
   */
  static show(props: ShowParams): Promise<ResolveData> {
    return new Promise<ResolveData>((resolve) => {
      TopView.show(
        <PopupContainer
          {...props}
          resolve={(data: ResolveData) => {
            resolve(data)
            this.hide()
          }}
        />,
        this.topviewId
      )
    })
  }
}
