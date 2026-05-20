import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import Scrollbar from '@renderer/components/Scrollbar'
import { useCollaborationClient } from '@renderer/hooks/collaboration/useCollaborationClient'
import { useApiServer } from '@renderer/hooks/useApiServer'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Empty, Spin, Tag } from 'antd'
import { Boxes, MessageSquarePlus, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const CollaborationPage = () => {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const client = useCollaborationClient()
  const { apiServerConfig, apiServerRunning, apiServerLoading } = useApiServer()
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)

  const { data: workspaces = [], isLoading: workspacesLoading } = useQuery({
    queryKey: ['collaboration', 'workspaces'],
    queryFn: () => client.listWorkspaces(),
    enabled: apiServerConfig.enabled && apiServerRunning
  })

  useEffect(() => {
    if (!selectedWorkspaceId && workspaces.length > 0) {
      setSelectedWorkspaceId(workspaces[0].id)
    }
  }, [selectedWorkspaceId, workspaces])

  const { data: rooms = [], isLoading: roomsLoading } = useQuery({
    queryKey: ['collaboration', 'rooms', selectedWorkspaceId],
    queryFn: () => client.listRooms(selectedWorkspaceId!),
    enabled: Boolean(selectedWorkspaceId) && apiServerConfig.enabled && apiServerRunning
  })

  useEffect(() => {
    if (!rooms.length) {
      setSelectedRoomId(null)
      return
    }
    if (!selectedRoomId || !rooms.some((room) => room.id === selectedRoomId)) {
      setSelectedRoomId(rooms[0].id)
    }
  }, [rooms, selectedRoomId])

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces]
  )
  const selectedRoom = useMemo(() => rooms.find((room) => room.id === selectedRoomId) ?? null, [rooms, selectedRoomId])

  const createWorkspace = async () => {
    const name = await PromptPopup.show({
      title: 'Create Collaboration Workspace',
      message: 'Name the workspace that should hold rooms and shared worker state.',
      defaultValue: 'Main Workspace'
    })
    if (!name?.trim()) return
    const workspace = await client.createWorkspace({ name: name.trim() })
    await qc.invalidateQueries({ queryKey: ['collaboration', 'workspaces'] })
    setSelectedWorkspaceId(workspace.id)
  }

  const createRoom = async () => {
    if (!selectedWorkspaceId) return
    const title = await PromptPopup.show({
      title: 'Create Collaboration Room',
      message: 'Give this room a task or project name.',
      defaultValue: 'New Room'
    })
    if (!title?.trim()) return
    const room = await client.createRoom({ workspaceId: selectedWorkspaceId, title: title.trim() })
    await qc.invalidateQueries({ queryKey: ['collaboration', 'rooms', selectedWorkspaceId] })
    setSelectedRoomId(room.id)
  }

  if (!apiServerConfig.enabled) {
    return (
      <PageContainer>
        <Navbar>
          <NavbarCenter style={{ borderRight: 'none' }}>{t('collaboration.title', 'Collaboration')}</NavbarCenter>
        </Navbar>
        <CenteredBody>
          <Alert type="info" message="Enable the API server to use collaboration rooms." />
        </CenteredBody>
      </PageContainer>
    )
  }

  if (!apiServerLoading && !apiServerRunning) {
    return (
      <PageContainer>
        <Navbar>
          <NavbarCenter style={{ borderRight: 'none' }}>{t('collaboration.title', 'Collaboration')}</NavbarCenter>
        </Navbar>
        <CenteredBody>
          <Alert type="warning" message="The API server is not running yet." />
        </CenteredBody>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('collaboration.title', 'Collaboration')}</NavbarCenter>
      </Navbar>
      <ContentContainer id="content-container">
        <WorkspaceSidebar>
          <SidebarHeader>
            <span>Workspaces</span>
            <Button size="small" icon={<Plus size={14} />} onClick={() => void createWorkspace()} />
          </SidebarHeader>
          {workspacesLoading ? (
            <LoadingBlock>
              <Spin size="small" />
            </LoadingBlock>
          ) : workspaces.length === 0 ? (
            <EmptyState>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No collaboration workspaces yet" />
              <Button type="primary" onClick={() => void createWorkspace()}>
                Create Workspace
              </Button>
            </EmptyState>
          ) : (
            workspaces.map((workspace) => (
              <WorkspaceItem
                key={workspace.id}
                $active={workspace.id === selectedWorkspaceId}
                onClick={() => setSelectedWorkspaceId(workspace.id)}>
                <div className="title">{workspace.name}</div>
                <div className="meta">{workspace.rootPaths.length} paths</div>
              </WorkspaceItem>
            ))
          )}
        </WorkspaceSidebar>

        <RoomsColumn>
          <SidebarHeader>
            <span>{selectedWorkspace?.name ?? 'Rooms'}</span>
            <Button
              size="small"
              icon={<MessageSquarePlus size={14} />}
              disabled={!selectedWorkspaceId}
              onClick={() => void createRoom()}
            />
          </SidebarHeader>
          {selectedWorkspaceId && roomsLoading ? (
            <LoadingBlock>
              <Spin size="small" />
            </LoadingBlock>
          ) : rooms.length === 0 ? (
            <EmptyState>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No rooms in this workspace" />
              {selectedWorkspaceId && (
                <Button onClick={() => void createRoom()} type="primary">
                  Create Room
                </Button>
              )}
            </EmptyState>
          ) : (
            rooms.map((room) => (
              <RoomCard key={room.id} $active={room.id === selectedRoomId} onClick={() => setSelectedRoomId(room.id)}>
                <div className="top">
                  <div className="title">{room.title}</div>
                  <Tag>{room.status}</Tag>
                </div>
                {room.description && <div className="description">{room.description}</div>}
                <div className="meta">Last activity {new Date(room.lastActivityAt).toLocaleString()}</div>
              </RoomCard>
            ))
          )}
        </RoomsColumn>

        <RoomDetailPane>
          {!selectedRoom ? (
            <CenteredBody>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="Select a room to continue building the collaboration flow"
              />
            </CenteredBody>
          ) : (
            <DetailContent>
              <HeroIcon>
                <Boxes size={20} />
              </HeroIcon>
              <h2>{selectedRoom.title}</h2>
              <Tag>{selectedRoom.status}</Tag>
              <p>
                This is the new collaboration surface. The next pass will attach message timeline, worker runs, and task
                publishing here.
              </p>
              <DetailGrid>
                <div>
                  <span className="label">Workspace</span>
                  <span>{selectedWorkspace?.name ?? 'Unknown'}</span>
                </div>
                <div>
                  <span className="label">Assigned Worker</span>
                  <span>{selectedRoom.assignedAgentId ?? 'Unassigned'}</span>
                </div>
                <div>
                  <span className="label">Created</span>
                  <span>{new Date(selectedRoom.createdAt).toLocaleString()}</span>
                </div>
                <div>
                  <span className="label">Last Activity</span>
                  <span>{new Date(selectedRoom.lastActivityAt).toLocaleString()}</span>
                </div>
              </DetailGrid>
            </DetailContent>
          )}
        </RoomDetailPane>
      </ContentContainer>
    </PageContainer>
  )
}

const PageContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: calc(100vh - var(--navbar-height));
`

const ContentContainer = styled.div`
  display: grid;
  grid-template-columns: 240px 320px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
`

const WorkspaceSidebar = styled(Scrollbar)`
  border-right: 0.5px solid var(--color-border);
  padding: 12px;
`

const RoomsColumn = styled(Scrollbar)`
  border-right: 0.5px solid var(--color-border);
  padding: 12px;
`

const RoomDetailPane = styled(Scrollbar)`
  padding: 24px;
`

const SidebarHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  font-weight: 600;
`

const WorkspaceItem = styled.button<{ $active: boolean }>`
  width: 100%;
  text-align: left;
  border: 0.5px solid ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-border)')};
  background: ${({ $active }) => ($active ? 'var(--color-background-soft)' : 'transparent')};
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 8px;
  cursor: pointer;

  .title {
    font-weight: 600;
  }

  .meta {
    margin-top: 4px;
    color: var(--color-text-3);
    font-size: 12px;
  }
`

const RoomCard = styled.button<{ $active: boolean }>`
  width: 100%;
  text-align: left;
  border: 0.5px solid ${({ $active }) => ($active ? 'var(--color-primary)' : 'var(--color-border)')};
  background: ${({ $active }) => ($active ? 'var(--color-background-soft)' : 'transparent')};
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 10px;
  cursor: pointer;

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .title {
    font-weight: 600;
    color: var(--color-text-1);
  }

  .description {
    margin-top: 8px;
    color: var(--color-text-2);
    font-size: 13px;
  }

  .meta {
    margin-top: 10px;
    color: var(--color-text-3);
    font-size: 12px;
  }
`

const EmptyState = styled.div`
  display: flex;
  min-height: 240px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
`

const CenteredBody = styled.div`
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 24px;
`

const LoadingBlock = styled.div`
  display: flex;
  min-height: 120px;
  align-items: center;
  justify-content: center;
`

const DetailContent = styled.div`
  display: flex;
  max-width: 720px;
  flex-direction: column;
  gap: 12px;

  h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 700;
    color: var(--color-text-1);
  }

  p {
    color: var(--color-text-2);
    line-height: 1.6;
  }
`

const HeroIcon = styled.div`
  display: flex;
  height: 40px;
  width: 40px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: var(--color-background-soft);
  color: var(--color-primary);
`

const DetailGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 8px;

  > div {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    border-radius: 12px;
    background: var(--color-background-soft);
  }

  .label {
    color: var(--color-text-3);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
`

export default CollaborationPage
