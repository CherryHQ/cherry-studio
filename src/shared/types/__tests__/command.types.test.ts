import { describe, expectTypeOf, it } from 'vitest'

import type { CommandDefinition, RegisteredCommandDefinition } from '../command'

type Metadata = Pick<CommandDefinition, 'id' | 'titleKey' | 'categoryKey'>
type RendererTarget = { renderer: { target: 'active-tab' } }

describe('command execution declarations', () => {
  it('requires a target for renderer and dual-process commands before and after registration', () => {
    expectTypeOf<Metadata & { scope: 'renderer' }>().not.toExtend<CommandDefinition>()
    expectTypeOf<Metadata & { scope: 'both' }>().not.toExtend<CommandDefinition>()
    expectTypeOf<Metadata & { scope: 'renderer' }>().not.toExtend<RegisteredCommandDefinition>()
    expectTypeOf<Metadata & { scope: 'both' }>().not.toExtend<RegisteredCommandDefinition>()

    expectTypeOf<Metadata & { scope: 'renderer' } & RendererTarget>().toExtend<CommandDefinition>()
    expectTypeOf<Metadata & { scope: 'both' } & RendererTarget>().toExtend<CommandDefinition>()
    expectTypeOf<Metadata & { scope: 'renderer' } & RendererTarget>().toExtend<RegisteredCommandDefinition>()
    expectTypeOf<Metadata & { scope: 'both' } & RendererTarget>().toExtend<RegisteredCommandDefinition>()
  })

  it('forbids renderer targets on main-only commands', () => {
    expectTypeOf<Metadata & { scope: 'main' }>().toExtend<CommandDefinition>()
    expectTypeOf<Metadata & { scope: 'main' }>().toExtend<RegisteredCommandDefinition>()
    expectTypeOf<Metadata & { scope: 'main' } & RendererTarget>().not.toExtend<CommandDefinition>()
    expectTypeOf<Metadata & { scope: 'main' } & RendererTarget>().not.toExtend<RegisteredCommandDefinition>()
  })

  it('preserves target availability when narrowing a registered command by process', () => {
    type MainCommand = Extract<RegisteredCommandDefinition, { scope: 'main' }>
    type RendererCommand = Exclude<RegisteredCommandDefinition, { scope: 'main' }>

    expectTypeOf<MainCommand['renderer']>().toEqualTypeOf<undefined>()
    expectTypeOf<RendererCommand['renderer']['target']>().toEqualTypeOf<'focused' | 'active-tab' | 'window'>()
  })
})
