import { loggerService } from '@logger'
import CherryStudioLogo from '@renderer/assets/images/logo.png'
import { useLanding } from '@renderer/context/LandingContext'
import { useAllProviders, useProvider } from '@renderer/hooks/useProvider'
import { oauthWithCherryIn } from '@renderer/utils/oauth'
import { Button, Divider } from 'antd'
import type { FC } from 'react'
import { useCallback, useState } from 'react'

import ProviderPopup from './ProviderPopup'

const logger = loggerService.withContext('WelcomePage')

const CHERRYIN_PROVIDER_ID = 'cherryin'
const CHERRYIN_OAUTH_SERVER = 'https://open.cherryin.ai'

const WelcomePage: FC = () => {
  const { setStep, setCherryInLoggedIn } = useLanding()
  const { updateProvider } = useProvider(CHERRYIN_PROVIDER_ID)
  const allProviders = useAllProviders()
  const [isLoggingIn, setIsLoggingIn] = useState(false)

  // 检查是否有可用的 provider（启用状态且至少有一个模型）
  const hasAvailableProvider = useCallback(() => {
    return allProviders.some((p) => p.enabled && p.models.length > 0)
  }, [allProviders])

  const handleCherryInLogin = useCallback(async () => {
    setIsLoggingIn(true)
    try {
      await oauthWithCherryIn(
        (apiKeys: string) => {
          updateProvider({ apiKey: apiKeys })
          setCherryInLoggedIn(true)
          setStep('login-success')
        },
        {
          oauthServer: CHERRYIN_OAUTH_SERVER
        }
      )
    } catch (error) {
      logger.error('OAuth Error:', error as Error)
    } finally {
      setIsLoggingIn(false)
    }
  }, [updateProvider, setCherryInLoggedIn, setStep])

  const handleSelectProvider = async () => {
    await ProviderPopup.show()
    // 弹窗关闭后，如果有可用的 provider（启用状态且至少有一个模型），进入模型选择页
    if (hasAvailableProvider()) {
      setStep('select-model')
    }
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        <img src={CherryStudioLogo} alt="Cherry Studio" className="h-16 w-16 rounded-xl" />

        <div className="flex flex-col items-center gap-2">
          <h1 className="m-0 font-semibold text-(--color-text) text-2xl">欢迎使用 Cherry Studio</h1>
          <p className="m-0 text-(--color-text-2) text-sm">使用 CherryIN 服务商可畅享顶级 AI 服务</p>
        </div>

        <div className="mt-2 flex w-100 flex-col gap-3">
          <Button
            type="primary"
            size="large"
            block
            loading={isLoggingIn}
            className="h-12 rounded-lg"
            onClick={handleCherryInLogin}>
            登录 CherryIN
          </Button>

          <Divider className="my-1!">
            <span className="text-(--color-text-3) text-xs">OR CONTINUE WITH</span>
          </Divider>

          <Button size="large" block className="h-12 rounded-lg" onClick={handleSelectProvider}>
            选择其他服务商
          </Button>
        </div>

        <p className="mt-1 text-(--color-text-3) text-xs">请您先至少配置一个服务商，以获得最佳使用体验</p>
      </div>
    </div>
  )
}

export default WelcomePage
