import { LoadingOutlined } from '@ant-design/icons'
import { Box } from '@renderer/components/Layout'
import { TopView } from '@renderer/components/TopView'
import { ApiKeyCheckStatus, checkModelsHealth, ModelCheckStatus } from '@renderer/services/HealthCheckService'
import { Model, Provider } from '@renderer/types'
import { maskApiKey } from '@renderer/utils/api'
import { Button, Modal, Radio, Segmented, Space, Spin, Typography } from 'antd'
import { useCallback, useMemo, useReducer } from 'react'
import { useTranslation } from 'react-i18next'

import HealthCheckModelList from './HealthCheckModelList'

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
 * Interface representing the status of a model, including the results of API key checks
 */
export interface ModelStatus {
  model: Model
  status?: ModelCheckStatus
  checking?: boolean
  error?: string
  keyResults?: ApiKeyCheckStatus[]
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
  | { type: 'SET_MODEL_CHECKING'; payload: { indices: number[] } }
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
    case 'SET_MODEL_CHECKING':
      return {
        ...state,
        modelStatuses: state.modelStatuses.map((status, idx) => ({
          ...status,
          checking: action.payload.indices.includes(idx),
          // Reset status when checking starts
          status: action.payload.indices.includes(idx) ? undefined : status.status
        }))
      }
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
 * Hook for handling model check operations using the HealthCheckService
 */
function useModelChecks({
  apiKeys,
  provider,
  modelStatuses,
  selectedKeyIndex,
  keyCheckMode,
  isConcurrent,
  dispatch
}: {
  apiKeys: string[]
  provider: Provider
  modelStatuses: ModelStatus[]
  selectedKeyIndex: number
  keyCheckMode: 'single' | 'all'
  isConcurrent: boolean
  dispatch: React.Dispatch<Action>
}) {
  /**
   * Initiate model checking using the HealthCheckService
   */
  const onCheckModels = useCallback(async () => {
    // Set all models and global checking state
    dispatch({ type: 'SET_CHECKING', payload: true })
    dispatch({
      type: 'SET_MODEL_CHECKING',
      payload: { indices: modelStatuses.map((_, index) => index) }
    })

    try {
      // Determine which API keys to use
      const keysToUse = keyCheckMode === 'single' ? [apiKeys[selectedKeyIndex]] : apiKeys

      // Get all models
      const models = modelStatuses.map((status) => status.model)

      // Call the service to perform health checks with a callback
      // for immediate UI updates when each model check completes
      await checkModelsHealth(
        {
          provider,
          models,
          apiKeys: keysToUse,
          isConcurrent
        },
        // Callback function for real-time updates
        (result, index) => {
          // Update UI immediately when a model check completes
          dispatch({
            type: 'UPDATE_MODEL_STATUS',
            payload: {
              index,
              status: {
                checking: false,
                status: result.status,
                error: result.error,
                keyResults: result.keyResults,
                checkTime: result.checkTime
              }
            }
          })
        }
      )
    } catch (error) {
      console.error('Health check failed:', error)

      // Reset checking state for all models on error
      modelStatuses.forEach((_, index) => {
        dispatch({
          type: 'UPDATE_MODEL_STATUS',
          payload: {
            index,
            status: {
              checking: false,
              status: ModelCheckStatus.FAILED,
              error: 'Check process failed'
            }
          }
        })
      })
    } finally {
      // Always reset global checking state
      dispatch({ type: 'SET_CHECKING', payload: false })
    }
  }, [apiKeys, provider, modelStatuses, selectedKeyIndex, keyCheckMode, isConcurrent, dispatch])

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
  const { onCheckModels } = useModelChecks({
    apiKeys,
    provider,
    modelStatuses,
    selectedKeyIndex,
    keyCheckMode,
    isConcurrent,
    dispatch
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
 */
export default class HealthCheckPopup {
  static readonly topviewId = 'HealthCheckPopup'

  static hide(): void {
    TopView.hide(this.topviewId)
  }

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
