import { CheckCircleOutlined, QuestionCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { Center, ColFlex } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { usePersistCache } from '@renderer/data/hooks/useCache'
import { useNavigate } from '@tanstack/react-router'
import { Alert } from 'antd'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingDescription, SettingRow, SettingSubtitle } from '..'

interface Props {
  mini?: boolean
}

const InstallNpxUv: FC<Props> = ({ mini = false }) => {
  const [isUvInstalled, setIsUvInstalled] = usePersistCache('feature.mcp.is_uv_installed')
  const [isBunInstalled, setIsBunInstalled] = usePersistCache('feature.mcp.is_bun_installed')

  const [isInstallingUv, setIsInstallingUv] = useState(false)
  const [isInstallingBun, setIsInstallingBun] = useState(false)
  const [uvPath, setUvPath] = useState<string | null>(null)
  const [bunPath, setBunPath] = useState<string | null>(null)
  const [binariesDir, setBinariesDir] = useState<string | null>(null)
  const { t } = useTranslation()
  const navigate = useNavigate()
  const checkBinariesTimerRef = useRef<NodeJS.Timeout>(undefined)

  // 清理定时器
  useEffect(() => {
    return () => {
      clearTimeout(checkBinariesTimerRef.current)
    }
  }, [])

  const checkBinaries = useCallback(async () => {
    const uvExists = await window.api.isBinaryExist('uv')
    const bunExists = await window.api.isBinaryExist('bun')
    const { uvPath, bunPath, dir } = await window.api.mcp.getInstallInfo()

    setIsUvInstalled(uvExists)
    setIsBunInstalled(bunExists)
    setUvPath(uvPath)
    setBunPath(bunPath)
    setBinariesDir(dir)
  }, [setIsUvInstalled, setIsBunInstalled])

  const installUV = async () => {
    try {
      setIsInstallingUv(true)
      await window.api.installUVBinary()
      setIsInstallingUv(false)
      setIsUvInstalled(true)
    } catch (error: any) {
      window.toast.error(`${t('settings.mcp.installError')}: ${error.message}`)
      setIsInstallingUv(false)
    }
    clearTimeout(checkBinariesTimerRef.current)
    checkBinariesTimerRef.current = setTimeout(checkBinaries, 1000)
  }

  const installBun = async () => {
    try {
      setIsInstallingBun(true)
      await window.api.installBunBinary()
      setIsInstallingBun(false)
      setIsBunInstalled(true)
    } catch (error: any) {
      window.toast.error(`${t('settings.mcp.installError')}: ${error.message}`)
      setIsInstallingBun(false)
    }
    clearTimeout(checkBinariesTimerRef.current)
    checkBinariesTimerRef.current = setTimeout(checkBinaries, 1000)
  }

  useEffect(() => {
    checkBinaries()
  }, [checkBinaries])

  if (mini) {
    const installed = isUvInstalled && isBunInstalled
    return (
      <Button
        className="nodrag rounded-full"
        variant={installed ? 'default' : 'destructive'}
        onClick={() => navigate({ to: '/settings/mcp/mcp-install' })}
        size="icon">
        {installed ? <CheckCircleOutlined /> : <WarningOutlined />}
      </Button>
    )
  }

  const openBinariesDir = () => {
    if (binariesDir) {
      window.api.openPath(binariesDir)
    }
  }

  const onHelp = () => {
    window.open('https://docs.cherry-ai.com/advanced-basic/mcp', '_blank')
  }

  return (
    <Container>
      <Alert
        type={isUvInstalled ? 'success' : 'warning'}
        style={{ borderRadius: 'var(--list-item-border-radius)' }}
        description={
          <ColFlex>
            <SettingRow style={{ width: '100%' }}>
              <SettingSubtitle style={{ margin: 0, fontWeight: 'normal' }}>
                {isUvInstalled ? 'UV Installed' : `UV ${t('settings.mcp.missingDependencies')}`}
              </SettingSubtitle>
              {!isUvInstalled && (
                <Button onClick={installUV} disabled={isInstallingUv} size="sm">
                  {isInstallingUv ? t('settings.mcp.dependenciesInstalling') : t('settings.mcp.install')}
                </Button>
              )}
            </SettingRow>
            <SettingRow style={{ width: '100%' }}>
              <SettingDescription
                onClick={openBinariesDir}
                style={{ margin: 0, fontWeight: 'normal', cursor: 'pointer' }}>
                {uvPath}
              </SettingDescription>
            </SettingRow>
          </ColFlex>
        }
      />
      <Alert
        type={isBunInstalled ? 'success' : 'warning'}
        style={{ borderRadius: 'var(--list-item-border-radius)' }}
        description={
          <ColFlex>
            <SettingRow style={{ width: '100%' }}>
              <SettingSubtitle style={{ margin: 0, fontWeight: 'normal' }}>
                {isBunInstalled ? 'Bun Installed' : `Bun ${t('settings.mcp.missingDependencies')}`}
              </SettingSubtitle>
              {!isBunInstalled && (
                <Button onClick={installBun} disabled={isInstallingBun} size="sm">
                  {isInstallingBun ? t('settings.mcp.dependenciesInstalling') : t('settings.mcp.install')}
                </Button>
              )}
            </SettingRow>
            <SettingRow style={{ width: '100%' }}>
              <SettingDescription
                onClick={openBinariesDir}
                style={{ margin: 0, fontWeight: 'normal', cursor: 'pointer' }}>
                {bunPath}
              </SettingDescription>
            </SettingRow>
          </ColFlex>
        }
      />
      <Center>
        <Button variant="ghost" onClick={onHelp}>
          <QuestionCircleOutlined />
          {t('settings.mcp.installHelp')}
        </Button>
      </Center>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  margin-bottom: 20px;
  gap: 12px;
  padding-top: 50px;
`

export default InstallNpxUv
