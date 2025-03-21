import { Alert, Button } from 'antd'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingRow, SettingSubtitle } from '..'

const InstallNpxUv: FC = () => {
  const [isUvInstalled, setIsUvInstalled] = useState(true)
  const [isBunInstalled, setIsBunInstalled] = useState(true)
  const [isInstallingUv, setIsInstallingUv] = useState(false)
  const [isInstallingBun, setIsInstallingBun] = useState(false)
  const { t } = useTranslation()

  const checkBinaries = async () => {
    const uvExists = await window.api.isBinaryExist('uv')
    const bunExists = await window.api.isBinaryExist('bun')

    setIsUvInstalled(uvExists)
    setIsBunInstalled(bunExists)
  }

  const installUV = async () => {
    try {
      setIsInstallingUv(true)
      await window.api.installUVBinary()
      setIsUvInstalled(true)
      setIsInstallingUv(false)
    } catch (error: any) {
      window.message.error(`${t('settings.mcp.installError')}: ${error.message}`)
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
      window.message.error(`${t('settings.mcp.installError')}: ${error.message}`)
      setIsInstallingBun(false)
      checkBinaries()
    }
  }

  useEffect(() => {
    checkBinaries()
  }, [])

  if (isUvInstalled && isBunInstalled) {
    return null
  }

  return (
    <Container>
      {!isUvInstalled && (
        <Alert
          type="warning"
          banner
          style={{ padding: 8 }}
          description={
            <SettingRow>
              <SettingSubtitle style={{ margin: 0 }}>
                {isUvInstalled ? 'UV Installed' : `UV ${t('settings.mcp.missingDependencies')}`}
              </SettingSubtitle>
              <Button
                type="primary"
                onClick={installUV}
                loading={isInstallingUv}
                disabled={isInstallingUv}
                size="small">
                {isInstallingUv ? t('settings.mcp.dependenciesInstalling') : t('settings.mcp.install')}
              </Button>
            </SettingRow>
          }
        />
      )}
      {!isBunInstalled && (
        <Alert
          type="warning"
          banner
          style={{ padding: 8 }}
          description={
            <SettingRow>
              <SettingSubtitle style={{ margin: 0 }}>
                {isBunInstalled ? 'Bun Installed' : `Bun ${t('settings.mcp.missingDependencies')}`}
              </SettingSubtitle>
              <Button
                type="primary"
                onClick={installBun}
                loading={isInstallingBun}
                disabled={isInstallingBun}
                size="small">
                {isInstallingBun ? t('settings.mcp.dependenciesInstalling') : t('settings.mcp.install')}
              </Button>
            </SettingRow>
          }
        />
      )}
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  margin-bottom: 20px;
  gap: 10px;
`

export default InstallNpxUv
