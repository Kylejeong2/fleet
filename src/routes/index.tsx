import { createFileRoute } from '@tanstack/react-router'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import {
  FleetEventSchema,
  RunSnapshotSchema,
  type AgentSnapshot,
  type FleetEvent,
  type RunProfile,
  type RunSnapshot,
  type ToolTrace,
} from '../lib/fleet-protocol'
import { reduceEvent } from '../server/fleet/reducer'

export const Route = createFileRoute('/')({
  component: FleetHome,
})

const eventKinds: FleetEvent['kind'][] = [
  'run.accepted',
  'agent.planned',
  'agent.started',
  'agent.activity',
  'tool.started',
  'tool.succeeded',
  'tool.failed',
  'agent.succeeded',
  'agent.failed',
  'synthesis.started',
  'synthesis.delta',
  'run.completed',
  'run.failed',
]

const agentNames = [
  'Frame scout',
  'Source diver',
  'History keeper',
  'Market mapper',
  'Data analyst',
  'Skeptic',
  'Consensus scout',
  'Incentive mapper',
  'Systems builder',
  'Economics analyst',
  'Policy reader',
  'Regional scout',
  'Edge-case hunter',
  'Ripple mapper',
  'Contrarian',
  'Example finder',
  'Alternatives scout',
  'Unknowns hunter',
  'Futures analyst',
  'Claim checker',
]

const botTones = ['blue', 'sand', 'mint', 'rose', 'lilac', 'slate'] as const

