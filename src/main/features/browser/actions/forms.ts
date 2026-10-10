import type { BrowserRef, CommandOptions } from '../browserUse'
import { BrowserSessionError } from '../session/BrowserSessionError'
import type { GuestSession } from '../session/GuestSession'
import { callOnElement, withElement } from './resolveTarget'

export async function selectOption(session: GuestSession, ref: BrowserRef, values: string[], options: CommandOptions) {
  return withElement(
    session,
    ref,
    async (objectId) => {
      const ok = await callOnElement<boolean>(
        session,
        objectId,
        `function(values){
      if(!this.isConnected || this.tagName !== 'SELECT' || this.disabled || (!this.multiple && values.length !== 1)) return false;
      const options = Array.from(this.options);
      const selected = values.map(value => options.find(o => o.value === value) ?? options.find(o => o.label === value));
      if(selected.some(o => !o || o.disabled || (o.parentElement.tagName === 'OPTGROUP' && o.parentElement.disabled))) return false;
      for(const option of options) option.selected = selected.includes(option);
      this.dispatchEvent(new Event('input', {bubbles:true})); this.dispatchEvent(new Event('change', {bubbles:true}));
      return true
    }`,
        [values],
        options
      )
      if (!ok) throw new BrowserSessionError('not_found')
    },
    options
  )
}
