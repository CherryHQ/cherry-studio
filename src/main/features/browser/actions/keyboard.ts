import { isMac } from '@main/core/platform'

import type { BrowserActionOptions } from '../BrowserCursor'
import type { BrowserRef } from '../browserUse'
import { BrowserSessionError } from '../session/BrowserSessionError'
import type { GuestSession } from '../session/GuestSession'
import { KeyModifier, resolveKeyDefinition, TEXT_SUPPRESSING_MODIFIERS } from './keyDefinitions'
import { callOnElement, withElement } from './resolveTarget'

async function requestInputFocus(session: GuestSession, options: BrowserActionOptions) {
  if (session.ownership === 'borrowed' && !options.focusInput) throw new BrowserSessionError('input_not_focused')
  await options.focusInput?.(options)
}

async function checkGuestFocus(session: GuestSession, options: BrowserActionOptions) {
  if (session.ownership !== 'borrowed') return
  const result = await session.send(
    'Runtime.evaluate',
    { expression: 'document.hasFocus()', returnByValue: true },
    options
  )
  if (result.result.value !== true) throw new BrowserSessionError('input_not_focused')
}

export async function pressKey(session: GuestSession, chord: string, options: BrowserActionOptions) {
  const prepared = resolveChord(chord)
  await requestInputFocus(session, options)
  await dispatchKey(session, prepared, options, () => checkGuestFocus(session, options))
}

type ResolvedChord = {
  key: string
  code: string
  windowsVirtualKeyCode: number
  modifiers: number
  text: string | undefined
  selectAll: boolean
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
  await guard()
  await session.send(
    'Input.dispatchKeyEvent',
    { ...params, type: 'rawKeyDown', ...(selectAll ? { commands: ['selectAll'] } : {}) },
    options
  )
  let failed = false
  try {
    if (text) {
      await guard()
      await session.send('Input.dispatchKeyEvent', { ...params, type: 'char', text, unmodifiedText: text }, options)
    }
  } catch (error) {
    failed = true
    throw error
  } finally {
    // Release an already dispatched key even after focus, ref, cancellation or deadline loss.
    await session
      .send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' }, { deadline: Date.now() + 1000 })
      .catch((error) => {
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
  if (session.ownership === 'borrowed' && !options.focusInput) throw new BrowserSessionError('input_not_focused')
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
        if (session.ownership === 'borrowed') {
          const focused = await callOnElement<boolean>(
            session,
            objectId,
            `function(){
              if(!document.hasFocus() || !this.isConnected) return false;
              let target = this, active = this.getRootNode().activeElement;
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
          check()
          if (!focused) throw new BrowserSessionError('input_not_focused')
        }
      }
      const key = (chord: string) => dispatchKey(session, resolveChord(chord), options, guard)
      const clearField = async () => {
        await key(`${isMac ? 'Meta' : 'Control'}+a`)
        await key('Backspace')
      }
      await guard()
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
        if (!positioned) await key(isMac ? 'Meta+ArrowRight' : 'End')
      }
      await guard()
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
        await guard()
        await clearField()
        for (const character of expected) {
          check()
          await key(character === '\n' ? 'Enter' : character)
        }
        if ((await read()) !== expected) throw new BrowserSessionError('not_found')
      }
      check()
      if (submit) await key('Enter')
    },
    options
  )
}
