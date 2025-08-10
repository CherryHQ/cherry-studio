import {
  CloudServerOutlined,
  CloudSyncOutlined,
  FileSearchOutlined,
  LoadingOutlined,
  YuqueOutlined
} from '@ant-design/icons'
import DividerWithText from '@renderer/components/DividerWithText'
import { NutstoreIcon } from '@renderer/components/Icons/NutstoreIcons'
import { HStack } from '@renderer/components/Layout'
import ListItem from '@renderer/components/ListItem'
import BackupPopup from '@renderer/components/Popups/BackupPopup'
import RestorePopup from '@renderer/components/Popups/RestorePopup'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useKnowledgeFiles } from '@renderer/hooks/useKnowledgeFiles'
import { reset } from '@renderer/services/BackupService'
import store, { useAppDispatch } from '@renderer/store'
import { setSkipBackupFile as _setSkipBackupFile } from '@renderer/store/settings'
import { AppInfo } from '@renderer/types'
import { formatFileSize } from '@renderer/utils'
import { occupiedDirs } from '@shared/config/constant'
import { Button, Progress, Switch, Typography } from 'antd'
import { FileText, FolderCog, FolderInput, FolderOpen, SaveIcon, Sparkle } from 'lucide-react'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import {
  SettingContainer,
  SettingDivider,
  SettingGroup,
  SettingHelpText,
  SettingRow,
  SettingRowTitle,
  SettingTitle
} from '..'
import AgentsSubscribeUrlSettings from './AgentsSubscribeUrlSettings'
import ExportMenuOptions from './ExportMenuSettings'
import JoplinSettings from './JoplinSettings'
import LocalBackupSettings from './LocalBackupSettings'
import MarkdownExportSettings from './MarkdownExportSettings'
import NotionSettings from './NotionSettings'
import NutstoreSettings from './NutstoreSettings'
import ObsidianSettings from './ObsidianSettings'
import S3Settings from './S3Settings'
import SiyuanSettings from './SiyuanSettings'
import WebDavSettings from './WebDavSettings'
import YuqueSettings from './YuqueSettings'

