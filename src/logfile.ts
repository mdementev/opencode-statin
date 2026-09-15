import { closeSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs"
import { join } from "node:path"

export type LogRow = {
  t: number
  type: string
  sessionID?: string
  text: string
}

export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024

function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

export class JsonlLogger {
  readonly dir: string
  readonly path: string
  readonly maxBytes: number
  private fd: number | null = null
  private bytes = 0
  private closed = false

  constructor(dir: string, maxBytes = DEFAULT_MAX_BYTES) {
    this.dir = dir
    this.path = join(dir, "events.jsonl")
    this.maxBytes = maxBytes > 0 ? maxBytes : DEFAULT_MAX_BYTES
    try {
      mkdirSync(dir, { recursive: true })
    } catch {
      // a failure here is non-fatal; writes below degrade safely
    }
    this.bytes = fileSize(this.path)
    this.fd = this.open()
  }

  private open(): number | null {
    try {
      return openSync(this.path, "a")
    } catch {
      return null
    }
  }

  private rotate(): void {
    try {
      if (this.fd !== null) closeSync(this.fd)
    } catch {
      // ignore
    }
    this.fd = null
    const backup = `${this.path}.1`
    try {
      rmSync(backup, { force: true })
    } catch {
      // ignore
    }
    try {
      renameSync(this.path, backup)
    } catch {
      // ignore; if rename fails we keep appending to the same file
    }
    this.fd = this.open()
    this.bytes = fileSize(this.path)
  }

  write(row: LogRow): void {
    if (this.closed) return
    try {
      if (this.fd === null) {
        this.fd = this.open()
        if (this.fd === null) return
        this.bytes = fileSize(this.path)
      }
      const line = JSON.stringify(row) + "\n"
      writeSync(this.fd, line)
      this.bytes += Buffer.byteLength(line)
      if (this.bytes >= this.maxBytes) this.rotate()
    } catch {
      // logging must never break the session
    }
  }

  close(): void {
    this.closed = true
    try {
      if (this.fd !== null) closeSync(this.fd)
    } catch {
      // ignore
    }
    this.fd = null
  }
}
