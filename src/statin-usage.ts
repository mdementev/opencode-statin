import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join, relative } from "node:path"

export type UsageEntry = {
  count: number
  first: number
  last: number
}

type ProjectUsage = Record<string, UsageEntry>
type UsageData = Record<string, ProjectUsage>

export const DEFAULT_USAGE_TTL_DAYS = 7
export const TRACKED_TOOLS = ["read", "grep"] as const

const DAY_MS = 24 * 60 * 60 * 1000

const ARG_KEYS: Record<string, string[]> = {
  read: ["filePath", "path"],
  grep: ["pattern", "query", "include"],
}

function pickArg(args: unknown, keys: string[]): string | undefined {
  if (!args || typeof args !== "object") return undefined
  const a = args as Record<string, unknown>
  for (const key of keys) {
    const value = a[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

function renderArg(tool: string, args: unknown, directory: string | undefined): string {
  const arg = pickArg(args, ARG_KEYS[tool] ?? [])
  if (arg === undefined) {
    try {
      return JSON.stringify(args ?? {})
    } catch {
      return ""
    }
  }
  if (tool === "read" && directory) {
    const rel = relative(directory, arg)
    if (rel && !rel.startsWith("..")) return rel
    if (rel === "") return basename(arg)
  }
  return arg
}

export class UsageStore {
  readonly dir: string
  readonly path: string
  readonly ttlDays: number
  private data: UsageData = {}
  private timer: ReturnType<typeof setTimeout> | null = null
  private dirty = false

  constructor(dir: string, ttlDays = DEFAULT_USAGE_TTL_DAYS) {
    this.dir = dir
    this.path = join(dir, "usage.json")
    this.ttlDays = ttlDays > 0 ? ttlDays : DEFAULT_USAGE_TTL_DAYS
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.path)) return
      const raw: unknown = JSON.parse(readFileSync(this.path, "utf8"))
      if (!raw || typeof raw !== "object") return
      this.data = raw as UsageData
      this.prune(Date.now())
    } catch {
      this.data = {}
    }
  }

  private prune(now: number): void {
    const cutoff = now - this.ttlDays * DAY_MS
    for (const project of Object.keys(this.data)) {
      const usages = this.data[project]
      for (const key of Object.keys(usages)) {
        if (usages[key].last < cutoff) delete usages[key]
      }
      if (Object.keys(usages).length === 0) delete this.data[project]
    }
  }

  record(
    project: string,
    tool: string,
    args: unknown,
    directory?: string,
    now = Date.now(),
  ): void {
    if (!TRACKED_TOOLS.includes(tool as (typeof TRACKED_TOOLS)[number])) return
    const key = `${tool}:${renderArg(tool, args, directory)}`
    if (key === tool + ":") return
    const p = this.data[project] ?? (this.data[project] = {})
    const entry = p[key]
    if (entry) {
      entry.count += 1
      entry.last = now
    } else {
      p[key] = { count: 1, first: now, last: now }
    }
    this.dirty = true
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.save()
    }, 2000)
  }

  save(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.dirty) return
    this.dirty = false
    try {
      mkdirSync(this.dir, { recursive: true })
      writeFileSync(this.path, JSON.stringify(this.data, null, 2) + "\n")
    } catch {
      // usage tracking must never break the session
    }
  }

  top(project: string, n = 10): Array<[string, number]> {
    const p = this.data[project]
    if (!p) return []
    return Object.entries(p)
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .slice(0, n)
      .map(([k, v]) => [k, v.count] as [string, number])
  }

  totals(project: string): number {
    const p = this.data[project]
    if (!p) return 0
    return Object.values(p).reduce((acc, e) => acc + e.count, 0)
  }
}