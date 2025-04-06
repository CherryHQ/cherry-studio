import { CheckCircleOutlined, QuestionCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { Center, VStack } from '@renderer/components/Layout'
import { EventEmitter } from '@renderer/services/EventService'
import { Alert, Button } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingDescription, SettingRow, SettingSubtitle } from '..'

interface Props {
  mini?: boolean
}

const InstallNpxUv: FC<Props> = ({ mini = false }) => {
  const [isUvInstalled, setIsUvInstalled] = useState(true)
  const [isBunInstalled, setIsBunInstalled] = useState(true)
  const [isInstallingUv, setIsInstallingUv] = useState(false)
  const [isInstallingBun, setIsInstallingBun] = useState(false)
  const [uvPath, setUvPath] = useState<string | null>(null)
  const [bunPath, setBunPath] = useState<string | null>(null)
  const [binariesDir, setBinariesDir] = useState<string | null>(null)
  const { t } = useTranslation()

  const checkBinaries = async () => {
    const uvExists = await window.api.isBinaryExist('uv')
    const bunExists = await window.api.isBinaryExist('bun')
    const { uvPath, bunPath, dir } = await window.api.mcp.getInstallInfo()

    setIsUvInstalled(uvExists)
    setIsBunInstalled(bunExists)
    setUvPath(uvPath)
    setBunPath(bunPath)
    setBinariesDir(dir)
  }

  const installUV = async () => {
    try {
      setIsInstallingUv(true)
      await window.api.installUVBinary()
      setIsUvInstalled(true)
      setIsInstallingUv(false)
    } catch (error: any) {
      window.message.error({ content: `${t('settings.mcp.installError')}: ${error.message}`, key: 'mcp-install-error' })
      setIsInstallingUv(false)
      checkBinaries()
    }
  }

  const installBun = async () => {
    try {
      setIsInstallingBun(true)
      await window.api.installBunBinary()
      setIsBunInstalled(true)
      setIsInstallingBun(false)
    } catch (error: any) {
      window.message.error({
        content: `${t('settings.mcp.installError')}: ${error.message}`,
        key: 'mcp-install-error'
      })
      setIsInstallingBun(false)
      checkBinaries()
    }
  }

  useEffect(() => {
    checkBinaries()
  }, [])

  if (mini) {
    const installed = isUvInstalled && isBunInstalled
    return (
      <Button
        type="primary"
        size="small"
        variant="filled"
        shape="circle"
        icon={installed ? <CheckCircleOutlined /> : <WarningOutlined />}
        className="nodrag"
        color={installed ? 'green' : 'danger'}
        onClick={() => EventEmitter.emit('mcp:mcp-install')}
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
`

export default InstallNpxUv
