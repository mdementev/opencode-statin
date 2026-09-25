import { test } from "node:test"
import assert from "node:assert/strict"
import { join } from "node:path"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { UsageStore } from "./usage.ts"

const dir = (): string => mkdtempSync(join(tmpdir(), "usage-"))

test("records counts per tool:argument", () => {
  const d = dir()
  try {
    const store = new UsageStore(d)
    const project = "proj"
    store.record(project, "read", { filePath: "/repo/src/foo.ts" }, "/repo")
    store.record(project, "read", { filePath: "/repo/src/foo.ts" }, "/repo")
    store.record(project, "grep", { pattern: "class Bar" }, "/repo")
    assert.deepEqual(
      store.top(project, 10),
      [
        ["read:src/foo.ts", 2],
        ["grep:class Bar", 1],
      ],
    )
    assert.equal(store.totals(project), 3)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test("read paths are relativized against the project directory", () => {
  const d = dir()
  try {
    const store = new UsageStore(d)
    store.record("p", "read", { filePath: "/work/repo/lib/api.ts" }, "/work/repo")
    assert.deepEqual(store.top("p", 10), [["read:lib/api.ts", 1]])
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test("paths outside the project stay absolute", () => {
  const d = dir()
  try {
    const store = new UsageStore(d)
    store.record("p", "read", { filePath: "/other/place/config.json" }, "/work/repo")
    assert.deepEqual(store.top("p", 10), [["read:/other/place/config.json", 1]])
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test("non-tracked tools are ignored", () => {
  const d = dir()
  try {
    const store = new UsageStore(d)
    store.record("p", "bash", { command: "rm -rf /" }, "/repo")
    store.record("p", "edit", { filePath: "a.ts" }, "/repo")
    assert.deepEqual(store.top("p", 10), [])
    assert.equal(store.totals("p"), 0)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test("granularity is per project", () => {
  const d = dir()
  try {
    const store = new UsageStore(d)
    store.record("repo-a", "read", { filePath: "src/foo.ts" }, "/repo-a")
    store.record("repo-b", "read", { filePath: "src/foo.ts" }, "/repo-b")
    assert.equal(store.totals("repo-a"), 1)
    assert.equal(store.totals("repo-b"), 1)
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test("entries older than the ttl are pruned on load", () => {
  const d = dir()
  try {
    const old = Date.now() - 10 * 24 * 60 * 60 * 1000
    const fresh = Date.now()
    writeFileSync(
      join(d, "usage.json"),
      JSON.stringify({
        proj: {
          "read:stale.ts": { count: 9, first: old, last: old },
          "read:fresh.ts": { count: 2, first: fresh, last: fresh },
        },
      }),
    )
    const reloaded = new UsageStore(d, 7)
    assert.deepEqual(reloaded.top("proj", 10), [["read:fresh.ts", 2]])
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})

test("save persists and reload restores counts", () => {
  const d = dir()
  try {
    const store = new UsageStore(d)
    store.record("p", "read", { filePath: "/repo/a.ts" }, "/repo")
    store.save()
    const raw = JSON.parse(readFileSync(join(d, "usage.json"), "utf8"))
    assert.equal(raw.p["read:a.ts"].count, 1)
    const reloaded = new UsageStore(d)
    assert.deepEqual(reloaded.top("p", 10), [["read:a.ts", 1]])
  } finally {
    rmSync(d, { recursive: true, force: true })
  }
})