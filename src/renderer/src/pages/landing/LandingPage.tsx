import { useLanding } from '@renderer/context/LandingContext'
import { Button } from 'antd'
import type { FC } from 'react'
import { useState } from 'react'

const LandingPage: FC = () => {
  const [step, setStep] = useState(1)
  const { completeLanding } = useLanding()

  const handleNext = () => {
    setStep(2)
  }

  const handleComplete = () => {
    completeLanding()
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-(--color-background)">
      <div className="drag h-10 w-full shrink-0" />
      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <div className="flex gap-2">
          <div
            className={`h-2 w-2 rounded-full transition-colors duration-200 ${
              step === 1 ? 'bg-(--color-primary)' : 'bg-(--color-border)'
            }`}
          />
          <div
            className={`h-2 w-2 rounded-full transition-colors duration-200 ${
              step === 2 ? 'bg-(--color-primary)' : 'bg-(--color-border)'
            }`}
          />
        </div>

        <h1 className="m-0 font-semibold text-(--color-text) text-2xl">Step {step}</h1>

        <div className="mt-4">
          {step === 1 ? (
            <Button type="primary" size="large" onClick={handleNext}>
              Next
            </Button>
          ) : (
            <Button type="primary" size="large" onClick={handleComplete}>
              Get Started
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default LandingPage
