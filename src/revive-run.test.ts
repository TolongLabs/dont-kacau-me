import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildArgv, type Deps, type RunResult, runSupervised } from './revive-run'

const NOW = new Date('2026-09-04T10:00:00.000Z')

function limitJson(sessionId: string, resetsIn: string): string {
  return JSON.stringify({
    type: 'result',
    is_error: true,
    api_error_status: 429,
    session_id: sessionId,
    result: `Usage limit reached. Try again until your limit resets at ${resetsIn}.`
  })
}

function doneJson(sessionId: string, result: string): string {
  return JSON.stringify({ type: 'result', is_error: false, subtype: 'success', session_id: sessionId, result })
}

function harness(outputs: string[]) {
  const calls: string[][] = []
  const slept: number[] = []
  const logged: string[] = []
  const deps: Deps = {
    run: (argv): RunResult => {
      calls.push(argv)
      return { stdout: outputs[calls.length - 1] ?? '', stderr: '', status: 0 }
    },
    sleep: (ms) => {
      slept.push(ms)
    },
    now: () => NOW,
    log: (line) => {
      logged.push(line)
    }
  }
  return { deps, calls, slept, logged }
}

function withRoot<T>(fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'dkm-revive-'))
  try {
    return fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('buildArgv', () => {
  it('starts a fresh session with the prompt', () => {
    const argv = buildArgv(
      { root: '/r', prompt: 'do the thing', claudeArgs: ['--effort', 'high'], maxAttempts: 3 },
      null
    )
    expect(argv).toEqual([
      'claude',
      '--output-format',
      'json',
      '--permission-mode',
      'default',
      '--permission-prompts',
      'none',
      '--effort',
      'high',
      '-p',
      'do the thing'
    ])
  })

  it('resumes by session id instead of restarting the prompt', () => {
    const argv = buildArgv({ root: '/r', prompt: 'do the thing', claudeArgs: [], maxAttempts: 3 }, 'sess-9')
    // Re-sending the original prompt would repeat work already done before the limit.
    expect(argv).toContain('--resume')
    expect(argv[argv.indexOf('--resume') + 1]).toBe('sess-9')
    expect(argv).not.toContain('do the thing')
  })
})

describe('runSupervised', () => {
  it('returns immediately when the first run finishes', () => {
    withRoot((root) => {
      const h = harness([doneJson('s1', 'all done')])
      const report = runSupervised({ root, prompt: 'go', claudeArgs: [], maxAttempts: 5 }, h.deps)
      expect(report.attempts).toBe(1)
      expect(report.outcome.kind).toBe('done')
      expect(h.slept).toEqual([])
    })
  })

  it('waits for the stated reset and resumes the same session', () => {
    withRoot((root) => {
      const h = harness([limitJson('s1', '2026-09-04T12:00:00Z'), doneJson('s1', 'finished after the pause')])
      const report = runSupervised({ root, prompt: 'go', claudeArgs: [], maxAttempts: 5 }, h.deps)

      expect(report.outcome.kind).toBe('done')
      expect(report.attempts).toBe(2)
      // Two hours to the reset, plus the 30s cushion.
      expect(h.slept).toEqual([2 * 60 * 60 * 1000 + 30_000])
      expect(h.calls[0]).not.toContain('--resume')
      expect(h.calls[1]).toContain('--resume')
      expect(h.calls[1]?.[h.calls[1].indexOf('--resume') + 1]).toBe('s1')
    })
  })

  it('survives several consecutive limits', () => {
    withRoot((root) => {
      const h = harness([
        limitJson('s1', '2026-09-04T11:00:00Z'),
        limitJson('s1', '2026-09-04T12:00:00Z'),
        doneJson('s1', 'third time')
      ])
      const report = runSupervised({ root, prompt: 'go', claudeArgs: [], maxAttempts: 5 }, h.deps)
      expect(report.attempts).toBe(3)
      expect(report.outcome.kind).toBe('done')
      expect(h.slept).toHaveLength(2)
    })
  })

  it('stops on a real error instead of retrying it forever', () => {
    withRoot((root) => {
      const h = harness([JSON.stringify({ is_error: true, subtype: 'error_during_execution', session_id: 's1' })])
      const report = runSupervised({ root, prompt: 'go', claudeArgs: [], maxAttempts: 5 }, h.deps)
      expect(report.outcome.kind).toBe('failed')
      expect(h.calls).toHaveLength(1)
    })
  })

  it('refuses to restart when the limit left no session id to resume', () => {
    withRoot((root) => {
      // Restarting from the prompt would redo work already paid for and could repeat side effects.
      const h = harness([JSON.stringify({ is_error: true, api_error_status: 429, result: 'Usage limit reached.' })])
      const report = runSupervised({ root, prompt: 'go', claudeArgs: [], maxAttempts: 5 }, h.deps)
      expect(report.outcome.kind).toBe('limit')
      expect(h.calls).toHaveLength(1)
      expect(h.slept).toEqual([])
      expect(h.logged.join(' ')).toContain('cannot resume')
    })
  })

  it('gives up at maxAttempts rather than looping without end', () => {
    withRoot((root) => {
      const h = harness([limitJson('s1', '11:00'), limitJson('s1', '11:00'), limitJson('s1', '11:00')])
      const report = runSupervised({ root, prompt: 'go', claudeArgs: [], maxAttempts: 2 }, h.deps)
      expect(h.calls).toHaveLength(2)
      expect(report.outcome.kind).toBe('limit')
    })
  })

  it('records every pause in the revival log so a night can be reconstructed', () => {
    withRoot((root) => {
      const h = harness([limitJson('s1', '2026-09-04T12:00:00Z'), doneJson('s1', 'ok')])
      runSupervised({ root, prompt: 'go', claudeArgs: [], maxAttempts: 5 }, h.deps)
      const lines = readFileSync(join(root, '.dkm', 'revivals.jsonl'), 'utf8')
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => JSON.parse(l) as Record<string, unknown>)
      expect(lines.map((l) => l.event)).toEqual(['waiting', 'done'])
      expect(lines[0]?.waitMs).toBe(2 * 60 * 60 * 1000 + 30_000)
    })
  })
})
