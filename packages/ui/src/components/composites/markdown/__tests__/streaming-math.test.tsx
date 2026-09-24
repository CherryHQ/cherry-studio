// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Markdown } from '../markdown'
import { withMath } from '../presets'

const plugins = { math: withMath({ streaming: true }) }
const fence = (source: string) => `\`\`\`math\n${source}\n\`\`\``

afterEach(cleanup)

describe('streaming math', () => {
  // An unfinished term must not hide a newly completed prefix from the same network chunk.
  it.each([
    [String.raw`a + \frac{b}{c} + \sqrt{`, String.raw`a + \frac{b}{c} + `],
    [String.raw`x^2 + y_{`, 'x^2 + y'],
    [String.raw`x + \frac{a}{`, 'x + '],
    [String.raw`x + \left(\frac{a}{b}`, 'x + '],
    [String.raw`x + \sqrt[12345`, 'x + '],
    [String.raw`\left[x\right] + \sqrt{`, String.raw`\left[x\right] + `],
    [String.raw`\left[x\right) + \sqrt{`, String.raw`\left[x\right) + `],
    [String.raw`\left(x\right] + \sqrt{`, String.raw`\left(x\right] + `],
    [String.raw`[0,1) + \frac{`, '[0,1) + '],
    [String.raw`x] + \sqrt{`, 'x] + '],
    [String.raw`\left[x]\right] + \frac{`, String.raw`\left[x]\right] + `],
    [String.raw`\sqrt[3]{x} + \frac{`, String.raw`\sqrt[3]{x} + `],
    [String.raw`x + \begin{aligned}a&=b\\c&=`, 'x + '],
    [String.raw`x + \notACommand + y`, 'x + '],
    [String.raw`\{x\} + \frac{`, String.raw`\{x\} + `],
    [String.raw`x % {\begin{aligned}`, 'x % {\\begin{aligned}\n']
  ])('renders a closed prefix of %s without an error placeholder', (source, prefix) => {
    render(
      <Markdown id="prefix" plugins={plugins}>
        {fence(source)}
      </Markdown>
    )

    // MathML annotations preserve the exact rendered TeX, including the completed fraction/script.
    expect(screen.getByRole('math', { hidden: true }).getElementsByTagName('annotation')[0].textContent).toBe(prefix)
    expect(screen.queryByTitle(/ParseError/)).not.toBeInTheDocument()
  })

  it('renders completed terms progressively and preserves final errors', () => {
    const { rerender } = render(
      <Markdown id="growth" plugins={plugins}>
        {fence('\\frac{a}{')}
      </Markdown>
    )
    expect(screen.queryByRole('math', { hidden: true })).not.toBeInTheDocument()
    expect(screen.queryByText('\\frac{a}{')).not.toBeInTheDocument()

    rerender(
      <Markdown id="growth" plugins={plugins}>
        {fence('\\frac{a}{b} + c^')}
      </Markdown>
    )
    expect(screen.getByRole('math', { hidden: true })).toHaveTextContent('ab+c')
    expect(screen.queryByTitle(/ParseError/)).not.toBeInTheDocument()

    rerender(
      <Markdown id="growth" plugins={plugins}>
        {fence('\\frac{a}{b} + c^2')}
      </Markdown>
    )
    expect(screen.getByRole('math', { hidden: true })).toHaveTextContent('ab+c2')

    rerender(
      <Markdown id="growth" plugins={{ math: withMath() }}>
        {fence('\\frac{a}{')}
      </Markdown>
    )
    expect(screen.getByText('\\frac{a}{')).toBeInTheDocument()
    expect(screen.getByTitle(/ParseError/)).toBeInTheDocument()
  })

  it('waits for the entire paired environment instead of inventing its closing tokens', () => {
    const { rerender } = render(
      <Markdown id="environment" plugins={plugins}>
        {fence('\\begin{aligned}a&=b\\\\c&=d')}
      </Markdown>
    )
    expect(screen.queryByRole('math', { hidden: true })).not.toBeInTheDocument()
    expect(screen.queryByTitle(/ParseError/)).not.toBeInTheDocument()

    rerender(
      <Markdown id="environment" plugins={plugins}>
        {fence('\\begin{aligned}a&=b\\\\c&=d\\end{aligned}')}
      </Markdown>
    )
    expect(screen.getByRole('math', { hidden: true })).toHaveTextContent('a=bc=d')
  })

  it('keeps surrounding text and adjacent inline formulas when trimming an incomplete formula', () => {
    render(
      <Markdown id="inline" plugins={plugins}>
        {String.raw`Before $$x + \frac{a}{$$ between $$y^2$$ after.`}
      </Markdown>
    )
    const formulas = screen.getAllByRole('math', { hidden: true })
    expect(formulas).toHaveLength(2)
    expect(formulas[0]).toHaveTextContent('x+')
    expect(formulas[1]).toHaveTextContent('y2')
    expect(screen.getByText(/Before/)).toHaveTextContent('between')
    expect(screen.getByText(/Before/)).toHaveTextContent('after.')
    expect(screen.queryByTitle(/ParseError/)).not.toBeInTheDocument()
  })
})
