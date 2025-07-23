import { CheckCircleOutlined, QuestionCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { Center, VStack } from '@renderer/components/Layout'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setIsBunInstalled, setIsUvInstalled } from '@renderer/store/mcp'
import { Alert, Button } from 'antd'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import styled from 'styled-components'

import { SettingDescription, SettingRow, SettingSubtitle } from '..'

interface Props {
  mini?: boolean
}

const InstallNpxUv: FC<Props> = ({ mini = false }) => {
  const dispatch = useAppDispatch()
  const isUvInstalled = useAppSelector((state) => state.mcp.isUvInstalled)
  const isBunInstalled = useAppSelector((state) => state.mcp.isBunInstalled)

  const [isInstallingUv, setIsInstallingUv] = useState(false)
  const [isInstallingBun, setIsInstallingBun] = useState(false)
  const [uvPath, setUvPath] = useState<string | null>(null)
  const [bunPath, setBunPath] = useState<string | null>(null)
  const [binariesDir, setBinariesDir] = useState<string | null>(null)
  const { t } = useTranslation()
  const navigate = useNavigate()
  const checkBinaries = useCallback(async () => {
    const uvExists = await window.api.isBinaryExist('uv')
    const bunExists = await window.api.isBinaryExist('bun')
    const { uvPath, bunPath, dir } = await window.api.mcp.getInstallInfo()

    dispatch(setIsUvInstalled(uvExists))
    dispatch(setIsBunInstalled(bunExists))
    setUvPath(uvPath)
    setBunPath(bunPath)
    setBinariesDir(dir)
  }, [dispatch])

  const installUV = async () => {
    try {
      setIsInstallingUv(true)
      await window.api.installUVBinary()
      setIsInstallingUv(false)
      dispatch(setIsUvInstalled(true))
    } catch (error: any) {
      window.message.error({ content: `${t('settings.mcp.installError')}: ${error.message}`, key: 'mcp-install-error' })
      setIsInstallingUv(false)
    }
    setTimeout(checkBinaries, 1000)
  }

  const installBun = async () => {
    try {
      setIsInstallingBun(true)
      await window.api.installBunBinary()
      setIsInstallingBun(false)
      dispatch(setIsBunInstalled(true))
    } catch (error: any) {
      window.message.error({
        content: `${t('settings.mcp.installError')}: ${error.message}`,
        key: 'mcp-install-error'
      })
      setIsInstallingBun(false)
    }
    setTimeout(checkBinaries, 1000)
  }

  useEffect(() => {
    checkBinaries()
  }, [checkBinaries])

  if (mini) {
    const installed = isUvInstalled && isBunInstalled
    return (
      <Button
        type="primary"
        variant="filled"
        shape="circle"
        icon={installed ? <CheckCircleOutlined /> : <WarningOutlined />}
        className="nodrag"
        color={installed ? 'green' : 'danger'}
        onClick={() => navigate('/settings/mcp/mcp-install')}
      />
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
        banner
        style={{ borderRadius: 'var(--list-item-border-radius)' }}
        description={
          <VStack>
            <SettingRow style={{ width: '100%' }}>
              <SettingSubtitle style={{ margin: 0, fontWeight: 'normal' }}>
                {isUvInstalled ? 'UV Installed' : `UV ${t('settings.mcp.missingDependencies')}`}
              </SettingSubtitle>
              {!isUvInstalled && (
                <Button
                  type="primary"
                  onClick={installUV}
                  loading={isInstallingUv}
                  disabled={isInstallingUv}
                  size="small">
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
          </VStack>
        }
      />
      <Alert
        type={isBunInstalled ? 'success' : 'warning'}
        banner
        style={{ borderRadius: 'var(--list-item-border-radius)' }}
        description={
          <VStack>
            <SettingRow style={{ width: '100%' }}>
              <SettingSubtitle style={{ margin: 0, fontWeight: 'normal' }}>
                {isBunInstalled ? 'Bun Installed' : `Bun ${t('settings.mcp.missingDependencies')}`}
              </SettingSubtitle>
              {!isBunInstalled && (
                <Button
                  type="primary"
                  onClick={installBun}
                  loading={isInstallingBun}
                  disabled={isInstallingBun}
                  size="small">
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
          </VStack>
        }
      />
      <Center>
        <Button type="link" onClick={onHelp} icon={<QuestionCircleOutlined />}>
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
