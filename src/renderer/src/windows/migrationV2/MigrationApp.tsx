import { Button } from '@cherrystudio/ui'
import { AppLogo } from '@renderer/config/env'
import { loggerService } from '@renderer/services/LoggerService'
import { Progress, Space, Steps } from 'antd'
import { AlertTriangle, CheckCircle, CheckCircle2, Database, Loader2, Rocket } from 'lucide-react'
import React, { useMemo, useState } from 'react'
import styled from 'styled-components'

import { MigratorProgressList } from './components'
import { DexieExporter, ReduxExporter } from './exporters'
import { useMigrationActions, useMigrationProgress } from './hooks/useMigrationProgress'
import { MigrationIpcChannels } from './types'

const logger = loggerService.withContext('MigrationApp')

const MigrationApp: React.FC = () => {
  const { progress, lastError } = useMigrationProgress()
  const actions = useMigrationActions()
  const [isLoading, setIsLoading] = useState(false)

  const handleStartMigration = async () => {
    setIsLoading(true)
    try {
      logger.info('Starting migration process...')

      // Export Redux data
      const reduxExporter = new ReduxExporter()
      const reduxResult = reduxExporter.export()
      logger.info('Redux data exported', {
        slicesFound: reduxResult.slicesFound,
        slicesMissing: reduxResult.slicesMissing
      })

      // Export Dexie data
      const userDataPath = await window.electron.ipcRenderer.invoke(MigrationIpcChannels.GetUserDataPath)
      const exportPath = `${userDataPath}/migration_temp/dexie_export`
      const dexieExporter = new DexieExporter(exportPath)

      await dexieExporter.exportAll((p) => {
        logger.info('Dexie export progress', p)
      })

      logger.info('Dexie data exported', { exportPath })

      // Start migration with exported data
      await actions.startMigration(reduxResult.data, exportPath)
    } catch (error) {
      logger.error('Failed to start migration', error as Error)
    } finally {
      setIsLoading(false)
    }
  }

  const currentStep = useMemo(() => {
    switch (progress.stage) {
      case 'introduction':
        return 0
      case 'backup_required':
      case 'backup_progress':
      case 'backup_confirmed':
        return 1
      case 'migration':
        return 2
      case 'completed':
        return 3
      case 'error':
        return -1
      default:
        return 0
    }
  }, [progress.stage])

  const stepStatus = useMemo(() => {
    if (progress.stage === 'error') {
      return 'error'
    }
    return 'process'
  }, [progress.stage])

  const getProgressColor = () => {
    switch (progress.stage) {
      case 'completed':
        return 'var(--color-primary)'
      case 'error':
        return '#ff4d4f'
      default:
        return 'var(--color-primary)'
    }
  }

  const getCurrentStepIcon = () => {
    switch (progress.stage) {
      case 'introduction':
        return <Rocket size={48} color="var(--color-primary)" />
      case 'backup_required':
      case 'backup_progress':
        return <Database size={48} color="var(--color-primary)" />
      case 'backup_confirmed':
        return <CheckCircle size={48} color="var(--color-primary)" />
      case 'migration':
        return (
          <SpinningIcon>
            <Loader2 size={48} color="var(--color-primary)" />
          </SpinningIcon>
        )
      case 'completed':
        return <CheckCircle2 size={48} color="var(--color-primary)" />
      case 'error':
        return <AlertTriangle size={48} color="#ff4d4f" />
      default:
        return <Rocket size={48} color="var(--color-primary)" />
    }
  }

  const renderActionButtons = () => {
    switch (progress.stage) {
      case 'introduction':
        return (
          <>
            <Button onClick={actions.cancel}>取消</Button>
            <Spacer />
            <Button onClick={actions.proceedToBackup}>下一步</Button>
          </>
        )
      case 'backup_required':
        return (
          <>
            <Button onClick={actions.cancel}>取消</Button>
            <Spacer />
            <Space>
              <Button onClick={actions.showBackupDialog}>创建备份</Button>
              <Button onClick={actions.confirmBackup}>我已备份，开始迁移</Button>
            </Space>
          </>
        )
      case 'backup_progress':
        return (
          <ButtonRow>
            <div></div>
            <Button disabled loading>
              正在备份...
            </Button>
          </ButtonRow>
        )
      case 'backup_confirmed':
        return (
          <ButtonRow>
            <Button onClick={actions.cancel}>取消</Button>
            <Space>
              <Button onClick={handleStartMigration} loading={isLoading}>
                开始迁移
              </Button>
            </Space>
          </ButtonRow>
        )
      case 'migration':
        return (
          <ButtonRow>
            <div></div>
            <Button disabled>迁移进行中...</Button>
          </ButtonRow>
        )
      case 'completed':
        return (
          <ButtonRow>
            <div></div>
            <Button onClick={actions.restart}>重启应用</Button>
          </ButtonRow>
        )
      case 'error':
        return (
          <ButtonRow>
            <Button onClick={actions.cancel}>关闭应用</Button>
            <Space>
              <Button onClick={actions.retry}>重新尝试</Button>
            </Space>
          </ButtonRow>
        )
      default:
        return null
    }
  }

  return (
    <Container>
      <Header>
        <HeaderLogo src={AppLogo} />
        <HeaderTitle>数据迁移向导</HeaderTitle>
      </Header>

      <MainContent>
        <LeftSidebar>
          <StepsContainer>
            <Steps
              direction="vertical"
              current={currentStep}
              status={stepStatus}
              size="small"
              items={[{ title: '介绍' }, { title: '备份' }, { title: '迁移' }, { title: '完成' }]}
            />
          </StepsContainer>
        </LeftSidebar>

        <RightContent>
          <ContentArea>
            <InfoIcon>{getCurrentStepIcon()}</InfoIcon>

            {progress.stage === 'introduction' && (
              <InfoCard>
                <InfoTitle>将数据迁移到新的架构中</InfoTitle>
                <InfoDescription>
                  Cherry Studio对数据的存储和使用方式进行了重大重构，在新的架构下，效率和安全性将会得到极大提升。
                  <br />
                  <br />
                  数据必须进行迁移，才能在新版本中使用。
                  <br />
                  <br />
                  我们会指导你完成迁移，迁移过程不会损坏原来的数据，你随时可以取消迁移，并继续使用旧版本。
                </InfoDescription>
              </InfoCard>
            )}

            {progress.stage === 'backup_required' && (
              <InfoCard variant="warning">
                <InfoTitle>创建数据备份</InfoTitle>
                <InfoDescription>
                  迁移前必须创建数据备份以确保数据安全。请选择备份位置或确认已有最新备份。
                </InfoDescription>
              </InfoCard>
            )}

            {progress.stage === 'backup_progress' && (
              <InfoCard variant="warning">
                <InfoTitle>准备数据备份</InfoTitle>
                <InfoDescription>请选择备份位置，保存后等待备份完成。</InfoDescription>
              </InfoCard>
            )}

            {progress.stage === 'backup_confirmed' && (
              <InfoCard variant="success">
                <InfoTitle>备份完成</InfoTitle>
                <InfoDescription>数据备份已完成，现在可以安全地开始迁移。</InfoDescription>
              </InfoCard>
            )}

            {progress.stage === 'migration' && (
              <div style={{ width: '100%', maxWidth: '600px', margin: '0 auto' }}>
                <InfoCard>
                  <InfoTitle>正在迁移数据...</InfoTitle>
                  <InfoDescription>{progress.currentMessage}</InfoDescription>
                </InfoCard>
                <ProgressContainer>
                  <Progress
                    percent={Math.round(progress.overallProgress * 100)}
                    strokeColor={getProgressColor()}
                    trailColor="#f0f0f0"
                  />
                </ProgressContainer>
                <div style={{ marginTop: '20px', height: '200px', overflowY: 'auto' }}>
                  <MigratorProgressList migrators={progress.migrators} overallProgress={progress.overallProgress} />
                </div>
              </div>
            )}

            {progress.stage === 'completed' && (
              <InfoCard variant="success">
                <InfoTitle>迁移完成</InfoTitle>
                <InfoDescription>数据已成功迁移，重启应用后即可正常使用。</InfoDescription>
              </InfoCard>
            )}

            {progress.stage === 'error' && (
              <InfoCard variant="error">
                <InfoTitle>迁移失败</InfoTitle>
                <InfoDescription>
                  迁移过程遇到错误，您可以重新尝试或继续使用之前版本（原始数据完好保存）。
                  <br />
                  <br />
                  错误信息：{lastError || progress.error || '发生未知错误'}
                </InfoDescription>
              </InfoCard>
            )}
          </ContentArea>
        </RightContent>
      </MainContent>

      <Footer>{renderActionButtons()}</Footer>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #fff;
`

const Header = styled.div`
  height: 48px;
  background: rgb(240, 240, 240);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  -webkit-app-region: drag;
  user-select: none;
`

const HeaderTitle = styled.div`
  font-size: 16px;
  font-weight: 600;
  color: black;
  margin-left: 12px;
`

const HeaderLogo = styled.img`
  width: 24px;
  height: 24px;
  border-radius: 6px;
`

const MainContent = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
`

const LeftSidebar = styled.div`
  width: 150px;
  background: #fff;
  border-right: 1px solid #f0f0f0;
  display: flex;
  flex-direction: column;
`

const StepsContainer = styled.div`
  padding: 32px 24px;
  flex: 1;

  .ant-steps-item-process .ant-steps-item-icon {
    background-color: var(--color-primary);
    border-color: var(--color-primary-soft);
  }

  .ant-steps-item-finish .ant-steps-item-icon {
    background-color: var(--color-primary-mute);
    border-color: var(--color-primary-mute);
  }

  .ant-steps-item-finish .ant-steps-item-icon > .ant-steps-icon {
    color: var(--color-primary);
  }

  .ant-steps-item-process .ant-steps-item-icon > .ant-steps-icon {
    color: #fff;
  }

  .ant-steps-item-wait .ant-steps-item-icon {
    border-color: #d9d9d9;
  }
`

const RightContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
`

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 24px;
`

const Footer = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  background: rgb(250, 250, 250);
  height: 64px;
  padding: 0 24px;
  gap: 16px;
`

const Spacer = styled.div`
  flex: 1;
`

const ProgressContainer = styled.div`
  margin: 32px 0;
  width: 100%;
`

const ButtonRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  min-width: 300px;
`

const InfoIcon = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 12px;
`

const InfoCard = styled.div<{ variant?: 'info' | 'warning' | 'success' | 'error' }>`
  width: 100%;
`

const InfoTitle = styled.div`
  margin-bottom: 32px;
  margin-top: 32px;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-primary);
  line-height: 1.4;
  text-align: center;
`

const InfoDescription = styled.p`
  margin: 0;
  color: rgba(0, 0, 0, 0.68);
  line-height: 1.8;
  max-width: 420px;
  margin: 0 auto;
  text-align: center;
`

const SpinningIcon = styled.div`
  display: inline-block;
  animation: spin 2s linear infinite;

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
`

export default MigrationApp
