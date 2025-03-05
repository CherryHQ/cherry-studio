import { Box } from '@renderer/components/Layout'
import { TopView } from '@renderer/components/TopView'
import { Provider } from '@renderer/types'
import { maskApiKey } from '@renderer/utils/api'
import { Button, Modal, Radio, Segmented, Space, Typography } from 'antd'
import { useCallback, useMemo, useReducer } from 'react'
import { useTranslation } from 'react-i18next'

interface ShowParams {
  title: string
  provider: Provider
  apiKeys: string[]
}

interface ResolveData {
  apiKeys: string[]
  isConcurrent: boolean
  cancelled?: boolean
}

interface Props extends ShowParams {
  resolve: (data: ResolveData) => void
}

/**
 * Component state type definition
 */
type State = {
  open: boolean
  selectedKeyIndex: number
  keyCheckMode: 'single' | 'all' // Whether to check with single key or all keys
  isConcurrent: boolean
}

/**
 * Reducer action type definition
 */
type Action =
  | { type: 'SET_OPEN'; payload: boolean }
  | { type: 'SET_KEY_INDEX'; payload: number }
  | { type: 'SET_KEY_CHECK_MODE'; payload: 'single' | 'all' }
  | { type: 'SET_CONCURRENT'; payload: boolean }

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
    case 'SET_CONCURRENT':
      return { ...state, isConcurrent: action.payload }
    default:
      return state
  }
}

/**
 * Hook for modal dialog actions
 */
function useModalActions(
  resolve: (data: ResolveData) => void,
  apiKeys: string[],
  selectedKeyIndex: number,
  keyCheckMode: 'single' | 'all',
  isConcurrent: boolean,
  dispatch: React.Dispatch<Action>
) {
  const onStart = useCallback(() => {
    // Determine which API keys to use
    const keysToUse = keyCheckMode === 'single' ? [apiKeys[selectedKeyIndex]] : apiKeys

    // Return config data
    resolve({
      apiKeys: keysToUse,
      isConcurrent
    })

    dispatch({ type: 'SET_OPEN', payload: false })
  }, [apiKeys, selectedKeyIndex, keyCheckMode, isConcurrent, resolve, dispatch])

  const onCancel = useCallback(() => {
    dispatch({ type: 'SET_OPEN', payload: false })
  }, [dispatch])

  const onClose = useCallback(() => {
    resolve({ apiKeys: [], isConcurrent: false, cancelled: true })
  }, [resolve])

  return { onStart, onCancel, onClose }
}

/**
 * Main container component for the health check configuration popup
 */
const PopupContainer: React.FC<Props> = ({ title, apiKeys, resolve }) => {
  const { t } = useTranslation()

  // Initialize state with reducer
  const [state, dispatch] = useReducer(reducer, {
    open: true,
    selectedKeyIndex: 0,
    keyCheckMode: 'all',
    isConcurrent: true
  })

  const { open, selectedKeyIndex, keyCheckMode, isConcurrent } = state

  // Use custom hooks
  const { onStart, onCancel, onClose } = useModalActions(
    resolve,
    apiKeys,
    selectedKeyIndex,
    keyCheckMode,
    isConcurrent,
    dispatch
  )

  // Check if we have multiple API keys
  const hasMultipleKeys = useMemo(() => apiKeys.length > 1, [apiKeys.length])

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      afterClose={onClose}
      centered
      maskClosable={false}
      width={500}
      footer={
        <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Space>
            <Space align="center">
              <Typography.Text strong>{t('settings.models.check.use_all_keys')}</Typography.Text>
              <Segmented
                value={keyCheckMode}
                onChange={(value) => dispatch({ type: 'SET_KEY_CHECK_MODE', payload: value as 'single' | 'all' })}
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
                size="small"
                options={[
                  { value: 'disabled', label: t('settings.models.check.disabled') },
                  { value: 'enabled', label: t('settings.models.check.enabled') }
                ]}
              />
            </Space>
          </Space>
          <Button key="start" type="primary" onClick={onStart}>
            {t('settings.models.check.start')}
          </Button>
        </Space>
      }>
      {/* API key selection section - only shown for 'single' mode and multiple keys */}
      {keyCheckMode === 'single' && hasMultipleKeys && (
        <Box style={{ marginBottom: 16 }}>
          <strong>{t('settings.models.check.select_api_key')}</strong>
          <Radio.Group
            value={selectedKeyIndex}
            onChange={(e) => dispatch({ type: 'SET_KEY_INDEX', payload: e.target.value })}
            style={{ display: 'block', marginTop: 8 }}>
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