function FleetHome() {
  const [hydrated, setHydrated] = useState(false)
  const [question, setQuestion] = useState('')
  const [agentCount, setAgentCount] = useState(12)
  const [profile, setProfile] = useState<RunProfile>('development')
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [fleetOpen, setFleetOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fleetButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => setHydrated(true), [])

  useEffect(() => {
    if (!snapshot || snapshot.status === 'completed' || snapshot.status === 'failed') {
      return
    }
    const source = new EventSource(
      `/api/v1/runs/${snapshot.id}/events?after=${snapshot.latestSequence}`,
    )
    const receive = (message: MessageEvent<string>) => {
      try {
        const event = FleetEventSchema.parse(JSON.parse(message.data))
        setSnapshot((current) => {
          if (!current) return current
          const result = reduceEvent(current, event)
          if (result.kind === 'gap') {
            void refreshRun(current.id)
            return current
          }
          return result.snapshot
        })
      } catch {
        setError('Fleet received an event it could not read. Refresh to reconnect.')
      }
    }
    for (const kind of eventKinds) source.addEventListener(kind, receive as EventListener)
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        void refreshRun(snapshot.id)
      }
    }
    return () => source.close()
  }, [snapshot?.id, snapshot?.status])

  useEffect(() => {
    if (fleetOpen) closeButtonRef.current?.focus()
  }, [fleetOpen])

  useEffect(() => {
    if (!fleetOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFleetOpen(false)
        requestAnimationFrame(() => fleetButtonRef.current?.focus())
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      )
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [fleetOpen])

  const selectedAgent = useMemo(
    () =>
      snapshot?.agents.find((agent) => agent.id === selectedAgentId) ??
      snapshot?.agents[0] ??
      null,
    [selectedAgentId, snapshot?.agents],
  )

  const completeCount =
    snapshot?.agents.filter((agent) =>
      ['succeeded', 'failed'].includes(agent.status),
    ).length ?? 0

  async function refreshRun(runId: string) {
    try {
      const response = await fetch(`/api/v1/runs/${runId}`)
      if (!response.ok) throw new Error('Could not refresh the research run.')
      setSnapshot(RunSnapshotSchema.parse(await response.json()))
    } catch (refreshError) {
      setError(errorMessage(refreshError))
    }
  }

  async function startResearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (question.trim().length < 3 || submitting) return
    setSubmitting(true)
    setError(null)
    setSnapshot(null)
    setSelectedAgentId(null)
    try {
      const response = await fetch('/api/v1/runs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          question: question.trim(),
          agentCount,
          concurrency: Math.min(agentCount, 6),
          profile,
        }),
      })
      const body: unknown = await response.json()
      if (!response.ok) {
        const message =
          typeof body === 'object' && body && 'error' in body
            ? String(body.error)
            : 'Fleet could not start this run.'
        throw new Error(message)
      }
      setSnapshot(RunSnapshotSchema.parse(body))
      setFleetOpen(true)
    } catch (startError) {
      setError(errorMessage(startError))
    } finally {
      setSubmitting(false)
    }
  }

  function closeFleet() {
    setFleetOpen(false)
    requestAnimationFrame(() => fleetButtonRef.current?.focus())
  }

  return (
    <main className="app-shell" data-hydrated={hydrated ? 'true' : 'false'}>
      <Sidebar snapshot={snapshot} />
      <section className="conversation" aria-label="Fleet research chat">
        <header className="conversation-header">
          <span className="fleet-glyph" aria-hidden="true">F</span>
          <span className="conversation-title">Fleet research</span>
          {snapshot ? (
            <span className="run-meta">
              {snapshot.agentCount} agents
              <i className={`status-light ${snapshot.status}`} aria-hidden="true" />
            </span>
          ) : null}
          {snapshot ? (
            <button
              className="view-fleet-button"
              type="button"
              ref={fleetButtonRef}
              onClick={() => setFleetOpen(true)}
            >
              <FleetMark />
              View fleet
            </button>
          ) : null}
        </header>

        {snapshot ? (
          <ResearchConversation snapshot={snapshot} />
        ) : (
          <WelcomeComposer
            question={question}
            setQuestion={setQuestion}
            agentCount={agentCount}
            setAgentCount={setAgentCount}
            profile={profile}
            setProfile={setProfile}
            submitting={submitting}
            onSubmit={startResearch}
          />
        )}

        {snapshot ? (
          <form className="follow-up-composer" onSubmit={startResearch}>
            <label className="sr-only" htmlFor="follow-up-question">New research question</label>
            <input
              id="follow-up-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Start another research run"
            />
            <button type="submit" disabled={submitting || question.trim().length < 3}>
              <span aria-hidden="true">↑</span>
              <span className="sr-only">Start research</span>
            </button>
          </form>
        ) : null}

        {error ? <div className="error-toast" role="alert">{error}</div> : null}
      </section>

      {snapshot && fleetOpen ? (
        <FleetDialog
          snapshot={snapshot}
          selectedAgent={selectedAgent}
          selectedAgentId={selectedAgentId}
          completeCount={completeCount}
          closeButtonRef={closeButtonRef}
          dialogRef={dialogRef}
          onClose={closeFleet}
          onSelectAgent={setSelectedAgentId}
        />
      ) : null}
    </main>
  )
}

function Sidebar({ snapshot }: { snapshot: RunSnapshot | null }) {
  return (
    <aside className="sidebar" aria-label="Research navigation">
      <div className="window-row" aria-hidden="true">
        <i className="window-dot red" />
        <i className="window-dot amber" />
        <i className="window-dot green" />
        <span className="add-mark">+</span>
      </div>
      <div className="sidebar-search">
        <SearchIcon />
        Search
      </div>
      <nav className="thread-list" aria-label="Recent research">
        <div className="thread active">
          <span className="thread-avatar">F</span>
          <span className="thread-copy">
            <strong>Fleet research</strong>
            <small>{snapshot ? runSummary(snapshot) : 'Ready for a new question'}</small>
          </span>
          <time>Now</time>
        </div>
        <div className="thread muted-thread" aria-hidden="true">
          <span className="thread-avatar neutral">N</span>
          <span className="thread-copy"><strong>New Bot</strong><small>Product notes and analysis</small></span>
          <time>Thu</time>
        </div>
      </nav>
      <div className="sidebar-foot">
        <div><span className="round-icon">⌁</span>Tools</div>
        <div><span className="account-avatar">K</span>Kyle Jeong</div>
      </div>
    </aside>
  )
}

