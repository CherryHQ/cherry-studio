import { describe, it, expect, beforeEach } from 'vitest'
import { getSelectedText } from '../selection'

describe('getSelectedText', () => {
  beforeEach(() => {
    // Clear any existing selection
    window.getSelection()?.removeAllRanges()
  })

  it('should return empty string when no selection', () => {
    expect(getSelectedText()).toBe('')
  })

  it('should return plain text selection', () => {
    // Create a div with plain text
    const div = document.createElement('div')
    div.textContent = 'Hello World'
    document.body.appendChild(div)

    // Select the text
    const range = document.createRange()
    range.selectNodeContents(div)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    expect(getSelectedText()).toBe('Hello World')

    // Cleanup
    document.body.removeChild(div)
  })

  it('should extract LaTeX from KaTeX elements', () => {
    // Create a KaTeX-like structure
    const div = document.createElement('div')
    div.innerHTML = `
      <p>Before <span class="katex">
        <span class="katex-mathml">
          <math><semantics>
            <annotation encoding="application/x-tex">x^2</annotation>
          </semantics></math>
        </span>
        <span class="katex-html" aria-hidden="true">x²</span>
      </span> After</p>
    `
    document.body.appendChild(div)

    // Select the entire content
    const range = document.createRange()
    range.selectNodeContents(div)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const result = getSelectedText()
    expect(result).toContain('$x^2$')
    expect(result).toContain('Before')
    expect(result).toContain('After')

    // Cleanup
    document.body.removeChild(div)
  })

  it('should handle multiple KaTeX elements', () => {
    // Create multiple KaTeX elements
    const div = document.createElement('div')
    div.innerHTML = `
      <span class="katex">
        <span class="katex-mathml">
          <math><semantics>
            <annotation encoding="application/x-tex">a+b</annotation>
          </semantics></math>
        </span>
      </span>
      and
      <span class="katex">
        <span class="katex-mathml">
          <math><semantics>
            <annotation encoding="application/x-tex">c=d</annotation>
          </semantics></math>
        </span>
      </span>
    `
    document.body.appendChild(div)

    // Select the entire content
    const range = document.createRange()
    range.selectNodeContents(div)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const result = getSelectedText()
    expect(result).toContain('$a+b$')
    expect(result).toContain('$c=d$')
    expect(result).toContain('and')

    // Cleanup
    document.body.removeChild(div)
  })

  it('should handle mixed content with text and KaTeX', () => {
    const div = document.createElement('div')
    div.innerHTML = `
      <p>The equation 
        <span class="katex">
          <span class="katex-mathml">
            <math><semantics>
              <annotation encoding="application/x-tex">E=mc^2</annotation>
            </semantics></math>
          </span>
        </span>
        is famous.
      </p>
    `
    document.body.appendChild(div)

    // Select the entire content
    const range = document.createRange()
    range.selectNodeContents(div)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const result = getSelectedText()
    expect(result).toContain('The equation')
    expect(result).toContain('$E=mc^2$')
    expect(result).toContain('is famous')

    // Cleanup
    document.body.removeChild(div)
  })

  it('should handle display mode KaTeX (block math)', () => {
    const div = document.createElement('div')
    div.innerHTML = `
      <p>Block equation:</p>
      <span class="katex katex-display">
        <span class="katex-mathml">
          <math><semantics>
            <annotation encoding="application/x-tex">\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}</annotation>
          </semantics></math>
        </span>
      </span>
      <p>End</p>
    `
    document.body.appendChild(div)

    // Select the entire content
    const range = document.createRange()
    range.selectNodeContents(div)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const result = getSelectedText()
    expect(result).toContain('$$')
    expect(result).toContain('\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}')
    expect(result).toContain('Block equation')
    expect(result).toContain('End')

    // Cleanup
    document.body.removeChild(div)
  })
})