const DataSettings: FC = () => {
  const { t } = useTranslation()
  const [appInfo, setAppInfo] = useState<AppInfo>()
  const [cacheSize, setCacheSize] = useState<string>('')
  const { size, removeAllFiles } = useKnowledgeFiles()
  const { theme } = useTheme()
  const [menu, setMenu] = useState<string>('data')

  const _skipBackupFile = store.getState().settings.skipBackupFile
  const [skipBackupFile, setSkipBackupFile] = useState<boolean>(_skipBackupFile)

  const dispatch = useAppDispatch()

  //joplin icon needs to be updated into iconfont
  const JoplinIcon = () => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="var(--color-icon)" xmlns="http://www.w3.org/2000/svg">
      <path d="M20.97 0h-8.9a.15.15 0 00-.16.15v2.83c0 .1.08.17.18.17h1.22c.49 0 .89.38.93.86V17.4l-.01.36-.05.29-.04.13a2.06 2.06 0 01-.38.7l-.02.03a2.08 2.08 0 01-.37.34c-.5.35-1.17.5-1.92.43a4.66 4.66 0 01-2.67-1.22 3.96 3.96 0 01-1.34-2.42c-.1-.78.14-1.47.65-1.93l.07-.05c.37-.31.84-.5 1.39-.55a.09.09 0 00.01 0l.3-.01.35.01h.02a4.39 4.39 0 011.5.44c.15.08.17 0 .18-.06V9.63a.26.26 0 00-.2-.26 7.5 7.5 0 00-6.76 1.61 6.37 6.37 0 00-2.03 5.5 8.18 8.18 0 002.71 5.08A9.35 9.35 0 0011.81 24c1.88 0 3.62-.64 4.9-1.81a6.32 6.32 0 002.06-4.3l.01-10.86V4.08a.95.95 0 01.95-.93h1.22a.17.17 0 00.17-.17V.15a.15.15 0 00-.15-.15z" />
    </svg>
  )

  const SiyuanIcon = () => (
    <svg viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2962" width="16" height="16">
      <path
        d="M309.76 148.16a84.8 84.8 0 0 0-10.88 11.84S288 170.24 288 171.2s-6.72 4.8-6.72 6.72-3.52 1.92-2.88 2.88a12.48 12.48 0 0 0-6.4 6.4 121.28 121.28 0 0 0-20.8 19.2 456.64 456.64 0 0 1-37.76 37.12v2.88c0 2.88 0 0 0 0s-3.52 1.92-6.72 5.12c-8.64 9.28-19.84 20.48-28.16 28.16l-7.04 7.04-2.56 2.88a114.88 114.88 0 0 0-20.16 21.76 2.88 2.88 0 0 1-8 8.64l-1.6 1.6a99.52 99.52 0 0 0-19.52 18.88 21.44 21.44 0 0 0-6.4 5.44c-14.08 14.4-22.4 23.04-22.72 23.04l-9.28 8.96-8.96 8.96V887.04c0 1.28 3.2 2.56 6.72-1.92s3.52-3.84 4.16-3.84 0-1.6 0 0S163.84 800 219.84 744.64l38.4-38.08c16-16.32 29.12-29.76 28.8-30.4s6.72-4.16 5.76-5.76 5.44-3.2 5.44-5.12 23.68-23.04 23.04-26.56 0-115.52 0-252.16V138.56a128 128 0 0 0-11.84 10.88z m373.76 2.24a96 96 0 0 0-13.44 15.04s-33.92 32-76.48 74.56l-42.56 42.88L512 320v504.96s5.76-5.12 5.12-5.76a29.44 29.44 0 0 0 8.32-7.68c3.84-4.16 9.92-10.24 13.76-13.76l21.44-21.76 21.76-21.44c18.56-18.24 32-32 32-32l8.96-9.6a69.76 69.76 0 0 1 10.56-9.6s3.84-1.92 3.84-3.52 6.4-4.48 5.76-5.12 3.2-2.56 2.56-3.2 1.6 0 0 0 11.52-10.24 24-22.72l22.72-22.4v-256-251.84c0-0.96 0-2.24-15.36 11.84z"
        fill="#cdcdcd"
        p-id="2963"></path>
      <path
        d="M322.24 136h0c-1.6 0 0-0.64 0 0z m2.88 0v504.64l45.12 44.16c37.44 36.8 93.76 92.8 116.48 114.88l14.4 15.04a64 64 0 0 0 10.24 9.6V320l-4.8-4.48c-2.88-2.24-7.68-7.36-11.52-10.88l-42.24-41.92-20.8-21.12-16-14.4a76.48 76.48 0 0 1-7.36-7.04l-23.36-23.68-42.56-44.16c-15.04-15.04-16-16-17.6-14.72z m376 1.92V640l123.84 123.84c98.24 97.92 124.48 123.52 126.4 123.52h2.56V386.56l-124.8-124.8C760 192 704 136.96 704 136.96a3.52 3.52 0 0 0-1.6 2.56z"
        fill="#707070"
        p-id="2964"></path>
      <path
        d="M699.52 136.64V136z m-376.96 249.6V136.96s-0.32 50.56 0 249.28zM512 573.76v-127.04zM667.84 672l-6.72 7.36 7.04-7.04c6.72-6.08 7.68-7.36 6.72-7.36zM184 272.96v1.92l2.56-1.92c2.56-1.92 0-2.24 0-2.24a5.44 5.44 0 0 0-2.56 2.24zM141.76 314.88a2.24 2.24 0 0 0 1.92 0v-1.6z m483.2 399.04a71.36 71.36 0 0 0-8.96 10.24 69.76 69.76 0 0 0 10.56-9.6 56 56 0 0 0 8.96-10.24 73.28 73.28 0 0 0-10.56 9.6z m-448 75.52l-3.2 3.2 3.52-2.88 3.52-3.52s-2.56 0-5.44 3.2z m-97.92 96v1.92l2.88-1.92s1.92-2.24 0-2.24a6.72 6.72 0 0 0-4.48 2.88z"
        p-id="2965"></path>
    </svg>
  )

  const menuItems = [
    { key: 'divider_0', isDivider: true, text: t('settings.data.divider.basic') },
    { key: 'data', title: t('settings.data.data.title'), icon: <FolderCog size={16} /> },
    { key: 'divider_1', isDivider: true, text: t('settings.data.divider.cloud_storage') },
    { key: 'local_backup', title: t('settings.data.local.title'), icon: <FolderCog size={16} /> },
    { key: 'webdav', title: t('settings.data.webdav.title'), icon: <CloudSyncOutlined style={{ fontSize: 16 }} /> },
    { key: 'nutstore', title: t('settings.data.nutstore.title'), icon: <NutstoreIcon /> },
    { key: 's3', title: t('settings.data.s3.title.label'), icon: <CloudServerOutlined style={{ fontSize: 16 }} /> },
    { key: 'divider_2', isDivider: true, text: t('settings.data.divider.export_settings') },
    {
      key: 'export_menu',
      title: t('settings.data.export_menu.title'),
      icon: <FolderInput size={16} />
    },
    {
      key: 'markdown_export',
      title: t('settings.data.markdown_export.title'),
      icon: <FileText size={16} />
    },

    { key: 'divider_3', isDivider: true, text: t('settings.data.divider.third_party') },
    { key: 'notion', title: t('settings.data.notion.title'), icon: <i className="iconfont icon-notion" /> },
    {
      key: 'yuque',
      title: t('settings.data.yuque.title'),
      icon: <YuqueOutlined style={{ fontSize: 16 }} />
    },
    {
      key: 'joplin',
      title: t('settings.data.joplin.title'),
      icon: <JoplinIcon />
    },
    {
      key: 'obsidian',
      title: t('settings.data.obsidian.title'),
      icon: <i className="iconfont icon-obsidian" />
    },
    {
      key: 'siyuan',
      title: t('settings.data.siyuan.title'),
      icon: <SiyuanIcon />
    },
    {
      key: 'agentssubscribe_url',
      title: t('agents.settings.title'),
      icon: <Sparkle size={16} className="icon" />
    }
  ]

  useEffect(() => {
    window.api.getAppInfo().then(setAppInfo)
    window.api.getCacheSize().then(setCacheSize)
  }, [])

  const handleOpenPath = (path?: string) => {
    if (!path) return
    if (path?.endsWith('log')) {
      const dirPath = path.split(/[/\\]/).slice(0, -1).join('/')
      window.api.openPath(dirPath)
    } else {
      window.api.openPath(path)
    }
  }

  const handleClearCache = () => {
    window.modal.confirm({
      title: t('settings.data.clear_cache.title'),
      content: t('settings.data.clear_cache.confirm'),
      okText: t('settings.data.clear_cache.button'),
      centered: true,
      okButtonProps: {
        danger: true
      },
      onOk: async () => {
        try {
          await window.api.clearCache()
          await window.api.trace.cleanLocalData()
          await window.api.getCacheSize().then(setCacheSize)
          window.message.success(t('settings.data.clear_cache.success'))
        } catch (error) {
          window.message.error(t('settings.data.clear_cache.error'))
        }
      }
    })
  }

  const handleRemoveAllFiles = () => {
    window.modal.confirm({
      centered: true,
      title: t('settings.data.app_knowledge.remove_all') + ` (${formatFileSize(size)}) `,
      content: t('settings.data.app_knowledge.remove_all_confirm'),
      onOk: async () => {
        await removeAllFiles()
        window.message.success(t('settings.data.app_knowledge.remove_all_success'))
      },
      okText: t('common.delete'),
      okButtonProps: {
        danger: true
      }
    })
  }

  const handleSelectAppDataPath = async () => {
    if (!appInfo || !appInfo.appDataPath) {
      return
    }

    const newAppDataPath = await window.api.select({
      properties: ['openDirectory', 'createDirectory'],
      title: t('settings.data.app_data.select_title')
    })

    if (!newAppDataPath) {
      return
    }

    // check new app data path is root path
    // if is root path, show error
    const pathParts = newAppDataPath.split(/[/\\]/).filter((part: string) => part !== '')
    if (pathParts.length <= 1) {
      window.message.error(t('settings.data.app_data.select_error_root_path'))
      return
    }

    // check new app data path is not in old app data path
    const isInOldPath = await window.api.isPathInside(newAppDataPath, appInfo.appDataPath)
    if (isInOldPath) {
      window.message.error(t('settings.data.app_data.select_error_same_path'))
      return
    }

    // check new app data path is not in app install path
    const isInInstallPath = await window.api.isPathInside(newAppDataPath, appInfo.installPath)
    if (isInInstallPath) {
      window.message.error(t('settings.data.app_data.select_error_in_app_path'))
      return
    }

    // check new app data path has write permission
    const hasWritePermission = await window.api.hasWritePermission(newAppDataPath)
    if (!hasWritePermission) {
      window.message.error(t('settings.data.app_data.select_error_write_permission'))
      return
    }

    const migrationTitle = (
      <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{t('settings.data.app_data.migration_title')}</div>
    )
    const migrationClassName = 'migration-modal'
    showMigrationConfirmModal(appInfo.appDataPath, newAppDataPath, migrationTitle, migrationClassName)
  }

  const doubleConfirmModalBeforeCopyData = (newPath: string) => {
    window.modal.confirm({
      title: t('settings.data.app_data.select_not_empty_dir'),
      content: t('settings.data.app_data.select_not_empty_dir_content'),
      centered: true,
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      onOk: () => {
        window.message.info({
          content: t('settings.data.app_data.restart_notice'),
          duration: 2
        })
        setTimeout(() => {
          window.api.relaunchApp({
            args: ['--new-data-path=' + newPath]
          })
        }, 500)
      }
    })
  }

  // 显示确认迁移的对话框
  const showMigrationConfirmModal = async (
    originalPath: string,
    newPath: string,
    title: React.ReactNode,
    className: string
  ) => {
    // 复制数据选项状态
    let shouldCopyData = !(await window.api.isNotEmptyDir(newPath))

    // 创建路径内容组件
    const PathsContent = () => (
      <div>
        <MigrationPathRow>
          <MigrationPathLabel>{t('settings.data.app_data.original_path')}:</MigrationPathLabel>
          <MigrationPathValue>{originalPath}</MigrationPathValue>
        </MigrationPathRow>
        <MigrationPathRow style={{ marginTop: '16px' }}>
          <MigrationPathLabel>{t('settings.data.app_data.new_path')}:</MigrationPathLabel>
          <MigrationPathValue>{newPath}</MigrationPathValue>
        </MigrationPathRow>
      </div>
    )

    const CopyDataContent = () => (
      <div>
        <MigrationPathRow style={{ marginTop: '20px', flexDirection: 'row', alignItems: 'center' }}>
          <Switch
            defaultChecked={shouldCopyData}
            onChange={(checked) => {
              shouldCopyData = checked
            }}
            style={{ marginRight: '8px' }}
          />
          <MigrationPathLabel style={{ fontWeight: 'normal', fontSize: '14px' }}>
            {t('settings.data.app_data.copy_data_option')}
          </MigrationPathLabel>
        </MigrationPathRow>
      </div>
    )

    // 显示确认模态框
    window.modal.confirm({
      title,
      className,
      width: 'min(600px, 90vw)',
      style: { minHeight: '400px' },
      content: (
        <MigrationModalContent>
          <PathsContent />
          <CopyDataContent />
          <MigrationNotice>
            <p style={{ color: 'var(--color-warning)' }}>{t('settings.data.app_data.restart_notice')}</p>
            <p style={{ color: 'var(--color-text-3)', marginTop: '8px' }}>
              {t('settings.data.app_data.copy_time_notice')}
            </p>
          </MigrationNotice>
        </MigrationModalContent>
      ),
      centered: true,
      okButtonProps: {
        danger: true
      },
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          if (shouldCopyData) {
            if (await window.api.isNotEmptyDir(newPath)) {
              doubleConfirmModalBeforeCopyData(newPath)
              return
            }

            window.message.info({
              content: t('settings.data.app_data.restart_notice'),
              duration: 3
            })
            setTimeout(() => {
              window.api.relaunchApp({
                args: ['--new-data-path=' + newPath]
              })
            }, 500)
            return
          }
          // 如果不复制数据，直接设置新的应用数据路径
          await window.api.setAppDataPath(newPath)
          window.message.success(t('settings.data.app_data.path_changed_without_copy'))

          // 更新应用数据路径
          setAppInfo(await window.api.getAppInfo())

          // 通知用户并重启应用
          setTimeout(() => {
            window.message.success(t('settings.data.app_data.select_success'))
            window.api.setStopQuitApp(false, '')
            window.api.relaunchApp()
          }, 500)
        } catch (error) {
          window.api.setStopQuitApp(false, '')
          window.message.error({
            content: t('settings.data.app_data.path_change_failed') + ': ' + error,
            duration: 5
          })
        }
      }
    })
  }

  useEffect(() => {
    const handleDataMigration = async () => {
      const newDataPath = await window.api.getDataPathFromArgs()
      if (!newDataPath) return

      const originalPath = (await window.api.getAppInfo())?.appDataPath
      if (!originalPath) return

      const title = (
        <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{t('settings.data.app_data.migration_title')}</div>
      )
      const className = 'migration-modal'
      const messageKey = 'data-migration'

      // 显示进度模态框
      const showProgressModal = (title: React.ReactNode, className: string, PathsContent: React.FC) => {
        let currentProgress = 0
        let progressInterval: NodeJS.Timeout | null = null

        // 创建进度更新模态框
        const loadingModal = window.modal.info({
          title,
          className,
          width: 'min(600px, 90vw)',
          style: { minHeight: '400px' },
          icon: <LoadingOutlined style={{ fontSize: 18 }} />,
          content: (
            <MigrationModalContent>
              <PathsContent />
              <MigrationNotice>
                <p>{t('settings.data.app_data.copying')}</p>
                <div style={{ marginTop: '12px' }}>
                  <Progress percent={currentProgress} status="active" strokeWidth={8} />
                </div>
                <p style={{ color: 'var(--color-warning)', marginTop: '12px', fontSize: '13px' }}>
                  {t('settings.data.app_data.copying_warning')}
                </p>
              </MigrationNotice>
            </MigrationModalContent>
          ),
          centered: true,
          closable: false,
          maskClosable: false,
          okButtonProps: { style: { display: 'none' } }
        })

        // 更新进度的函数
        const updateProgress = (progress: number, status: 'active' | 'success' = 'active') => {
          loadingModal.update({
            title,
            content: (
              <MigrationModalContent>
                <PathsContent />
                <MigrationNotice>
                  <p>{t('settings.data.app_data.copying')}</p>
                  <div style={{ marginTop: '12px' }}>
                    <Progress percent={Math.round(progress)} status={status} strokeWidth={8} />
                  </div>
                  <p style={{ color: 'var(--color-warning)', marginTop: '12px', fontSize: '13px' }}>
                    {t('settings.data.app_data.copying_warning')}
                  </p>
                </MigrationNotice>
              </MigrationModalContent>
            )
          })
        }

        // 开始模拟进度更新
        progressInterval = setInterval(() => {
          if (currentProgress < 95) {
            currentProgress += Math.random() * 5 + 1
            if (currentProgress > 95) currentProgress = 95
            updateProgress(currentProgress)
          }
        }, 500)

        return { loadingModal, progressInterval, updateProgress }
      }

      // 开始迁移数据
      const startMigration = async (
        originalPath: string,
        newPath: string,
        progressInterval: NodeJS.Timeout | null,
        updateProgress: (progress: number, status?: 'active' | 'success') => void,
        loadingModal: { destroy: () => void },
        messageKey: string
      ): Promise<void> => {
        // flush app data
        await window.api.flushAppData()

        // wait 2 seconds to flush app data
        await new Promise((resolve) => setTimeout(resolve, 2000))

        // 开始复制过程
        const copyResult = await window.api.copy(
          originalPath,
          newPath,
          occupiedDirs.map((dir) => originalPath + '/' + dir)
        )

        // 停止进度更新
        if (progressInterval) {
          clearInterval(progressInterval)
        }

        // 显示100%完成
        updateProgress(100, 'success')

        if (!copyResult.success) {
          // 延迟关闭加载模态框
          await new Promise<void>((resolve) => {
            setTimeout(() => {
              loadingModal.destroy()
              window.message.error({
                content: t('settings.data.app_data.copy_failed') + ': ' + copyResult.error,
                key: messageKey,
                duration: 5
              })
              resolve()
            }, 500)
          })

          throw new Error(copyResult.error || 'Unknown error during copy')
        }

        // 在复制成功后设置新的AppDataPath
        await window.api.setAppDataPath(newPath)

        // 短暂延迟以显示100%完成
        await new Promise((resolve) => setTimeout(resolve, 500))

        // 关闭加载模态框
        loadingModal.destroy()

        window.message.success({
          content: t('settings.data.app_data.copy_success'),
          key: messageKey,
          duration: 2
        })
      }

      // Create PathsContent component for this specific migration
      const PathsContent = () => (
        <div>
          <MigrationPathRow>
            <MigrationPathLabel>{t('settings.data.app_data.original_path')}:</MigrationPathLabel>
            <MigrationPathValue>{originalPath}</MigrationPathValue>
          </MigrationPathRow>
          <MigrationPathRow style={{ marginTop: '16px' }}>
            <MigrationPathLabel>{t('settings.data.app_data.new_path')}:</MigrationPathLabel>
            <MigrationPathValue>{newDataPath}</MigrationPathValue>
          </MigrationPathRow>
        </div>
      )

      const { loadingModal, progressInterval, updateProgress } = showProgressModal(title, className, PathsContent)
      try {
        window.api.setStopQuitApp(true, t('settings.data.app_data.stop_quit_app_reason'))
        await startMigration(originalPath, newDataPath, progressInterval, updateProgress, loadingModal, messageKey)

        // 更新应用数据路径
        setAppInfo(await window.api.getAppInfo())

        // 通知用户并重启应用
        setTimeout(() => {
          window.message.success(t('settings.data.app_data.select_success'))
          window.api.setStopQuitApp(false, '')
          window.api.relaunchApp({
            args: ['--user-data-dir=' + newDataPath]
          })
        }, 1000)
      } catch (error) {
        window.api.setStopQuitApp(false, '')
        window.message.error({
          content: t('settings.data.app_data.copy_failed') + ': ' + error,
          key: messageKey,
          duration: 5
        })
      } finally {
        if (progressInterval) {
          clearInterval(progressInterval)
        }
        loadingModal.destroy()
      }
    }

    handleDataMigration()
  }, [t])

  const onSkipBackupFilesChange = (value: boolean) => {
    setSkipBackupFile(value)
    dispatch(_setSkipBackupFile(value))
  }

  return (
    <Container>
      <MenuList>
        {menuItems.map((item) =>
          item.isDivider ? (
            <DividerWithText key={item.key} text={item.text || ''} style={{ margin: '8px 0' }} /> // 动态传递分隔符文字
          ) : (
            <ListItem
              key={item.key}
              title={item.title}
              active={menu === item.key}
              onClick={() => setMenu(item.key)}
              titleStyle={{ fontWeight: 500 }}
              icon={item.icon}
            />
          )
        )}
      </MenuList>
      <SettingContainer theme={theme} style={{ display: 'flex', flex: 1 }}>
        {menu === 'data' && (
          <>
            <SettingGroup theme={theme}>
              <SettingTitle>{t('settings.data.title')}</SettingTitle>
              <SettingDivider />
              <SettingRow>
                <SettingRowTitle>{t('settings.general.backup.title')}</SettingRowTitle>
                <HStack gap="5px" justifyContent="space-between">
                  <Button onClick={BackupPopup.show} icon={<SaveIcon size={14} />}>
                    {t('settings.general.backup.button')}
                  </Button>
                  <Button onClick={RestorePopup.show} icon={<FolderOpen size={14} />}>
                    {t('settings.general.restore.button')}
                  </Button>
                </HStack>
              </SettingRow>
              <SettingDivider />
              <SettingRow>
                <SettingRowTitle>{t('settings.data.backup.skip_file_data_title')}</SettingRowTitle>
                <Switch checked={skipBackupFile} onChange={onSkipBackupFilesChange} />
              </SettingRow>
              <SettingRow>
                <SettingHelpText>{t('settings.data.backup.skip_file_data_help')}</SettingHelpText>
              </SettingRow>
            </SettingGroup>
            <SettingGroup theme={theme}>
              <SettingTitle>{t('settings.data.data.title')}</SettingTitle>
              <SettingDivider />
              <SettingRow>
                <SettingRowTitle>{t('settings.data.app_data.label')}</SettingRowTitle>
                <PathRow>
                  <PathText
                    style={{ color: 'var(--color-text-3)' }}
                    onClick={() => handleOpenPath(appInfo?.appDataPath)}>
                    {appInfo?.appDataPath}
                  </PathText>
                  <StyledIcon onClick={() => handleOpenPath(appInfo?.appDataPath)} style={{ flexShrink: 0 }} />
                  <HStack gap="5px" style={{ marginLeft: '8px' }}>
                    <Button onClick={handleSelectAppDataPath}>{t('settings.data.app_data.select')}</Button>
                  </HStack>
                </PathRow>
              </SettingRow>
              <SettingDivider />
              <SettingRow>
                <SettingRowTitle>{t('settings.data.app_logs.label')}</SettingRowTitle>
                <PathRow>
                  <PathText style={{ color: 'var(--color-text-3)' }} onClick={() => handleOpenPath(appInfo?.logsPath)}>
                    {appInfo?.logsPath}
                  </PathText>
                  <StyledIcon onClick={() => handleOpenPath(appInfo?.logsPath)} style={{ flexShrink: 0 }} />
                  <HStack gap="5px" style={{ marginLeft: '8px' }}>
                    <Button onClick={() => handleOpenPath(appInfo?.logsPath)}>
                      {t('settings.data.app_logs.button')}
                    </Button>
                  </HStack>
                </PathRow>
              </SettingRow>
              <SettingDivider />
              <SettingRow>
                <SettingRowTitle>{t('settings.data.app_knowledge.label')}</SettingRowTitle>
                <HStack alignItems="center" gap="5px">
                  <Button onClick={handleRemoveAllFiles}>{t('settings.data.app_knowledge.button.delete')}</Button>
                </HStack>
              </SettingRow>
              <SettingDivider />
              <SettingRow>
                <SettingRowTitle>
                  {t('settings.data.clear_cache.title')}
                  {cacheSize && <CacheText>({cacheSize}MB)</CacheText>}
                </SettingRowTitle>
                <HStack gap="5px">
                  <Button onClick={handleClearCache}>{t('settings.data.clear_cache.button')}</Button>
                </HStack>
              </SettingRow>
              <SettingDivider />
              <SettingRow>
                <SettingRowTitle>{t('settings.general.reset.title')}</SettingRowTitle>
                <HStack gap="5px">
                  <Button onClick={reset} danger>
                    {t('settings.general.reset.title')}
                  </Button>
                </HStack>
              </SettingRow>
            </SettingGroup>
          </>
        )}
        {menu === 'webdav' && <WebDavSettings />}
        {menu === 'nutstore' && <NutstoreSettings />}
        {menu === 's3' && <S3Settings />}
        {menu === 'export_menu' && <ExportMenuOptions />}
        {menu === 'markdown_export' && <MarkdownExportSettings />}
        {menu === 'notion' && <NotionSettings />}
        {menu === 'yuque' && <YuqueSettings />}
        {menu === 'joplin' && <JoplinSettings />}
        {menu === 'obsidian' && <ObsidianSettings />}
        {menu === 'siyuan' && <SiyuanSettings />}
        {menu === 'agentssubscribe_url' && <AgentsSubscribeUrlSettings />}
        {menu === 'local_backup' && <LocalBackupSettings />}
      </SettingContainer>
    </Container>
  )
}

