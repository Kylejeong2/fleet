import { describe, expect, it } from 'vitest'
import { createRunId, createAgentId } from '../../../lib/fleet-protocol'
import {
  buildSynthesisPrompt,
  mapGatewayStream,
  ORCHESTRATOR_REASONING,
  SYNTHESIS_SYSTEM_PROMPT,
} from './gateway'

describe('Gateway synthesis prompt', () => {
  it('uses medium reasoning for the live orchestrator', () => {
    expect(ORCHESTRATOR_REASONING).toBe('medium')
  })

  it('carries exact source and agent trace citations into the dossier', () => {
    const agentId = createAgentId(createRunId(), 0)
    const prompt = buildSynthesisPrompt({
      question: 'What is a GPU?',
      findings: [
        {
          agentId,
          objective: 'Define the term',
          finding: 'A GPU is a parallel processor.',
          sources: [
            { title: 'GPU overview', url: 'https://example.com/gpu' },
          ],
        },
      ],
    })

    expect(prompt).toContain('https://example.com/gpu')
    expect(prompt).toContain(`[A1](#fleet-agent=${encodeURIComponent(agentId)})`)
    expect(SYNTHESIS_SYSTEM_PROMPT).toContain('Every factual paragraph')
    expect(SYNTHESIS_SYSTEM_PROMPT).toContain('700 to 1,200 words')
  })

  it('separates independent reasoning blocks before streaming them to the UI', async () => {
    async function* source() {
      yield { type: 'reasoning-start' }
      yield { type: 'reasoning-delta', text: 'Clarifying the dossier' }
      yield { type: 'reasoning-start' }
      yield { type: 'reasoning-delta', text: '## Structuring the answer' }
      yield { type: 'text-delta', text: '# Final answer' }
    }

    const parts = []
    for await (const part of mapGatewayStream(source())) parts.push(part)

    expect(parts).toEqual([
      { kind: 'reasoning-delta', delta: 'Clarifying the dossier' },
      { kind: 'reasoning-delta', delta: '\n\n' },
      { kind: 'reasoning-delta', delta: '## Structuring the answer' },
      { kind: 'text-delta', delta: '# Final answer' },
    ])
  })
})
