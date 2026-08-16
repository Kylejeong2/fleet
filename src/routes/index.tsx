import { createFileRoute } from '@tanstack/react-router'
import * as SelectPrimitive from '@radix-ui/react-select'
import {
  ArrowUp,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  LoaderCircle,
  Moon,
  Search as SearchIcon,
  Sun,
  XCircle,
} from 'lucide-react'
import { AnimatePresence, domMax, LazyMotion, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  useEffect,
  useId,
  lazy,
  useMemo,
  useRef,
  useState,
  Suspense,
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

const ResearchOcean = lazy(async () => {
  const ocean = await import('./-research-ocean')
  return { default: ocean.ResearchOcean }
})

export const Route = createFileRoute('/')({
  component: FleetHome,
})

const eventKinds: FleetEvent['kind'][] = [
  'run.accepted',
  'agent.planned',
  'agent.started',
  'agent.activity',
  'agent.reasoning',
  'orchestrator.activity',
  'orchestrator.reasoning.delta',
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
type Theme = 'light' | 'dark'

const botPalettes = [
  { shell: '#c9dcf5', shellLight: '#f4f8ff', accent: '#5579b3', accentSoft: '#d9e6f7', eye: '#25446f' },
  { shell: '#ead7bd', shellLight: '#fff9f0', accent: '#a9773c', accentSoft: '#f1e2ce', eye: '#63431f' },
  { shell: '#cbe5d2', shellLight: '#f3fff6', accent: '#4f8a62', accentSoft: '#dcefe1', eye: '#28543a' },
  { shell: '#efd0d1', shellLight: '#fff7f7', accent: '#a96065', accentSoft: '#f5dfe0', eye: '#6b3438' },
  { shell: '#ddcff0', shellLight: '#fbf7ff', accent: '#8061a4', accentSoft: '#eadff5', eye: '#4f346d' },
  { shell: '#d6dce5', shellLight: '#f8faff', accent: '#65738a', accentSoft: '#e3e8ef', eye: '#384457' },
] as const

function FleetHome() {
  const prefersReducedMotion = useReducedMotion()
  const [hydrated, setHydrated] = useState(false)
  const [question, setQuestion] = useState('')
  const [agentCount, setAgentCount] = useState(50)
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null)
  const [conversationHistory, setConversationHistory] = useState<RunSnapshot[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [dialogRunId, setDialogRunId] = useState<string | null>(null)
  const [fleetOpen, setFleetOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [theme, setTheme] = useState<Theme>('light')
  const fleetButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const transitioningRunRef = useRef<string | null>(null)
  const appendingFollowUpRef = useRef(false)

  useEffect(() => {
    setHydrated(true)
    const storedTheme = window.localStorage.getItem('fleet-theme')
    const preferredTheme: Theme = storedTheme === 'light' || storedTheme === 'dark'
      ? storedTheme
      : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    setTheme(preferredTheme)
    document.documentElement.dataset.theme = preferredTheme
  }, [])

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
    if (!snapshot?.id) return
    if (appendingFollowUpRef.current) {
      appendingFollowUpRef.current = false
      transitioningRunRef.current = null
      const frame = requestAnimationFrame(() => {
        const messages = messagesRef.current
        messages?.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' })
      })
      return () => cancelAnimationFrame(frame)
    }
    transitioningRunRef.current = snapshot.id
    messagesRef.current?.scrollTo({ top: 0 })
    const timeout = window.setTimeout(() => {
      if (transitioningRunRef.current === snapshot.id) transitioningRunRef.current = null
    }, 1100)
    return () => window.clearTimeout(timeout)
  }, [snapshot?.id])

  useEffect(() => {
    if (!snapshot || !autoScrollRef.current || transitioningRunRef.current === snapshot.id) return
    const messages = messagesRef.current
    if (!messages) return
    const frame = requestAnimationFrame(() => {
      messages.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [snapshot?.latestSequence])

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

  const dialogSnapshot = useMemo(
    () => conversationHistory.find((turn) => turn.id === dialogRunId) ?? snapshot,
    [conversationHistory, dialogRunId, snapshot],
  )

  const selectedAgent = useMemo(
    () =>
      dialogSnapshot?.agents.find((agent) => agent.id === selectedAgentId) ??
      dialogSnapshot?.agents[0] ??
      null,
    [dialogSnapshot, selectedAgentId],
  )

  const completeCount =
    dialogSnapshot?.agents.filter((agent) =>
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

  async function startResearch(event: FormEvent<HTMLFormElement>, mode: 'new' | 'follow-up' = 'new') {
    event.preventDefault()
    if (question.trim().length < 3 || submitting) return
    const currentSnapshot = snapshot
    const isFollowUp = mode === 'follow-up' && currentSnapshot !== null
    const priorTurns = isFollowUp ? [...conversationHistory, currentSnapshot] : []
    const launchStartedAt = performance.now()
    setSubmitting(true)
    setError(null)
    if (!isFollowUp) {
      setConversationHistory([])
      setSnapshot(null)
    }
    setSelectedAgentId(null)
    setDialogRunId(null)
    setFleetOpen(false)
    autoScrollRef.current = true
    try {
      const response = await fetch('/api/v1/runs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          question: question.trim(),
          context: isFollowUp ? conversationContext(priorTurns) : undefined,
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
      const nextSnapshot = RunSnapshotSchema.parse(body)
      const minimumLaunchDuration = isFollowUp || prefersReducedMotion ? 0 : 900
      const remainingLaunchTime = minimumLaunchDuration - (performance.now() - launchStartedAt)
      if (remainingLaunchTime > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remainingLaunchTime))
      }
      if (isFollowUp) {
        appendingFollowUpRef.current = true
        setConversationHistory((current) => [...current, currentSnapshot])
      }
      setSnapshot(nextSnapshot)
      setQuestion('')
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

  function openAgentTrace(agentId: string, turn: RunSnapshot | null = snapshot) {
    if (!turn?.agents.some((agent) => agent.id === agentId)) return
    setDialogRunId(turn.id)
    setSelectedAgentId(agentId)
    setFleetOpen(true)
  }

  function toggleTheme() {
    setTheme((current) => {
      const nextTheme = current === 'dark' ? 'light' : 'dark'
      document.documentElement.dataset.theme = nextTheme
      window.localStorage.setItem('fleet-theme', nextTheme)
      return nextTheme
    })
  }

  return (
    <LazyMotion features={domMax} strict>
    <main className="app-shell" data-hydrated={hydrated ? 'true' : 'false'}>
      <section className={`conversation ${snapshot ? 'has-run' : 'ocean-home'}`} aria-label="Fleet research chat">
        <header className="conversation-header">
          <FleetBoatMark />
          <span className="conversation-title">Fleet research</span>
          {snapshot ? (
            <span className="run-meta">
              {snapshot.agentCount} {snapshot.agentCount === 1 ? 'agent' : 'agents'}
              <i className={`status-light ${snapshot.status}`} aria-hidden="true" />
            </span>
          ) : null}
          <div className="header-actions">
            {snapshot ? (
              <button
                className="view-fleet-button"
                type="button"
                ref={fleetButtonRef}
                onClick={() => {
                  setDialogRunId(snapshot.id)
                  setFleetOpen(true)
                }}
              >
                <FleetMark />
                View fleet
              </button>
            ) : null}
            <button
              className="theme-toggle"
              type="button"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark'
                ? <Sun aria-hidden="true" size={16} strokeWidth={1.8} />
                : <Moon aria-hidden="true" size={16} strokeWidth={1.8} />}
            </button>
          </div>
        </header>

        <AnimatePresence initial={false} mode="sync">
          {snapshot ? (
            <m.div
              className="conversation-stage"
              key="research-conversation"
              initial={{ opacity: 1, y: 0 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: .2, ease: [.22, 1, .36, 1] }}
            >
              <ResearchConversation
                history={conversationHistory}
                snapshot={snapshot}
                onOpenAgent={openAgentTrace}
                messagesRef={messagesRef}
                onBreakAutoScroll={() => { autoScrollRef.current = false }}
                onReachBottom={() => { autoScrollRef.current = true }}
              />
            </m.div>
          ) : (
            <m.div
              className="welcome-transition"
              key="research-welcome"
              exit={{ opacity: 0 }}
              transition={{ duration: .82, ease: [.4, 0, .2, 1] }}
            >
              <WelcomeComposer
                question={question}
                setQuestion={setQuestion}
                agentCount={agentCount}
                setAgentCount={setAgentCount}
                submitting={submitting}
                onSubmit={startResearch}
              />
            </m.div>
          )}
        </AnimatePresence>

        {snapshot ? (
          <form className="follow-up-composer" onSubmit={(event) => startResearch(event, 'follow-up')}>
            <label className="sr-only" htmlFor="follow-up-question">Follow-up question</label>
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
              placeholder="Ask a follow-up question"
            />
            <button type="submit" disabled={submitting || question.trim().length < 3}>
              <ArrowUp aria-hidden="true" size={15} strokeWidth={2} />
              <span className="sr-only">Ask follow-up</span>
            </button>
          </form>
        ) : null}

        {error ? <div className="error-toast" role="alert">{error}</div> : null}
      </section>

      {dialogSnapshot && fleetOpen ? (
        <FleetDialog
          snapshot={dialogSnapshot}
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
        <h1 id="research-heading">One question. An entire fleet of intelligence.</h1>
        <p>Send 100 researchers in every direction, then synthesize what they find into one cited answer.</p>
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
      <m.div
        className="ocean-transition-frame ocean-transition-hero"
        layoutId="research-ocean-shell"
        transition={{ layout: { duration: .95, ease: [.22, 1, .36, 1] } }}
      >
        <Suspense fallback={<OceanFallback label="Charting the research ocean" />}>
          <ResearchOcean launching={props.submitting} />
        </Suspense>
      </m.div>
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
  history,
  snapshot,
  onOpenAgent,
  messagesRef,
  onBreakAutoScroll,
  onReachBottom,
}: {
  history: RunSnapshot[]
  snapshot: RunSnapshot
  onOpenAgent: (agentId: string, turn: RunSnapshot) => void
  messagesRef: React.RefObject<HTMLDivElement | null>
  onBreakAutoScroll: () => void
  onReachBottom: () => void
}) {
  return (
    <div
      className="messages"
      ref={messagesRef}
      tabIndex={0}
      aria-label="Research conversation"
      aria-live="polite"
      onWheel={(event) => { if (event.deltaY < 0) onBreakAutoScroll() }}
      onTouchMove={onBreakAutoScroll}
      onKeyDownCapture={(event) => {
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) onBreakAutoScroll()
      }}
      onScroll={(event) => {
        const element = event.currentTarget
        if (element.scrollHeight - element.scrollTop - element.clientHeight < 24) {
          onReachBottom()
        }
      }}
    >
      <div className="message-column">
        {history.map((turn) => (
          <ResearchTurn key={turn.id} snapshot={turn} archived onOpenAgent={onOpenAgent} />
        ))}
        <ResearchTurn snapshot={snapshot} onOpenAgent={onOpenAgent} />
      </div>
    </div>
  )
}

function ResearchTurn({
  snapshot,
  archived = false,
  onOpenAgent,
}: {
  snapshot: RunSnapshot
  archived?: boolean
  onOpenAgent: (agentId: string, turn: RunSnapshot) => void
}) {
  const answer = snapshot.finalAnswer ?? snapshot.partialAnswer
  const openAgent = (agentId: string) => onOpenAgent(agentId, snapshot)
  return (
    <section className={`conversation-turn ${archived ? 'archived' : 'active'}`}>
      <div className="prompt-bubble">{snapshot.question}</div>
      <article className="response">
        <header className="response-head">
          <span className="research-icon" aria-hidden="true"><SearchIcon size={13} strokeWidth={1.8} /></span>
          <span>{responseTitle(snapshot)}</span>
          {!archived && (snapshot.status === 'running' || snapshot.status === 'synthesizing') ? <TypingDots /> : null}
        </header>
        {archived ? null : (
          <m.div
            className="ocean-transition-frame ocean-transition-compact"
            layoutId="research-ocean-shell"
            transition={{ layout: { duration: .95, ease: [.22, 1, .36, 1] } }}
          >
            <Suspense fallback={<OceanFallback label="Launching the fleet" />}>
              <ResearchOcean snapshot={snapshot} onOpenAgent={openAgent} />
            </Suspense>
          </m.div>
        )}
        {answer ? null : <ResearchProgress snapshot={snapshot} />}
        {archived ? null : <ResearchActivity snapshot={snapshot} onOpenAgent={openAgent} />}
        {answer ? <AnswerText text={answer} onOpenAgent={openAgent} /> : null}
        {snapshot.error ? <p className="inline-error" role="alert">{snapshot.error}</p> : null}
      </article>
    </section>
  )
}

function OceanFallback({ label }: { label: string }) {
  return <div className="research-ocean ocean-loading" role="status"><span>{label}</span></div>
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
            <h2 id="fleet-dialog-title">Fleet</h2>
            <span>{workingCount} working · {props.completeCount} finished</span>
            <button ref={props.closeButtonRef} type="button" onClick={props.onClose} aria-label="Close fleet">×</button>
          </header>
          <div className="objective-block">
            <div>
              <strong>{trimQuestion(props.snapshot.question)}</strong>
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
        </div>
        <TracePanel agent={props.selectedAgent} index={Math.max(0, props.snapshot.agents.indexOf(props.selectedAgent!))} />
      </section>
    </div>
  )
}

function ResearchActivity({
  snapshot,
  onOpenAgent,
}: {
  snapshot: RunSnapshot
  onOpenAgent: (id: string) => void
}) {
  const running = snapshot.status === 'running' || snapshot.status === 'synthesizing'
  const answerStarted = snapshot.partialAnswer.length > 0 || snapshot.finalAnswer !== null
  const [open, setOpen] = useState(false)
  const wasAnswerStarted = useRef(answerStarted)
  const started = snapshot.agents.filter((agent) => agent.status !== 'planned').length
  const visibleAgents = snapshot.agents.filter((agent) => agent.status !== 'planned')

  useEffect(() => {
    if (answerStarted && !wasAnswerStarted.current) setOpen(false)
    wasAnswerStarted.current = answerStarted
  }, [answerStarted])

  return (
    <section
      className={`research-activity ${open ? 'open' : 'collapsed'} ${answerStarted ? 'answer-started' : ''}`}
      aria-label="Live fleet activity"
    >
      <button
        className="activity-toggle"
        type="button"
        aria-expanded={open}
        aria-label={open ? 'Hide fleet activity' : 'Show fleet activity'}
        aria-controls="live-fleet-activity"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="orchestrator-mark" aria-hidden="true"><FleetMark /></span>
        <span className="activity-toggle-copy">
          <strong>Live fleet activity</strong>
          <small>{started} of {snapshot.agentCount} subagents invoked · reasoning and tool calls</small>
        </span>
        <ChevronDown className="activity-chevron" aria-hidden="true" size={17} strokeWidth={1.8} />
      </button>
      {open ? (
        <div id="live-fleet-activity" className="research-activity-stream" aria-live="polite">
          <div className="activity-event-list" aria-label="Orchestrator activity">
            {snapshot.orchestratorTrace.length ? snapshot.orchestratorTrace.map((entry, index) => (
              <div className="activity-event-row" key={entry.sequence}>
                <ActivityStatusIcon complete={!running || index < snapshot.orchestratorTrace.length - 1} />
                <strong>{entry.phase}</strong>
                <small>{entry.message}</small>
              </div>
            )) : (
              <div className="activity-event-row">
                <ActivityStatusIcon complete={false} />
                <strong>Planning</strong>
                <small>Interpreting the question and preparing the fleet.</small>
              </div>
            )}
            {snapshot.orchestratorReasoning ? (
              <ReasoningDisclosure
                text={snapshot.orchestratorReasoning}
                isStreaming={snapshot.status === 'synthesizing' && !answerStarted}
              />
            ) : null}
            {visibleAgents.map((agent) => {
              const index = snapshot.agents.indexOf(agent)
              return (
                <AgentActivityRow
                  key={agent.id}
                  agent={agent}
                  index={index}
                  onOpen={() => onOpenAgent(agent.id)}
                />
              )
            })}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function ActivityStatusIcon({ complete }: { complete: boolean }) {
  return complete
    ? <CheckCircle2 className="activity-status-icon complete" aria-hidden="true" size={16} strokeWidth={1.8} />
    : <LoaderCircle className="activity-status-icon running" aria-hidden="true" size={16} strokeWidth={1.8} />
}

function ReasoningDisclosure({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const [open, setOpen] = useState(isStreaming)
  const dismissedWhileStreaming = useRef(false)
  const wasStreaming = useRef(isStreaming)

  useEffect(() => {
    const started = isStreaming && !wasStreaming.current
    if (started && !dismissedWhileStreaming.current) setOpen(true)
    if (!isStreaming && wasStreaming.current) dismissedWhileStreaming.current = false
    wasStreaming.current = isStreaming
  }, [isStreaming])

  function toggle() {
    setOpen((current) => {
      if (current && isStreaming) dismissedWhileStreaming.current = true
      return !current
    })
  }

  return (
    <div className={`streamed-reasoning ${open ? 'open' : ''}`}>
      <button type="button" onClick={toggle} aria-expanded={open}>
        <Brain aria-hidden="true" size={16} strokeWidth={1.8} />
        <strong>{isStreaming ? 'Orchestrator thinking…' : 'Orchestrator reasoning'}</strong>
        <ChevronDown className="reasoning-chevron" aria-hidden="true" size={15} strokeWidth={1.8} />
      </button>
      {open ? (
        <div className="reasoning-detail subagent-markdown">
          <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
        </div>
      ) : null}
    </div>
  )
}

function AgentActivityRow(props: { agent: AgentSnapshot; index: number; onOpen: () => void }) {
  const latestTool = props.agent.trace.at(-1)
  return (
    <details className={`main-agent-row ${props.agent.status}`}>
      <summary>
        {props.agent.status === 'running'
          ? <LoaderCircle className="activity-status-icon running" aria-hidden="true" size={16} strokeWidth={1.8} />
          : props.agent.status === 'failed'
            ? <XCircle className="activity-status-icon failed" aria-hidden="true" size={16} strokeWidth={1.8} />
            : <CheckCircle2 className="activity-status-icon complete" aria-hidden="true" size={16} strokeWidth={1.8} />}
        <span>A{props.index + 1}</span>
        <strong>{agentNames[props.index % agentNames.length]}</strong>
        <small>{latestTool ? `${latestTool.tool === 'search' ? 'Search' : 'Fetch'} · ${latestTool.input}` : props.agent.activity}</small>
        <em>{displayStatus(props.agent.status)}</em>
        <ChevronDown className="reasoning-chevron" aria-hidden="true" size={15} strokeWidth={1.8} />
      </summary>
      <div className="main-agent-detail">
        <AgentTimeline agent={props.agent} compact />
        <button className="open-agent-trace" type="button" onClick={props.onOpen}>Open agent trace</button>
      </div>
    </details>
  )
}

function AgentTimeline({ agent, compact = false }: { agent: AgentSnapshot; compact?: boolean }) {
  const entries: Array<
    | { kind: 'reasoning'; entry: AgentSnapshot['reasoning'][number]; step: number }
    | { kind: 'tool'; trace: ToolTrace }
  > = []
  const entryCount = Math.max(agent.reasoning.length, agent.trace.length)
  for (let index = 0; index < entryCount; index += 1) {
    const reasoning = agent.reasoning[index]
    const trace = agent.trace[index]
    if (reasoning) entries.push({ kind: 'reasoning', entry: reasoning, step: index + 1 })
    if (trace) entries.push({ kind: 'tool', trace })
  }

  if (entries.length === 0) {
    return <p className="empty-trace">Waiting for the first model response.</p>
  }

  return (
    <div className={`agent-timeline ${compact ? 'compact' : ''}`} aria-live="polite">
      {entries.map((item) => item.kind === 'reasoning' ? (
        <div className="timeline-reasoning" key={`reasoning-${item.entry.sequence}`}>
          <span>Step {item.step}</span>
          <div className="subagent-markdown">
            <Markdown remarkPlugins={[remarkGfm]}>{item.entry.text}</Markdown>
          </div>
        </div>
      ) : (
        <details className={`timeline-tool ${item.trace.status}`} key={item.trace.id}>
          <summary>
            <span className="tool-icon" aria-hidden="true">
              {item.trace.tool === 'search'
                ? <SearchIcon size={13} strokeWidth={1.8} />
                : <ExternalLink size={13} strokeWidth={1.8} />}
            </span>
            <span>
              <strong>{item.trace.tool === 'search' ? 'Search' : 'Fetch'}</strong>
              <small>{item.trace.input}</small>
            </span>
            <em>{displayStatus(item.trace.status)}</em>
          </summary>
          <pre>{toolDetail(item.trace)}</pre>
        </details>
      ))}
    </div>
  )
}

function AgentCard(props: { agent: AgentSnapshot; index: number; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={`agent-card ${props.agent.status} ${props.selected ? 'selected' : ''}`}
      onClick={props.onSelect}
      aria-pressed={props.selected}
      aria-label={`${agentNames[props.index % agentNames.length]}, ${displayStatus(props.agent.status)}`}
    >
      <Bot index={props.index} active={props.agent.status === 'running'} />
      <strong>{agentNames[props.index % agentNames.length]}</strong>
    </button>
  )
}

function AgentSkeletons({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => (
    <div className="agent-card planned skeleton" key={index} aria-hidden="true">
      <Bot index={index} active />
      <strong>Planning agent</strong>
    </div>
  ))
}

function TracePanel({ agent, index }: { agent: AgentSnapshot | null; index: number }) {
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
            <div className="trace-label tool-activity-label">Chronological trace</div>
            <AgentTimeline agent={agent} />
            {agent.finding ? (
              <>
                <div className="trace-label finding-label">Finding</div>
                <div className="trace-finding subagent-markdown">
                  <Markdown remarkPlugins={[remarkGfm]}>{agent.finding}</Markdown>
                </div>
              </>
            ) : null}
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

function FleetBoatMark() {
  return (
    <svg
      className="fleet-boat-mark"
      viewBox="0 0 30 22"
      aria-hidden="true"
      focusable="false"
    >
      <g className="boat boat-back" transform="translate(1 2)">
        <path className="boat-sail" d="M6 1v9H1.5L6 1Z" />
        <path className="boat-hull" d="M.5 11h11c-.8 3-2.7 4.5-5.5 4.5S1.3 14 .5 11Z" />
      </g>
      <g className="boat boat-middle" transform="translate(7 1)">
        <path className="boat-sail" d="M6 1v9H1.5L6 1Z" />
        <path className="boat-hull" d="M.5 11h11c-.8 3-2.7 4.5-5.5 4.5S1.3 14 .5 11Z" />
      </g>
      <g className="boat boat-front" transform="translate(13)">
        <path className="boat-sail" d="M6 1v9H1.5L6 1Z" />
        <path className="boat-hull" d="M.5 11h11c-.8 3-2.7 4.5-5.5 4.5S1.3 14 .5 11Z" />
      </g>
    </svg>
  )
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

function conversationContext(turns: RunSnapshot[]): string {
  return turns
    .slice(-3)
    .map((turn, index) => {
      const answer = (turn.finalAnswer ?? turn.partialAnswer) || 'No answer was produced.'
      return `Turn ${index + 1}\nQuestion: ${turn.question}\nAnswer: ${answer.slice(0, 5_500)}`
    })
    .join('\n\n')
    .slice(-19_500)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
