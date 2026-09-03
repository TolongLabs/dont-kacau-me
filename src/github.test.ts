import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { fetchChecks, fetchSince, findReceiptComment, resolveWorkItem, runner, upsertReceiptComment } from './github'
import type { WorkItemRef } from './types'

type RunResult = ReturnType<typeof runner.run>

let calls: { repoRoot: string; argv: string[]; input?: string }[] = []
let results: RunResult[] = []
const originalRun = runner.run

function fakeRunner(repoRoot: string, argv: string[], input?: string): RunResult {
  calls.push({ repoRoot, argv, input })
  const next = results.shift()
  if (next === undefined) return { ok: true, stdout: '[]', stderr: '' }
  return next
}

function queue(...queued: RunResult[]) {
  results.push(...queued)
}

beforeEach(() => {
  calls = []
  results = []
  runner.run = fakeRunner
})

afterEach(() => {
  runner.run = originalRun
})

const item: WorkItemRef = {
  repoNodeId: 'repo',
  itemNodeId: 'item',
  number: 42,
  kind: 'pr'
}

describe('resolveWorkItem', () => {
  it('parses a PR from gh pr list', () => {
    queue({
      ok: true,
      stdout: JSON.stringify([{ id: 'pr-node-1', number: 42, headRepository: { id: 'repo-node-1' } }]),
      stderr: ''
    })
    const ref = resolveWorkItem('/repo', 'feature-x')
    expect(ref).toEqual({
      repoNodeId: 'repo-node-1',
      itemNodeId: 'pr-node-1',
      number: 42,
      kind: 'pr'
    })
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call).toBeDefined()
    if (call) {
      expect(call.argv).toEqual([
        'pr',
        'list',
        '--head',
        'feature-x',
        '--json',
        'id,number,headRepository',
        '--limit',
        '1'
      ])
    }
  })

  it('returns null on empty list', () => {
    queue({ ok: true, stdout: '[]', stderr: '' })
    expect(resolveWorkItem('/repo', 'feature-x')).toBeNull()
  })

  it('returns null on malformed json', () => {
    queue({ ok: true, stdout: '{not json', stderr: '' })
    expect(resolveWorkItem('/repo', 'feature-x')).toBeNull()
  })

  it('returns null on non-zero exit', () => {
    queue({ ok: false, stdout: '', stderr: 'gh failed' })
    expect(resolveWorkItem('/repo', 'feature-x')).toBeNull()
  })
})

describe('fetchChecks', () => {
  it('parses completed check runs', () => {
    queue({
      ok: true,
      stdout: JSON.stringify({
        check_runs: [
          { id: 123, name: 'test', status: 'completed', conclusion: 'success', run_attempt: 2 },
          { id: 124, name: 'lint', status: 'completed', conclusion: 'failure', run_attempt: 1 }
        ]
      }),
      stderr: ''
    })
    const checks = fetchChecks('/repo', 'abc123')
    expect(checks).toEqual([
      { checkRunId: '123', name: 'test', attempt: 2, conclusion: 'success' },
      { checkRunId: '124', name: 'lint', attempt: 1, conclusion: 'failure' }
    ])
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call).toBeDefined()
    if (call) {
      expect(call.argv).toEqual(['api', 'repos/{owner}/{repo}/commits/abc123/check-runs'])
    }
  })

  it('returns empty array on non-zero exit', () => {
    queue({ ok: false, stdout: '', stderr: 'error' })
    expect(fetchChecks('/repo', 'abc123')).toEqual([])
  })

  it('returns empty array on malformed json', () => {
    queue({ ok: true, stdout: 'not json', stderr: '' })
    expect(fetchChecks('/repo', 'abc123')).toEqual([])
  })

  it('maps non-completed status to pending', () => {
    queue({
      ok: true,
      stdout: JSON.stringify({
        check_runs: [
          { id: 1, name: 'build', status: 'in_progress', conclusion: 'success' },
          { id: 2, name: 'queue', status: 'queued', conclusion: null },
          { id: 3, name: 'done', status: 'completed', conclusion: 'skipped' }
        ]
      }),
      stderr: ''
    })
    const checks = fetchChecks('/repo', 'abc123')
    expect(checks).toEqual([
      { checkRunId: '1', name: 'build', attempt: 1, conclusion: 'pending' },
      { checkRunId: '2', name: 'queue', attempt: 1, conclusion: 'pending' },
      { checkRunId: '3', name: 'done', attempt: 1, conclusion: 'skipped' }
    ])
  })
})

describe('findReceiptComment', () => {
  it('returns the first comment with the marker', () => {
    queue({
      ok: true,
      stdout: JSON.stringify([
        { id: 100, body: 'hello' },
        { id: 101, body: '<!-- dkm:receipt v1 -->\nreceipt body' },
        { id: 102, body: 'other' }
      ]),
      stderr: ''
    })
    const found = findReceiptComment('/repo', item)
    expect(found).toEqual({ id: '101', body: '<!-- dkm:receipt v1 -->\nreceipt body' })
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call).toBeDefined()
    if (call) {
      expect(call.argv).toEqual(['api', 'repos/{owner}/{repo}/issues/42/comments'])
    }
  })

  it('returns null when no marker matches', () => {
    queue({ ok: true, stdout: JSON.stringify([{ id: 100, body: 'hello' }]), stderr: '' })
    expect(findReceiptComment('/repo', item)).toBeNull()
  })

  it('returns null on non-zero exit', () => {
    queue({ ok: false, stdout: '', stderr: 'error' })
    expect(findReceiptComment('/repo', item)).toBeNull()
  })
})

