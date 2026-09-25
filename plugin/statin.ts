import type { Plugin } from "@opencode-ai/plugin"
import type { Event, Part } from "@opencode-ai/sdk"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { summarizeEvent } from "../src/events.ts"
import { JsonlLogger, DEFAULT_MAX_BYTES } from "../src/logfile.ts"
import { Ring, StatStore } from "../src/store.ts"
import { DEFAULT_USAGE_TTL_DAYS, UsageStore } from "../src/usage.ts"

const RECENT_EVENTS = 40

export type StatinConfig = {
  logDir: string
  maxLogBytes: number
  ringSize: number
  logPartUpdated: boolean
  eventLog: boolean
  usageTtlDays: number
}

function defaultConfig(): StatinConfig {
  return {
    logDir: join(homedir(), ".config", "opencode", "statin"),
    maxLogBytes: DEFAULT_MAX_BYTES,
    ringSize: 5000,
    logPartUpdated: false,
    eventLog: false,
    usageTtlDays: DEFAULT_USAGE_TTL_DAYS,
  }
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null
    const raw = JSON.parse(readFileSync(path, "utf8"))
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function loadConfig(): StatinConfig {
  const base = defaultConfig()
  const configDir = join(homedir(), ".config", "opencode")
  const raw =
    readJson(join(configDir, "statin.json")) ?? readJson(join(configDir, "opencode-statin.json"))
  if (!raw) return base
  const logDir =
    typeof raw.logDir === "string" && raw.logDir.trim() ? raw.logDir.trim() : base.logDir
  const maxLogBytes =
    typeof raw.maxLogBytes === "number" && raw.maxLogBytes > 0 ? raw.maxLogBytes : base.maxLogBytes
  const ringSize =
    typeof raw.ringSize === "number" && raw.ringSize > 0
      ? Math.floor(raw.ringSize)
      : base.ringSize
  const logPartUpdated = raw.logPartUpdated === true
  const eventLog = raw.eventLog === true
  const usageTtlDays =
    typeof raw.usageTtlDays === "number" && raw.usageTtlDays > 0
      ? Math.floor(raw.usageTtlDays)
      : base.usageTtlDays
  return { logDir, maxLogBytes, ringSize, logPartUpdated, eventLog, usageTtlDays }
}

const isFailed = (metadata: unknown): boolean => {
  if (!metadata || typeof metadata !== "object") return false
  const meta = metadata as Record<string, unknown>
  return "error" in meta || meta.status === "error"
}

export const Statin: Plugin = async (input) => {
  const config = loadConfig()
  const logger = config.eventLog ? new JsonlLogger(config.logDir, config.maxLogBytes) : null
  const usage = new UsageStore(config.logDir, config.usageTtlDays)
  const ring = new Ring(config.ringSize)
  const store = new StatStore()
  const project = input?.directory ? basename(input.directory) : "(unknown)"
  const directory = input?.directory

  return {
    dispose: async () => {
      usage.save()
      logger?.close()
    },
    event: async ({ event }: { event: Event }) => {
      try {
        const s = summarizeEvent(event)
        ring.push(s.type, s.text, s.sessionID)
        store.event(event)
        if (logger && (config.logPartUpdated || !s.noisy)) {
          logger.write({ t: Date.now(), type: s.type, sessionID: s.sessionID, text: s.text })
        }
      } catch {
        // telemetry must never break the session
      }
    },
    "tool.execute.before": async (input) => {
      try {
        store.toolStart(input.callID, input.sessionID, input.tool)
      } catch {
        // telemetry must never break the session
      }
    },
    "tool.execute.after": async (input, output) => {
      try {
        store.toolEnd(input.callID, isFailed(output?.metadata))
        usage.record(project, input.tool, input.args, directory)
      } catch {
        // telemetry must never break the session
      }
    },
    "chat.params": async (input) => {
      try {
        store.prompt(input.sessionID, input.model.id)
      } catch {
        // telemetry must never break the session
      }
    },
    "experimental.chat.system.transform": async (input, output) => {
      try {
        store.systemTransform(input.sessionID, output.system.join("\n").length)
      } catch {
        // telemetry must never break the session
      }
    },
    "command.execute.before": async (input, output) => {
      try {
        if (input.command === "statin") {
          const text =
            store.summary(input.sessionID) +
            "\n\nInformational only \u2014 reply with one short confirmation and take no further action."
          // prompt.ts keeps its own reference to the parts array, so the hook
          // must mutate it in place instead of rebinding output.parts
          output.parts.splice(0, output.parts.length, {
            type: "text",
            synthetic: true,
            text,
          } as Part)
        } else if (input.command === "statin-events") {
          const recent = ring.recent(RECENT_EVENTS)
          const counts = [...ring.countByType().entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")
          const lines = recent.map((it) => {
            const head = `${new Date(it.t).toISOString()} ${it.type}`
            const sess = it.sessionID ? ` [${it.sessionID}]` : ""
            const detail = it.text ? ` ${it.text}` : ""
            return `${head}${sess}${detail}`
          })
          const usageTop = usage.top(project, 10).map(([k, v]) => `${k}=${v}`).join(", ")
          const text = [
            `statin: last ${recent.length} events (ring size ${ring.size})`,
            `log: ${logger ? logger.path : "(event log disabled)"}`,
            `counts: ${counts || "(none)"}`,
            "",
            `usage (${project}, ttl ${usage.ttlDays}d): ${usageTop || "(none)"}`,
            `usage file: ${usage.path}`,
            "",
            ...lines,
            "",
            "Informational only \u2014 reply with one short confirmation and take no further action.",
          ].join("\n")
          output.parts.splice(0, output.parts.length, {
            type: "text",
            synthetic: true,
            text,
          } as Part)
        }
      } catch {
        // telemetry must never break the session
      }
    },
  }
}
