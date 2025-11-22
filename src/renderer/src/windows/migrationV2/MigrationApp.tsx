import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { AppLogo } from '@renderer/config/env'
import { loggerService } from '@renderer/services/LoggerService'
import { MigrationIpcChannels } from '@shared/data/migration/v2/types'
import { Progress, Space, Steps } from 'antd'
import { AlertTriangle, CheckCircle, CheckCircle2, Database, Loader2, Rocket } from 'lucide-react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { MigratorProgressList } from './components'
import { DexieExporter, ReduxExporter } from './exporters'
import { useMigrationActions, useMigrationProgress } from './hooks/useMigrationProgress'

const logger = loggerService.withContext('MigrationApp')

const MigrationApp: React.FC = () => {
  const { t, i18n } = useTranslation()
  const { progress, lastError, confirmComplete } = useMigrationProgress()
  const actions = useMigrationActions()
  const [isLoading, setIsLoading] = useState(false)

  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang)
  }

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
      case 'migration_completed':
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
            <Button onClick={actions.cancel}>{t('migration.buttons.cancel')}</Button>
            <Spacer />
            <Button onClick={actions.proceedToBackup}>{t('migration.buttons.next')}</Button>
          </>
        )
      case 'backup_required':
        return (
          <>
            <Button onClick={actions.cancel}>{t('migration.buttons.cancel')}</Button>
            <Spacer />
            <Space>
              <Button onClick={actions.showBackupDialog}>{t('migration.buttons.create_backup')}</Button>
              <Button onClick={actions.confirmBackup}>{t('migration.buttons.confirm_backup')}</Button>
            </Space>
          </>
        )
      case 'backup_progress':
        return (
          <ButtonRow>
            <div></div>
            <Button disabled loading>
              {t('migration.buttons.backing_up')}
            </Button>
          </ButtonRow>
        )
      case 'backup_confirmed':
        return (
          <ButtonRow>
            <Button onClick={actions.cancel}>{t('migration.buttons.cancel')}</Button>
            <Space>
              <Button onClick={handleStartMigration} loading={isLoading}>
                {t('migration.buttons.start_migration')}
              </Button>
            </Space>
          </ButtonRow>
        )
      case 'migration':
        return (
          <ButtonRow>
            <div></div>
            <Button disabled>{t('migration.buttons.migrating')}</Button>
          </ButtonRow>
        )
      case 'migration_completed':
        return (
          <ButtonRow>
            <div></div>
            <Button onClick={confirmComplete}>{t('migration.buttons.confirm')}</Button>
          </ButtonRow>
        )
      case 'completed':
        return (
          <ButtonRow>
            <div></div>
            <Button onClick={actions.restart}>{t('migration.buttons.restart')}</Button>
          </ButtonRow>
        )
      case 'error':
        return (
          <ButtonRow>
            <Button onClick={actions.cancel}>{t('migration.buttons.close')}</Button>
            <Space>
              <Button onClick={actions.retry}>{t('migration.buttons.retry')}</Button>
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
        <HeaderTitle>{t('migration.title')}</HeaderTitle>
      </Header>

      <MainContent>
        <LeftSidebar>
          <StepsContainer>
            <Steps
              direction="vertical"
              current={currentStep}
              status={stepStatus}
              size="small"
              items={[
                { title: t('migration.stages.introduction') },
                { title: t('migration.stages.backup') },
                { title: t('migration.stages.migration') },
                { title: t('migration.stages.completed') }
              ]}
            />
          </StepsContainer>
          <LanguageSelectorContainer>
            <Select value={i18n.language} onValueChange={handleLanguageChange}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh-CN">中文</SelectItem>
                <SelectItem value="en-US">English</SelectItem>
              </SelectContent>
            </Select>
          </LanguageSelectorContainer>
        </LeftSidebar>

        <RightContent>
          <ContentArea>
            <InfoIcon>{getCurrentStepIcon()}</InfoIcon>

            {progress.stage === 'introduction' && (
              <InfoCard>
                <InfoTitle>{t('migration.introduction.title')}</InfoTitle>
                <InfoDescription>
                  {t('migration.introduction.description_1')}
                  <br />
                  <br />
                  {t('migration.introduction.description_2')}
                  <br />
                  <br />
                  {t('migration.introduction.description_3')}
                </InfoDescription>
              </InfoCard>
            )}

            {progress.stage === 'backup_required' && (
              <InfoCard variant="warning">
                <InfoTitle>{t('migration.backup_required.title')}</InfoTitle>
                <InfoDescription>{t('migration.backup_required.description')}</InfoDescription>
              </InfoCard>
            )}

            {progress.stage === 'backup_progress' && (
              <InfoCard variant="warning">
                <InfoTitle>{t('migration.backup_progress.title')}</InfoTitle>
                <InfoDescription>{t('migration.backup_progress.description')}</InfoDescription>
              </InfoCard>
            )}

            {progress.stage === 'backup_confirmed' && (
              <InfoCard variant="success">
                <InfoTitle>{t('migration.backup_confirmed.title')}</InfoTitle>
                <InfoDescription>{t('migration.backup_confirmed.description')}</InfoDescription>
              </InfoCard>
            )}

            {progress.stage === 'migration' && (
              <div style={{ width: '100%', maxWidth: '600px', margin: '0 auto' }}>
                <InfoCard>
                  <InfoTitle>{t('migration.migration.title')}</InfoTitle>
                  <InfoDescription>{progress.currentMessage}</InfoDescription>
                </InfoCard>
                <ProgressContainer>
                  <Progress
                    percent={Math.round(progress.overallProgress)}
                    strokeColor={getProgressColor()}
                    trailColor="#f0f0f0"
                  />
                </ProgressContainer>
                <div style={{ marginTop: '20px', height: '200px', overflowY: 'auto' }}>
                  <MigratorProgressList migrators={progress.migrators} overallProgress={progress.overallProgress} />
                </div>
              </div>
            )}

            {progress.stage === 'migration_completed' && (
              <div style={{ width: '100%', maxWidth: '600px', margin: '0 auto' }}>
                <InfoCard variant="success">
                  <InfoTitle>{t('migration.migration_completed.title')}</InfoTitle>
                  <InfoDescription>{t('migration.migration_completed.description')}</InfoDescription>
                </InfoCard>
                <ProgressContainer>
                  <Progress percent={100} strokeColor={getProgressColor()} trailColor="#f0f0f0" />
                </ProgressContainer>
                <div style={{ marginTop: '20px', height: '200px', overflowY: 'auto' }}>
                  <MigratorProgressList migrators={progress.migrators} overallProgress={progress.overallProgress} />
                </div>
              </div>
            )}

            {progress.stage === 'completed' && (
              <InfoCard variant="success">
                <InfoTitle>{t('migration.completed.title')}</InfoTitle>
                <InfoDescription>{t('migration.completed.description')}</InfoDescription>
              </InfoCard>
            )}

            {progress.stage === 'error' && (
              <InfoCard variant="error">
                <InfoTitle>{t('migration.error.title')}</InfoTitle>
                <InfoDescription>
                  {t('migration.error.description')}
                  <br />
                  <br />
                  {t('migration.error.error_prefix')}
                  {lastError || progress.error || 'Unknown error'}
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

const LanguageSelectorContainer = styled.div`
  padding: 16px 24px 24px 24px;
  border-top: 1px solid #f0f0f0;
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
