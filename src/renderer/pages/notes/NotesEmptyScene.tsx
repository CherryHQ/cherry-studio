import { CodeXml, Heading1, ListChecks, NotebookPen, TextQuote } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { EmptyStateScene, SceneCaret, SceneFloat, ScenePanel, SceneRow } from '@cherrystudio/ui'

const COMMANDS = [
  { icon: Heading1, key: 'richEditor.commands.heading1.title' },
  { icon: ListChecks, key: 'richEditor.commands.taskList.title' },
  { icon: CodeXml, key: 'richEditor.commands.codeBlock.title' },
  { icon: TextQuote, key: 'richEditor.commands.blockquote.title' }
] as const

/** No note open: an untitled page with the caret in its title and the slash-command menu. */
export function NotesEmptyScene() {
  const { t } = useTranslation()
  const untitled = t('notes.untitled_note')
  return (
    <EmptyStateScene
      accent={7}
      sprites={[
        { x: 265, y: 3, color: 2, shape: 'cross', tilt: 10 },
        { x: 21, y: 109, color: 4, shape: 'corner', tilt: -12 },
        { x: 278, y: 143, color: 7, shape: 'checker', tilt: 8 }
      ]}>
      <ScenePanel className="absolute top-[13px] left-[39px] h-[220px] w-[234px]">
        <div className="flex h-[29px] shrink-0 items-center gap-[5px] border-b border-border-subtle px-[13px] text-[7px] text-foreground-tertiary">
          <NotebookPen size={10} strokeWidth={1.8} className="shrink-0" />
          <span className="truncate">
            {t('notes.title')} / {untitled}
          </span>
        </div>
        <div className="flex flex-col gap-[3px] px-[16px] pt-[10px]">
          <div className="flex items-center gap-[3px]">
            <SceneCaret className="h-[18px] w-[1.6px]" />
            <span className="truncate text-[16px] font-semibold text-foreground-tertiary">{untitled}</span>
          </div>
          <span className="truncate text-[7.5px] text-foreground-tertiary">{t('richEditor.placeholder')}</span>
        </div>
      </ScenePanel>
      <SceneFloat className="top-[94px] left-[62px]">
        <ScenePanel className="w-[130px] gap-[2px] rounded-[10px] p-[4px]">
          {COMMANDS.map(({ icon, key }, index) => (
            <SceneRow
              key={key}
              icon={icon}
              label={t(key)}
              meta={index === 0 ? '↵' : undefined}
              className={index === 0 ? 'bg-muted text-foreground' : undefined}
            />
          ))}
        </ScenePanel>
      </SceneFloat>
    </EmptyStateScene>
  )
}
