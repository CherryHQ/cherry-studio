import { CheckCircleOutlined, QuestionCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { Center, VStack } from '@renderer/components/Layout'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { setIsBunInstalled, setIsUvInstalled } from '@renderer/store/mcp'
import { Alert, Button, Popover } from 'antd'
import { FC, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingDescription, SettingRow, SettingSubtitle } from '..'

const InstallNpxUv: FC = () => {
  const dispatch = useAppDispatch()
  const isUvInstalled = useAppSelector((state) => state.mcp.isUvInstalled)
  const isBunInstalled = useAppSelector((state) => state.mcp.isBunInstalled)

  const [isInstallingUv, setIsInstallingUv] = useState(false)
  const [isInstallingBun, setIsInstallingBun] = useState(false)
  const [uvPath, setUvPath] = useState<string | null>(null)
  const [bunPath, setBunPath] = useState<string | null>(null)
  const [binariesDir, setBinariesDir] = useState<string | null>(null)
  const { t } = useTranslation()
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
    if (isUvInstalled && !isInstallingUv) {
      setIsInstallingUv(false)
    }
  }, [isUvInstalled, isInstallingUv])

  useEffect(() => {
    if (isBunInstalled && !isInstallingBun) {
      setIsInstallingBun(false)
    }
  }, [isBunInstalled, isInstallingBun])

  useEffect(() => {
    checkBinaries()
  }, [checkBinaries])

  const openBinariesDir = () => {
    if (binariesDir) {
      window.api.openPath(binariesDir)
    }
  }

  const onHelp = () => {
    window.open('https://docs.cherry-ai.com/advanced-basic/mcp', '_blank')
  }

  const allInstalled = isUvInstalled && isBunInstalled

  const content = (
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
            </SettingRow>
            <SettingRow style={{ width: '100%' }}>
              <SettingDescription
                onClick={openBinariesDir}
                style={{ margin: 0, fontWeight: 'normal', cursor: 'pointer' }}>
                {uvPath}
              </SettingDescription>
            </SettingRow>
            <SettingRow style={{ width: '100%', justifyContent: 'flex-end' }}>
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
            </SettingRow>
            <SettingRow style={{ width: '100%' }}>
              <SettingDescription
                onClick={openBinariesDir}
                style={{ margin: 0, fontWeight: 'normal', cursor: 'pointer' }}>
                {bunPath}
              </SettingDescription>
            </SettingRow>
            <SettingRow style={{ width: '100%', justifyContent: 'flex-end' }}>
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

  return (
    <Popover content={content} placement="bottomLeft" arrow={false}>
      <Button
        type="primary"
        size="small"
        variant="filled"
        shape="circle"
        icon={allInstalled ? <CheckCircleOutlined /> : <WarningOutlined />}
        className="nodrag"
        color={allInstalled ? 'green' : 'danger'}
      />
    </Popover>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

export default InstallNpxUv