const Container = styled(HStack)`
  flex: 1;
`

const StyledIcon = styled(FileSearchOutlined)`
  color: var(--color-text-2);
  cursor: pointer;
  transition: color 0.3s;

  &:hover {
    color: var(--color-text-1);
  }
`

const MenuList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: var(--settings-width);
  padding: 12px;
  padding-bottom: 48px;
  border-right: 0.5px solid var(--color-border);
  height: 100vh;
  overflow: auto;
  box-sizing: border-box;
  min-height: 0;
  .iconfont {
    color: var(--color-text-2);
    line-height: 16px;
  }
`

const CacheText = styled(Typography.Text)`
  color: var(--color-text-3);
  font-size: 12px;
  margin-left: 5px;
  line-height: 16px;
  display: inline-block;
  vertical-align: middle;
  text-align: left;
`

const PathText = styled(Typography.Text)`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  vertical-align: middle;
  text-align: right;
  margin-left: 5px;
  cursor: pointer;
`

const PathRow = styled(HStack)`
  min-width: 0;
  flex: 1;
  width: 0;
  align-items: center;
  gap: 5px;
`

// Add styled components for migration modal
const MigrationModalContent = styled.div`
  padding: 20px 0 10px;
  display: flex;
  flex-direction: column;
`

const MigrationNotice = styled.div`
  margin-top: 24px;
  font-size: 14px;
`

const MigrationPathRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
`

const MigrationPathLabel = styled.div`
  font-weight: 600;
  font-size: 15px;
  color: var(--color-text-1);
`

const MigrationPathValue = styled.div`
  font-size: 14px;
  color: var(--color-text-2);
  background-color: var(--color-background-soft);
  padding: 8px 12px;
  border-radius: 4px;
  word-break: break-all;
  border: 1px solid var(--color-border);
`

export default DataSettings
