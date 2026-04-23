import { Button, Sortable, useDndReorder } from '@cherrystudio/ui'
import CollapsibleSearchBar from '@renderer/components/CollapsibleSearchBar'
import { EditIcon } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { matchKeywordsInString } from '@renderer/utils/match'
import type { CreateMCPServerDto } from '@shared/data/api/schemas/mcpServers'
import type { MCPServer } from '@shared/data/types/mcpServer'
import { useNavigate } from '@tanstack/react-router'
import { Dropdown, Empty } from 'antd'
import { Plus } from 'lucide-react'
import type { FC } from 'react'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingTitle } from '..'
import AddMcpServerModal from './AddMcpServerModal'
import EditMcpJsonPopup from './EditMcpJsonPopup'
import InstallNpxUv from './InstallNpxUv'
import McpServerCard from './McpServerCard'

const McpServersList: FC = () => {
  const { mcpServers, addMCPServer, reorderMCPServers } = useMCPServers()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isAddModalVisible, setIsAddModalVisible] = useState(false)
  const [modalType, setModalType] = useState<'json' | 'dxt'>('json')

  const [searchText, _setSearchText] = useState('')

  const setSearchText = useCallback((text: string) => {
    startTransition(() => {
      _setSearchText(text)
    })
  }, [])

  const filteredMcpServers = useMemo(() => {
    if (!searchText.trim()) return mcpServers

    const keywords = searchText.toLowerCase().split(/\s+/).filter(Boolean)

    return mcpServers.filter((server) => {
      const searchTarget = `${server.name} ${server.description} ${server.tags?.join(' ')}`
      return matchKeywordsInString(keywords, searchTarget)
    })
  }, [mcpServers, searchText])

  const { onSortEnd } = useDndReorder({
    originalList: mcpServers,
    filteredList: filteredMcpServers,
    onUpdate: reorderMCPServers,
    itemKey: 'id'
  })

  const scrollRef = useRef<HTMLDivElement>(null)

  // 简单的滚动位置记忆
  useEffect(() => {
    // 恢复滚动位置
    const savedScroll = sessionStorage.getItem('mcp-list-scroll')
    if (savedScroll && scrollRef.current) {
      scrollRef.current.scrollTop = Number(savedScroll)
    }

    // 保存滚动位置
    const handleScroll = () => {
      if (scrollRef.current) {
        sessionStorage.setItem('mcp-list-scroll', String(scrollRef.current.scrollTop))
      }
    }

    const container = scrollRef.current
    container?.addEventListener('scroll', handleScroll)
    return () => container?.removeEventListener('scroll', handleScroll)
  }, [])

  const onAddMcpServer = useCallback(async () => {
    const newServer = await addMCPServer({
      name: t('settings.mcp.newServer'),
      description: '',
      baseUrl: '',
      command: '',
      args: [],
      env: {},
      isActive: false
    })
    void navigate({ to: `/settings/mcp/settings/${newServer.id}` })
    window.toast.success(t('settings.mcp.addSuccess'))
  }, [addMCPServer, navigate, t])

  const handleAddServerSuccess = useCallback(
    async (dto: CreateMCPServerDto): Promise<MCPServer> => {
      const created = await addMCPServer(dto)
      setIsAddModalVisible(false)
      window.toast.success(t('settings.mcp.addSuccess'))
      return created
    },
    [addMCPServer, t]
  )

  const menuItems = useMemo(
    () => [
      {
        key: 'manual',
        label: t('settings.mcp.addServer.create'),
        onClick: () => {
          void onAddMcpServer()
        }
      },
      {
        key: 'json',
        label: t('settings.mcp.addServer.importFrom.json'),
        onClick: () => {
          setModalType('json')
          setIsAddModalVisible(true)
        }
      },
      {
        key: 'dxt',
        label: t('settings.mcp.addServer.importFrom.dxt'),
        onClick: () => {
          setModalType('dxt')
          setIsAddModalVisible(true)
        }
      }
    ],
    [onAddMcpServer, t]
  )

  return (
    <Scrollbar
      ref={scrollRef}
      className="flex h-[calc(100vh-var(--navbar-height))] w-full flex-1 flex-col gap-[15px] overflow-hidden overflow-y-auto p-5 pt-[15px]">
      <div className="flex w-full items-center justify-between [&_h2]:m-0 [&_h2]:text-[22px]">
        <SettingTitle style={{ gap: 6 }}>
          <span>{t('settings.mcp.newServer')}</span>
          <CollapsibleSearchBar
            onSearch={setSearchText}
            placeholder={t('settings.mcp.search.placeholder')}
            tooltip={t('settings.mcp.search.tooltip')}
            style={{ borderRadius: 20 }}
          />
        </SettingTitle>
        <div className="flex items-center gap-2">
          <InstallNpxUv mini />
          <Button className="rounded-full" onClick={() => EditMcpJsonPopup.show()}>
            <EditIcon size={14} />
            {t('common.edit')}
          </Button>
          <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
            <Button className="rounded-full">
              <Plus size={16} />
              {t('common.add')}
            </Button>
          </Dropdown>
        </div>
      </div>
      <Sortable
        items={filteredMcpServers}
        itemKey="id"
        onSortEnd={onSortEnd}
        layout="list"
        horizontal={false}
        listStyle={{ display: 'flex', flexDirection: 'column', width: '100%' }}
        itemStyle={{ width: '100%' }}
        gap="12px"
        restrictions={{ scrollableAncestor: true }}
        useDragOverlay
        showGhost
        renderItem={(server) => (
          <McpServerCard server={server} onEdit={() => navigate({ to: `/settings/mcp/settings/${server.id}` })} />
        )}
      />
      {(mcpServers.length === 0 || filteredMcpServers.length === 0) && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={mcpServers.length === 0 ? t('settings.mcp.noServers') : t('common.no_results')}
          style={{ marginTop: 20 }}
        />
      )}

      <AddMcpServerModal
        visible={isAddModalVisible}
        onClose={() => setIsAddModalVisible(false)}
        onSuccess={handleAddServerSuccess}
        existingServers={mcpServers} // 傳遞現有的伺服器列表
        initialImportMethod={modalType}
      />
    </Scrollbar>
  )
}

export default McpServersList
