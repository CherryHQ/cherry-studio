import type { Change } from 'diff'
import { diffChars } from 'diff'
import { useMemo } from 'react'
import styled from 'styled-components'

interface TextDiffDisplayProps {
  original: string
  refined: string
}

function TextDiffDisplay({ original, refined }: TextDiffDisplayProps) {
  const changes: Change[] = useMemo(() => diffChars(original, refined), [original, refined])

  return (
    <DiffContainer>
      {changes.map((part, index) => {
        if (part.added) {
          return <Added key={index}>{part.value}</Added>
        }
        if (part.removed) {
          return <Removed key={index}>{part.value}</Removed>
        }
        return <Unchanged key={index}>{part.value}</Unchanged>
      })}
    </DiffContainer>
  )
}

const DiffContainer = styled.div`
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
`

const Added = styled.span`
  background-color: rgba(0, 200, 83, 0.15);
  border-radius: 2px;
  padding: 0 1px;
`

const Removed = styled.span`
  background-color: rgba(244, 67, 54, 0.15);
  border-radius: 2px;
  padding: 0 1px;
  text-decoration: line-through;
`

const Unchanged = styled.span``

export default TextDiffDisplay
