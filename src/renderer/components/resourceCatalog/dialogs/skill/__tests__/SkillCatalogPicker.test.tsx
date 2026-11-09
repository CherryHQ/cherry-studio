import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { Dialog, DialogContent, DialogTitle } from '@cherrystudio/ui'
import type { InstalledSkill } from '@shared/data/types/agent'

import { SkillCatalogPicker } from '../SkillCatalogPicker'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('../ImportSkillDialog', () => ({
  ImportSkillDialog: () => null
}))

vi.mock('../SkillMarketplaceDialog', () => ({
  SkillMarketplaceDialog: () => null
}))

vi.mock('../SystemSkillDialog', () => ({
  SystemSkillDialog: () => null
}))

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {}
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
  HTMLElement.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
})

function SkillPickerDialog({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null)

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent ref={setPortalContainer} aria-describedby={undefined}>
        <DialogTitle>Edit Agent</DialogTitle>
        <div data-testid="dialog-blank-area">Blank area</div>
        <SkillCatalogPicker
          mode="edit"
          skills={[]}
          loading={false}
          selectedIds={[]}
          onSelectedIdsChange={() => {}}
          emptyLabel="No skills"
          portalContainer={portalContainer}
        />
      </DialogContent>
    </Dialog>
  )
}

describe('SkillCatalogPicker', () => {
  it('preserves the creation checkbox state when the note is clicked or focused', async () => {
    const user = userEvent.setup()
    const skills = [
      { id: 'one', name: 'Noted local skill', source: 'local', isGlobalEnabled: true, note: 'For invoice review' }
    ] as InstalledSkill[]

    function StatefulPicker() {
      const [selectedIds, setSelectedIds] = useState<string[]>([])
      return (
        <SkillCatalogPicker
          mode="create"
          skills={skills}
          loading={false}
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          emptyLabel="Empty"
          portalContainer={null}
        />
      )
    }

    render(<StatefulPicker />)
    const checkbox = screen.getByRole('checkbox', { name: 'Noted local skill' })
    const note = screen.getByText('For invoice review')
    expect(checkbox).not.toBeChecked()

    await user.click(note)
    expect(checkbox).not.toBeChecked()

    await user.tab({ shift: true })
    expect(checkbox).toHaveFocus()
    await user.tab()
    expect(note).toHaveFocus()
    expect(checkbox).not.toBeChecked()

    await user.click(checkbox)
    expect(checkbox).toBeChecked()
    await user.tab()
    expect(note).toHaveFocus()
    expect(checkbox).toBeChecked()
    await user.click(note)
    expect(checkbox).toBeChecked()
  })

  it.each(['create', 'edit'] as const)('shows a user note in %s without changing selection', async (mode) => {
    const user = userEvent.setup()
    const onSelectedIdsChange = vi.fn()
    const skills = [
      { id: 'one', name: 'Noted', source: 'builtin', isGlobalEnabled: true, note: 'A long reminder for this skill' },
      { id: 'two', name: 'Plain', source: 'local', isGlobalEnabled: true, note: null }
    ] as InstalledSkill[]
    render(
      <SkillCatalogPicker
        mode={mode}
        skills={skills}
        loading={false}
        selectedIds={[]}
        onSelectedIdsChange={onSelectedIdsChange}
        emptyLabel="Empty"
        portalContainer={null}
      />
    )
    const note = screen.getByText('A long reminder for this skill')
    expect(note).toBeVisible()
    expect(screen.getByText('Plain').parentElement?.querySelector('[tabindex]')).toBeNull()
    await user.click(note)
    expect(onSelectedIdsChange).not.toHaveBeenCalled()
  })
  it('hides globally disabled skills from Agent selection and bulk enablement', async () => {
    const user = userEvent.setup()
    const onSelectedIdsChange = vi.fn()
    const enabledSkill = {
      id: 'enabled-skill',
      name: 'Enabled Skill',
      source: 'local',
      isGlobalEnabled: true
    } as InstalledSkill
    const disabledSkill = {
      id: 'disabled-skill',
      name: 'Disabled Skill',
      source: 'local',
      isGlobalEnabled: false
    } as InstalledSkill

    render(
      <SkillCatalogPicker
        mode="edit"
        skills={[enabledSkill, disabledSkill]}
        loading={false}
        selectedIds={[]}
        onSelectedIdsChange={onSelectedIdsChange}
        emptyLabel="No skills"
        portalContainer={null}
      />
    )

    expect(screen.getByText('Enabled Skill')).toBeInTheDocument()
    expect(screen.queryByText('Disabled Skill')).not.toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'library.config.agent.section.tools.skills_enable_all' }))
    expect(onSelectedIdsChange).toHaveBeenCalledWith(['enabled-skill'])
  })

  it('preserves selected globally disabled skills when toggling all visible skills', async () => {
    const user = userEvent.setup()
    const onSelectedIdsChange = vi.fn()
    const enabledSkill = {
      id: 'enabled-skill',
      name: 'Enabled Skill',
      source: 'local',
      isGlobalEnabled: true
    } as InstalledSkill
    const disabledSkill = {
      id: 'disabled-skill',
      name: 'Disabled Skill',
      source: 'local',
      isGlobalEnabled: false
    } as InstalledSkill

    function StatefulPicker() {
      const [selectedIds, setSelectedIds] = useState(['enabled-skill', 'disabled-skill'])

      return (
        <SkillCatalogPicker
          mode="edit"
          skills={[enabledSkill, disabledSkill]}
          loading={false}
          selectedIds={selectedIds}
          onSelectedIdsChange={(ids) => {
            onSelectedIdsChange(ids)
            setSelectedIds(ids)
          }}
          emptyLabel="No skills"
          portalContainer={null}
        />
      )
    }

    render(<StatefulPicker />)

    const bulkToggle = screen.getByRole('switch', {
      name: 'library.config.agent.section.tools.skills_enable_all'
    })
    await user.click(bulkToggle)
    expect(onSelectedIdsChange).toHaveBeenLastCalledWith(['disabled-skill'])

    await user.click(bulkToggle)
    expect(onSelectedIdsChange).toHaveBeenLastCalledWith(['disabled-skill', 'enabled-skill'])
  })

  it('clears globally disabled draft selections when toggling all skills off during Agent creation', async () => {
    const user = userEvent.setup()
    const onSelectedIdsChange = vi.fn()
    const enabledSkill = {
      id: 'enabled-skill',
      name: 'Enabled Skill',
      source: 'local',
      isGlobalEnabled: true
    } as InstalledSkill
    const disabledSkill = {
      id: 'disabled-skill',
      name: 'Disabled Skill',
      source: 'local',
      isGlobalEnabled: false
    } as InstalledSkill

    render(
      <SkillCatalogPicker
        mode="create"
        skills={[enabledSkill, disabledSkill]}
        loading={false}
        selectedIds={['enabled-skill', 'disabled-skill']}
        onSelectedIdsChange={onSelectedIdsChange}
        emptyLabel="No skills"
        portalContainer={null}
      />
    )

    await user.click(screen.getByRole('switch', { name: 'library.config.agent.section.tools.skills_enable_all' }))

    expect(onSelectedIdsChange).toHaveBeenCalledWith([])
  })

  it('dismisses the add menu without closing its parent dialog', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<SkillPickerDialog onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole('button', { name: 'library.skill_add.add' }))
    expect(screen.getByRole('menuitem', { name: 'library.skill_add.online_search' })).toBeInTheDocument()

    await user.click(screen.getByTestId('dialog-blank-area'))

    expect(screen.queryByRole('menuitem', { name: 'library.skill_add.online_search' })).not.toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
