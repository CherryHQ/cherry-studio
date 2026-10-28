import { isMac } from '@main/core/platform'

import type { BrowserActionOptions } from '../BrowserCursor'
import type { BrowserRef } from '../browserUse'
import { BrowserSessionError } from '../session/BrowserSessionError'
import type { GuestSession } from '../session/GuestSession'
import type { KeyStroke } from '../session/InputTransport'
import { KeyModifier, resolveKeyDefinition, TEXT_SUPPRESSING_MODIFIERS } from './keyDefinitions'
import { callOnElement, withElement } from './resolveTarget'

async function assertElementFocused(session: GuestSession, objectId: string, options: BrowserActionOptions) {
  const focused = await callOnElement<boolean>(
    session,
    objectId,
    `function(){
      if(!this.isConnected) return false;
      let active = this.getRootNode().activeElement;
      while(active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      let target = this;
      if(this.isContentEditable){
        while(target.parentElement?.isContentEditable) target = target.parentElement;
        if(!active?.isContentEditable) return false;
        while(active.parentElement?.isContentEditable) active = active.parentElement;
      }
      return active === target
    }`,
    [],
    options
  )
  if (!focused) throw new BrowserSessionError('input_not_focused')
}

export async function pressKey(session: GuestSession, chord: string, options: BrowserActionOptions) {
  const prepared = resolveChord(chord)
  await options.focusInput?.(options)
  const guard = () => options.assertRoute?.(options) ?? Promise.resolve()
  if (prepared.selectAll) {
    await guard()
    if (!(await session.input.selectAll(options))) throw new BrowserSessionError('not_found')
  }
  await dispatchKey(session, prepared, options, guard)
}

async function selectText(
  session: GuestSession,
  objectId: string,
  all: boolean,
  clear: boolean,
  options: BrowserActionOptions
) {
  const declaration = `function(all, clear){
    if(!this || !this.isConnected || this.disabled || this.readOnly) return false;
    if(this.setSelectionRange && this.selectionStart !== null){ this.setSelectionRange(all ? 0 : this.value.length, this.value.length); return 'selected' }
    if(this.isContentEditable){ const r=document.createRange(); r.selectNodeContents(this); if(!all) r.collapse(false); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return 'selected' }
    if(clear && this.tagName === 'INPUT'){
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(this, ''); this.dispatchEvent(new Event('input', {bubbles:true})); this.dispatchEvent(new Event('change', {bubbles:true})); return 'cleared'
    }
    return false
  }`
  return callOnElement<'selected' | 'cleared' | false>(session, objectId, declaration, [all, clear], options)
}

function resolveChord(chord: string): KeyStroke {
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
  stroke: KeyStroke,
  options: BrowserActionOptions,
  guard: () => Promise<void>
) {
  await guard()
  let failed = false
  try {
    await session.input.keyDown(stroke, options)
    if (stroke.text) {
      await guard()
      await session.input.char(stroke, options)
    }
  } catch (error) {
    failed = true
    throw error
  } finally {
    // Release even after cancellation or timeout so subsequent input cannot inherit a held key.
    if (!session.guest.isDestroyed())
      await session.input.keyUp(stroke, { deadline: Date.now() + 1000 }).catch((error) => {
        if (!failed) throw error
      })
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
  const normalizedText = text.replace(/\r\n/g, '\n')
  await withElement(
    session,
    ref,
    async (objectId, backendNodeId, check) => {
      const initial = await callOnElement<{ editable: boolean; value: string; multiline: boolean }>(
        session,
        objectId,
        `function(){
      const editable = this.isConnected && !this.disabled && !this.readOnly && (this.isContentEditable || this.tagName === 'TEXTAREA' || (this.tagName === 'INPUT' && ['text','search','email','url','tel','password','number'].includes(this.type)));
      return { editable, value: this.value ?? this.textContent ?? '', multiline: this.isContentEditable || this.tagName === 'TEXTAREA' }
    }`,
        [],
        options
      )
      if (!initial.editable || (!initial.multiline && /[\r\n]/.test(normalizedText)))
        throw new BrowserSessionError('not_found')
      check()
      await options.focusInput?.(options)
      check()
      await session.send('DOM.focus', { backendNodeId }, options)
      const guard = async () => {
        check()
        await options.assertRoute?.(options)
        await assertElementFocused(session, objectId, options)
        check()
      }
      const sendChord = (chord: string) => dispatchKey(session, resolveChord(chord), options, guard)
      const clearField = async () => {
        await guard()
        if (!(await session.input.selectAll(options))) {
          await guard()
          const selection = await selectText(session, objectId, true, true, options)
          if (selection === 'cleared') return
          throw new BrowserSessionError('not_found')
        }
        await sendChord('Backspace')
      }
      if (clear) await clearField()
      else if (!(await selectText(session, objectId, false, false, options)))
        await sendChord(isMac ? 'Meta+ArrowRight' : 'End')
      await guard()
      await session.input.insertText(normalizedText, options, guard)
      const expected = (clear ? '' : initial.value) + normalizedText
      const read = () =>
        callOnElement<string>(
          session,
          objectId,
          'function(){ return this.value ?? this.textContent ?? "" }',
          [],
          options
        )
      if ((await read()) !== expected) {
        await guard()
        if (session.input.kind === 'send-input-event' || /[\r\n]/.test(expected))
          throw new BrowserSessionError('not_found')
        await clearField()
        for (const character of expected) {
          check()
          await sendChord(character === '\n' ? 'Enter' : character)
        }
        if ((await read()) !== expected) throw new BrowserSessionError('not_found')
      }
      check()
      if (submit) await sendChord('Enter')
    },
    options
  )
}
