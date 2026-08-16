import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserbaseResearchTools } from './browserbase'

afterEach(() => vi.unstubAllGlobals())

describe('BrowserbaseResearchTools', () => {
  it('does not duplicate an ambiguous paid request', async () => {
    const request = vi.fn(async () => {
      throw new TypeError('Connection closed before a response arrived')
    })
    vi.stubGlobal('fetch', request)

    await expect(
      new BrowserbaseResearchTools('test-key').execute(
        { kind: 'search', query: 'abundant inference products' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('Connection closed')
    expect(request).toHaveBeenCalledOnce()
  })
})
