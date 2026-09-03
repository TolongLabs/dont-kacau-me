import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'

type Response = { stdout: string; status?: number; stderr?: string }
type Fixture = Record<string, Response[]>

const fixturePath = process.env.FAKE_GH_FIXTURE
const logPath = process.env.FAKE_GH_LOG

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function matchPattern(argv: string[]): string | null {
  const [first, second] = argv
  if (first === 'pr' && second === 'list') return 'pr-list'
  if (first === 'api' && second !== undefined) {
    const path = second
    if (path.includes('/check-runs')) return 'check-runs'
    if (path.includes('/issues/comments/') && argv.includes('PATCH')) return 'comment-patch'
    if (path.endsWith('/comments') && argv.includes('POST')) return 'comment-create'
    if (path.endsWith('/comments')) return 'comment-list'
    if (path.includes('/issues?since=')) return 'issue-list'
    if (/\/issues\/\d+$/.test(path)) return 'issue-get'
  }
  if (first === 'repo' && second === 'view') return 'repo-view'
  return null
}

async function main(): Promise<void> {
  if (fixturePath === undefined) fail('FAKE_GH_FIXTURE not set')
  if (!existsSync(fixturePath)) fail(`fixture not found: ${fixturePath}`)

  let fixture: Fixture
  try {
    fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture
  } catch {
    fail('invalid fixture JSON')
  }

  const argv = process.argv.slice(2)
  const pattern = matchPattern(argv)
  if (pattern === null) fail(`unrecognised argv: ${JSON.stringify(argv)}`)

  const queue = fixture[pattern]
  if (!queue || queue.length === 0) fail(`no queued response for ${pattern}`)

  const response = queue.shift()
  if (response === undefined) fail(`no queued response for ${pattern}`)

  if (pattern === 'comment-create' || pattern === 'comment-patch') {
    if (logPath !== undefined) {
      writeFileSync(logPath, `${JSON.stringify(argv)}\n`, { flag: 'a' })
    }
  }

  if (argv.includes('--input')) {
    for await (const _ of Bun.stdin.stream()) {
      // drain stdin so the caller does not get EPIPE
    }
  }

  try {
    writeFileSync(fixturePath, JSON.stringify(fixture))
  } catch {
    fail('failed to update fixture')
  }

  if (response.stderr) process.stderr.write(response.stderr)
  process.stdout.write(response.stdout)
  process.exit(response.status ?? 0)
}

main().catch((err: unknown) => fail(String(err)))
