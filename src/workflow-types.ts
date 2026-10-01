import type { CheckResult, WorkItemRef } from './types'

export type WorkflowConfig = {
  version: 1
  enabled: boolean
  verificationHints: string[]
  release: { enabled: boolean; tagPrefix: string; targetBranch: string; requiredChecks: string[] }
}

export type IntakeComment = {
  id: string
  author: string
  url: string
  body: string
  updatedAt: string
  fingerprint: string
  deleted: boolean
}

export const decisions = ['accepted', 'declined', 'superseded', 'needs-owner'] as const
export const deliveries = ['planned', 'in-progress', 'implemented', 'merged', 'blocked', 'released'] as const
export type ProductDecision = (typeof decisions)[number]
export type Delivery = (typeof deliveries)[number]

export type RequestInput = {
  commentId: string
  key: string
  reviewedFrom: string
  summary: string
  decision: ProductDecision
  why: string
  phase: string
  link: string
  delivery: Delivery
  reportedVerification: string
  implementationHead: string
  prNumber: number | null
  supersedes: string | null
}

export type PullObservation = {
  head: string
  mergedHead: string | null
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  checksAvailable: boolean
  checks: CheckResult[]
  observedAt: string
}

export type WorkflowRequest = RequestInput & {
  history: { reviewedFrom: string; decision: ProductDecision; delivery: Delivery; why: string }[]
  observation: PullObservation | null
}

export type WorkflowState = {
  version: 1
  revision: number
  workItem: WorkItemRef
  comments: IntakeComment[]
  requests: WorkflowRequest[]
  publication: { commentId: string; fingerprint: string } | null
  releases: { tag: string; head: string; url: string }[]
}

export type ReleasePlan = { version: string; tag: string; head: string; notes: string; blockers: string[] }
