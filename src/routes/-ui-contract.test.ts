import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const interfaceSource = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')
const interfaceStyles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')

describe('interface copy contract', () => {
  it('keeps eyebrow labels and uppercase transformations out of the product', () => {
    expect(`${interfaceSource}\n${interfaceStyles}`.toLowerCase()).not.toContain('eyebrow')
    expect(interfaceStyles).not.toMatch(/text-transform\s*:\s*uppercase/i)
  })
})
