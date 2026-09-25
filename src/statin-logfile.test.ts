import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { JsonlLogger } from "./statin-logfile.ts"

const makeDir = (): string => mkdtempSync(join(tmpdir(), "statin-log-"))

test("writes one JSON object per line", () => {
  const dir = makeDir()
  try {
    const logger = new JsonlLogger(dir, 1024 * 1024)
    logger.write({ t: 1, type: "session.created", sessionID: "ses_1", text: "title=x" })
    logger.write({ t: 2, type: "file.edited", text: "file=/tmp/a.ts" })
    logger.close()
    const lines = readFileSync(join(dir, "events.jsonl"), "utf8").trim().split("\n")
    assert.equal(lines.length, 2)
    const first = JSON.parse(lines[0])
    assert.equal(first.type, "session.created")
    assert.equal(first.sessionID, "ses_1")
    const second = JSON.parse(lines[1])
    assert.equal(second.sessionID, undefined)
    assert.equal(second.type, "file.edited")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rotates to events.jsonl.1 once maxBytes is exceeded", () => {
  const dir = makeDir()
  try {
    const logger = new JsonlLogger(dir, 120)
    for (let i = 0; i < 20; i++) {
      logger.write({ t: i, type: "message.part.updated", text: "x".repeat(40) })
    }
    logger.close()
    assert.ok(existsSync(join(dir, "events.jsonl")))
    assert.ok(existsSync(join(dir, "events.jsonl.1")))
    const backup = readFileSync(join(dir, "events.jsonl.1"), "utf8").trim()
    assert.ok(backup.length > 0)
    for (const line of backup.split("\n")) JSON.parse(line)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("append continues across logger instances", () => {
  const dir = makeDir()
  try {
    const first = new JsonlLogger(dir, 1024 * 1024)
    first.write({ t: 1, type: "a", text: "1" })
    first.close()
    const second = new JsonlLogger(dir, 1024 * 1024)
    second.write({ t: 2, type: "b", text: "2" })
    second.close()
    const lines = readFileSync(join(dir, "events.jsonl"), "utf8").trim().split("\n")
    assert.equal(lines.length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
