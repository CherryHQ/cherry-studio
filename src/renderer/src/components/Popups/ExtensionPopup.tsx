import { ChromeOutlined, ReloadOutlined } from '@ant-design/icons'
import ExtensionIcon from '@renderer/components/Icons/ExtensionIcon'
import { Center, VStack } from '@renderer/components/Layout'
import Scrollbar from '@renderer/components/Scrollbar'
import { useExtensions } from '@renderer/hooks/useExtensions'
import { Extension } from '@shared/config/types'
import { Button, Empty, List, Popover, Typography } from 'antd'
import { isEmpty } from 'lodash'
import { FC, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const { Text } = Typography

interface Props {
  children: React.ReactNode
}

const ExtensionPopup: FC<Props> = ({ children }) => {
  const [open, setOpen] = useState(false)
  const { extensions, loading, error, openPopup, updateExtensions, openChromeStore } = useExtensions()
  const { t } = useTranslation()
  const clickContentRef = useRef<HTMLDivElement>(null)

  // Filter out developer tools extensions (Redux DevTools)
  const filteredExtensions = extensions.filter((ext) => !ext.isDev)

  useHotkeys('esc', () => {
    setOpen(false)
  })

  const handleClose = () => {
    setOpen(false)
  }

  const [maxHeight, setMaxHeight] = useState(window.innerHeight - 100)

  useEffect(() => {
    const handleResize = () => {
      setMaxHeight(window.innerHeight - 100)
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  const handlePopup = async (extensionId: string) => {
    const rect = clickContentRef.current?.getBoundingClientRect()
    if (rect) {
      openPopup(extensionId, {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      })
    }
    console.log('[ExtensionPopup] Popup opened for extension:', extensionId)
  }

  const handleOpenChromeStore = () => {
    openChromeStore()
    handleClose()
  }

  const content = (
    <PopoverContent maxHeight={maxHeight}>
      <ExtensionsContainer>
        {loading ? (
          <Center>
            <Text>{t('common.loading', 'Loading...')}</Text>
          </Center>
        ) : error ? (
          <Center>
            <VStack alignItems="center" gap={8}>
              <Text type="danger">{error}</Text>
              <Button onClick={updateExtensions} icon={<ReloadOutlined />}>
                {t('extensions.retry', 'Retry')}
              </Button>
            </VStack>
          </Center>
        ) : isEmpty(filteredExtensions) ? (
          <Center>
            <VStack alignItems="center" gap={8}>
              <Empty description={t('extensions.no_extensions', 'No extensions installed')} />
              <Button type="primary" icon={<ChromeOutlined />} onClick={handleOpenChromeStore}>
                {t('extensions.browse_store', 'Browse Chrome Web Store')}
              </Button>
            </VStack>
          </Center>
        ) : (
          <List
            dataSource={filteredExtensions}
            renderItem={(extension: Extension) => (
              <ExtensionItem key={extension.id}>
                <ExtensionIconWrapper ref={clickContentRef} onClick={() => handlePopup(extension.id)}>
                  {extension.icon ? (
                    <ExtensionIcon src={extension.icon} size={24} shape="square" />
                  ) : (
                    <div className="placeholder">{extension.name.charAt(0)}</div>
                  )}
                </ExtensionIconWrapper>
                <ExtensionName>{extension.name}</ExtensionName>
              </ExtensionItem>
            )}
          />
        )}
      </ExtensionsContainer>
    </PopoverContent>
  )

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      content={content}
      trigger="click"
      placement="bottomRight"
      styles={{ body: { padding: 0, borderRadius: '8px', overflow: 'hidden' } }}>
      {children}
    </Popover>
  )
}

const PopoverContent = styled(Scrollbar)<{ maxHeight: number }>`
  max-height: ${(props) => props.maxHeight}px;
  width: 240px;
  overflow-y: auto;
  border-radius: 8px;
`

const ExtensionName = styled.div`
  margin-left: 12px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-1);
`

const ExtensionsContainer = styled.div`
  padding: 12px;
`

const ExtensionItem = styled(List.Item)`
  padding: 10px 16px;
  display: flex;
  align-items: center;
  cursor: pointer;
  border-radius: 6px;

  &:hover {
    background-color: var(--color-background-hover);
  }
`

const ExtensionIconWrapper = styled.div`
  width: 24px;
  height: 24px;
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .placeholder {
    font-size: 12px;
    font-weight: bold;
    color: var(--color-text-1);
  }
`

export default ExtensionPopup
