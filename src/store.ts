import type { Event } from "@opencode-ai/sdk"

export type ToolStats = {
  calls: number
  totalMs: number
  failed: number
  first: number
  last: number
}

export type SessionStats = {
  id: string
  created: number
  lastActivity: number
  messages: { user: number; assistant: number }
  parts: Map<string, number>
  tokens: { input: number; output: number; reasoning: number }
  cacheRead: number
  cacheWrite: number
  cost: number
  compactions: number[]
  commands: Map<string, number>
  tools: Map<string, ToolStats>
  systemSizes: number[]
  models: Map<string, number>
  idleCount: number
  errors: number
}

type Usage = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

const SYSTEM_SIZES_CAP = 200

export type RingItem = {
  t: number
  type: string
  sessionID?: string
  text: string
}

export class Ring {
  private readonly limit: number
  private readonly items: RingItem[] = []

  constructor(limit = 5000) {
    this.limit = Math.max(1, limit)
  }

  push(type: string, text: string, sessionID?: string): void {
    this.items.push({ t: Date.now(), type, sessionID, text })
    if (this.items.length > this.limit) {
      this.items.splice(0, this.items.length - this.limit)
    }
  }

  recent(n: number): RingItem[] {
    if (n <= 0) return []
    return this.items.slice(-n)
  }

  countByType(): Map<string, number> {
    const counts = new Map<string, number>()
    for (const item of this.items) {
      counts.set(item.type, (counts.get(item.type) ?? 0) + 1)
    }
    return counts
  }

  get size(): number {
    return this.items.length
  }
}

const zeroUsage = (): Usage => ({
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
})

const iso = (ms: number): string => new Date(ms).toISOString()

const fmtDuration = (ms: number): string =>
  ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`

const fmtChars = (n: number): string => n.toLocaleString("en-US")

const fmtMap = (map: Map<string, number>): string => {
  if (map.size === 0) return "(none)"
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${v}`)
    .join(", ")
}

export class StatStore {
  private readonly sessions = new Map<string, SessionStats>()
  private readonly partsSeen = new Set<string>()
  private readonly messagesSeen = new Set<string>()
  private readonly assistantUsage = new Map<string, Usage>()
  private readonly inFlight = new Map<string, { sessionID: string; tool: string; start: number }>()

  private ensure(sessionID: string): SessionStats {
    let s = this.sessions.get(sessionID)
    if (!s) {
      const now = Date.now()
      s = {
        id: sessionID,
        created: now,
        lastActivity: now,
        messages: { user: 0, assistant: 0 },
        parts: new Map(),
        tokens: { input: 0, output: 0, reasoning: 0 },
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        compactions: [],
        commands: new Map(),
        tools: new Map(),
        systemSizes: [],
        models: new Map(),
        idleCount: 0,
        errors: 0,
      }
      this.sessions.set(sessionID, s)
    }
    return s
  }

