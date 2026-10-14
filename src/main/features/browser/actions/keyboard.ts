import { isMac } from '@main/core/platform'

import type { BrowserRef, CommandOptions } from '../browserUse'
import { BrowserSessionError } from '../session/BrowserSessionError'
import type { GuestSession } from '../session/GuestSession'
import { KeyModifier, resolveKeyDefinition, TEXT_SUPPRESSING_MODIFIERS } from './keyDefinitions'
import { callOnElement, withElement } from './resolveTarget'

export async function pressKey(session: GuestSession, chord: string, options: CommandOptions) {
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
  const params = { key, code, windowsVirtualKeyCode, modifiers }
  const selectAll = modifiers === (isMac ? KeyModifier.Meta : KeyModifier.Control) && key.toLowerCase() === 'a'
  await session.send(
    'Input.dispatchKeyEvent',
    { ...params, type: 'rawKeyDown', ...(selectAll ? { commands: ['selectAll'] } : {}) },
    options
  )
  if (text)
    await session.send('Input.dispatchKeyEvent', { ...params, type: 'char', text, unmodifiedText: text }, options)
  await session.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' }, options)
}

export async function typeText(
  session: GuestSession,
  ref: BrowserRef,
  text: string,
  clear: boolean,
  submit: boolean,
  options: CommandOptions
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
      await session.send('DOM.focus', { backendNodeId }, options)
      const clearField = async () => {
        check()
        await pressKey(session, `${isMac ? 'Meta' : 'Control'}+a`, options)
        await pressKey(session, 'Backspace', options)
      }
      if (clear) await clearField()
      else {
        const positioned = await callOnElement<boolean>(
          session,
          objectId,
          `function(){
          if(this.setSelectionRange && this.selectionStart !== null){ this.setSelectionRange(this.value.length, this.value.length); return true }
          if(this.isContentEditable){ const r=document.createRange(); r.selectNodeContents(this); r.collapse(false); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return true }
          return false
        }`,
          [],
          options
        )
        if (!positioned) await pressKey(session, isMac ? 'Meta+ArrowRight' : 'End', options)
      }
      check()
      await session.send('Input.insertText', { text }, options)
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
          await pressKey(session, character === '\n' ? 'Enter' : character, options)
        }
        if ((await read()) !== expected) throw new BrowserSessionError('not_found')
      }
      check()
      if (submit) await pressKey(session, 'Enter', options)
    },
    options
  )
}
