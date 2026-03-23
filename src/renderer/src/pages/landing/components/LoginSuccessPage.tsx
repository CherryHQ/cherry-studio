import CherryINLogo from '@renderer/assets/images/providers/cherryin.png'
import { useLanding } from '@renderer/context/LandingContext'
import { Button } from 'antd'
import { CircleCheck } from 'lucide-react'
import type { FC } from 'react'

const LoginSuccessPage: FC = () => {
  const { setStep } = useLanding()

  const handleNext = () => {
    setStep('select-model')
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        <img src={CherryINLogo} alt="Cherry IN" className="h-16 w-16 rounded-xl" />

        <div className="flex flex-col items-center gap-2">
          <h1 className="m-0 font-semibold text-(--color-text) text-2xl">成功接入 Cherry IN</h1>
          <p className="m-0 text-(--color-text-2) text-sm">更好的价格，更好的稳定性</p>
        </div>

        <div className="flex w-80 flex-col items-center gap-4 rounded-lg border border-green-500/30 bg-green-500/5 p-4">
          <div className="flex items-center gap-2">
            <CircleCheck size={20} className="text-green-500" />
            <span className="font-medium text-(--color-text)">登陆成功</span>
          </div>
          <p className="m-0 text-(--color-text-2) text-sm">已同步您的 Cherry IN 模型</p>
        </div>

        <Button type="primary" size="large" block className="h-12 w-80 rounded-lg" onClick={handleNext}>
          下一步
        </Button>
      </div>
    </div>
  )
}

export default LoginSuccessPage
