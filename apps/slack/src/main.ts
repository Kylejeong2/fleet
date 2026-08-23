import { createSlackFleetApp } from './app.js'
import { SlackFleetConfigSchema } from './config.js'

const config = SlackFleetConfigSchema.parse(process.env)
const app = createSlackFleetApp(config)
await app.start()
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.stop())
}
