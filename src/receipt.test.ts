import { expect, test } from 'bun:test'
import { parseReceipt, receiptFingerprint, renderReceipt } from './receipt'
import type { Receipt } from './types'

const baseReceipt: Receipt = {
  eventId: 'ev1',
  workItem: {
    repoNodeId: 'R_kgDO123',
    itemNodeId: 'I_kwDO456',
    number: 42,
    kind: 'issue'
  },
  base: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  head: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  changedPaths: [
    { status: 'M', path: 'src/foo.ts' },
    { status: 'A', path: 'src/bar.ts' }
  ],
  checks: [
    { name: 'ci', checkRunId: '123', attempt: 1, conclusion: 'success' },
    { name: 'lint', checkRunId: '456', attempt: 2, conclusion: 'failure' }
  ],
  contractDelta: ['src/foo.ts'],
  decisions: { allowed: 1, denied: 0, asked: 2 },
  blockers: ['needs review'],
  narrative: 'Did the thing.',
  observedAt: '2026-09-03T12:00:00Z'
}

test('round-trips a full receipt', () => {
  expect(parseReceipt(renderReceipt(baseReceipt))).toEqual(baseReceipt)
})

test('round-trips empty arrays and unicode/emoji narrative', () => {
  const r: Receipt = {
    ...baseReceipt,
    changedPaths: [],
    checks: [],
    contractDelta: [],
    blockers: [],
    narrative: 'Done 🎉 — à la mode.'
  }
  expect(parseReceipt(renderReceipt(r))).toEqual(r)
})

test('returns null when marker is absent', () => {
  expect(parseReceipt('no marker here')).toBe(null)
})

test('returns null when json is malformed', () => {
  const body = '<!-- dkm:receipt v1 -->\n```json\nnot json\n```\n<!-- /dkm:receipt -->'
  expect(parseReceipt(body)).toBe(null)
})

test('returns null when body is truncated', () => {
  const body = renderReceipt(baseReceipt).slice(0, -10)
  expect(parseReceipt(body)).toBe(null)
})

test('fingerprint is stable when only narrative or observedAt change', () => {
  const a = receiptFingerprint(baseReceipt)
  const r = {
    ...baseReceipt,
    narrative: 'Completely different.',
    observedAt: '2020-01-01T00:00:00Z'
  }
  expect(receiptFingerprint(r)).toBe(a)
})

test('fingerprint differs when head changes', () => {
  const r = { ...baseReceipt, head: 'cccccccccccccccccccccccccccccccccccccccc' }
  expect(receiptFingerprint(r)).not.toBe(receiptFingerprint(baseReceipt))
})

test('fingerprint differs when blockers change', () => {
  const r = { ...baseReceipt, blockers: ['needs review', 'waiting'] }
  expect(receiptFingerprint(r)).not.toBe(receiptFingerprint(baseReceipt))
})

test('fingerprint differs when checks change', () => {
  const [first] = baseReceipt.checks
  if (first === undefined) throw new Error('fixture must carry a check')
  const r: Receipt = { ...baseReceipt, checks: [{ ...first, conclusion: 'pending' }] }
  expect(receiptFingerprint(r)).not.toBe(receiptFingerprint(baseReceipt))
})