  private bump(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1)
  }

  get(sessionID: string): SessionStats | undefined {
    return this.sessions.get(sessionID)
  }

  ids(): string[] {
    return [...this.sessions.keys()]
  }

  event(ev: Event): void {
    switch (ev.type) {
      case "message.updated": {
        const info = ev.properties.info
        const s = this.ensure(info.sessionID)
        s.lastActivity = Date.now()
        if (info.role === "assistant") {
          if (!this.messagesSeen.has(info.id)) {
            this.messagesSeen.add(info.id)
            s.messages.assistant += 1
          }
          const prev = this.assistantUsage.get(info.id) ?? zeroUsage()
          const cur: Usage = {
            input: info.tokens.input,
            output: info.tokens.output,
            reasoning: info.tokens.reasoning,
            cacheRead: info.tokens.cache.read,
            cacheWrite: info.tokens.cache.write,
            cost: info.cost,
          }
          s.tokens.input += Math.max(0, cur.input - prev.input)
          s.tokens.output += Math.max(0, cur.output - prev.output)
          s.tokens.reasoning += Math.max(0, cur.reasoning - prev.reasoning)
          s.cacheRead += Math.max(0, cur.cacheRead - prev.cacheRead)
          s.cacheWrite += Math.max(0, cur.cacheWrite - prev.cacheWrite)
          s.cost += Math.max(0, cur.cost - prev.cost)
          this.assistantUsage.set(info.id, cur)
        } else if (!this.messagesSeen.has(info.id)) {
          this.messagesSeen.add(info.id)
          s.messages.user += 1
        }
        break
      }
      case "message.part.updated": {
        const part = ev.properties.part
        const s = this.ensure(part.sessionID)
        s.lastActivity = Date.now()
        if (!this.partsSeen.has(part.id)) {
          this.partsSeen.add(part.id)
          this.bump(s.parts, part.type)
        }
        break
      }
      case "message.part.removed": {
        const s = this.ensure(ev.properties.sessionID)
        s.lastActivity = Date.now()
        break
      }
      case "message.removed": {
        const s = this.ensure(ev.properties.sessionID)
        s.lastActivity = Date.now()
        break
      }
      case "session.created": {
        const info = ev.properties.info
        const s = this.ensure(info.id)
        s.created = info.time.created
        s.lastActivity = info.time.updated
        break
      }
      case "session.updated": {
        const info = ev.properties.info
        const s = this.ensure(info.id)
        s.lastActivity = info.time.updated
        break
      }
      case "session.deleted": {
        const info = ev.properties.info
        const s = this.ensure(info.id)
        s.lastActivity = info.time.updated
        break
      }
      case "session.compacted": {
        const s = this.ensure(ev.properties.sessionID)
        s.compactions.push(Date.now())
        s.lastActivity = Date.now()
        break
      }
      case "session.idle": {
        const s = this.ensure(ev.properties.sessionID)
        s.idleCount += 1
        break
      }
      case "session.status": {
        const s = this.ensure(ev.properties.sessionID)
        s.lastActivity = Date.now()
        break
      }
      case "session.error": {
        const s = this.ensure(ev.properties.sessionID ?? "unknown")
        s.errors += 1
        s.lastActivity = Date.now()
        break
      }
      case "command.executed": {
        const s = this.ensure(ev.properties.sessionID)
        this.bump(s.commands, ev.properties.name)
        s.lastActivity = Date.now()
        break
      }
      case "todo.updated": {
        const s = this.ensure(ev.properties.sessionID)
        s.lastActivity = Date.now()
        break
      }
      case "permission.updated": {
        const s = this.ensure(ev.properties.sessionID)
        s.lastActivity = Date.now()
        break
      }
      case "permission.replied": {
        const s = this.ensure(ev.properties.sessionID)
        s.lastActivity = Date.now()
        break
      }
      default:
        break
    }
  }

  toolStart(callID: string, sessionID: string, tool: string, start = Date.now()): void {
    this.inFlight.set(callID, { sessionID, tool, start })
  }

  toolEnd(callID: string, failed = false, end = Date.now()): void {
    const entry = this.inFlight.get(callID)
    if (!entry) return
    this.inFlight.delete(callID)
    const s = this.ensure(entry.sessionID)
    const duration = Math.max(0, end - entry.start)
    const stat =
      s.tools.get(entry.tool) ?? { calls: 0, totalMs: 0, failed: 0, first: end, last: end }
    stat.calls += 1
    stat.totalMs += duration
    if (failed) stat.failed += 1
    stat.last = end
    s.tools.set(entry.tool, stat)
    s.lastActivity = end
  }

  systemTransform(sessionID: string | undefined, chars: number): void {
    if (!sessionID) return
    const s = this.ensure(sessionID)
    s.systemSizes.push(chars)
    if (s.systemSizes.length > SYSTEM_SIZES_CAP) {
      s.systemSizes.splice(0, s.systemSizes.length - SYSTEM_SIZES_CAP)
    }
  }

  prompt(sessionID: string, modelID: string): void {
    const s = this.ensure(sessionID)
    this.bump(s.models, modelID)
    s.lastActivity = Date.now()
  }

  summary(sessionID: string): string {
    const s = this.sessions.get(sessionID)
    if (!s) return `statin: no recorded data for session ${sessionID}`

    const lines: string[] = []
    lines.push(`statin: session ${s.id}`)
    lines.push(`  created: ${iso(s.created)}`)
    lines.push(`  last activity: ${iso(s.lastActivity)}`)
    lines.push(`  messages: user=${s.messages.user} assistant=${s.messages.assistant}`)
    lines.push(`  parts: ${fmtMap(s.parts)}`)

    const toolCount = [...s.tools.values()].reduce((acc, t) => acc + t.calls, 0)
    const toolFailed = [...s.tools.values()].reduce((acc, t) => acc + t.failed, 0)
    lines.push(`  tools: ${toolCount} call(s) across ${s.tools.size} tool(s), failed=${toolFailed}`)
    for (const [name, t] of [...s.tools.entries()].sort((a, b) => b[1].calls - a[1].calls)) {
      const avg = t.calls > 0 ? t.totalMs / t.calls : 0
      lines.push(
        `    - ${name}: calls=${t.calls} total=${fmtDuration(t.totalMs)} avg=${fmtDuration(avg)} failed=${t.failed}`,
      )
    }

    lines.push(
      `  tokens: input=${s.tokens.input} output=${s.tokens.output} reasoning=${s.tokens.reasoning}`,
    )
    lines.push(`  cache: read=${s.cacheRead} write=${s.cacheWrite}`)
    lines.push(`  cost: ${s.cost}`)

    if (s.compactions.length === 0) {
      lines.push("  compactions: 0")
    } else {
      lines.push(
        `  compactions: ${s.compactions.length} (last at ${iso(s.compactions[s.compactions.length - 1])})`,
      )
    }

    lines.push(`  commands: ${fmtMap(s.commands)}`)
    lines.push(`  models: ${fmtMap(s.models)}`)
    lines.push(`  idle events: ${s.idleCount}`)
    lines.push(`  errors: ${s.errors}`)

    if (s.systemSizes.length === 0) {
      lines.push("  system prompt size: no samples")
    } else {
      const last = s.systemSizes[s.systemSizes.length - 1]
      const max = Math.max(...s.systemSizes)
      const sum = s.systemSizes.reduce((acc, n) => acc + n, 0)
      const avg = Math.round(sum / s.systemSizes.length)
      lines.push(
        `  system prompt size: last=${fmtChars(last)} chars samples=${s.systemSizes.length} avg=${fmtChars(avg)} max=${fmtChars(max)}`,
      )
    }

    return lines.join("\n")
  }
}
