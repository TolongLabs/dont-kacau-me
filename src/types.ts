export type FieldKind = 'measured' | 'reported' | 'unverified'

export type TrackingTier = 'bound' | 'followed' | 'ambient'

export type PermissionDecision = 'allow' | 'deny' | 'ask'

export type CheckResult = {
  name: string
  checkRunId: string
  attempt: number
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'skipped' | 'pending'
}

export type Receipt = {
  eventId: string
  workItem: WorkItemRef
  base: string
  head: string
  changedPaths: ChangedPath[]
  checks: CheckResult[]
  contractDelta: string[]
  decisions: DecisionSummary
  blockers: string[]
  narrative: string
  observedAt: string
}

export type ChangedPath = {
  status: 'A' | 'M' | 'D' | 'R' | 'C'
  path: string
}

export type WorkItemRef = {
  repoNodeId: string
  itemNodeId: string
  number: number
  kind: 'issue' | 'pr'
}

export type DecisionSummary = {
  allowed: number
  denied: number
  asked: number
}

export type Binding = {
  worktreePath: string
  bound: WorkItemRef | null
  followed: WorkItemRef[]
  ambient: boolean
}

export type BindingsFile = {
  version: 1
  bindings: Binding[]
}

export type CursorFile = {
  version: 1
  cursors: Record<string, string>
}

export type PendingEvent = {
  eventId: string
  rootId: string
  hops: number
  tier: TrackingTier
  workItem: WorkItemRef
  observedAt: string
  headline: string
  url: string
  receipt: Receipt | null
}

export type LastEmitFile = {
  version: 1
  emitted: Record<string, EmittedState>
}

export type EmittedState = {
  head: string
  blockers: string[]
  checksFingerprint: string
  commentId: string
}

export type PolicyAllowRule = {
  tool: string
  match?: string
  paths?: string[]
}

export type Policy = {
  version: 1
  allow: PolicyAllowRule[]
  contractGlobs: string[]
}

export type BlastRadiusTrip = 'data-loss' | 'egress' | 'money' | 'surface' | 'outside-worktree'

export type DecisionRecord = {
  ts: string
  session: string
  tool: string
  summary: string
  decision: PermissionDecision
  rule: string
  reverse: string
}

export type DecisionInput = {
  sessionId: string
  cwd: string
  worktreePath: string
  toolName: string
  toolInput: unknown
}

export type RevivalRecord = {
  ts: string
  attempt: number
  event: 'waiting' | 'done' | 'failed' | 'unresumable'
  sessionId: string | null
  waitMs: number
  detail?: string
}

export type ResumeTicket = {
  sessionId: string
  cwd: string
  reason: string
  endedAt: string
}
