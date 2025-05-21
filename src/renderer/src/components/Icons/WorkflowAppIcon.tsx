import { MinAppType } from '@renderer/types'
import { FC } from 'react'
import styled from 'styled-components'

interface Props {
  workflowApp: MinAppType
  size?: number
  style?: React.CSSProperties
}

const WorkflowAppIcon: FC<Props> = ({ workflowApp, size = 48, style }) => {
  console.log('WorkflowAppIcon', workflowApp)

  if (!workflowApp.logo) {
    return null
  }

  return (
    <Container
      src={workflowApp.logo}
      style={{
        border: '0.5px solid var(--color-border)',
        width: `${size}px`,
        height: `${size}px`,
        ...style
      }}
    />
  )
}

const Container = styled.img`
  border-radius: 16px;
  user-select: none;
  -webkit-user-drag: none;
`

export default WorkflowAppIcon
