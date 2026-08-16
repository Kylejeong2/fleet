import type {
  ResearchToolCall,
  ResearchToolResult,
  ResearchTools,
  Synthesizer,
  SynthesisInput,
  WorkerModel,
  WorkerResponse,
  WorkerTurn,
} from '../ports'

const delay = (milliseconds: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new Error('Research cancelled'))
      },
      { once: true },
    )
  })

export class DevelopmentWorkerModel implements WorkerModel {
  readonly name = 'deterministic-development-worker'

  async respond(turn: WorkerTurn, signal: AbortSignal): Promise<WorkerResponse> {
    await delay(18, signal)
    if (turn.history.length === 0) {
      return {
        kind: 'tool-call',
        reasoning: `I need a broad evidence pass for “${turn.objective}”, so I’ll start with a targeted web search.`,
        call: { kind: 'search', query: `${turn.question} ${turn.objective}`.slice(0, 200) },
      }
    }
    const search = turn.history.find((item) => item.result.kind === 'search')
    if (turn.history.length === 1 && search?.result.kind === 'search') {
      const first = search.result.results[0]
      if (first) {
        return {
          kind: 'tool-call',
          reasoning: 'The search surfaced a directly relevant source. I’ll open it and inspect the supporting details.',
          call: { kind: 'fetch', url: first.url },
        }
      }
    }
    return {
      kind: 'finding',
      reasoning: 'The collected evidence is sufficient to report a concise source-backed finding to the orchestrator.',
      finding: `${turn.objective}: the development evidence indicates a distinct, source-backed angle for “${turn.question}”.`,
    }
  }
}

export class DevelopmentResearchTools implements ResearchTools {
  async execute(call: ResearchToolCall, signal: AbortSignal): Promise<ResearchToolResult> {
    await delay(14, signal)
    if (call.kind === 'search') {
      return {
        kind: 'search',
        results: [
          {
            title: `Source for ${call.query.slice(0, 64)}`,
            url: `https://example.com/research/${encodeURIComponent(call.query.slice(0, 40))}`,
            snippet: 'A deterministic development result that exercises the complete trace path.',
          },
        ],
      }
    }
    return {
      kind: 'fetch',
      url: call.url,
      title: 'Development research source',
      text: 'This deterministic page body lets Fleet test bounded fetch traces without external calls.',
    }
  }
}

export class DevelopmentSynthesizer implements Synthesizer {
  readonly name = 'deterministic-development-synthesizer'

  async *stream(input: SynthesisInput, signal: AbortSignal): AsyncIterable<string> {
    const question = input.question.replace(/[.?!]+$/, '')
    const chunks = [
      `Fleet completed a development research run for “${question}”. `,
      `The orchestrator reviewed ${input.findings.length} independent findings and synthesized them into this single response. `,
      'Open View fleet when you want to inspect the underlying agents, sources, and tool traces.',
    ]
    for (const chunk of chunks) {
      await delay(12, signal)
      yield chunk
    }
  }
}
