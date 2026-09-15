import { test } from "node:test"
import assert from "node:assert/strict"
import type { Event } from "@opencode-ai/sdk"
import { Ring, StatStore } from "./store.ts"

const ev = (value: unknown): Event => value as Event

const assistant = (id: string, input: number, output: number, cost: number): Event =>
  ev({
    type: "message.updated",
    properties: {
      info: {
        id,
        sessionID: "ses_1",
        role: "assistant",
        time: { created: 1 },
        parentID: "msg_0",
        modelID: "claude-sonnet-4",
        providerID: "anthropic",
        mode: "build",
        path: { cwd: "/tmp", root: "/tmp" },
        cost,
        tokens: { input, output, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    },
  })

const user = (id: string): Event =>
  ev({
    type: "message.updated",
    properties: {
      info: {
        id,
        sessionID: "ses_1",
        role: "user",
        time: { created: 1 },
        agent: "build",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      },
    },
  })

const part = (id: string, type: string): Event =>
  ev({
    type: "message.part.updated",
    properties: { part: { id, sessionID: "ses_1", messageID: "msg_1", type, text: "x" } },
  })

test("messages are counted once per id", () => {
  const store = new StatStore()
  store.event(user("msg_u1"))
  store.event(user("msg_u1"))
  store.event(assistant("msg_a1", 10, 1, 0))
  store.event(assistant("msg_a1", 10, 1, 0))
  const s = store.get("ses_1")
  assert.equal(s?.messages.user, 1)
  assert.equal(s?.messages.assistant, 1)
})

test("token usage accumulates deltas across updates", () => {
  const store = new StatStore()
  store.event(assistant("msg_a1", 100, 20, 0.01))
  store.event(assistant("msg_a1", 250, 40, 0.03))
  const s = store.get("ses_1")
  assert.equal(s?.tokens.input, 250)
  assert.equal(s?.tokens.output, 40)
  assert.equal(s?.cost, 0.03)
})

test("parts are counted once per part id", () => {
  const store = new StatStore()
  store.event(part("prt_1", "text"))
  store.event(part("prt_1", "text"))
  store.event(part("prt_2", "reasoning"))
  const s = store.get("ses_1")
  assert.equal(s?.parts.get("text"), 1)
  assert.equal(s?.parts.get("reasoning"), 1)
})

test("tool timing is recorded on toolEnd", () => {
  const store = new StatStore()
  store.toolStart("call_1", "ses_1", "bash", 1000)
  store.toolEnd("call_1", false, 1250)
  store.toolStart("call_2", "ses_1", "bash", 2000)
  store.toolEnd("call_2", true, 2100)
  const t = store.get("ses_1")?.tools.get("bash")
  assert.equal(t?.calls, 2)
  assert.equal(t?.totalMs, 350)
  assert.equal(t?.failed, 1)
})

test("system sizes are capped", () => {
  const store = new StatStore()
  for (let i = 0; i < 250; i++) store.systemTransform("ses_1", i)
  assert.equal(store.get("ses_1")?.systemSizes.length, 200)
})

test("system transform without a session id is ignored", () => {
  const store = new StatStore()
  store.systemTransform(undefined, 10)
  assert.equal(store.ids().length, 0)
})

test("models are counted per prompt", () => {
  const store = new StatStore()
  store.prompt("ses_1", "claude-sonnet-4")
  store.prompt("ses_1", "claude-sonnet-4")
  store.prompt("ses_1", "gpt-5")
  assert.equal(store.get("ses_1")?.models.get("claude-sonnet-4"), 2)
  assert.equal(store.get("ses_1")?.models.get("gpt-5"), 1)
})

test("compactions are timestamped", () => {
  const store = new StatStore()
  store.event(ev({ type: "session.compacted", properties: { sessionID: "ses_1" } }))
  assert.equal(store.get("ses_1")?.compactions.length, 1)
})

test("summary contains key facts and no data case is handled", () => {
  const store = new StatStore()
  store.event(user("msg_u1"))
  store.event(assistant("msg_a1", 100, 20, 0.5))
  store.toolStart("call_1", "ses_1", "bash", 1000)
  store.toolEnd("call_1", false, 3000)
  const text = store.summary("ses_1")
  assert.match(text, /session ses_1/)
  assert.match(text, /messages: user=1 assistant=1/)
  assert.match(text, /bash: calls=1 total=2\.0s/)
  assert.match(text, /tokens: input=100 output=20/)
  assert.equal(store.summary("ses_missing"), "statin: no recorded data for session ses_missing")
})

test("ring keeps only the most recent items and counts by type", () => {
  const ring = new Ring(3)
  ring.push("a", "1")
  ring.push("b", "2")
  ring.push("a", "3")
  ring.push("c", "4")
  assert.equal(ring.size, 3)
  assert.deepEqual(
    ring.recent(10).map((i) => i.text),
    ["2", "3", "4"],
  )
  const counts = ring.countByType()
  assert.equal(counts.get("a"), 1)
  assert.equal(counts.get("b"), 1)
  assert.equal(counts.get("c"), 1)
})
