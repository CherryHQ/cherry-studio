import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'

import plugin from '../scroll-area.mjs'

function lint(source: string) {
  return new Linter().verify(source, {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'cherry-scroll-area': plugin },
    rules: { 'cherry-scroll-area/no-container-padding': 'error' }
  })
}

const named = 'import { ScrollArea } from "@cherrystudio/ui";'

describe('ScrollArea content padding ownership', () => {
  it.each(['p-3', 'md:px-4', 'hover:!pr-2', 'pb-[var(--inset)]!', 'rtl:ps-2', '[@media(min-width:40rem)]:py-2'])(
    'rejects container padding %s',
    (token) => {
      const messages = lint(`${named}<ScrollArea className="${token}" />`)
      expect(messages).toHaveLength(1)
      expect(messages[0].ruleId).toBe('cherry-scroll-area/no-container-padding')
      expect(messages[0].message).toContain('contentProps.className')
    }
  )

  it('recognizes aliased imports and static class helpers', () => {
    expect(
      lint(
        'import { ScrollArea as Scroller } from "@cherrystudio/ui"; const padding = "p-3"; <Scroller className={cn("h-full", active && padding)} />'
      )
    ).toHaveLength(1)
  })

  it('recognizes namespace imports and viewport props objects', () => {
    const messages = lint(
      'import * as UI from "@cherrystudio/ui"; const props = {className: "pl-5"}; <UI.ScrollArea viewportProps={{...props, tabIndex: 0}} />'
    )
    expect(messages).toHaveLength(1)
    expect(messages[0].message).toContain('viewportProps.className')
  })

  it('checks both branches of conditional viewport classes', () => {
    expect(lint(`${named}<ScrollArea viewportProps={{className: small ? 'p-2' : 'p-4'}} />`)).toHaveLength(2)
  })

  it('allows content padding, ancestor padding, dimensions and descendant styling', () => {
    expect(
      lint(
        `${named}<div className="p-4"><ScrollArea className="max-h-60 [&_p]:p-2" viewportProps={{className: 'overflow-x-hidden'}} contentProps={{className: 'pl-5 pr-3'}} /></div>`
      )
    ).toEqual([])
  })

  it('does not match unrelated components or shadowed imports', () => {
    expect(lint('import { ScrollArea } from "another-ui"; <ScrollArea className="p-3" />')).toEqual([])
    expect(lint(`${named}function Panel(ScrollArea) { return <ScrollArea className="p-3" /> }`)).toEqual([])
  })

  it('checks settings wrappers, aliases and namespaces without matching shadowed bindings', () => {
    const source = 'import { SettingsContentColumn as Settings } from "@renderer/components/SettingsPrimitives";'
    expect(lint(`${source}<Settings className="pt-2" />`)).toHaveLength(1)
    expect(lint(`${source}<Settings contentProps={{className: 'pt-8'}} />`)).toEqual([])
    expect(lint(`${source}function Panel(Settings) { return <Settings className="pt-2" /> }`)).toEqual([])
    expect(
      lint(
        'import * as Settings from "@renderer/components/SettingsPrimitives"; <Settings.SettingsContentColumn viewportProps={{className: "p-2"}} />'
      )
    ).toHaveLength(1)
  })

  it('does not interpret arbitrary function arguments as classes', () => {
    expect(lint(`${named}<ScrollArea className={translate('p-3')} />`)).toEqual([])
  })
})
