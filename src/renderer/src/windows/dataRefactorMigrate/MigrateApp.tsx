import { Button } from '@cherrystudio/ui'
import { getToastUtilities } from '@renderer/components/TopView/toast'
import { AppLogo } from '@renderer/config/env'
import { loggerService } from '@renderer/services/LoggerService'
import { IpcChannel } from '@shared/IpcChannel'
import { Progress, Space, Steps } from 'antd'
import { AlertTriangle, CheckCircle, Database, Loader2, Rocket } from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'

const logger = loggerService.withContext('MigrateApp')

type MigrationStage =
  | 'introduction' // Introduction phase - user can cancel
  | 'backup_required' // Backup required - show backup requirement
  | 'backup_progress' // Backup in progress - user is backing up
  | 'backup_confirmed' // Backup confirmed - ready to migrate
  | 'migration' // Migration in progress - cannot cancel
  | 'completed' // Completed - restart app
  | 'error' // Error - recovery options

interface MigrationProgress {
  stage: MigrationStage
  progress: number
  total: number
  message: string
  error?: string
}

const MigrateApp: React.FC = () => {
  const [progress, setProgress] = useState<MigrationProgress>({
    stage: 'introduction',
    progress: 0,
    total: 100,
    message: 'Ready to start data migration'
  })

  useEffect(() => {
    window.toast = getToastUtilities()
  }, [])

  useEffect(() => {
    // Listen for progress updates
    const handleProgress = (_: any, progressData: MigrationProgress) => {
      setProgress(progressData)
    }

    window.electron.ipcRenderer.on(IpcChannel.DataMigrateProgress, handleProgress)

    // Request initial progress
    window.electron.ipcRenderer
      .invoke(IpcChannel.DataMigrate_GetProgress)
      .then((initialProgress: MigrationProgress) => {
        if (initialProgress) {
          setProgress(initialProgress)
        }
      })

    return () => {
      window.electron.ipcRenderer.removeAllListeners(IpcChannel.DataMigrateProgress)
    }
  }, [])

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
        return -1 // Error state - will be handled separately
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

  /**
   * Extract Redux persist data from localStorage and send to main process
   */
  const extractAndSendReduxData = async () => {
    try {
      logger.info('Extracting Redux persist data for migration...')

      // Get the Redux persist key (this should match the key used in store configuration)
      const persistKey = 'persist:cherry-studio'

      // Read the persisted data from localStorage
      const persistedDataString = localStorage.getItem(persistKey)

      if (!persistedDataString) {
        logger.warn('No Redux persist data found in localStorage', { persistKey })
        // Send empty data to indicate no Redux data available
        await window.electron.ipcRenderer.invoke(IpcChannel.DataMigrate_SendReduxData, null)
        return
      }

      // Parse the persisted data
      const persistedData = JSON.parse(persistedDataString)

      logger.info('Found Redux persist data:', {
        keys: Object.keys(persistedData),
        hasData: !!persistedData,
        dataSize: persistedDataString.length,
        persistKey
      })

      // Send the Redux data to main process for migration
      const result = await window.electron.ipcRenderer.invoke(IpcChannel.DataMigrate_SendReduxData, persistedData)

      if (result?.success) {
        logger.info('Successfully sent Redux data to main process for migration')
      } else {
        logger.warn('Failed to send Redux data to main process', { result })
      }
    } catch (error) {
      logger.error('Error extracting Redux persist data', error as Error)
      // Send null to indicate extraction failed
      await window.electron.ipcRenderer.invoke(IpcChannel.DataMigrate_SendReduxData, null)
      throw error
    }
  }

  const handleProceedToBackup = () => {
    window.electron.ipcRenderer.invoke(IpcChannel.DataMigrate_ProceedToBackup)
  }

  const handleStartMigration = async () => {
    try {
      // First, extract Redux persist data and send to main process
      await extractAndSendReduxData()

      // Then start the migration process
      window.electron.ipcRenderer.invoke(IpcChannel.DataMigrate_StartMigration)
    } catch (error) {
      logger.error('Failed to extract Redux data for migration', error as Error)
      // Still proceed with migration even if Redux data extraction fails
      window.electron.ipcRenderer.invoke(IpcChannel.DataMigrate_StartMigration)
    }
  }

  const handleRestartApp = () => {
    window.electron.ipcRenderer.invoke(IpcChannel.DataMigrate_RestartApp)
  }

  const handleCloseWindow = () => {
    window.electron.ipcRenderer.invoke(IpcChannel.DataMigrate_CloseWindow)
  }

  const handleCancel = () => {
    window.electron.ipcRenderer.invoke(IpcChannel.DataMigrate_Cancel)
  }

  const handleShowBackupDialog = () => {
    // Open the main window backup dialog
    window.electron.ipcRenderer.invoke(IpcChannel.DataMigrate_ShowBackupDialog)
  }

  const handleBackupCompleted = () => {
    // Notify the main process that backup is completed
    window.electron.ipcRenderer.invoke(IpcChannel.DataMigrate_BackupCompleted)
  }

  const handleRetryMigration = () => {
    window.electron.ipcRenderer.invoke(IpcChannel.DataMigrate_RetryMigration)
  }

  const getProgressColor = () => {
    switch (progress.stage) {
      case 'completed':
        return 'var(--color-primary)'
      case 'error':
        return '#ff4d4f'
      case 'backup_confirmed':
        return 'var(--color-primary)'
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
        return <CheckCircle size={48} color="var(--color-primary)" />
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
            <Button onClick={handleCancel}>取消</Button>
            <Spacer />
            <Button onClick={handleProceedToBackup}>下一步</Button>
          </>
        )
      case 'backup_required':
        return (
          <>
            <Button onClick={handleCancel}>取消</Button>
            <Spacer />
            <Button onClick={handleBackupCompleted}>我已备份，开始迁移</Button>
            <Button onClick={handleShowBackupDialog}>创建备份</Button>
          </>
        )
      case 'backup_confirmed':
        return (
          <ButtonRow>
            <Button onClick={handleCancel}>取消</Button>
            <Space>
              <Button onClick={handleStartMigration}>开始迁移</Button>
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
            <Button onClick={handleRestartApp}>重启应用</Button>
          </ButtonRow>
        )
      case 'error':
        return (
          <ButtonRow>
            <Button onClick={handleCloseWindow}>关闭应用</Button>
            <Space>
              <Button onClick={handleRetryMigration}>重新尝试</Button>
            </Space>
          </ButtonRow>
        )
      default:
        return null
    }
  }

  return (
    <Container>
      {/* Header */}
      <Header>
        <HeaderLogo src={AppLogo} />

        <HeaderTitle>数据迁移向导</HeaderTitle>
      </Header>

      {/* Main Content */}
      <MainContent>
        {/* Left Sidebar with Steps */}
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

        {/* Right Content Area */}
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
                {/* Debug button to test Redux data extraction */}
                <div style={{ marginTop: '24px', textAlign: 'center' }}>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await extractAndSendReduxData()
                        alert('Redux数据提取成功！请查看应用日志。')
                      } catch (error) {
                        alert('Redux数据提取失败：' + (error as Error).message)
                      }
                    }}>
                    测试Redux数据提取
                  </Button>
                </div>
              </InfoCard>
            )}

            {progress.stage === 'backup_required' && (
              <InfoCard variant="warning">
                <InfoTitle>创建数据备份</InfoTitle>
                <InfoDescription style={{ textAlign: 'center' }}>
                  迁移前必须创建数据备份以确保数据安全。请选择备份位置或确认已有最新备份。
                </InfoDescription>
              </InfoCard>
            )}

            {progress.stage === 'backup_progress' && (
              <InfoCard variant="warning">
                <InfoTitle>准备数据备份</InfoTitle>
                <InfoDescription style={{ textAlign: 'center' }}>请选择备份位置，保存后等待备份完成。</InfoDescription>
              </InfoCard>
            )}

            {progress.stage === 'backup_confirmed' && (
              <InfoCard variant="success">
                <InfoTitle>备份完成</InfoTitle>
                <InfoDescription style={{ textAlign: 'center' }}>
                  数据备份已完成，现在可以安全地开始迁移。
                </InfoDescription>
              </InfoCard>
            )}

            {progress.stage === 'error' && (
              <InfoCard variant="error">
                <InfoTitle>迁移失败</InfoTitle>
                <InfoDescription>
                  迁移过程遇到错误，您可以重新尝试或继续使用之前版本（原始数据完好保存）。
                  <br />
                  <br />
                  错误信息：{progress.error}
                </InfoDescription>
              </InfoCard>
            )}

            {progress.stage === 'completed' && (
              <InfoCard variant="success">
                <InfoTitle>迁移完成</InfoTitle>
                <InfoDescription>数据已成功迁移，重启应用后即可正常使用。</InfoDescription>
              </InfoCard>
            )}

            {(progress.stage == 'backup_progress' || progress.stage == 'migration') && (
              <ProgressContainer>
                <Progress
                  percent={progress.progress}
                  strokeColor={getProgressColor()}
                  trailColor="#f0f0f0"
                  size="default"
                  showInfo={true}
                />
              </ProgressContainer>
            )}
          </ContentArea>
        </RightContent>
      </MainContent>

      {/* Footer */}
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
  /* justify-content: center; */
  /* align-items: center; */
  /* margin: 0 auto; */
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

export default MigrateApp