describe('upsertReceiptComment', () => {
  it('patches an existing receipt comment', () => {
    queue(
      {
        ok: true,
        stdout: JSON.stringify([{ id: 101, body: '<!-- dkm:receipt v1 -->\nold' }]),
        stderr: ''
      },
      { ok: true, stdout: JSON.stringify({ id: 101, body: 'new body' }), stderr: '' }
    )
    const id = upsertReceiptComment('/repo', item, 'new body')
    expect(id).toBe('101')
    expect(calls).toHaveLength(2)
    const call = calls[1]
    expect(call).toBeDefined()
    if (call) {
      expect(call.argv).toEqual([
        'api',
        'repos/{owner}/{repo}/issues/comments/101',
        '--method',
        'PATCH',
        '--input',
        '-'
      ])
      expect(call.input).toBe(JSON.stringify({ body: 'new body' }))
    }
  })

  it('posts a new receipt comment', () => {
    queue(
      { ok: true, stdout: '[]', stderr: '' },
      { ok: true, stdout: JSON.stringify({ id: 202, body: 'new body' }), stderr: '' }
    )
    const id = upsertReceiptComment('/repo', item, 'new body')
    expect(id).toBe('202')
    expect(calls).toHaveLength(2)
    const call = calls[1]
    expect(call).toBeDefined()
    if (call) {
      expect(call.argv).toEqual(['api', 'repos/{owner}/{repo}/issues/42/comments', '--method', 'POST', '--input', '-'])
      expect(call.input).toBe(JSON.stringify({ body: 'new body' }))
    }
  })

  it('throws on patch failure', () => {
    queue(
      {
        ok: true,
        stdout: JSON.stringify([{ id: 101, body: '<!-- dkm:receipt v1 -->\nold' }]),
        stderr: ''
      },
      { ok: false, stdout: '', stderr: 'patch failed' }
    )
    expect(() => upsertReceiptComment('/repo', item, 'new body')).toThrow('patch failed')
  })

  it('throws on post failure', () => {
    queue({ ok: true, stdout: '[]', stderr: '' }, { ok: false, stdout: '', stderr: 'post failed' })
    expect(() => upsertReceiptComment('/repo', item, 'new body')).toThrow('post failed')
  })
})

describe('fetchSince', () => {
  it('returns issues and pull requests without bodies', () => {
    queue({
      ok: true,
      stdout: JSON.stringify([
        {
          node_id: 'node1',
          number: 1,
          title: 'Issue 1',
          html_url: 'https://github.com/owner/repo/issues/1',
          updated_at: '2026-09-03T00:00:00Z',
          body: 'secret body that must be ignored'
        },
        {
          node_id: 'node2',
          number: 2,
          title: 'PR 2',
          html_url: 'https://github.com/owner/repo/pull/2',
          updated_at: '2026-09-03T01:00:00Z',
          pull_request: { url: '...' },
          body: 'another secret'
        }
      ]),
      stderr: ''
    })
    const events = fetchSince('/repo', 'owner/repo', '2026-09-03T00:00:00Z')
    expect(events).toEqual([
      {
        kind: 'issue',
        nodeId: 'node1',
        number: 1,
        headline: 'Issue 1',
        url: 'https://github.com/owner/repo/issues/1',
        updatedAt: '2026-09-03T00:00:00Z'
      },
      {
        kind: 'pr',
        nodeId: 'node2',
        number: 2,
        headline: 'PR 2',
        url: 'https://github.com/owner/repo/pull/2',
        updatedAt: '2026-09-03T01:00:00Z'
      }
    ])
    for (const event of events) {
      expect(event).not.toHaveProperty('body')
    }
  })

  it('returns empty array on non-zero exit', () => {
    queue({ ok: false, stdout: '', stderr: 'error' })
    expect(fetchSince('/repo', 'owner/repo', '2026-09-03T00:00:00Z')).toEqual([])
  })

  it('returns empty array on malformed json', () => {
    queue({ ok: true, stdout: 'not json', stderr: '' })
    expect(fetchSince('/repo', 'owner/repo', '2026-09-03T00:00:00Z')).toEqual([])
  })

  it('never requests or returns a body field', () => {
    queue({
      ok: true,
      stdout: JSON.stringify([
        {
          node_id: 'n',
          number: 1,
          title: 't',
          html_url: 'u',
          updated_at: 'd',
          body: 'should not appear'
        }
      ]),
      stderr: ''
    })
    const events = fetchSince('/repo', 'owner/repo', '2026-09-03T00:00:00Z')
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call).toBeDefined()
    if (call) {
      expect(call.input).toBeUndefined()
      expect(call.argv.join(' ')).not.toContain('body')
    }
    expect(events).toHaveLength(1)
    const event = events[0]
    expect(event).toBeDefined()
    if (event) {
      expect(event).not.toHaveProperty('body')
    }
  })
})
