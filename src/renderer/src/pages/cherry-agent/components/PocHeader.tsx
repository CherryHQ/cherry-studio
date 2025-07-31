import React from 'react'
import styled from 'styled-components'

const HeaderContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background);
  min-height: 60px;
`

const Title = styled.h1`
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: var(--color-text);
`

const WorkingDirectory = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
`

const Controls = styled.div`
  display: flex;
  gap: 8px;
`

interface PocHeaderProps {
  currentWorkingDirectory?: string
}

const PocHeader: React.FC<PocHeaderProps> = ({ currentWorkingDirectory }) => {
  const workingDir = currentWorkingDirectory || process.cwd()

  return (
    <HeaderContainer>
      <div>
        <Title>Command POC</Title>
        <WorkingDirectory>📁 {workingDir}</WorkingDirectory>
      </div>
      <Controls>{/* Future: Add session controls */}</Controls>
    </HeaderContainer>
  )
}

export default PocHeader
