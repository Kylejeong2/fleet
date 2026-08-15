import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: FleetHome,
})

function FleetHome() {
  return (
    <main className="fleet-shell">
      <header className="fleet-header">
        <a className="fleet-wordmark" href="/" aria-label="Fleet home">
          Fleet
        </a>
        <button className="history-button" type="button">
          Research history
        </button>
      </header>

      <section className="composer-stage" aria-labelledby="research-heading">
        <div className="intro">
          <h1 id="research-heading">What should the fleet investigate?</h1>
          <p>
            Send parallel researchers across every angle, then bring the evidence
            back into one answer.
          </p>
        </div>

        <form className="research-composer">
          <label className="sr-only" htmlFor="research-question">
            Research question
          </label>
          <textarea
            id="research-question"
            name="question"
            placeholder="Ask a question worth investigating"
            rows={4}
          />
          <div className="composer-actions">
            <button className="agent-count" type="button">
              50 agents
            </button>
            <button className="launch-button" type="submit" aria-label="Start research">
              <span aria-hidden="true">&#8593;</span>
            </button>
          </div>
        </form>
      </section>
    </main>
  )
}
