import { isMac } from '@main/core/platform'

import type { BrowserActionOptions } from '../BrowserCursor'
import type { BrowserRef } from '../browserUse'
import { BrowserSessionError } from '../session/BrowserSessionError'
import type { GuestSession } from '../session/GuestSession'
import { KeyModifier, resolveKeyDefinition, TEXT_SUPPRESSING_MODIFIERS } from './keyDefinitions'
import { callOnElement, withElement } from './resolveTarget'

async function requestInputFocus(session: GuestSession, options: BrowserActionOptions) {
  if (session.sendInputEvent && (!options.focusInput || !options.assertInputTarget))
    throw new BrowserSessionError('input_unavailable')
  await options.focusInput?.(options)
}

export async function pressKey(session: GuestSession, chord: string, options: BrowserActionOptions) {
  const prepared = resolveChord(chord)
  await requestInputFocus(session, options)
  await dispatchKey(
    session,
    prepared,
    options,
    () => options.assertInputTarget?.(undefined, options) ?? Promise.resolve()
  )
}

type ResolvedChord = {
  key: string
  code?: string
  windowsVirtualKeyCode?: number
  modifiers: number
  text: string | undefined
  selectAll?: boolean
}

function resolveChord(chord: string): ResolvedChord {
  const parts = chord.split('+')
  let input = parts.pop()!
  if (!input && parts.at(-1) === '') {
    parts.pop()
    input = '+'
  }
  let modifiers = 0
  for (const part of parts) {
    if (!Object.hasOwn(KeyModifier, part)) throw new BrowserSessionError('not_allowed')
    modifiers |= KeyModifier[part as keyof typeof KeyModifier]
  }
  const definition = resolveKeyDefinition(input, Boolean(modifiers & KeyModifier.Shift))
  if (!definition) throw new BrowserSessionError('not_allowed')
  const { key, code, windowsVirtualKeyCode } = definition
  const text =
    modifiers & TEXT_SUPPRESSING_MODIFIERS
      ? undefined
      : key === 'Enter'
        ? '\r'
        : [...key].length === 1
          ? key
          : undefined
  const selectAll = modifiers === (isMac ? KeyModifier.Meta : KeyModifier.Control) && key.toLowerCase() === 'a'
  return { key, code, windowsVirtualKeyCode, modifiers, text, selectAll }
}

async function dispatchKey(
  session: GuestSession,
  chord: ResolvedChord,
  options: BrowserActionOptions,
  guard: () => Promise<void>
) {
  const { key, code, windowsVirtualKeyCode, modifiers, text, selectAll } = chord
  const params = { key, code, windowsVirtualKeyCode, modifiers }
  const send = async (type: 'rawKeyDown' | 'char' | 'keyUp') => {
    if (session.sendInputEvent) {
      const names = ['Alt', 'Control', 'Meta', 'Shift'] as const
      const electronModifiers = names
        .filter((name) => modifiers & KeyModifier[name])
        .map((name) => name.toLowerCase()) as Electron.KeyboardInputEvent['modifiers']
      session.sendInputEvent({
        type: type === 'rawKeyDown' ? 'keyDown' : type,
        keyCode: type === 'char' ? text! : key,
        modifiers: electronModifiers
      })
    } else {
      await session.send(
        'Input.dispatchKeyEvent',
        {
          ...params,
          type,
          ...(type === 'rawKeyDown' && selectAll ? { commands: ['selectAll'] } : {}),
          ...(type === 'char' ? { text, unmodifiedText: text } : {})
        },
        options
      )
    }
  }
  await guard()
  await send('rawKeyDown')
  let failed = false
  try {
    if (text) {
      await guard()
      await send('char')
    }
  } catch (error) {
    failed = true
    throw error
  } finally {
    let canRelease = true
    try {
      await guard()
    } catch {
      // Skip release when the guest route, target ref or operation is no longer valid.
      canRelease = false
    }
    if (canRelease)
      await send('keyUp').catch((error) => {
        if (!failed) throw error
      })
  }
}

async function insertText(
  session: GuestSession,
  text: string,
  options: BrowserActionOptions,
  guard: () => Promise<void>
) {
  if (session.sendInputEvent) {
    for (const character of text) {
      const enter = character === '\n' || character === '\r'
      await dispatchKey(
        session,
        { key: enter ? 'Enter' : character, text: enter ? '\r' : character, modifiers: 0 },
        options,
        guard
      )
    }
  } else {
    await guard()
    await session.send('Input.insertText', { text }, options)
  }
}

export async function typeText(
  session: GuestSession,
  ref: BrowserRef,
  text: string,
  clear: boolean,
  submit: boolean,
  options: BrowserActionOptions
) {
  await withElement(
    session,
    ref,
    async (objectId, backendNodeId, check) => {
      const initial = await callOnElement<{ editable: boolean; value: string }>(
        session,
        objectId,
        `function(){
      const editable = this.isConnected && !this.disabled && !this.readOnly && (this.isContentEditable || this.tagName === 'TEXTAREA' || (this.tagName === 'INPUT' && ['text','search','email','url','tel','password','number'].includes(this.type)));
      return { editable, value: this.value ?? this.textContent ?? '' }
    }`,
        [],
        options
      )
      if (!initial.editable) throw new BrowserSessionError('not_found')
      check()
      await requestInputFocus(session, options)
      check()
      await session.send('DOM.focus', { backendNodeId }, options)
      const guard = async () => {
        check()
        await options.assertInputTarget?.(objectId, options)
        check()
      }
      const sendChord = (chord: string) => dispatchKey(session, resolveChord(chord), options, guard)
      const selectText = (all: boolean) =>
        callOnElement<boolean>(
          session,
          objectId,
          `function(all){
          if(this.setSelectionRange && this.selectionStart !== null){ this.setSelectionRange(all ? 0 : this.value.length, this.value.length); return true }
          if(this.isContentEditable){ const r=document.createRange(); r.selectNodeContents(this); if(!all) r.collapse(false); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return true }
          return false
        }`,
          [all],
          options
        )
      const clearField = async () => {
        if (session.sendInputEvent) {
          await guard()
          if (!(await selectText(true))) throw new BrowserSessionError('not_found')
        } else await sendChord(`${isMac ? 'Meta' : 'Control'}+a`)
        await sendChord('Backspace')
      }
      if (clear) await clearField()
      else if (!(await selectText(false))) await sendChord(isMac ? 'Meta+ArrowRight' : 'End')
      await insertText(session, text, options, guard)
      const expected = (clear ? '' : initial.value) + text
      const read = () =>
        callOnElement<string>(
          session,
          objectId,
          'function(){ return this.value ?? this.textContent ?? "" }',
          [],
          options
        )
      if ((await read()) !== expected) {
        if (/[\r\n]/.test(expected)) throw new BrowserSessionError('not_found')
        await clearField()
        for (const character of expected) {
          check()
          if (session.sendInputEvent) await insertText(session, character, options, guard)
          else await sendChord(character === '\n' ? 'Enter' : character)
        }
        if ((await read()) !== expected) throw new BrowserSessionError('not_found')
      }
      check()
      if (submit) await sendChord('Enter')
    },
    options
  )
}
