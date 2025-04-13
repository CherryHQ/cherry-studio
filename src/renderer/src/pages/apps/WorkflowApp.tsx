import WorkflowAppIcon from '@renderer/components/Icons/WorkflowAppIcon'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { MinAppType } from '@renderer/types'
import { FC } from 'react'
import styled from 'styled-components'

interface Props {
  workflowApp: MinAppType
  onClick?: () => void
  size?: number
}

const WorkflowApp: FC<Props> = ({ workflowApp, onClick, size = 60 }) => {
  console.log('WorkflowApp', workflowApp)
  const { openMinappKeepAlive } = useMinappPopup()

  const handleClick = () => {
    openMinappKeepAlive(workflowApp)
    onClick?.()
  }

  return (
    <Container onClick={handleClick}>
      <WorkflowAppIcon size={size} workflowApp={workflowApp} />
      <AppTitle>{workflowApp.name}</AppTitle>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  overflow: hidden;
`

const AppTitle = styled.div`
  font-size: 12px;
  margin-top: 5px;
  color: var(--color-text-soft);
  text-align: center;
  user-select: none;
  white-space: nowrap;
`

export default WorkflowApp
