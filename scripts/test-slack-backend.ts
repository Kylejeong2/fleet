import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFleetClient } from '@fleet/client'

const port = 43_917
const baseUrl = new URL(`http://127.0.0.1:${port}`)
const serviceToken = 'fleet-slack-integration-test-token'
const temporary = await mkdtemp(join(tmpdir(), 'fleet-slack-backend-'))
const server = spawn('pnpm', ['dev', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    FLEET_EXECUTION_MODE: 'local',
    FLEET_DATABASE_PATH: join(temporary, 'fleet.sqlite'),
    FLEET_SLACK_SERVICE_TOKEN: serviceToken,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
server.stdout.on('data', (chunk) => { output += String(chunk) })
server.stderr.on('data', (chunk) => { output += String(chunk) })

try {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(baseUrl)
      if (response.ok) break
    } catch {}
    if (attempt === 99) throw new Error(`Fleet server did not start:\n${output}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const client = createFleetClient({ baseUrl, authorization: { kind: 'bearer', token: serviceToken } })
  const request = {
    question: 'Verify the deterministic Slack backend integration.',
    context: 'This run exercises POST, GET, and SSE through the real local server.',
    idempotencyKey: `slack:v1:integration:${Date.now()}`,
    execution: { profile: 'development' as const, agentCount: 3, concurrency: 3 },
  }
  const accepted = await client.createRun(request)
  const duplicate = await client.createRun(request)
  if (duplicate.id !== accepted.id) throw new Error('Idempotency did not converge on one Fleet run')
  let latest = accepted.latestSequence
  let terminal = accepted
  for await (const projection of client.follow(accepted.id, { after: accepted.latestSequence, signal: new AbortController().signal })) {
    if (projection.cursor < latest) throw new Error('Fleet cursor decreased')
    latest = projection.cursor
    terminal = projection.snapshot
  }
  const fetched = await client.getRun(accepted.id)
  if (terminal.status !== 'completed' || fetched.status !== 'completed') throw new Error('Fleet run did not complete')
  if (fetched.agentCount !== 3 || fetched.concurrency !== 3 || fetched.agents.length !== 3) {
    throw new Error('Fleet backend integration did not execute exactly three agents at concurrency three')
  }
  process.stdout.write(`Fleet Slack backend integration passed: run=${fetched.id} agents=3 cursor=${fetched.latestSequence}\n`)
} finally {
  server.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    if (server.exitCode !== null) resolve()
    else server.once('exit', () => resolve())
  })
  await rm(temporary, { recursive: true, force: true })
}
