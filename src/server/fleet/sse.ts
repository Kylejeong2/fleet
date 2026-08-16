import type { FleetEvent, RunId } from '../../lib/fleet-protocol'
import type { FleetService } from './service'

const encoder = new TextEncoder()

export const serializeFleetEvent = (event: FleetEvent): Uint8Array =>
  encoder.encode(
    `id: ${event.sequence}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`,
  )

export const createFleetEventStream = (
  service: FleetService,
  runId: RunId,
  after: number,
): ReadableStream<Uint8Array> => {
  let cursor = after
  let closed = false
  let pumping = false
  let pumpAgain = false
  let unsubscribe: () => void = () => undefined

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const pump = () => {
        if (closed) return
        if (pumping) {
          pumpAgain = true
          return
        }
        pumping = true
        try {
          const events = service.events(runId, cursor)
          for (const event of events) {
            controller.enqueue(serializeFleetEvent(event))
            cursor = event.sequence
          }
          const snapshot = service.getRun(runId)
          if (snapshot.status === 'completed' || snapshot.status === 'failed') {
            closed = true
            unsubscribe()
            controller.close()
          }
        } catch (error) {
          closed = true
          unsubscribe()
          controller.error(error)
        } finally {
          pumping = false
          if (pumpAgain && !closed) {
            pumpAgain = false
            queueMicrotask(pump)
          }
        }
      }
      unsubscribe = service.journal.subscribe(runId, pump)
      pump()
    },
    cancel() {
      closed = true
      unsubscribe()
    },
  })
}
