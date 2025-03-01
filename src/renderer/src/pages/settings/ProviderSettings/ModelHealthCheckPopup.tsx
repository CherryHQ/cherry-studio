import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { Box, HStack } from '@renderer/components/Layout'
import ModelTags from '@renderer/components/ModelTags'
import Scrollbar from '@renderer/components/Scrollbar'
import { TopView } from '@renderer/components/TopView'
import { checkApi } from '@renderer/services/ApiService'
import { Model, Provider } from '@renderer/types'
import { Button, List, Modal, Radio, Space, Spin, Switch, Tooltip, Typography } from 'antd'
import { useCallback, useMemo, useReducer } from 'react'
import { useTranslation } from 'react-i18next'

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
  checkMode: 'single' | 'all' // Whether to check with single key or all keys
  isChecking: boolean
  useConcurrentChecks: boolean
  modelStatuses: ModelStatus[]
}

/**
 * Reducer action type definition
 */
type Action =
  | { type: 'SET_OPEN'; payload: boolean }
  | { type: 'SET_KEY_INDEX'; payload: number }
  | { type: 'SET_CHECK_MODE'; payload: 'single' | 'all' }
  | { type: 'SET_CHECKING'; payload: boolean }
  | { type: 'SET_USE_CONCURRENT'; payload: boolean }
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
    case 'SET_CHECK_MODE':
      return { ...state, checkMode: action.payload }
    case 'SET_CHECKING':
      return { ...state, isChecking: action.payload }
    case 'SET_USE_CONCURRENT':
      return { ...state, useConcurrentChecks: action.payload }
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
 * Main function to perform model checks
 * Handles both concurrent and serial checking modes
 *
 * @param modelStatuses - Current status of all models
 * @param provider - The provider to check models against
 * @param keysToUse - Array of API keys to use for checking
 * @param useConcurrentChecks - Whether to check models concurrently
 * @param checkFn - Function to check a model with a provider
 * @param processResultsFn - Function to process the results of checks
 * @param dispatch - Reducer dispatch function
 */
