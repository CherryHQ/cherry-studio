import { loggerService } from '@logger'
import MinAppIcon from '@renderer/components/Icons/MinAppIcon'
import IndicatorLight from '@renderer/components/IndicatorLight'
import { reloadAllMinApps, updateAllMinApps, upsertMinAppProxyOverride } from '@renderer/config/minapps'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition } from '@renderer/hooks/useSettings'
import { setOpenedKeepAliveMinapps } from '@renderer/store/runtime'
import type { MinAppType } from '@renderer/types'
import { isValidProxyUrl } from '@renderer/utils'
import type { MenuProps } from 'antd'
import { Dropdown, Form, Input, Modal, Radio } from 'antd'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

interface Props {
  app: MinAppType
  onClick?: () => void
  size?: number
  isLast?: boolean
}

const logger = loggerService.withContext('App')

const MinApp: FC<Props> = ({ app, onClick, size = 60, isLast }) => {
  const { openMinappKeepAlive } = useMinappPopup()
  const { t } = useTranslation()
  const { minapps, pinned, disabled, updateMinapps, updateDisabledMinapps, updatePinnedMinapps } = useMinapps()
  const { openedKeepAliveMinapps, currentMinappId, minappShow } = useRuntime()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const isPinned = pinned.some((p) => p.id === app.id)
  const isVisible = minapps.some((m) => m.id === app.id)
  // Pinned apps should always be visible regardless of region/locale filtering
  const shouldShow = isVisible || isPinned
  const isActive = minappShow && currentMinappId === app.id
  const isOpened = openedKeepAliveMinapps.some((item) => item.id === app.id)
  const { isTopNavbar } = useNavbarPosition()
  const [proxyModalOpen, setProxyModalOpen] = useState(false)
  const [proxyForm] = Form.useForm<{
    proxyMode: 'inherit' | 'custom' | 'system' | 'direct'
    proxyUrl?: string
    proxyBypassRules?: string
  }>()

  const handleClick = () => {
    if (isTopNavbar) {
      // 顶部导航栏：导航到小程序页面
      navigate(`/apps/${app.id}`)
    } else {
      // 侧边导航栏：保持原有弹窗行为
      openMinappKeepAlive(app)
    }
    onClick?.()
  }

  const menuItems: MenuProps['items'] = [
    {
      key: 'togglePin',
      label: isPinned
        ? isTopNavbar
          ? t('minapp.remove_from_launchpad')
          : t('minapp.remove_from_sidebar')
        : isTopNavbar
          ? t('minapp.add_to_launchpad')
          : t('minapp.add_to_sidebar'),
      onClick: () => {
        const newPinned = isPinned ? pinned.filter((item) => item.id !== app.id) : [...(pinned || []), app]
        updatePinnedMinapps(newPinned)
      }
    },
    {
      key: 'proxySettings',
      label: '代理设置',
      onClick: () => {
        proxyForm.setFieldsValue({
          proxyMode: app.proxyMode || 'inherit',
          proxyUrl: app.proxyUrl,
          proxyBypassRules: app.proxyBypassRules
        })
        setProxyModalOpen(true)
      }
    },
    {
      key: 'hide',
      label: t('minapp.sidebar.hide.title'),
      onClick: () => {
        const newMinapps = minapps.filter((item) => item.id !== app.id)
        updateMinapps(newMinapps)
        const newDisabled = [...(disabled || []), app]
        updateDisabledMinapps(newDisabled)
        const newPinned = pinned.filter((item) => item.id !== app.id)
        updatePinnedMinapps(newPinned)
        // 更新 openedKeepAliveMinapps
        const newOpenedKeepAliveMinapps = openedKeepAliveMinapps.filter((item) => item.id !== app.id)
        dispatch(setOpenedKeepAliveMinapps(newOpenedKeepAliveMinapps))
      }
    },
    ...(app.type === 'Custom'
      ? [
          {
            key: 'removeCustom',
            label: t('minapp.sidebar.remove_custom.title'),
            danger: true,
            onClick: async () => {
              try {
                const content = await window.api.file.read('custom-minapps.json')
                const customApps = JSON.parse(content)
                const updatedApps = customApps.filter((customApp: MinAppType) => customApp.id !== app.id)
                await window.api.file.writeWithId('custom-minapps.json', JSON.stringify(updatedApps, null, 2))
                window.toast.success(t('settings.miniapps.custom.remove_success'))
                const reloadedApps = await reloadAllMinApps()
                updateAllMinApps(reloadedApps)
                updateMinapps(minapps.filter((item) => item.id !== app.id))
                updatePinnedMinapps(pinned.filter((item) => item.id !== app.id))
                updateDisabledMinapps(disabled.filter((item) => item.id !== app.id))
              } catch (error) {
                window.toast.error(t('settings.miniapps.custom.remove_error'))
                logger.error('Failed to remove custom mini app:', error as Error)
              }
            }
          }
        ]
      : [])
  ]

  if (!shouldShow) {
    return null
  }

  const handleSaveProxySettings = async () => {
    try {
      const values = await proxyForm.validateFields()

      if (values.proxyMode === 'custom' && values.proxyUrl && !isValidProxyUrl(values.proxyUrl)) {
        window.toast.error(t('message.error.invalid.proxy.url'))
        return
      }

      await upsertMinAppProxyOverride(app.id, {
        proxyMode: values.proxyMode,
        proxyUrl: values.proxyMode === 'custom' ? values.proxyUrl?.trim() : undefined,
        proxyBypassRules: values.proxyMode === 'custom' ? values.proxyBypassRules?.trim() : undefined
      })

      const reloadedApps = await reloadAllMinApps()
      updateAllMinApps(reloadedApps)
      updateMinapps([...minapps])

      setProxyModalOpen(false)
      window.toast.success('小程序代理设置已保存，重新打开该小程序后生效')
    } catch (error) {
      logger.error('Failed to save minapp proxy settings:', error as Error)
      window.toast.error('保存代理设置失败')
    }
  }

  return (
    <>
      <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']}>
        <Container onClick={handleClick}>
          <IconContainer>
            <MinAppIcon size={size} app={app} />
            {isOpened && (
              <StyledIndicator>
                <IndicatorLight color="#22c55e" size={6} animation={!isActive} />
              </StyledIndicator>
            )}
          </IconContainer>
          <AppTitle>{isLast ? t('settings.miniapps.custom.title') : app.nameKey ? t(app.nameKey) : app.name}</AppTitle>
        </Container>
      </Dropdown>
      <Modal
        title={`代理设置 - ${app.nameKey ? t(app.nameKey) : app.name}`}
        open={proxyModalOpen}
        onCancel={() => setProxyModalOpen(false)}
        onOk={handleSaveProxySettings}
        okText="保存"
        cancelText="取消"
        destroyOnClose>
        <Form layout="vertical" form={proxyForm} initialValues={{ proxyMode: app.proxyMode || 'inherit' }}>
          <Form.Item name="proxyMode" label="代理模式" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio value="inherit">跟随全局代理</Radio>
              <Radio value="custom">自定义代理</Radio>
              <Radio value="system">使用系统代理</Radio>
              <Radio value="direct">不使用代理</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.proxyMode !== next.proxyMode}>
            {({ getFieldValue }) =>
              getFieldValue('proxyMode') === 'custom' ? (
                <>
                  <Form.Item
                    name="proxyUrl"
                    label="代理地址"
                    rules={[{ required: true, message: '请输入代理地址（支持 http/socks）' }]}>
                    <Input placeholder="例如：http://127.0.0.1:7890 或 socks5://127.0.0.1:1080" />
                  </Form.Item>
                  <Form.Item name="proxyBypassRules" label="绕过规则（可选）">
                    <Input placeholder="例如：localhost,127.0.0.1,*.local" />
                  </Form.Item>
                </>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  overflow: hidden;
  min-height: 85px;
`

const IconContainer = styled.div`
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
`

const StyledIndicator = styled.div`
  position: absolute;
  bottom: -2px;
  right: -2px;
  padding: 2px;
  background: var(--color-background);
  border-radius: 50%;
`

const AppTitle = styled.div`
  font-size: 12px;
  margin-top: 5px;
  color: var(--color-text-soft);
  text-align: center;
  user-select: none;
  white-space: nowrap;
`

export default MinApp