function WelcomeComposer(props: {
  question: string
  setQuestion: (value: string) => void
  agentCount: number
  setAgentCount: (value: number) => void
  profile: RunProfile
  setProfile: (value: RunProfile) => void
  submitting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <section className="welcome-stage" aria-labelledby="research-heading">
      <div className="intro">
        <span className="intro-mark" aria-hidden="true"><FleetMark /></span>
        <h1 id="research-heading">What should the fleet investigate?</h1>
        <p>Send parallel researchers across the problem, then bring the evidence back into one answer.</p>
      </div>
      <form className="research-composer" onSubmit={props.onSubmit}>
        <label className="sr-only" htmlFor="research-question">Research question</label>
        <textarea
          id="research-question"
          value={props.question}
          onChange={(event) => props.setQuestion(event.target.value)}
          placeholder="Ask a question worth investigating"
          rows={4}
          autoFocus
        />
        <div className="composer-controls">
          <label className="number-control">
            <span className="sr-only">Number of agents</span>
            <input
              type="number"
              aria-label="Number of agents"
              min={1}
              max={100}
              list="agent-count-presets"
              value={props.agentCount}
              onChange={(event) => props.setAgentCount(Math.max(1, Math.min(100, Number(event.target.value))))}
            />
            <span>{props.agentCount === 1 ? 'agent' : 'agents'}</span>
            <datalist id="agent-count-presets">
              {[1, 3, 6, 12, 25, 50, 100].map((count) => <option key={count} value={count} />)}
            </datalist>
          </label>
          <label className="select-control">
            <span className="sr-only">Execution profile</span>
            <select
              aria-label="Execution profile"
              value={props.profile}
              onChange={(event) => props.setProfile(event.target.value as RunProfile)}
            >
              <option value="development">Development</option>
              <option value="live-workers">Live workers</option>
              <option value="live">Live fleet</option>
            </select>
          </label>
          <button
            className="launch-button"
            type="submit"
            disabled={props.submitting || props.question.trim().length < 3}
          >
            <span>{props.submitting ? 'Starting' : 'Launch fleet'}</span>
            <span aria-hidden="true">↑</span>
          </button>
        </div>
      </form>
    </section>
  )
}

function ResearchConversation({ snapshot }: { snapshot: RunSnapshot }) {
  const answer = snapshot.finalAnswer ?? snapshot.partialAnswer
  return (
    <div className="messages" aria-live="polite">
      <div className="prompt-bubble">{snapshot.question}</div>
      <article className="response">
        <header className="response-head">
          <span className="research-icon" aria-hidden="true">⌕</span>
          <span>{responseTitle(snapshot)}</span>
          {snapshot.status === 'running' || snapshot.status === 'synthesizing' ? <TypingDots /> : null}
        </header>
        {answer ? <AnswerText text={answer} /> : <ResearchProgress snapshot={snapshot} />}
        {snapshot.error ? <p className="inline-error" role="alert">{snapshot.error}</p> : null}
      </article>
    </div>
  )
}

