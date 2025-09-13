import { Box, ColFlex } from '@renderer/components/Layout'
import { Flex } from '@renderer/components/Layout'
import { TopView } from '@renderer/components/TopView'
import { Provider } from '@renderer/types'
import { maskApiKey } from '@renderer/utils/api'
import { InputNumber, Modal, Radio, Segmented, Typography } from 'antd'
import { Alert } from 'antd'
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
  timeout?: number
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
  timeoutSeconds: number // Timeout in seconds
}

/**
 * Reducer action type definition
 */
type Action =
  | { type: 'SET_OPEN'; payload: boolean }
  | { type: 'SET_KEY_INDEX'; payload: number }
  | { type: 'SET_KEY_CHECK_MODE'; payload: 'single' | 'all' }
  | { type: 'SET_CONCURRENT'; payload: boolean }
  | { type: 'SET_TIMEOUT_SECONDS'; payload: number }

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
    case 'SET_TIMEOUT_SECONDS':
      return { ...state, timeoutSeconds: action.payload }
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
  timeoutSeconds: number,
  dispatch: React.Dispatch<Action>
) {
  const onStart = useCallback(() => {
    // Determine which API keys to use
    const keysToUse = keyCheckMode === 'single' ? [apiKeys[selectedKeyIndex]] : apiKeys

    // Return config data
    resolve({
      apiKeys: keysToUse,
      isConcurrent,
      timeout: timeoutSeconds * 1000 // Convert seconds to milliseconds
    })

    dispatch({ type: 'SET_OPEN', payload: false })
  }, [apiKeys, selectedKeyIndex, keyCheckMode, isConcurrent, timeoutSeconds, resolve, dispatch])

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
    isConcurrent: true,
    timeoutSeconds: 15
  })

  const { open, selectedKeyIndex, keyCheckMode, isConcurrent, timeoutSeconds } = state

  // Use custom hooks
  const { onStart, onCancel, onClose } = useModalActions(
    resolve,
    apiKeys,
    selectedKeyIndex,
    keyCheckMode,
    isConcurrent,
    timeoutSeconds,
    dispatch
  )

  // Check if we have multiple API keys
  const hasMultipleKeys = useMemo(() => apiKeys.length > 1, [apiKeys.length])

  const renderFooter = useMemo(() => {
    return (
      <ColFlex className="gap-2.5">
        <Flex className="w-full items-center justify-between">
          <Typography.Text strong>{t('settings.models.check.use_all_keys')}:</Typography.Text>
          <Segmented
            value={keyCheckMode}
            onChange={(value) => dispatch({ type: 'SET_KEY_CHECK_MODE', payload: value as 'single' | 'all' })}
            size="small"
            options={[
              { value: 'single', label: t('settings.models.check.single') },
              { value: 'all', label: t('settings.models.check.all') }
            ]}
          />
        </Flex>
        <Flex className="w-full items-center justify-between">
          <Typography.Text strong>{t('settings.models.check.enable_concurrent')}:</Typography.Text>
          <Segmented
            value={isConcurrent ? 'enabled' : 'disabled'}
            onChange={(value) => dispatch({ type: 'SET_CONCURRENT', payload: value === 'enabled' })}
            size="small"
            options={[
              { value: 'disabled', label: t('settings.models.check.disabled') },
              { value: 'enabled', label: t('settings.models.check.enabled') }
            ]}
          />
        </Flex>
        <Flex className="w-full items-center justify-between">
          <Typography.Text strong>{t('settings.models.check.timeout')}:</Typography.Text>
          <InputNumber
            value={timeoutSeconds}
            onChange={(value) => dispatch({ type: 'SET_TIMEOUT_SECONDS', payload: value || 15 })}
            min={5}
            max={60}
            size="small"
            className="w-[90px]"
            addonAfter="s"
          />
        </Flex>
      </ColFlex>
    )
  }, [isConcurrent, keyCheckMode, timeoutSeconds, t])

  return (
    <Modal
      title={title}
      open={open}
      onOk={onStart}
      onCancel={onCancel}
      afterClose={onClose}
      okText={t('settings.models.check.start')}
      cancelText={t('common.cancel')}
      centered
      maskClosable={false}
      width={500}
      transitionName="animation-move-down"
      footer={(_, { OkBtn, CancelBtn }) => (
        <>
          {renderFooter}
          <Flex className="mt-4 justify-between">
            <div /> {/* Empty div for spacing */}
            <Flex className="gap-2">
              <CancelBtn />
              <OkBtn />
            </Flex>
          </Flex>
        </>
      )}>
      <Alert
        message={t('common.warning')}
        description={t('settings.models.check.disclaimer')}
        type="warning"
        showIcon
        className="text-xs"
      />

      {/* API key selection section - only shown for 'single' mode and multiple keys */}
      {keyCheckMode === 'single' && hasMultipleKeys && (
        <Box className="my-2.5">
          <strong>{t('settings.models.check.select_api_key')}</strong>
          <Radio.Group
            value={selectedKeyIndex}
            onChange={(e) => dispatch({ type: 'SET_KEY_INDEX', payload: e.target.value })}
            className="mt-2 block">
            {apiKeys.map((key, index) => (
              <Radio key={index} value={index} className="mb-2 block">
                <Typography.Text copyable={{ text: key }} className="max-w-[450px]">
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
