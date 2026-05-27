import { PlusOutlined } from '@ant-design/icons'
import { Button } from '@cherrystudio/ui'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import type { ComponentProps, FC, ReactNode } from 'react'

interface PaintingPageShellProps {
  title: ReactNode
  addButtonLabel: ReactNode
  onAddPainting?: () => unknown
  addButtonVariant?: ComponentProps<typeof Button>['variant']
  contentClassName?: string
  navbarRightClassName?: string
  settingsClassName?: string
  mainClassName?: string
  settings: ReactNode
  artboard: ReactNode
  promptBar: ReactNode
  history: ReactNode
}

const PaintingPageShell: FC<PaintingPageShellProps> = ({
  title,
  addButtonLabel,
  onAddPainting,
  addButtonVariant,
  contentClassName = 'flex h-full flex-1 flex-row overflow-hidden bg-background',
  navbarRightClassName,
  settingsClassName = 'flex h-full max-w-(--assistants-width) flex-1 flex-col bg-background p-5 [border-right:0.5px_solid_var(--color-border)]',
  mainClassName = 'flex h-full flex-1 flex-col bg-background',
  settings,
  artboard,
  promptBar,
  history
}) => {
  return (
    <div className="flex h-full flex-1 flex-col">
      <Navbar>
        <NavbarCenter className="border-r-0">{title}</NavbarCenter>
        {isMac && onAddPainting && (
          <NavbarRight className={navbarRightClassName}>
            <Button size="sm" className="nodrag" variant={addButtonVariant} onClick={onAddPainting}>
              <PlusOutlined />
              {addButtonLabel}
            </Button>
          </NavbarRight>
        )}
      </Navbar>
      <div id="content-container" className={contentClassName}>
        <Scrollbar className={settingsClassName}>{settings}</Scrollbar>
        <div className={mainClassName}>
          {artboard}
          {promptBar}
        </div>
        {history}
      </div>
    </div>
  )
}

export default PaintingPageShell