function FleetDialog(props: {
  snapshot: RunSnapshot
  selectedAgent: AgentSnapshot | null
  selectedAgentId: string | null
  completeCount: number
  closeButtonRef: React.RefObject<HTMLButtonElement | null>
  dialogRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  onSelectAgent: (id: string) => void
}) {
  const workingCount = props.snapshot.agents.filter((agent) => agent.status === 'running').length
  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <section
        className="fleet-dialog"
        ref={props.dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fleet-dialog-title"
      >
        <div className="fleet-main">
          <header className="fleet-head">
            <h2 id="fleet-dialog-title">Research fleet</h2>
            <span>{workingCount} working · {props.completeCount} finished</span>
            <button ref={props.closeButtonRef} type="button" onClick={props.onClose} aria-label="Close research fleet">×</button>
          </header>
          <div className="objective-block">
            <div>
              <strong>{trimQuestion(props.snapshot.question)}</strong>
              <p>{props.snapshot.agentCount} independent research angles feeding one synthesis.</p>
            </div>
            <div
              className="overall-progress"
              role="progressbar"
              aria-label="Fleet progress"
              aria-valuemin={0}
              aria-valuemax={props.snapshot.agentCount}
              aria-valuenow={props.completeCount}
            >
              <i style={{ width: `${(props.completeCount / props.snapshot.agentCount) * 100}%` }} />
            </div>
          </div>
          <div className="agent-grid" aria-label="Research agents">
            {props.snapshot.agents.length ? props.snapshot.agents.map((agent, index) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                index={index}
                selected={(props.selectedAgentId ?? props.snapshot.agents[0]?.id) === agent.id}
                onSelect={() => props.onSelectAgent(agent.id)}
              />
            )) : <AgentSkeletons count={Math.min(props.snapshot.agentCount, 12)} />}
          </div>
          <footer className="fleet-foot">
            <div><strong>{props.snapshot.agentCount} agents, one shared brief</strong><span>Each worker keeps an isolated trace</span></div>
            <span className={`run-state ${props.snapshot.status}`}>{displayStatus(props.snapshot.status)}</span>
          </footer>
        </div>
        <TracePanel agent={props.selectedAgent} index={Math.max(0, props.snapshot.agents.indexOf(props.selectedAgent!))} />
      </section>
    </div>
  )
}

function AgentCard(props: { agent: AgentSnapshot; index: number; selected: boolean; onSelect: () => void }) {
  const progress = agentProgress(props.agent)
  return (
    <button
      type="button"
      className={`agent-card ${props.agent.status} ${props.selected ? 'selected' : ''}`}
      onClick={props.onSelect}
      aria-pressed={props.selected}
      aria-label={`${agentNames[props.index % agentNames.length]}, ${displayStatus(props.agent.status)}`}
    >
      <div className="agent-card-top">
        <Bot index={props.index} active={props.agent.status === 'running'} />
        <span className="agent-status"><i />{displayStatus(props.agent.status)}</span>
      </div>
      <strong>{agentNames[props.index % agentNames.length]}</strong>
      <span className="agent-objective">{props.agent.objective}</span>
      <span className="agent-progress"><i style={{ width: `${progress}%` }} /></span>
    </button>
  )
}

function AgentSkeletons({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <div className="agent-card planned skeleton" key={index} aria-hidden="true">
      <div className="agent-card-top"><Bot index={index} active /></div>
      <strong>Planning agent</strong>
      <span className="agent-objective">Preparing an independent research angle</span>
    </div>
  ))
}

function TracePanel({ agent, index }: { agent: AgentSnapshot | null; index: number }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const sourceCount = agent ? uniqueSourceCount(agent.trace) : 0
  return (
    <aside className="trace-panel" aria-label="Selected agent trace">
      <header className="trace-head"><strong>Agent trace</strong><span>{agent ? displayStatus(agent.status) : 'Planning'}</span></header>
      {agent ? (
        <>
          <div className="trace-context">
            <div className="trace-agent"><Bot index={index} active={agent.status === 'running'} /><div><strong>{agentNames[index % agentNames.length]}</strong><span>{agent.activity}</span></div></div>
            <div className="trace-label">Current objective</div>
            <p className="trace-objective">{agent.objective}</p>
          </div>
          <div className="trace-events">
            <div className="trace-label">Tool activity</div>
            {agent.trace.length ? agent.trace.map((trace) => {
              const isExpanded = Boolean(expanded[trace.id])
              return (
                <div className={`tool-event ${isExpanded ? 'expanded' : ''}`} key={trace.id}>
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpanded((current) => ({ ...current, [trace.id]: !isExpanded }))}
                  >
                    <span className="tool-icon" aria-hidden="true">{trace.tool === 'search' ? '⌕' : '↗'}</span>
                    <span><strong>{trace.tool === 'search' ? 'Search' : 'Fetch'}</strong><small>{trace.input}</small></span>
                    <span className="tool-status">{displayStatus(trace.status)} <i aria-hidden="true">›</i></span>
                  </button>
                  {isExpanded ? <pre>{toolDetail(trace)}</pre> : null}
                </div>
              )
            }) : <p className="empty-trace">Tools appear here as this agent works.</p>}
            {agent.finding ? <><div className="trace-label finding-label">Finding</div><p className="trace-finding">{agent.finding}</p></> : null}
            {agent.error ? <p className="inline-error">{agent.error}</p> : null}
          </div>
          <footer className="trace-foot"><span>{sourceCount} {sourceCount === 1 ? 'source' : 'sources'}</span><span>{agent.trace.length} tool {agent.trace.length === 1 ? 'call' : 'calls'}</span></footer>
        </>
      ) : <p className="empty-agent">The fleet is assigning research objectives.</p>}
    </aside>
  )
}

