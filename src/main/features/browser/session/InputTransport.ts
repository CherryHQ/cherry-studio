import { KeyModifier } from '../actions/keyDefinitions'
import type { CommandOptions } from '../browserUse'
import { BrowserSessionError } from './BrowserSessionError'
import type { GuestSession } from './GuestSession'

/** One key description; modifiers use the CDP KeyModifier bitmask. */
export interface KeyStroke {
  key: string
  code?: string
  windowsVirtualKeyCode?: number
  modifiers: number
  text?: string
  selectAll?: boolean
}

export interface InputTransport {
  readonly kind: 'cdp' | 'send-input-event'
  keyDown(stroke: KeyStroke, options?: CommandOptions): Promise<void>
  char(stroke: KeyStroke, options?: CommandOptions): Promise<void>
  keyUp(stroke: KeyStroke, options?: CommandOptions): Promise<void>
  insertText(text: string, options?: CommandOptions, guard?: () => Promise<void>): Promise<void>
  /** True only when selection was applied; false for an unsupported editable target. */
  selectAll(options?: CommandOptions): Promise<boolean>
}

export class CdpInputTransport implements InputTransport {
  readonly kind = 'cdp'

  constructor(private readonly session: GuestSession) {}

  async keyDown(stroke: KeyStroke, options?: CommandOptions): Promise<void> {
    const { key, code, windowsVirtualKeyCode, modifiers, selectAll } = stroke
    await this.session.send(
      'Input.dispatchKeyEvent',
      {
        key,
        code,
        windowsVirtualKeyCode,
        modifiers,
        type: 'rawKeyDown',
        ...(selectAll ? { commands: ['selectAll'] } : {})
      },
      options
    )
  }

  async char(stroke: KeyStroke, options?: CommandOptions): Promise<void> {
    const { key, code, windowsVirtualKeyCode, modifiers, text } = stroke
    await this.session.send(
      'Input.dispatchKeyEvent',
      { key, code, windowsVirtualKeyCode, modifiers, type: 'char', text, unmodifiedText: text },
      options
    )
  }

  async keyUp(stroke: KeyStroke, options?: CommandOptions): Promise<void> {
    const { key, code, windowsVirtualKeyCode, modifiers } = stroke
    await this.session.send(
      'Input.dispatchKeyEvent',
      { key, code, windowsVirtualKeyCode, modifiers, type: 'keyUp' },
      options
    )
  }

  async insertText(text: string, options?: CommandOptions): Promise<void> {
    await this.session.send('Input.insertText', { text }, options)
  }

  async selectAll(options?: CommandOptions): Promise<boolean> {
    let failed = false
    try {
      await this.session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', commands: ['selectAll'] }, options)
    } catch (error) {
      failed = true
      throw error
    } finally {
      if (!this.session.guest.isDestroyed())
        await this.session
          .send('Input.dispatchKeyEvent', { type: 'keyUp' }, { deadline: Date.now() + 1000 })
          .catch((error) => {
            if (!failed) throw error
          })
    }
    return true
  }
}

const DOM_KEY_TO_ELECTRON_ACCELERATOR: Record<string, string> = {
  ArrowLeft: 'Left',
  ArrowUp: 'Up',
  ArrowRight: 'Right',
  ArrowDown: 'Down',
  Escape: 'Esc',
  Enter: 'Return',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ' ': 'Space',
  F1: 'F1',
  F2: 'F2',
  F3: 'F3',
  F4: 'F4',
  F5: 'F5',
  F6: 'F6',
  F7: 'F7',
  F8: 'F8',
  F9: 'F9',
  F10: 'F10',
  F11: 'F11',
  F12: 'F12'
}

export class SendInputEventTransport implements InputTransport {
  readonly kind = 'send-input-event'

  constructor(private readonly session: GuestSession) {}

  private check(options: CommandOptions = {}): void {
    options.signal?.throwIfAborted()
    if (options.deadline !== undefined && options.deadline <= Date.now()) throw new BrowserSessionError('timeout')
    if (this.session.pendingDialog) throw new BrowserSessionError('dialog_open', this.session.pendingDialog)
    if (!this.session.isAvailable()) throw new BrowserSessionError('debugger_unavailable')
  }

  private send(type: Electron.KeyboardInputEvent['type'], stroke: KeyStroke): void {
    const names = ['Alt', 'Control', 'Meta', 'Shift'] as const
    const modifiers = names
      .filter((name) => stroke.modifiers & KeyModifier[name])
      .map((name) => name.toLowerCase()) as Electron.KeyboardInputEvent['modifiers']
    this.session.guest.sendInputEvent({
      type,
      keyCode: type === 'char' ? stroke.text! : (DOM_KEY_TO_ELECTRON_ACCELERATOR[stroke.key] ?? stroke.key),
      modifiers
    })
  }

  async keyDown(stroke: KeyStroke, options?: CommandOptions): Promise<void> {
    this.check(options)
    this.send('keyDown', stroke)
  }

  async char(stroke: KeyStroke, options?: CommandOptions): Promise<void> {
    this.check(options)
    this.send('char', stroke)
  }

  async keyUp(stroke: KeyStroke): Promise<void> {
    // Release is best-effort; only a destroyed guest skips delivery.
    if (this.session.guest.isDestroyed()) return
    this.send('keyUp', stroke)
  }

  async insertText(text: string, options?: CommandOptions, guard?: () => Promise<void>): Promise<void> {
    this.check(options)
    for (const character of text) {
      await guard?.()
      if (character === '\n' || character === '\r') {
        await this.char({ key: 'Enter', text: '\r', modifiers: 0 }, options)
        continue
      }
      const stroke = { key: character, text: character, modifiers: 0 }
      await this.keyDown(stroke, options)
      let failed = false
      try {
        await guard?.()
        await this.char(stroke, options)
      } catch (error) {
        failed = true
        throw error
      } finally {
        if (!this.session.guest.isDestroyed())
          await this.keyUp(stroke).catch((error) => {
            if (!failed) throw error
          })
      }
    }
  }

  async selectAll(options?: CommandOptions): Promise<boolean> {
    this.check(options)
    const response = await this.session.send(
      'Runtime.evaluate',
      {
        expression: `(() => {
          let target = document.activeElement;
          while(target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement;
          if(!target?.isConnected || target.disabled || target.readOnly) return false;
          if(target.setSelectionRange && target.selectionStart !== null){ target.setSelectionRange(0, target.value.length); return true }
          if(target.isContentEditable){
            const range = document.createRange(); range.selectNodeContents(target);
            const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return true
          }
          return false
        })()`,
        returnByValue: true
      },
      options
    )
    if (response.exceptionDetails) throw new BrowserSessionError('not_found')
    return response.result.value === true
  }
}
