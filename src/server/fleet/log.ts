export type FleetLogLevel = 'info' | 'warn' | 'error'

export type FleetLogFields = Record<
  string,
  string | number | boolean | null | undefined
>

const clean = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, 180)

const printable = (value: FleetLogFields[string]): string => {
  if (typeof value === 'string') return JSON.stringify(clean(value))
  return String(value)
}

export const formatFleetLogLine = (
  timestamp: string,
  level: FleetLogLevel,
  event: string,
  fields: FleetLogFields = {},
): string => {
  const context = Object.entries(fields)
    .filter((entry): entry is [string, Exclude<FleetLogFields[string], undefined>] =>
      entry[1] !== undefined,
    )
    .map(([key, value]) => `${key}=${printable(value)}`)
    .join(' ')
  return `${timestamp} [fleet] ${level.toUpperCase()} ${event}${context ? ` ${context}` : ''}`
}

export const fleetLog = (
  level: FleetLogLevel,
  event: string,
  fields: FleetLogFields = {},
): void => {
  if (process.env.NODE_ENV === 'test' || process.env.FLEET_LOG_LEVEL === 'silent') {
    return
  }
  const line = formatFleetLogLine(new Date().toISOString(), level, event, fields)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.info(line)
}

