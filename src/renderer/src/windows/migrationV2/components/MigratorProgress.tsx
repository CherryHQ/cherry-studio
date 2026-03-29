/**
 * Migrator progress list component
 * Shows the status of each migrator
 */

import type { MigratorProgress as MigratorProgressType, MigratorStatus } from '@shared/data/migration/v2/types'
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import styled, { keyframes } from 'styled-components'

interface Props {
  migrators: MigratorProgressType[]
  overallProgress: number
}

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`

const StatusIcon: React.FC<{ status: MigratorStatus }> = ({ status }) => {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={20} color="#52c41a" /> // Antd success color
    case 'running':
      return (
        <SpinningIcon>
          <Loader2 size={20} color="var(--color-primary)" />
        </SpinningIcon>
      )
    case 'failed':
      return <XCircle size={20} color="#ff4d4f" /> // Antd error color
    default:
      return <Circle size={20} color="#d9d9d9" />
  }
}

const SpinningIcon = styled.div`
  display: flex;
  animation: ${spin} 1s linear infinite;
`

export const MigratorProgressList: React.FC<Props> = ({ migrators }) => {
  const { t } = useTranslation()

  const getStatusText = (status: MigratorStatus): string => {
    return t('migration.status.' + status)
  }

  return (
    <Container>
      <List>
        {migrators.map((migrator) => (
          <ListItem key={migrator.id}>
            <ItemLeft>
              <StatusIcon status={migrator.status} />
              <ItemName>{migrator.name}</ItemName>
            </ItemLeft>
            <ItemStatus status={migrator.status}>{migrator.error || getStatusText(migrator.status)}</ItemStatus>
          </ListItem>
        ))}
      </List>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
`

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ListItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  background-color: rgba(0, 0, 0, 0.04);
  border-radius: 8px;
`

const ItemLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const ItemName = styled.span`
  font-weight: 500;
  color: rgba(0, 0, 0, 0.88);
`

const ItemStatus = styled.span<{ status: MigratorStatus }>`
  font-size: 14px;
  color: ${({ status }) => {
    switch (status) {
      case 'failed':
        return '#ff4d4f'
      case 'completed':
        return '#52c41a'
      case 'running':
        return 'var(--color-primary)'
      default:
        return 'rgba(0, 0, 0, 0.45)'
    }
  }};
`
