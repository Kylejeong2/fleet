import { gateway, streamText } from 'ai'
import type { Synthesizer, SynthesisInput } from '../ports'

export class GatewaySynthesizer implements Synthesizer {
  readonly name: string

  constructor(private readonly model = 'openai/gpt-5.6-sol') {
    this.name = `vercel-ai-gateway:${model}`
  }

  async *stream(input: SynthesisInput, signal: AbortSignal): AsyncIterable<string> {
    const result = streamText({
      model: gateway(this.model),
      abortSignal: signal,
      system:
        'You are Fleet’s lead research orchestrator. Synthesize only the supplied findings, preserve uncertainty, and cite source URLs present in the findings. Produce a direct, polished answer.',
      prompt: `Question: ${input.question}\n\nResearch findings:\n${input.findings
        .map((item, index) => `${index + 1}. ${item.objective}\n${item.finding}`)
        .join('\n\n')}`,
    })
    for await (const delta of result.textStream) yield delta
  }
}
