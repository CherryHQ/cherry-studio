import { useLanding } from '@renderer/context/LandingContext'
import { Button } from 'antd'
import type { FC } from 'react'

const SkipButton: FC = () => {
  const { completeLanding } = useLanding()

  return (
    <Button
      type="text"
      className="text-(--color-text-3) opacity-50 hover:opacity-80"
      style={{ position: 'absolute', top: 16, right: 16, width: 'auto' }}
      onClick={completeLanding}>
      跳过引导
    </Button>
  )
}

export default SkipButton
