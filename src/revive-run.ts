import { spawnSync } from 'node:child_process'
import { classify, type Outcome, waitFor } from './revive'
import { appendRevival } from './store'

export type RunResult = { stdout: string; stderr: string; status: number }

export type Deps = {
  run: (argv: string[]) => RunResult
  sleep: (ms: number) => void
  now: () => Date
  log: (line: string) => void
}

export type ReviveOptions = {
  root: string
  prompt: string
  claudeArgs: string[]
  maxAttempts: number
}

export type ReviveReport = {
  attempts: number
  outcome: Outcome
  waited: number[]
}

function defaultRun(argv: string[]): RunResult {
  const r = spawnSync(argv[0] ?? 'claude', argv.slice(1), {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? 1 }
}

export const defaultDeps: Deps = {
  run: defaultRun,
  sleep: (ms) => {
    // Blocking on purpose. The supervisor's only job while a limit is in force is to still be here
    // when it lifts, and a timer that needs an event loop is one more thing that can quietly die.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  },
  now: () => new Date(),
  log: (line) => process.stderr.write(`${line}\n`)
}

/**
 * The first attempt starts a session; every later one resumes the same session by id, so the work
 * continues where the limit interrupted it rather than starting over. Losing the id means the run
 * cannot be resumed, and the supervisor stops rather than silently starting a second session that
 * repeats work already done.
 */
/**
 * `--permission-mode default` puts every prompt to DKM's hook, and `--permission-prompts none` tells
 * the harness that nobody else can answer: anything the policy does not allow is denied, the model
 * is told not to retry it, and the run continues. Measured live before this was written: an edit
 * the policy allowed went through, a write outside the worktree was denied, and the session
 * reported it did not retry. Without these two flags a headless run inherits `defaultMode` from
 * settings and may never consult the policy at all.
 */
export function buildArgv(options: ReviveOptions, sessionId: string | null): string[] {
  const base = [
    'claude',
    '--output-format',
    'json',
    '--permission-mode',
    'default',
    '--permission-prompts',
    'none',
    ...options.claudeArgs
  ]
  if (sessionId !== null) return [...base, '--resume', sessionId, '-p', 'Continue where you left off.']
  return [...base, '-p', options.prompt]
}

export function runSupervised(options: ReviveOptions, deps: Deps = defaultDeps): ReviveReport {
  const waited: number[] = []
  let sessionId: string | null = null
  let outcome: Outcome = { kind: 'failed', sessionId: null, detail: 'never ran' }

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    const argv = buildArgv(options, sessionId)
    const result = deps.run(argv)
    outcome = classify(result.stdout.trim() === '' ? result.stderr : result.stdout, deps.now())
    if (outcome.sessionId !== null) sessionId = outcome.sessionId

    if (outcome.kind === 'done') {
      appendRevival(options.root, { ts: deps.now().toISOString(), attempt, event: 'done', sessionId, waitMs: 0 })
      return { attempts: attempt, outcome, waited }
    }

    if (outcome.kind === 'failed') {
      appendRevival(options.root, {
        ts: deps.now().toISOString(),
        attempt,
        event: 'failed',
        sessionId,
        waitMs: 0,
        detail: outcome.detail
      })
      return { attempts: attempt, outcome, waited }
    }

    if (sessionId === null) {
      deps.log('dkm: usage limit reached but no session id was reported; cannot resume without repeating work')
      appendRevival(options.root, {
        ts: deps.now().toISOString(),
        attempt,
        event: 'unresumable',
        sessionId: null,
        waitMs: 0
      })
      return { attempts: attempt, outcome, waited }
    }

    if (attempt === options.maxAttempts) break

    const ms = waitFor(outcome, attempt, deps.now())
    waited.push(ms)
    const until = outcome.resetAt === null ? 'an unstated time' : outcome.resetAt.toISOString()
    deps.log(`dkm: usage limit reached; resuming ${sessionId} in ${Math.round(ms / 1000)}s (limit resets at ${until})`)
    appendRevival(options.root, {
      ts: deps.now().toISOString(),
      attempt,
      event: 'waiting',
      sessionId,
      waitMs: ms,
      detail: until
    })
    deps.sleep(ms)
  }

  return { attempts: options.maxAttempts, outcome, waited }
}
