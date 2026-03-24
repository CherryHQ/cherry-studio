import { useLanding } from '@renderer/context/LandingContext'
import type { FC } from 'react'

import SelectModelPage from './components/SelectModelPage'
import SkipButton from './components/SkipButton'
import WelcomePage from './components/WelcomePage'

const LandingPage: FC = () => {
  const { step } = useLanding()

  return (
    <div className="flex h-screen w-screen flex-col">
      {/* Header 区域 - 可拖动 */}
      <div className="drag w-full shrink-0" style={{ height: 'var(--navbar-height)' }} />
      {/* Content 区域 - 带圆角的卡片，左右下有边距 */}
      <div className="flex flex-1 px-2 pb-2">
        <div className="relative flex flex-1 overflow-hidden rounded-xl bg-(--color-background)">
          <SkipButton />
          {step === 'welcome' && <WelcomePage />}
          {step === 'select-model' && <SelectModelPage />}
        </div>
      </div>
    </div>
  )
}

export default LandingPage
