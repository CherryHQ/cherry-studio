import { LoadingOutlined } from '@ant-design/icons'
import { Box } from '@renderer/components/Layout'
import { TopView } from '@renderer/components/TopView'
import { checkModel } from '@renderer/services/ModelService'
import { Model, Provider } from '@renderer/types'
import { maskApiKey } from '@renderer/utils/api'
import { Button, Modal, Radio, Segmented, Space, Spin, Typography } from 'antd'
import { TFunction } from 'i18next'
import { useCallback, useMemo, useReducer } from 'react'
import { useTranslation } from 'react-i18next'

import HealthCheckModelList from './HealthCheckModelList'

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
export interface ApiKeyStatus {
  key: string
  isValid: boolean
  error?: string
  checkTime?: number // Check latency in milliseconds
}

/**
 * Interface representing the status of a model, including the results of API key checks
 */
export interface ModelStatus {
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
 * Type definition for processing the results of API key checks
 */
type ProcessResultsFn = (keyResults: ApiKeyStatus[]) => {
  status: ModelCheckStatus
  error?: string
  keyResults?: ApiKeyStatus[]
  checkTime?: number
}

/**
 * Create ApiKeyStatus object from checkModel result
 */
function createApiKeyStatus(key: string, result: any): ApiKeyStatus {
  return {
    key,
    isValid: result.valid,
    error: result.error?.message,
    checkTime: result.latency
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
  processResultsFn,
  dispatch
}: {
  modelStatuses: ModelStatus[]
  provider: Provider
  keysToUse: string[]
  isConcurrent: boolean
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

      // Concurrently check all models
      await Promise.all(
        modelStatuses.map(async (status, modelIndex) => {
          const keyResults = await Promise.all(
            keysToUse.map(async (key) => {
              const result = await checkModel({ ...provider, apiKey: key }, status.model)
              return createApiKeyStatus(key, result)
            })
          )
          updateModelStatus(modelIndex, keyResults, processResultsFn, dispatch)
        })
      )
    } else {
      // Serial processing of models
      for (let i = 0; i < modelStatuses.length; i++) {
        dispatch({
          type: 'UPDATE_MODEL_STATUS',
          payload: { index: i, status: { checking: true } }
        })

        const keyResults: ApiKeyStatus[] = []
        for (const key of keysToUse) {
          const result = await checkModel({ ...provider, apiKey: key }, modelStatuses[i].model)
          keyResults.push(createApiKeyStatus(key, result))
        }

        updateModelStatus(i, keyResults, processResultsFn, dispatch)
      }
    }
  } finally {
    // Always reset the global checking state when done
    dispatch({ type: 'SET_CHECKING', payload: false })
  }
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
 * Main container component for the health check popup
 */
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

      {/* Model list with status indicators */}
      <HealthCheckModelList modelStatuses={modelStatuses} />
    </Modal>
  )
}

/**
 * Static class for showing the Health Check popup
 * Uses TopView to display as a modal
 */
export default class HealthCheckPopup {
  static readonly topviewId = 'HealthCheckPopup'

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
