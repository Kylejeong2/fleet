import { describe, expect, it } from 'vitest'
import { formatFleetLogLine } from './log'

describe('fleet logging', () => {
  it('produces a single readable line with structured context', () => {
    const line = formatFleetLogLine(
      '2026-08-16T04:00:00.000Z',
      'info',
      'tool.succeeded',
      {
        run: 'run-1',
        durationMs: 42,
        input: 'multi-line\nsearch query',
      },
    )

    expect(line).toBe(
      '2026-08-16T04:00:00.000Z [fleet] INFO tool.succeeded run="run-1" durationMs=42 input="multi-line search query"',
    )
  })
})
