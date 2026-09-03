import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type SessionReport = {
  narrative: string
  blockers: string[]
}

const EMPTY: SessionReport = { narrative: '', blockers: [] }

function reportPath(root: string, sessionId: string): string {
  return join(root, '.dkm', 'report', `${sessionId}.json`)
}

/**
 * The narrative and blockers are the only agent-authored parts of a receipt, and no hook payload
 * carries them. A session writes this file when it has something to say; silence is the default and
 * produces a receipt of measured fields only.
 */
export function readReport(root: string, sessionId: string): SessionReport {
  try {
    const raw = readFileSync(reportPath(root, sessionId), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY
    const p = parsed as Record<string, unknown>
    const narrative = typeof p.narrative === 'string' ? p.narrative : ''
    const blockers = Array.isArray(p.blockers) ? p.blockers.filter((b): b is string => typeof b === 'string') : []
    return { narrative, blockers }
  } catch {
    return EMPTY
  }
}

export function clearReport(root: string, sessionId: string): void {
  try {
    rmSync(reportPath(root, sessionId), { force: true })
  } catch {
    return
  }
}

export function writeReport(root: string, sessionId: string, report: SessionReport): void {
  const dir = join(root, '.dkm', 'report')
  mkdirSync(dir, { recursive: true })
  const path = reportPath(root, sessionId)
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(report), 'utf8')
  renameSync(tmp, path)
}