function Bot({ index, active }: { index: number; active: boolean }) {
  return (
    <span className={`bot tone-${botTones[index % botTones.length]} ${active ? 'active' : ''}`} aria-hidden="true" style={{ '--bot-delay': `${-(index % 8) * 0.17}s` } as React.CSSProperties}>
      <span className="bot-antenna" />
      <span className="bot-head"><i className="eye left" /><i className="eye right" /><i className="mouth" /></span>
      <span className="bot-body" />
      <i className="bot-foot left" /><i className="bot-foot right" />
    </span>
  )
}

function FleetMark() {
  return <span className="fleet-mark" aria-hidden="true"><i /><i /><i /></span>
}

function SearchIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="8" r="5" /><path d="m12 12 4 4" /></svg>
}

function TypingDots() {
  return <span className="typing" aria-label="In progress"><i /><i /><i /></span>
}

function AnswerText({ text }: { text: string }) {
  return <div className="answer-text">{text.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
}

function ResearchProgress({ snapshot }: { snapshot: RunSnapshot }) {
  const started = snapshot.agents.filter((agent) => agent.status !== 'planned').length
  return <p className="progress-copy">{started ? `${started} agents are searching, reading, and checking independent angles.` : 'The fleet is dividing the question into independent research angles.'}</p>
}

function toolDetail(trace: ToolTrace): string {
  if (trace.status === 'running') return `${trace.tool}: ${trace.input}\nStatus: running`
  if (trace.status === 'failed') return `${trace.tool}: ${trace.input}\nError: ${trace.error}`
  if (trace.result.kind === 'search') {
    return trace.result.results.map((result, index) => `${index + 1}. ${result.title}\n${result.url}\n${result.snippet}`).join('\n\n')
  }
  return `${trace.result.title}\n${trace.result.url}\n\n${trace.result.text}`
}

function uniqueSourceCount(trace: ToolTrace[]): number {
  const urls = new Set<string>()
  for (const entry of trace) {
    if (entry.status !== 'succeeded') continue
    if (entry.result.kind === 'search') entry.result.results.forEach((result) => urls.add(result.url))
    else urls.add(entry.result.url)
  }
  return urls.size
}

function agentProgress(agent: AgentSnapshot): number {
  if (agent.status === 'succeeded' || agent.status === 'failed') return 100
  if (agent.status === 'running') return Math.min(88, 28 + agent.trace.length * 24)
  return 8
}

function responseTitle(snapshot: RunSnapshot): string {
  if (snapshot.status === 'completed') return 'Research complete'
  if (snapshot.status === 'failed') return 'Research stopped'
  if (snapshot.status === 'synthesizing') return 'Synthesizing the evidence'
  return `Researching with ${snapshot.agentCount} agents`
}

function runSummary(snapshot: RunSnapshot): string {
  if (snapshot.status === 'completed') return 'Research answer ready'
  if (snapshot.status === 'failed') return 'Research needs attention'
  return `${snapshot.agents.filter((agent) => agent.status === 'running').length} agents working`
}

function displayStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function trimQuestion(question: string): string {
  return question.length > 80 ? `${question.slice(0, 77)}…` : question
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
