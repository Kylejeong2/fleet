import { describe, expect, it } from 'vitest'
import { createRunId, createAgentId } from '../../../lib/fleet-protocol'
import { buildSynthesisPrompt, SYNTHESIS_SYSTEM_PROMPT } from './gateway'

describe('Gateway synthesis prompt', () => {
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
})
