import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  fetchChecks,
  fetchMentions,
  fetchSince,
  findReceiptComment,
  runner,
  upsertReceiptComment,
  workItemByNumber
} from './github'
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
    const events = fetchSince('/repo', '2026-09-03T00:00:00Z')
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

  it("asks gh for the checkout's own repository, not a node ID", () => {
    queue({ ok: true, stdout: '[]', stderr: '' })
    fetchSince('/repo', '2026-09-03T00:00:00Z')
    const call = calls[0]
    expect(call).toBeDefined()
    if (call === undefined) throw new Error('no call')
    // `gh` expands {owner}/{repo} from the remote. Anything else here is not a REST path and 404s.
    expect(call.argv[1]).toStartWith('repos/{owner}/{repo}/issues?since=')
  })

  it('returns empty array on non-zero exit', () => {
    queue({ ok: false, stdout: '', stderr: 'error' })
    expect(fetchSince('/repo', '2026-09-03T00:00:00Z')).toEqual([])
  })

  it('returns empty array on malformed json', () => {
    queue({ ok: true, stdout: 'not json', stderr: '' })
    expect(fetchSince('/repo', '2026-09-03T00:00:00Z')).toEqual([])
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
    const events = fetchSince('/repo', '2026-09-03T00:00:00Z')
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

describe('workItemByNumber', () => {
  it('resolves an issue and pairs it with the repository node id', () => {
    queue(
      { ok: true, stdout: JSON.stringify({ id: 'I_9', number: 9, isPr: false }), stderr: '' },
      { ok: true, stdout: 'R_1\n', stderr: '' }
    )
    expect(workItemByNumber('/repo', 9)).toEqual({ repoNodeId: 'R_1', itemNodeId: 'I_9', number: 9, kind: 'issue' })
  })

  it('marks a pull request as kind pr', () => {
    queue(
      { ok: true, stdout: JSON.stringify({ id: 'PR_9', number: 9, isPr: true }), stderr: '' },
      { ok: true, stdout: 'R_1', stderr: '' }
    )
    expect(workItemByNumber('/repo', 9)?.kind).toBe('pr')
  })

  it('returns null on a failed lookup, malformed json, or a missing repository id', () => {
    queue({ ok: false, stdout: '', stderr: 'not found' })
    expect(workItemByNumber('/repo', 9)).toBeNull()

    queue({ ok: true, stdout: '{{{', stderr: '' })
    expect(workItemByNumber('/repo', 9)).toBeNull()

    queue(
      { ok: true, stdout: JSON.stringify({ id: 'I_9', number: 9, isPr: false }), stderr: '' },
      { ok: true, stdout: '', stderr: '' }
    )
    expect(workItemByNumber('/repo', 9)).toBeNull()
  })
})

describe('fetchMentions', () => {
  it('returns a MentionEvent for an issue mention', () => {
    const since = '2026-09-05T07:47:42Z'
    queue(
      {
        ok: true,
        stdout: JSON.stringify([
          {
            id: '25488037457',
            reason: 'mention',
            unread: true,
            updated_at: since,
            subject: {
              title: 'Signed-out visit to a deleted private record does not redirect',
              url: 'https://api.github.com/repos/OWNER/REPO/issues/191',
              latest_comment_url: 'https://api.github.com/repos/OWNER/REPO/issues/comments/5550383100',
              type: 'Issue'
            },
            repository: { full_name: 'OWNER/REPO', node_id: 'R_kgDOUE5Yiw' }
          }
        ]),
        stderr: ''
      },
      { ok: true, stdout: 'I_191\n', stderr: '' }
    )
    const events = fetchMentions('/repo', since)
    expect(events).toEqual([
      {
        kind: 'issue',
        nodeId: 'I_191',
        number: 191,
        headline: 'Signed-out visit to a deleted private record does not redirect',
        url: 'https://github.com/OWNER/REPO/issues/191',
        updatedAt: since,
        repoNodeId: 'R_kgDOUE5Yiw'
      }
    ])
    expect(calls).toHaveLength(2)
    const firstCall = calls[0]
    expect(firstCall).toBeDefined()
    if (firstCall) {
      expect(firstCall.argv).toEqual([
        'api',
        `notifications?all=true&participating=true&since=${encodeURIComponent(since)}&per_page=50`
      ])
    }
    const secondCall = calls[1]
    expect(secondCall).toBeDefined()
    if (secondCall) {
      expect(secondCall.argv).toEqual(['api', 'repos/{owner}/{repo}/issues/191', '--jq', '.node_id'])
    }
  })

  it('returns a MentionEvent for a pull request mention', () => {
    const since = '2026-09-04T12:00:00Z'
    queue(
      {
        ok: true,
        stdout: JSON.stringify([
          {
            id: '1',
            reason: 'mention',
            unread: false,
            updated_at: since,
            subject: {
              title: 'Fix the thing',
              url: 'https://api.github.com/repos/OWNER/REPO/pulls/42',
              latest_comment_url: 'https://api.github.com/repos/OWNER/REPO/pulls/comments/1',
              type: 'PullRequest'
            },
            repository: { full_name: 'OWNER/REPO', node_id: 'R_42' }
          }
        ]),
        stderr: ''
      },
      { ok: true, stdout: 'PR_42', stderr: '' }
    )
    const events = fetchMentions('/repo', since)
    expect(events).toEqual([
      {
        kind: 'pr',
        nodeId: 'PR_42',
        number: 42,
        headline: 'Fix the thing',
        url: 'https://github.com/OWNER/REPO/pull/42',
        updatedAt: since,
        repoNodeId: 'R_42'
      }
    ])
    expect(calls).toHaveLength(2)
    const call = calls[1]
    expect(call).toBeDefined()
    if (call) {
      expect(call.argv).toEqual(['api', 'repos/{owner}/{repo}/issues/42', '--jq', '.node_id'])
    }
  })

  it('drops notifications that are not mentions', () => {
    const since = '2026-09-03T00:00:00Z'
    queue(
      {
        ok: true,
        stdout: JSON.stringify([
          {
            id: '1',
            reason: 'author',
            updated_at: '2026-09-01T00:00:00Z',
            subject: {
              title: 'Author',
              url: 'https://api.github.com/repos/OWNER/REPO/issues/1',
              type: 'Issue'
            },
            repository: { full_name: 'OWNER/REPO', node_id: 'R_1' }
          },
          {
            id: '2',
            reason: 'comment',
            updated_at: '2026-09-01T00:00:00Z',
            subject: {
              title: 'Comment',
              url: 'https://api.github.com/repos/OWNER/REPO/issues/2',
              type: 'Issue'
            },
            repository: { full_name: 'OWNER/REPO', node_id: 'R_2' }
          },
          {
            id: '3',
            reason: 'assign',
            updated_at: '2026-09-01T00:00:00Z',
            subject: {
              title: 'Assign',
              url: 'https://api.github.com/repos/OWNER/REPO/issues/3',
              type: 'Issue'
            },
            repository: { full_name: 'OWNER/REPO', node_id: 'R_3' }
          },
          {
            id: '4',
            reason: 'ci_activity',
            updated_at: '2026-09-01T00:00:00Z',
            subject: {
              title: 'CI',
              url: 'https://api.github.com/repos/OWNER/REPO/issues/4',
              type: 'Issue'
            },
            repository: { full_name: 'OWNER/REPO', node_id: 'R_4' }
          },
          {
            id: '5',
            reason: 'state_change',
            updated_at: '2026-09-01T00:00:00Z',
            subject: {
              title: 'State change',
              url: 'https://api.github.com/repos/OWNER/REPO/issues/5',
              type: 'Issue'
            },
            repository: { full_name: 'OWNER/REPO', node_id: 'R_5' }
          },
          {
            id: '6',
            reason: 'mention',
            updated_at: since,
            subject: {
              title: 'Mentioned',
              url: 'https://api.github.com/repos/OWNER/REPO/issues/6',
              type: 'Issue'
            },
            repository: { full_name: 'OWNER/REPO', node_id: 'R_6' }
          }
        ]),
        stderr: ''
      },
      { ok: true, stdout: 'I_6\n', stderr: '' }
    )
    const events = fetchMentions('/repo', since)
    expect(events).toEqual([
      {
        kind: 'issue',
        nodeId: 'I_6',
        number: 6,
        headline: 'Mentioned',
        url: 'https://github.com/OWNER/REPO/issues/6',
        updatedAt: since,
        repoNodeId: 'R_6'
      }
    ])
    expect(calls).toHaveLength(2)
  })

  it('skips a mention when the node id lookup fails', () => {
    const since = '2026-09-02T00:00:00Z'
    queue(
      {
        ok: true,
        stdout: JSON.stringify([
          {
            id: '1',
            reason: 'mention',
            updated_at: since,
            subject: {
              title: 'First',
              url: 'https://api.github.com/repos/OWNER/REPO/issues/1',
              type: 'Issue'
            },
            repository: { full_name: 'OWNER/REPO', node_id: 'R_1' }
          },
          {
            id: '2',
            reason: 'mention',
            updated_at: '2026-09-02T00:01:00Z',
            subject: {
              title: 'Second',
              url: 'https://api.github.com/repos/OWNER/REPO/issues/2',
              type: 'Issue'
            },
            repository: { full_name: 'OWNER/REPO', node_id: 'R_2' }
          }
        ]),
        stderr: ''
      },
      { ok: false, stdout: '', stderr: 'not found' },
      { ok: true, stdout: 'I_2\n', stderr: '' }
    )
    const events = fetchMentions('/repo', since)
    expect(events).toEqual([
      {
        kind: 'issue',
        nodeId: 'I_2',
        number: 2,
        headline: 'Second',
        url: 'https://github.com/OWNER/REPO/issues/2',
        updatedAt: '2026-09-02T00:01:00Z',
        repoNodeId: 'R_2'
      }
    ])
    expect(calls).toHaveLength(3)
  })
})
