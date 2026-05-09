import { EditableNumber, Slider, type SliderMark } from '@cherrystudio/ui'
import type React from 'react'

type ParameterSliderProps = {
  value: number
  min: number
  max: number
  step: number
  marks: Record<number, React.ReactNode>
  onChange: (value: number) => void
  onCommit: (value: number | null) => void
  inputWidthClassName?: string
}

const toSliderMarks = (marks: Record<number, React.ReactNode>): SliderMark[] =>
  Object.entries(marks)
    .map(([value, label]) => ({ value: Number(value), label }))
    .sort((a, b) => a.value - b.value)

const ParameterSlider = ({
  value,
  min,
  max,
  step,
  marks,
  onChange,
  onCommit,
  inputWidthClassName = 'w-full'
}: ParameterSliderProps) => {
  const handleSliderChange = ([nextValue]: number[]) => {
    onChange(nextValue ?? min)
  }

  const handleSliderCommit = ([nextValue]: number[]) => {
    onCommit(nextValue ?? min)
  }

  const handleNumberChange = (nextValue: number | null) => {
    if (nextValue === null) {
      return
    }

    onChange(nextValue)
    onCommit(nextValue)
  }

  return (
    <>
      <Slider
        min={min}
        max={max}
        value={[value]}
        marks={toSliderMarks(marks)}
        step={step}
        onValueChange={handleSliderChange}
        onValueCommit={handleSliderCommit}
      />
      <EditableNumber
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleNumberChange}
        size="small"
        align="start"
        className={inputWidthClassName}
      />
    </>
  )
}

export default ParameterSlider
