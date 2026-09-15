import type { Event } from "@opencode-ai/sdk"

export type EventSummary = {
  type: string
  sessionID?: string
  text: string
  noisy: boolean
}

const fmtCost = (cost: number): string =>
  cost === 0 ? "0" : cost < 0.001 ? cost.toExponential(2) : cost.toFixed(4)

export function summarizeEvent(ev: Event): EventSummary {
  switch (ev.type) {
    case "message.updated": {
      const info = ev.properties.info
      if (info.role === "assistant") {
        const t = info.tokens
        return {
          type: ev.type,
          sessionID: info.sessionID,
          text:
            `role=assistant model=${info.modelID} mode=${info.mode} finish=${info.finish ?? "-"} ` +
            `tokens(input=${t.input},output=${t.output},reasoning=${t.reasoning},` +
            `cacheRead=${t.cache.read},cacheWrite=${t.cache.write}) cost=${fmtCost(info.cost)}`,
          noisy: false,
        }
      }
      return {
        type: ev.type,
        sessionID: info.sessionID,
        text: `role=user agent=${info.agent} model=${info.model.providerID}/${info.model.modelID}`,
        noisy: false,
      }
    }
    case "message.removed":
      return {
        type: ev.type,
        sessionID: ev.properties.sessionID,
        text: `messageID=${ev.properties.messageID}`,
        noisy: false,
      }
    case "message.part.updated":
      return {
        type: ev.type,
        sessionID: ev.properties.part.sessionID,
        text:
          `part=${ev.properties.part.type}` +
          (ev.properties.delta ? ` delta=${ev.properties.delta.length}B` : ""),
        noisy: true,
      }
    case "message.part.removed":
      return {
        type: ev.type,
        sessionID: ev.properties.sessionID,
        text: `messageID=${ev.properties.messageID} partID=${ev.properties.partID}`,
        noisy: false,
      }
    case "permission.updated": {
      const p = ev.properties
      return {
        type: ev.type,
        sessionID: p.sessionID,
        text: `id=${p.id} type=${p.type} title=${p.title}`,
        noisy: false,
      }
    }
    case "permission.replied":
      return {
        type: ev.type,
        sessionID: ev.properties.sessionID,
        text: `permissionID=${ev.properties.permissionID} response=${ev.properties.response}`,
        noisy: false,
      }
    case "session.status":
      return {
        type: ev.type,
        sessionID: ev.properties.sessionID,
        text: `status=${ev.properties.status.type}`,
        noisy: false,
      }
    case "session.idle":
      return { type: ev.type, sessionID: ev.properties.sessionID, text: "", noisy: false }
    case "session.compacted":
      return { type: ev.type, sessionID: ev.properties.sessionID, text: "", noisy: false }
    case "file.edited":
      return { type: ev.type, text: `file=${ev.properties.file}`, noisy: false }
    case "todo.updated":
      return {
        type: ev.type,
        sessionID: ev.properties.sessionID,
        text: `todos=${ev.properties.todos.length}`,
        noisy: false,
      }
    case "command.executed":
      return {
        type: ev.type,
        sessionID: ev.properties.sessionID,
        text: `command=${ev.properties.name}`,
        noisy: false,
      }
    case "session.created":
      return {
        type: ev.type,
        sessionID: ev.properties.info.id,
        text: `title=${ev.properties.info.title}`,
        noisy: false,
      }
    case "session.updated":
      return {
        type: ev.type,
        sessionID: ev.properties.info.id,
        text: `title=${ev.properties.info.title}`,
        noisy: false,
      }
    case "session.deleted":
      return {
        type: ev.type,
        sessionID: ev.properties.info.id,
        text: `title=${ev.properties.info.title}`,
        noisy: false,
      }
    case "session.diff":
      return {
        type: ev.type,
        sessionID: ev.properties.sessionID,
        text: `files=${ev.properties.diff.length}`,
        noisy: false,
      }
    case "session.error": {
      const e = ev.properties.error
      return {
        type: ev.type,
        sessionID: ev.properties.sessionID,
        text: e ? `error=${e.name}` : "error=(none)",
        noisy: false,
      }
    }
    case "file.watcher.updated":
      return {
        type: ev.type,
        text: `file=${ev.properties.file} event=${ev.properties.event}`,
        noisy: false,
      }
    case "vcs.branch.updated":
      return { type: ev.type, text: `branch=${ev.properties.branch ?? "(none)"}`, noisy: false }
    case "tui.prompt.append":
      return { type: ev.type, text: `chars=${ev.properties.text.length}`, noisy: false }
    case "tui.command.execute":
      return { type: ev.type, text: `command=${ev.properties.command}`, noisy: false }
    case "tui.toast.show":
      return {
        type: ev.type,
        text: `variant=${ev.properties.variant} message=${ev.properties.message}`,
        noisy: false,
      }
    case "pty.created":
      return {
        type: ev.type,
        text: `title=${ev.properties.info.title} pid=${ev.properties.info.pid}`,
        noisy: false,
      }
    case "pty.updated":
      return {
        type: ev.type,
        text: `title=${ev.properties.info.title} status=${ev.properties.info.status}`,
        noisy: false,
      }
    case "pty.exited":
      return {
        type: ev.type,
        text: `id=${ev.properties.id} exitCode=${ev.properties.exitCode}`,
        noisy: false,
      }
    case "pty.deleted":
      return { type: ev.type, text: `id=${ev.properties.id}`, noisy: false }
    case "server.connected":
      return { type: ev.type, text: "", noisy: false }
    case "server.instance.disposed":
      return { type: ev.type, text: `directory=${ev.properties.directory}`, noisy: false }
    case "installation.updated":
      return { type: ev.type, text: `version=${ev.properties.version}`, noisy: false }
    case "installation.update-available":
      return { type: ev.type, text: `version=${ev.properties.version}`, noisy: false }
    case "lsp.client.diagnostics":
      return {
        type: ev.type,
        text: `serverID=${ev.properties.serverID} path=${ev.properties.path}`,
        noisy: false,
      }
    case "lsp.updated":
      return { type: ev.type, text: "", noisy: false }
    default: {
      // The runtime emits event types that are not part of the SDK Event union
      // (e.g. plugin.added, catalog.updated, message.part.delta). Keep the real
      // type name and only treat streaming part deltas as noisy.
      const unhandled: never = ev
      const raw = unhandled as unknown as { type?: string }
      const type = typeof raw?.type === "string" ? raw.type : "unknown"
      return {
        type,
        text: JSON.stringify(raw),
        noisy: type === "message.part.delta" || type === "message.part.updated",
      }
    }
  }
}
