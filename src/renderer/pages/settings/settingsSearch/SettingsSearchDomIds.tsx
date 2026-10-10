import { createContext, use, useId, useMemo } from 'react'

/**
 * DOM ids shared by the combobox input (aria-controls/activedescendant) and
 * the results listbox. Scoped per settings-page instance: two settings tabs
 * coexist with their DOM kept under <Activity>, so window-global fixed ids
 * would break IDREF uniqueness for assistive tech.
 */
export interface SettingsSearchDomIds {
  listboxId: string
  optionDomId: (index: number) => string
}

const DomIdsContext = createContext<SettingsSearchDomIds | null>(null)

function buildDomIds(instanceId: string): SettingsSearchDomIds {
  // useId embeds «»/: characters that CSS selectors cannot consume unescaped;
  // strip to a safe slug so querySelector can use the derived ids verbatim
  const slug = instanceId.replace(/[^a-zA-Z0-9]+/g, '')
  return {
    listboxId: `settings-search-listbox-${slug}`,
    optionDomId: (index: number) => `settings-search-option-${slug}-${index}`
  }
}

/** Provides one id set shared by the search box and results page of a tab */
export const SettingsSearchDomIdsProvider = ({ children }: { children: React.ReactNode }) => {
  const instanceId = useId()
  const value = useMemo(() => buildDomIds(instanceId), [instanceId])
  return <DomIdsContext value={value}>{children}</DomIdsContext>
}

/** Standalone fallback for single-component renders (tests); real mounts go
 * through SettingsPage's provider so both consumers share one id set */
const STANDALONE_DOM_IDS: SettingsSearchDomIds = {
  listboxId: 'settings-search-results-listbox',
  optionDomId: (index: number) => `settings-search-option-${index}`
}

export function useSettingsSearchDomIds(): SettingsSearchDomIds {
  return use(DomIdsContext) ?? STANDALONE_DOM_IDS
}
