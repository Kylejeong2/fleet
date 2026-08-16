import { createFileRoute } from '@tanstack/react-router'
import * as SelectPrimitive from '@radix-ui/react-select'
import { ArrowUp, Check, ChevronDown, ExternalLink, Search as SearchIcon } from 'lucide-react'
import { domAnimation, LazyMotion, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  useEffect,
  useId,
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

const agentCountOptions = [1, 3, 6, 12, 25, 50, 100] as const

const botPalettes = [
  { shell: '#c9dcf5', shellLight: '#f4f8ff', accent: '#5579b3', accentSoft: '#d9e6f7', eye: '#25446f' },
  { shell: '#ead7bd', shellLight: '#fff9f0', accent: '#a9773c', accentSoft: '#f1e2ce', eye: '#63431f' },
  { shell: '#cbe5d2', shellLight: '#f3fff6', accent: '#4f8a62', accentSoft: '#dcefe1', eye: '#28543a' },
  { shell: '#efd0d1', shellLight: '#fff7f7', accent: '#a96065', accentSoft: '#f5dfe0', eye: '#6b3438' },
  { shell: '#ddcff0', shellLight: '#fbf7ff', accent: '#8061a4', accentSoft: '#eadff5', eye: '#4f346d' },
  { shell: '#d6dce5', shellLight: '#f8faff', accent: '#65738a', accentSoft: '#e3e8ef', eye: '#384457' },
] as const

function FleetHome() {
  const [hydrated, setHydrated] = useState(false)
  const [question, setQuestion] = useState('')
  const [agentCount, setAgentCount] = useState(12)
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
    // Subscribe once per run. Reconnecting on every sequence would replay events and churn the UI.
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
    setFleetOpen(false)
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
          profile: 'live',
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

  function openAgentTrace(agentId: string) {
    if (!snapshot?.agents.some((agent) => agent.id === agentId)) return
    setSelectedAgentId(agentId)
    setFleetOpen(true)
  }

  return (
    <LazyMotion features={domAnimation} strict>
    <main className="app-shell" data-hydrated={hydrated ? 'true' : 'false'}>
      <section className="conversation" aria-label="Fleet research chat">
        <header className="conversation-header">
          <span className="fleet-glyph" aria-hidden="true">F</span>
          <span className="conversation-title">Fleet research</span>
          {snapshot ? (
            <span className="run-meta">
              {snapshot.agentCount} {snapshot.agentCount === 1 ? 'agent' : 'agents'}
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
          <ResearchConversation snapshot={snapshot} onOpenAgent={openAgentTrace} />
        ) : (
          <WelcomeComposer
            question={question}
            setQuestion={setQuestion}
            agentCount={agentCount}
            setAgentCount={setAgentCount}
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
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              placeholder="Start another research run"
            />
            <button type="submit" disabled={submitting || question.trim().length < 3}>
              <ArrowUp aria-hidden="true" size={15} strokeWidth={2} />
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
    </LazyMotion>
  )
}

function WelcomeComposer(props: {
  question: string
  setQuestion: (value: string) => void
  agentCount: number
  setAgentCount: (value: number) => void
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
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          placeholder="Ask a question worth investigating"
          rows={4}
          autoFocus
        />
        <div className="composer-controls">
          <FleetSelect
            label="Number of agents"
            value={String(props.agentCount)}
            options={agentCountOptions.map((count) => ({
              value: String(count),
              label: `${count} ${count === 1 ? 'agent' : 'agents'}`,
            }))}
            className="agent-count-control"
            onValueChange={(value) => props.setAgentCount(Number(value))}
          />
          <button
            className="launch-button"
            type="submit"
            disabled={props.submitting || props.question.trim().length < 3}
          >
            <span>{props.submitting ? 'Starting' : 'Launch fleet'}</span>
            <ArrowUp aria-hidden="true" size={14} strokeWidth={2} />
          </button>
        </div>
      </form>
    </section>
  )
}

function FleetSelect(props: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  className?: string
  onValueChange: (value: string) => void
}) {
  return (
    <div className={`select-control ${props.className ?? ''}`}>
      <SelectPrimitive.Root value={props.value} onValueChange={props.onValueChange}>
        <SelectPrimitive.Trigger className="select-trigger" aria-label={props.label}>
          <SelectPrimitive.Value />
          <SelectPrimitive.Icon className="select-chevron" aria-hidden="true">
            <ChevronDown size={12} strokeWidth={1.8} />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            className="select-content"
            position="popper"
            sideOffset={6}
            collisionPadding={12}
          >
            <SelectPrimitive.Viewport className="select-viewport">
              {props.options.map((option) => (
                <SelectPrimitive.Item
                  className="select-item"
                  key={option.value}
                  value={option.value}
                >
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="select-indicator">
                    <Check size={12} strokeWidth={1.8} />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </div>
  )
}

function ResearchConversation({
  snapshot,
  onOpenAgent,
}: {
  snapshot: RunSnapshot
  onOpenAgent: (agentId: string) => void
}) {
  const answer = snapshot.finalAnswer ?? snapshot.partialAnswer
  return (
    <div className="messages" aria-live="polite">
      <div className="message-column">
        <div className="prompt-bubble">{snapshot.question}</div>
        <article className="response">
          <header className="response-head">
            <span className="research-icon" aria-hidden="true"><SearchIcon size={13} strokeWidth={1.8} /></span>
            <span>{responseTitle(snapshot)}</span>
            {snapshot.status === 'running' || snapshot.status === 'synthesizing' ? <TypingDots /> : null}
          </header>
          {answer
            ? <AnswerText text={answer} onOpenAgent={onOpenAgent} />
            : <ResearchProgress snapshot={snapshot} />}
          {snapshot.error ? <p className="inline-error" role="alert">{snapshot.error}</p> : null}
        </article>
      </div>
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
              <p>{props.snapshot.agentCount} independent research {props.snapshot.agentCount === 1 ? 'angle' : 'angles'} feeding one synthesis.</p>
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
            <div><strong>{props.snapshot.agentCount} {props.snapshot.agentCount === 1 ? 'agent' : 'agents'}, one shared brief</strong><span>Each worker keeps an isolated trace</span></div>
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
                    <span className="tool-icon" aria-hidden="true">
                      {trace.tool === 'search'
                        ? <SearchIcon size={13} strokeWidth={1.8} />
                        : <ExternalLink size={13} strokeWidth={1.8} />}
                    </span>
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
  const prefersReducedMotion = useReducedMotion()
  const gradientId = useId().replace(/:/g, '')
  const palette = botPalettes[index % botPalettes.length] ?? botPalettes[0]
  const duration = 1.7 + (index % 5) * 0.12
  const isMoving = active && !prefersReducedMotion

  return (
    <m.svg
      className={`bot ${active ? 'active' : ''}`}
      data-reduced-motion={prefersReducedMotion ? 'true' : 'false'}
      viewBox="0 0 52 56"
      aria-hidden="true"
      whileHover={prefersReducedMotion ? undefined : { scale: 1.09, rotate: index % 2 ? 2 : -2 }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={palette.shellLight} />
          <stop offset="1" stopColor={palette.shell} />
        </linearGradient>
      </defs>
      <m.g
        className="bot-rig"
        animate={isMoving ? { y: [0, -3.2, 0], rotate: [-0.8, 0.8, -0.8] } : { y: 0, rotate: 0 }}
        transition={{ duration, repeat: isMoving ? Infinity : 0, ease: 'easeInOut', delay: -(index % 7) * 0.11 }}
      >
        <m.ellipse
          className="bot-shadow"
          cx="26"
          cy="52"
          rx="13"
          ry="2.4"
          animate={isMoving ? { scaleX: [1, 0.78, 1], opacity: [0.18, 0.08, 0.18] } : { scaleX: 1, opacity: 0.14 }}
          transition={{ duration, repeat: isMoving ? Infinity : 0, ease: 'easeInOut' }}
        />

        <path className="bot-antenna-stem" d="M26 10V5" />
        <m.circle
          className="bot-antenna-light"
          cx="26"
          cy="4"
          r="2.7"
          fill={palette.accent}
          animate={isMoving ? { opacity: [0.45, 1, 0.45], scale: [0.82, 1.18, 0.82] } : { opacity: 0.72, scale: 1 }}
          transition={{ duration: 1.1 + (index % 3) * 0.15, repeat: isMoving ? Infinity : 0 }}
        />

        <m.path
          className="bot-arm"
          d="M11.5 32.5 6.5 38l3 5"
          animate={isMoving ? { rotate: [0, -13, 7, 0] } : { rotate: 0 }}
          transition={{ duration: 0.85, repeat: isMoving ? Infinity : 0, ease: 'easeInOut', delay: -(index % 4) * 0.09 }}
        />
        <m.path
          className="bot-arm right"
          d="m40.5 32.5 5 5.5-3 5"
          animate={isMoving ? { rotate: [0, 12, -8, 0] } : { rotate: 0 }}
          transition={{ duration: 0.85, repeat: isMoving ? Infinity : 0, ease: 'easeInOut', delay: -0.33 - (index % 3) * 0.08 }}
        />

        <rect className="bot-body" x="15" y="31" width="22" height="17" rx="6" fill={`url(#${gradientId})`} />
        <path className="bot-body-shine" d="M19 35.5h14" />
        <m.circle
          className="bot-core"
          cx="26"
          cy="40"
          r="3.2"
          fill={palette.accent}
          animate={isMoving ? { opacity: [0.55, 1, 0.55], scale: [0.82, 1.12, 0.82] } : { opacity: 0.72, scale: 1 }}
          transition={{ duration: 1.25, repeat: isMoving ? Infinity : 0, delay: -(index % 5) * 0.12 }}
        />
        <path className="bot-leg" d="M20 47.5v4h-5" />
        <path className="bot-leg right" d="M32 47.5v4h5" />

        <circle className="bot-ear" cx="10" cy="23" r="3.2" fill={palette.accentSoft} />
        <circle className="bot-ear right" cx="42" cy="23" r="3.2" fill={palette.accentSoft} />
        <rect className="bot-head" x="11" y="11" width="30" height="24" rx="9" fill={`url(#${gradientId})`} />
        <rect className="bot-face" x="15" y="16" width="22" height="13" rx="5" />
        <m.g
          className="bot-eyes"
          animate={isMoving ? { x: [0, 1.8, -1.3, 0] } : { x: 0 }}
          transition={{ duration: 2.35 + (index % 4) * 0.18, repeat: isMoving ? Infinity : 0, times: [0, 0.36, 0.72, 1] }}
        >
          <m.rect
            x="19"
            y="20"
            width={index % 3 === 0 ? 4.8 : 3.6}
            height="4"
            rx="1.8"
            fill={palette.eye}
            animate={isMoving ? { scaleY: [1, 1, 0.18, 1] } : { scaleY: 1 }}
            transition={{ duration: 2.8 + (index % 5) * 0.2, repeat: isMoving ? Infinity : 0, times: [0, 0.76, 0.8, 1] }}
          />
          <m.rect
            x="29"
            y="20"
            width={index % 3 === 1 ? 4.8 : 3.6}
            height="4"
            rx="1.8"
            fill={palette.eye}
            animate={isMoving ? { scaleY: [1, 1, 0.18, 1] } : { scaleY: 1 }}
            transition={{ duration: 2.8 + (index % 5) * 0.2, repeat: isMoving ? Infinity : 0, times: [0, 0.76, 0.8, 1] }}
          />
        </m.g>
        <m.path
          className="bot-mouth"
          d={index % 4 === 0 ? 'M23 26.5h6' : index % 4 === 1 ? 'M23 26.5q3 2 6 0' : 'M22.5 26.5h2l1-1.5 1.5 3 1-1.5h2'}
          animate={isMoving && index % 4 > 1 ? { opacity: [0.45, 1, 0.45] } : { opacity: 0.82 }}
          transition={{ duration: 0.72, repeat: isMoving ? Infinity : 0 }}
        />
      </m.g>
    </m.svg>
  )
}

function FleetMark() {
  return <span className="fleet-mark" aria-hidden="true"><i /><i /><i /></span>
}

function TypingDots() {
  return <span className="typing" aria-label="In progress"><i /><i /><i /></span>
}

function AnswerText({
  text,
  onOpenAgent,
}: {
  text: string
  onOpenAgent: (agentId: string) => void
}) {
  return (
    <div className="answer-text">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('#fleet-agent=')) {
              const encodedId = href.slice('#fleet-agent='.length)
              let agentId = encodedId
              try {
                agentId = decodeURIComponent(encodedId)
              } catch {
                return <span>{children}</span>
              }
              return (
                <button
                  className="agent-citation"
                  type="button"
                  title="Open the supporting agent trace"
                  onClick={() => onOpenAgent(agentId)}
                >
                  {children}
                </button>
              )
            }
            if (!href || !/^https?:\/\//i.test(href)) return <span>{children}</span>
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
                <ExternalLink aria-hidden="true" size={11} strokeWidth={1.8} />
              </a>
            )
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}

function ResearchProgress({ snapshot }: { snapshot: RunSnapshot }) {
  const started = snapshot.agents.filter((agent) => agent.status !== 'planned').length
  return <p className="progress-copy">{started ? `The orchestrator dispatched ${started} of ${snapshot.agentCount} researchers and is reviewing their evidence.` : 'The orchestrator is framing the question and preparing independent research angles.'}</p>
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
  if (snapshot.status === 'synthesizing') return 'Orchestrator is synthesizing the evidence'
  return 'Orchestrator is thinking'
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
