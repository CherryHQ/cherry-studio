import { loggerService } from '@logger'
import CherryStudioLogo from '@renderer/assets/images/logo.png'
import { useLanding } from '@renderer/context/LandingContext'
import { useProvider } from '@renderer/hooks/useProvider'
import { oauthWithCherryIn } from '@renderer/utils/oauth'
import { Button, Divider } from 'antd'
import { isEmpty } from 'lodash'
import type { FC } from 'react'
import { useCallback, useState } from 'react'

import ProviderPopup from './ProviderPopup'

const logger = loggerService.withContext('WelcomePage')

const CHERRYIN_PROVIDER_ID = 'cherryin'
const CHERRYIN_OAUTH_SERVER = 'https://open.cherryin.ai'

const WelcomePage: FC = () => {
  const { setStep, setCherryInLoggedIn } = useLanding()
  const { updateProvider, provider } = useProvider(CHERRYIN_PROVIDER_ID)
  const [isLoggingIn, setIsLoggingIn] = useState(false)

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
    // 弹窗关闭后，如果有任何 provider 配置了 apiKey，直接进入模型选择页
    if (!isEmpty(provider?.apiKey)) {
      setStep('select-model')
    }
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        <img src={CherryStudioLogo} alt="Cherry Studio" className="h-16 w-16 rounded-xl" />

        <div className="flex flex-col items-center gap-2">
          <h1 className="m-0 font-semibold text-(--color-text) text-2xl">欢迎使用 Cherry Studio</h1>
          <p className="m-0 text-(--color-text-2) text-sm">登入 CherryIN 聚合所有主流 AI 模型的统一 API 网关</p>
        </div>

        <div className="flex w-100 flex-col gap-3">
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

        <p className="mt-1 text-(--color-text-3) text-xs">请您先配置至少一个模型，以获得最佳使用体验</p>
      </div>
    </div>
  )
}

export default WelcomePage
