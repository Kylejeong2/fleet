import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const interfaceSource = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')
const interfaceStyles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')

describe('interface copy contract', () => {
  it('keeps eyebrow labels and uppercase transformations out of the product', () => {
    expect(`${interfaceSource}\n${interfaceStyles}`.toLowerCase()).not.toContain('eyebrow')
    expect(interfaceStyles).not.toMatch(/text-transform\s*:\s*uppercase/i)
  })

  it('exposes fleet size without exposing internal execution profiles', () => {
    expect(interfaceSource).toContain("profile: 'live'")
    expect(interfaceSource).toContain('Number of agents')
    expect(interfaceSource).not.toContain('Execution profile')
    expect(interfaceSource).not.toContain('Live workers')
  })

  it('provides an accessible persisted theme toggle', () => {
    expect(interfaceSource).toContain("window.localStorage.getItem('fleet-theme')")
    expect(interfaceSource).toContain("window.localStorage.setItem('fleet-theme', nextTheme)")
    expect(interfaceSource).toContain("aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}")
    expect(interfaceSource).toContain('<Sun aria-hidden="true"')
    expect(interfaceSource).toContain('<Moon aria-hidden="true"')
  })
})
