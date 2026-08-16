import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const interfaceSource = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')
const interfaceStyles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
const rootSource = readFileSync(new URL('./__root.tsx', import.meta.url), 'utf8')
const faviconSource = readFileSync(new URL('../../public/favicon.svg', import.meta.url), 'utf8')

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

  it('renders the Fleet identity as three overlapping decorative boats', () => {
    expect(interfaceSource).toContain('<FleetBoatMark />')
    expect(interfaceSource).toContain('className="boat boat-back"')
    expect(interfaceSource).toContain('className="boat boat-middle"')
    expect(interfaceSource).toContain('className="boat boat-front"')
    expect(interfaceSource).toContain('className="fleet-boat-mark"')
    expect(interfaceSource).toContain('aria-hidden="true"')
  })

  it('uses the three-boat Fleet mark as the browser favicon', () => {
    expect(rootSource).toContain("href: '/favicon.svg'")
    expect(rootSource).toContain("sizes: 'any'")
    expect(faviconSource.match(/class="boat boat-/g)).toHaveLength(3)
    expect(faviconSource).toContain('class="boat boat-front"')
  })

  it('keeps explicitly sized interface text at a readable minimum', () => {
    const pixelFontSizes = [...interfaceStyles.matchAll(/font-size:\s*(\d+)px/g)]
      .map((match) => Number(match[1]))

    expect(pixelFontSizes.length).toBeGreaterThan(0)
    expect(Math.min(...pixelFontSizes)).toBeGreaterThanOrEqual(12)
  })

  it('keeps live traces in chat and the Fleet modal focused on compact agent cards', () => {
    expect(interfaceSource).toContain('<ResearchActivity snapshot={snapshot} onOpenAgent={onOpenAgent} />')
    expect(interfaceSource).toContain('<h2 id="fleet-dialog-title">Fleet</h2>')
    expect(interfaceSource).not.toContain('Research fleet</h2>')
    expect(interfaceSource).not.toContain('<OrchestratorPanel')
    expect(interfaceSource).not.toContain('className="agent-objective"')
    expect(interfaceSource).not.toContain('independent research {props.snapshot.agentCount === 1')
    expect(interfaceSource).toContain('snapshot.orchestratorReasoning')
    expect(interfaceSource).toContain("snapshot.agents.filter((agent) => agent.status !== 'planned')")
    expect(interfaceSource).toContain("answerStarted && !wasAnswerStarted.current")
    expect(interfaceSource).toContain('aria-controls="live-fleet-activity"')
    expect(interfaceSource).toContain("aria-label={open ? 'Hide fleet activity' : 'Show fleet activity'}")
    expect(interfaceSource).toContain("latestTool ? `${latestTool.tool === 'search' ? 'Search' : 'Fetch'}")
    expect(interfaceSource).not.toContain('className="orchestrator-chat"')
    expect(interfaceSource).not.toContain('className="main-agent-stream"')
    expect(interfaceSource).toContain('<AgentTimeline agent={props.agent} compact />')
    expect(interfaceSource).toContain('<AgentTimeline agent={agent} />')
    expect(interfaceSource).toContain('<Markdown remarkPlugins={[remarkGfm]}>{agent.finding}</Markdown>')
    expect(interfaceSource).toContain("if (event.deltaY < 0) onBreakAutoScroll()")
    expect(interfaceSource).toContain('tabIndex={0}')
    expect(interfaceStyles).toContain('grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr)')
  })
})
