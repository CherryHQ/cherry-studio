import { loggerService } from '@logger'
import { NavbarHeader } from '@renderer/components/app/Navbar'
import { useNavbarPosition } from '@renderer/hooks/useSettings'
import { useShowWorkspace } from '@renderer/hooks/useStore'
import { findNodeInTree, getNodePathArray } from '@renderer/services/NotesService'
import { useAppSelector } from '@renderer/store'
import { selectActiveNodeId } from '@renderer/store/note'
import { Breadcrumb, BreadcrumbProps, Tooltip } from 'antd'
import { t } from 'i18next'
import { PanelLeftClose, PanelRightClose } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import styled from 'styled-components'

const logger = loggerService.withContext('HeaderNavbar')

const HeaderNavbar = ({ notesTree }) => {
  const { isTopNavbar } = useNavbarPosition()
  const { showWorkspace, toggleShowWorkspace } = useShowWorkspace()
  const activeNodeId = useAppSelector(selectActiveNodeId)
  const [breadcrumbItems, setBreadcrumbItems] = useState<Required<BreadcrumbProps>['items']>([])

  const handleToggleShowWorkspace = useCallback(() => {
    toggleShowWorkspace()
  }, [toggleShowWorkspace])

  // 构建面包屑路径
  useEffect(() => {
    const buildBreadcrumbPath = async () => {
      const items: Required<BreadcrumbProps>['items'] = []

      if (!activeNodeId) {
        setBreadcrumbItems(items)
        return
      }

      try {
        const activeNode = findNodeInTree(notesTree, activeNodeId)
        if (!activeNode) {
          setBreadcrumbItems(items)
          return
        }

        const pathNodes = await getNodePathArray(notesTree, activeNodeId)
        logger.debug('buildBreadcrumbPath', pathNodes)
        pathNodes.forEach((node) => {
          items.push({
            key: node.id,
            title: node.name
          })
        })

        setBreadcrumbItems(items)
      } catch (error) {
        setBreadcrumbItems(items)
      }
    }

    buildBreadcrumbPath()
  }, [activeNodeId, notesTree])

  return (
    <NavbarHeader className="home-navbar">
      <NavbarWrapper>
        <LeftSection>
          {isTopNavbar && showWorkspace && (
            <Tooltip title={t('navbar.hide_sidebar')} mouseEnterDelay={0.8}>
              <NavbarIcon onClick={handleToggleShowWorkspace}>
                <PanelLeftClose size={18} />
              </NavbarIcon>
            </Tooltip>
          )}
          {isTopNavbar && !showWorkspace && (
            <Tooltip title={t('navbar.show_sidebar')} mouseEnterDelay={0.8}>
              <NavbarIcon onClick={handleToggleShowWorkspace}>
                <PanelRightClose size={18} />
              </NavbarIcon>
            </Tooltip>
          )}
        </LeftSection>
        <CenterSection>
          <Breadcrumb items={breadcrumbItems} />
        </CenterSection>
        <RightSection />
      </NavbarWrapper>
    </NavbarHeader>
  )
}

const NavbarWrapper = styled.div`
  display: flex;
  width: 100%;
  position: relative;
`

const LeftSection = styled.div`
  display: flex;
  align-items: center;
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
`

const CenterSection = styled.div`
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
`

const RightSection = styled.div`
  display: flex;
  align-items: center;
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 1;
`

export const NavbarIcon = styled.div`
  -webkit-app-region: none;
  border-radius: 8px;
  height: 30px;
  padding: 0 7px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  transition: all 0.2s ease-in-out;
  cursor: pointer;
  .iconfont {
    font-size: 18px;
    color: var(--color-icon);
    &.icon-a-addchat {
      font-size: 20px;
    }
    &.icon-a-darkmode {
      font-size: 20px;
    }
    &.icon-appstore {
      font-size: 20px;
    }
  }
  .anticon {
    color: var(--color-icon);
    font-size: 16px;
  }
  &:hover {
    background-color: var(--color-background-mute);
    color: var(--color-icon-white);
  }
`

export default HeaderNavbar