async function performModelChecks({
  modelStatuses,
  provider,
  keysToUse,
  useConcurrentChecks,
  checkFn,
  processResultsFn,
  dispatch
}: {
  modelStatuses: ModelStatus[]
  provider: Provider
  keysToUse: string[]
  useConcurrentChecks: boolean
  checkFn: ModelCheckFn
  processResultsFn: ProcessResultsFn
  dispatch: React.Dispatch<Action>
}) {
  // Set global checking state to true
  dispatch({ type: 'SET_CHECKING', payload: true })

  try {
    if (useConcurrentChecks) {
      // === CONCURRENT MODE ===
      // First, set all models to 'checking' state
      modelStatuses.forEach((_, modelIndex) => {
        dispatch({
          type: 'UPDATE_MODEL_STATUS',
          payload: { index: modelIndex, status: { checking: true } }
        })
      })

      // Create promises for all model checks, but don't wait for all to complete
      // This allows each model's UI to update as soon as its check completes
      const checkPromises = modelStatuses.map(async (status, modelIndex) => {
        try {
          // Check all API keys for this model concurrently
          const keyResults = await Promise.all(
            keysToUse.map(async (key) => {
              try {
                // Record start time for latency measurement
                const startTime = performance.now()
                const { valid, error } = await checkFn({ ...provider, apiKey: key }, status.model)
                // Calculate elapsed time
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
            })
          )

          // Process the results for this model
          const processedResult = processResultsFn(keyResults)

          // Immediately update this model's status, without waiting for other models
          // This is key for responsive UI updates in concurrent mode
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
        } catch (error) {
          // Handle errors for individual model checks
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

      // Wait for all checks to complete, but UI updates happen independently
      await Promise.all(checkPromises)
    } else {
      // === SERIAL MODE ===
      // Process models one at a time
      for (let m = 0; m < modelStatuses.length; m++) {
        dispatch({
          type: 'UPDATE_MODEL_STATUS',
          payload: { index: m, status: { checking: true } }
        })

        const keyResults: ApiKeyStatus[] = []

        // Process each API key for the current model
        for (let k = 0; k < keysToUse.length; k++) {
          const currentKey = keysToUse[k]
          try {
            // Record start time for latency measurement
            const startTime = performance.now()
            const { valid, error } = await checkFn({ ...provider, apiKey: currentKey }, modelStatuses[m].model)
            // Calculate elapsed time
            const checkTime = performance.now() - startTime
            keyResults.push({
              key: currentKey,
              isValid: valid,
              error: error?.message,
              checkTime
            })
          } catch (err) {
            keyResults.push({
              key: currentKey,
              isValid: false,
              error: err instanceof Error ? err.message : String(err),
              checkTime: undefined
            })
          }
        }

        // Process the results for this model
        const processedResult = processResultsFn(keyResults)

        // Update the model's status
        dispatch({
          type: 'UPDATE_MODEL_STATUS',
          payload: {
            index: m,
            status: {
              checking: false,
              ...processedResult
            }
          }
        })
      }
    }
  } finally {
    // Always reset the global checking state when done
    dispatch({ type: 'SET_CHECKING', payload: false })
  }
}

const PopupContainer: React.FC<Props> = ({ title, provider, apiKeys, resolve }) => {
  const { t } = useTranslation()

  // Initialize state with reducer
  const [state, dispatch] = useReducer(reducer, {
    open: true,
    selectedKeyIndex: 0,
    checkMode: 'single',
    isChecking: false,
    useConcurrentChecks: false,
    modelStatuses: provider.models.map((model) => ({ model }))
  })

  const { open, selectedKeyIndex, checkMode, isChecking, useConcurrentChecks, modelStatuses } = state

  /**
   * Process the result of a single API key check
   * Used when checking with a single API key
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
   * Used when checking with all API keys
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
      // This helps users identify the most responsive keys/models
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

  /**
   * Check all models with a single selected API key
   */
  const checkAllModels = useCallback(async () => {
    const apiKey = apiKeys[selectedKeyIndex]
    await performModelChecks({
      modelStatuses,
      provider,
      keysToUse: [apiKey], // Only use the selected API key
      useConcurrentChecks,
      checkFn: checkApi,
      processResultsFn: processSingleKeyResult,
      dispatch
    })
  }, [apiKeys, provider, selectedKeyIndex, modelStatuses, useConcurrentChecks, processSingleKeyResult])

  /**
   * Check all models with all available API keys
   */
  const checkAllModelsWithAllKeys = useCallback(async () => {
    await performModelChecks({
      modelStatuses,
      provider,
      keysToUse: apiKeys, // Use all API keys
      useConcurrentChecks,
      checkFn: checkApi,
      processResultsFn: processMultipleKeysResult,
      dispatch
    })
  }, [apiKeys, provider, modelStatuses, useConcurrentChecks, processMultipleKeysResult])

  /**
   * Initiate model checking based on the selected mode
   */
  const onCheckModels = useCallback(async () => {
    if (checkMode === 'single') {
      await checkAllModels()
    } else {
      await checkAllModelsWithAllKeys()
    }
  }, [checkMode, checkAllModels, checkAllModelsWithAllKeys])

  /**
   * Handle the OK button click - resolve with checked models
   */
  const onOk = useCallback(() => {
    resolve({ checkedModels: modelStatuses })
    dispatch({ type: 'SET_OPEN', payload: false })
  }, [modelStatuses, resolve])

  /**
   * Handle the Cancel button click
   */
  const onCancel = useCallback(() => {
    dispatch({ type: 'SET_OPEN', payload: false })
  }, [])

  /**
   * Handle modal close
   */
  const onClose = useCallback(() => {
    resolve({})
  }, [resolve])

  /**
   * Generate tooltip content for model check results
   * Shows check status, error messages, and response time
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
            {status.error && <div style={{ marginTop: 5, color: '#ff4d4f' }}>{status.error}</div>}
            {status.checkTime && status.status !== ModelCheckStatus.FAILED && (
              <div style={{ marginTop: 5 }}>{(status.checkTime / 1000).toFixed(2)}s</div>
            )}
          </div>
        )
      }

      // Detailed tooltip for multiple key results
      return (
        <div>
          {statusTitle}
          {status.error && <div style={{ marginTop: 5, marginBottom: 5 }}>{status.error}</div>}
          {status.checkTime && status.status !== ModelCheckStatus.FAILED && (
            <div style={{ marginTop: 5 }}>{(status.checkTime / 1000).toFixed(2)}s</div>
          )}
          <div style={{ marginTop: 5 }}>
            <strong>{t('settings.models.check.result_in_detail')}:</strong>
            <ul style={{ maxHeight: '300px', overflowY: 'auto', padding: '5px 0 5px 20px', margin: 0 }}>
              {status.keyResults.map((kr, idx) => {
                // Mask API key for security
                const maskedKey = kr.key.length > 16 ? `${kr.key.slice(0, 8)}...${kr.key.slice(-8)}` : kr.key

                return (
                  <li key={idx} style={{ marginBottom: '5px', color: kr.isValid ? '#52c41a' : '#ff4d4f' }}>
                    {maskedKey}: {kr.isValid ? t('settings.models.check.passed') : t('settings.models.check.failed')}
                    {kr.error && !kr.isValid && ` (${kr.error})`}
                    {kr.checkTime && kr.isValid && ` (${(kr.checkTime / 1000).toFixed(2)}s)`}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )
    },
    [t]
  )

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
            <Radio.Group
              value={checkMode}
              onChange={(e) => dispatch({ type: 'SET_CHECK_MODE', payload: e.target.value })}
              disabled={isChecking}>
              <Radio value="single">{t('settings.models.check.check_with_single_key')}</Radio>
              <Radio value="all">{t('settings.models.check.check_with_all_keys')}</Radio>
            </Radio.Group>
          </Space>
          <Space>
            <Space align="center">
              <Typography.Text>{t('settings.models.check.use_concurrent_checks')}</Typography.Text>
              <Switch
                checked={useConcurrentChecks}
                onChange={(checked) => dispatch({ type: 'SET_USE_CONCURRENT', payload: checked })}
                disabled={isChecking}
                size="small"
              />
            </Space>
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
      {checkMode === 'single' && hasMultipleKeys && (
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
                  {key.slice(0, 8)}...{key.slice(-8)}
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
                  <span style={{ maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {status.model.name}
                  </span>
                  <ModelTags model={status.model} />
                  {/* Display response time for successful or partially successful models */}
                  {status.checkTime &&
                    (status.status === ModelCheckStatus.SUCCESS || status.status === ModelCheckStatus.PARTIAL) && (
                      <Typography.Text type="secondary">{(status.checkTime / 1000).toFixed(2)}s</Typography.Text>
                    )}
                </Space>
                <Space>
                  {/* Show spinner for models being checked */}
                  {status.checking && <Spin indicator={<LoadingOutlined spin />} />}

                  {/* Status indicators with tooltips */}
                  {status.status === ModelCheckStatus.SUCCESS && (
                    <Tooltip title={renderKeyCheckResultTooltip(status)}>
                      <CheckCircleFilled style={{ color: '#52c41a' }} />
                    </Tooltip>
                  )}

                  {status.status === ModelCheckStatus.FAILED && (
                    <Tooltip title={renderKeyCheckResultTooltip(status)}>
                      <CloseCircleFilled style={{ color: '#ff4d4f' }} />
                    </Tooltip>
                  )}

                  {status.status === ModelCheckStatus.PARTIAL && (
                    <Tooltip title={renderKeyCheckResultTooltip(status)}>
                      <ExclamationCircleFilled style={{ color: '#faad14' }} />
                    </Tooltip>
                  )}

                  {/* Show 'not checked' for models without status */}
                  {(!status.status || status.status === ModelCheckStatus.NOT_CHECKED) && !status.checking && (
                    <span>{t('settings.models.check.not_checked')}</span>
                  )}
                </Space>
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
