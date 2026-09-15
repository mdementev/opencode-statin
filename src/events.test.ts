import { test } from "node:test"
import assert from "node:assert/strict"
import type { Event } from "@opencode-ai/sdk"
import { summarizeEvent } from "./events.ts"

const ev = (value: unknown): Event => value as Event

test("assistant message.updated reports model, tokens and cost", () => {
  const s = summarizeEvent(
    ev({
      type: "message.updated",
      properties: {
        info: {
          id: "msg_1",
          sessionID: "ses_1",
          role: "assistant",
          time: { created: 1 },
          parentID: "msg_0",
          modelID: "claude-sonnet-4",
          providerID: "anthropic",
          mode: "build",
          path: { cwd: "/tmp", root: "/tmp" },
          cost: 0.0123,
          tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 10, write: 2 } },
          finish: "stop",
        },
      },
    }),
  )
  assert.equal(s.type, "message.updated")
  assert.equal(s.sessionID, "ses_1")
  assert.equal(s.noisy, false)
  assert.match(s.text, /role=assistant/)
  assert.match(s.text, /model=claude-sonnet-4/)
  assert.match(s.text, /input=100/)
  assert.match(s.text, /output=20/)
  assert.match(s.text, /reasoning=5/)
  assert.match(s.text, /cacheRead=10/)
  assert.match(s.text, /cost=0\.0123/)
})

test("user message.updated reports role and model", () => {
  const s = summarizeEvent(
    ev({
      type: "message.updated",
      properties: {
        info: {
          id: "msg_2",
          sessionID: "ses_1",
          role: "user",
          time: { created: 1 },
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
        },
      },
    }),
  )
  assert.equal(s.sessionID, "ses_1")
  assert.equal(s.noisy, false)
  assert.match(s.text, /role=user/)
  assert.match(s.text, /agent=build/)
  assert.match(s.text, /anthropic\/claude-sonnet-4/)
})

test("message.part.updated is noisy and names the part type", () => {
  const s = summarizeEvent(
    ev({
      type: "message.part.updated",
      properties: {
        part: { id: "prt_1", sessionID: "ses_1", messageID: "msg_1", type: "text", text: "hi" },
      },
    }),
  )
  assert.equal(s.noisy, true)
  assert.equal(s.sessionID, "ses_1")
  assert.match(s.text, /part=text/)
})

test("message.part.updated records delta length", () => {
  const s = summarizeEvent(
    ev({
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt_2",
          sessionID: "ses_1",
          messageID: "msg_1",
          type: "text",
          text: "hello",
        },
        delta: "lo",
      },
    }),
  )
  assert.match(s.text, /delta=2B/)
})

test("session.compacted carries the session id", () => {
  const s = summarizeEvent(ev({ type: "session.compacted", properties: { sessionID: "ses_2" } }))
  assert.equal(s.sessionID, "ses_2")
  assert.equal(s.noisy, false)
})

test("session.status reports the status type", () => {
  const s = summarizeEvent(
    ev({ type: "session.status", properties: { sessionID: "ses_1", status: { type: "busy" } } }),
  )
  assert.match(s.text, /status=busy/)
})

test("command.executed reports the command name", () => {
  const s = summarizeEvent(
    ev({
      type: "command.executed",
      properties: { name: "statin", sessionID: "ses_1", arguments: "", messageID: "msg_9" },
    }),
  )
  assert.equal(s.sessionID, "ses_1")
  assert.match(s.text, /command=statin/)
})

test("file.edited reports the file and has no session", () => {
  const s = summarizeEvent(ev({ type: "file.edited", properties: { file: "/tmp/a.ts" } }))
  assert.equal(s.sessionID, undefined)
  assert.match(s.text, /file=\/tmp\/a\.ts/)
})

test("session.error reports the error name", () => {
  const s = summarizeEvent(
    ev({
      type: "session.error",
      properties: { sessionID: "ses_1", error: { name: "UnknownError", data: { message: "x" } } },
    }),
  )
  assert.equal(s.sessionID, "ses_1")
  assert.match(s.text, /error=UnknownError/)
})

test("runtime-only event types keep their name and are logged", () => {
  const s = summarizeEvent(ev({ type: "plugin.added", properties: { id: "command" } }))
  assert.equal(s.type, "plugin.added")
  assert.equal(s.noisy, false)
})

test("message.part.delta is treated as noisy", () => {
  const s = summarizeEvent(
    ev({ type: "message.part.delta", properties: { sessionID: "ses_1", delta: "x" } }),
  )
  assert.equal(s.type, "message.part.delta")
  assert.equal(s.noisy, true)
})
