import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dkmPath } from './store'
import type { WorkItemRef } from './types'
import { decisions, deliveries, type WorkflowConfig, type WorkflowState } from './workflow-types'

export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function configError(): never {
  throw new Error('Invalid workflow config; workflow is not enabled and permission policy was not changed.')
}

export function loadWorkflowConfig(root: string): WorkflowConfig {
  const path = join(dkmPath(root), 'workflow.toml')
  const defaults: WorkflowConfig = {
    version: 1,
    enabled: false,
    verificationHints: [],
    release: { enabled: false, tagPrefix: 'v', targetBranch: 'main', requiredChecks: [] }
  }
  if (!existsSync(path)) return defaults
  let data: unknown
  try {
    data = Bun.TOML.parse(readFileSync(path, 'utf8'))
  } catch {
    return configError()
  }
  if (!object(data) || data.version !== 1 || !keys(data, ['version', 'enabled', 'verificationHints', 'release']))
    return configError()
  if (data.enabled !== undefined && typeof data.enabled !== 'boolean') return configError()
  if (data.verificationHints !== undefined && !strings(data.verificationHints)) return configError()
  const release = data.release ?? {}
  if (!object(release) || !keys(release, ['enabled', 'tagPrefix', 'targetBranch', 'requiredChecks']))
    return configError()
  if (release.enabled !== undefined && typeof release.enabled !== 'boolean') return configError()
  if (release.requiredChecks !== undefined && !strings(release.requiredChecks)) return configError()
  const prefix = release.tagPrefix ?? 'v'
  const branch = release.targetBranch ?? 'main'
  if (typeof prefix !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/.test(prefix)) return configError()
  if (typeof branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes('..'))
    return configError()
  return {
    version: 1,
    enabled: data.enabled === true,
    verificationHints: (data.verificationHints as string[] | undefined) ?? [],
    release: {
      enabled: release.enabled === true,
      tagPrefix: prefix,
      targetBranch: branch,
      requiredChecks: (release.requiredChecks as string[] | undefined) ?? []
    }
  }
}

export function workflowPath(root: string, item: WorkItemRef): string {
  const key = createHash('sha256').update(`${item.repoNodeId}\0${item.itemNodeId}`).digest('hex')
  return join(dkmPath(root), 'workflows', `${key}.json`)
}

function textFields(value: Record<string, unknown>, fields: string[]): boolean {
  return fields.every((field) => typeof value[field] === 'string')
}

function validObservation(observation: unknown): boolean {
  if (observation === null) return true
  return (
    object(observation) &&
    textFields(observation, ['head', 'observedAt']) &&
    ['OPEN', 'CLOSED', 'MERGED'].includes(String(observation.state)) &&
    typeof observation.checksAvailable === 'boolean' &&
    (observation.mergedHead === null || typeof observation.mergedHead === 'string') &&
    Array.isArray(observation.checks) &&
    observation.checks.every(
      (check) =>
        object(check) &&
        textFields(check, ['name', 'checkRunId']) &&
        Number.isInteger(check.attempt) &&
        ['success', 'failure', 'neutral', 'cancelled', 'timed_out', 'skipped', 'pending'].includes(
          String(check.conclusion)
        )
    )
  )
}

function validState(value: unknown): value is WorkflowState {
  if (!object(value) || value.version !== 1 || !Number.isInteger(value.revision) || Number(value.revision) < 0)
    return false
  const item = value.workItem
  if (
    !object(item) ||
    !textFields(item, ['repoNodeId', 'itemNodeId']) ||
    !Number.isInteger(item.number) ||
    Number(item.number) <= 0 ||
    !['issue', 'pr'].includes(String(item.kind))
  )
    return false
  if (!Array.isArray(value.comments) || !Array.isArray(value.requests) || !Array.isArray(value.releases)) return false
  if (
    !value.comments.every(
      (comment) =>
        object(comment) &&
        textFields(comment, ['id', 'author', 'url', 'body', 'updatedAt', 'fingerprint']) &&
        typeof comment.deleted === 'boolean'
    )
  )
    return false
  if (
    !value.requests.every((request) => {
      if (
        !object(request) ||
        !textFields(request, [
          'commentId',
          'key',
          'reviewedFrom',
          'summary',
          'why',
          'phase',
          'link',
          'reportedVerification',
          'implementationHead'
        ])
      )
        return false
      if (!decisions.includes(request.decision as never) || !deliveries.includes(request.delivery as never))
        return false
      if (request.prNumber !== null && (!Number.isInteger(request.prNumber) || Number(request.prNumber) <= 0))
        return false
      if (request.supersedes !== null && typeof request.supersedes !== 'string') return false
      if (
        !Array.isArray(request.history) ||
        !request.history.every(
          (entry) =>
            object(entry) &&
            textFields(entry, [
              'commentId',
              'key',
              'reviewedFrom',
              'summary',
              'why',
              'phase',
              'link',
              'reportedVerification',
              'implementationHead'
            ]) &&
            decisions.includes(entry.decision as never) &&
            deliveries.includes(entry.delivery as never) &&
            (entry.prNumber === null || (Number.isInteger(entry.prNumber) && Number(entry.prNumber) > 0)) &&
            (entry.supersedes === null || typeof entry.supersedes === 'string') &&
            validObservation(entry.observation)
        )
      )
        return false
      return validObservation(request.observation)
    })
  )
    return false
  const publication = value.publication
  if (publication !== null && (!object(publication) || !textFields(publication, ['commentId', 'fingerprint'])))
    return false
  return value.releases.every((release) => object(release) && textFields(release, ['tag', 'head', 'url']))
}

export function readWorkflow(root: string, item: WorkItemRef): WorkflowState {
  const path = workflowPath(root, item)
  if (!existsSync(path))
    return {
      version: 1,
      revision: 0,
      workItem: { ...item },
      comments: [],
      requests: [],
      publication: null,
      releases: []
    }
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error('Invalid workflow state; no records were reset.')
  }
  if (
    !validState(value) ||
    value.workItem.repoNodeId !== item.repoNodeId ||
    value.workItem.itemNodeId !== item.itemNodeId ||
    value.workItem.number !== item.number ||
    value.workItem.kind !== item.kind
  )
    throw new Error('Invalid workflow state or bound identity; no records were reset.')
  return value
}

export function updateWorkflow(
  root: string,
  item: WorkItemRef,
  expectedRevision: number,
  change: (state: WorkflowState) => void
): WorkflowState {
  const path = workflowPath(root, item)
  mkdirSync(dirname(path), { recursive: true })
  const lock = `${path}.lock`
  let fd: number
  try {
    fd = openSync(lock, 'wx', 0o600)
  } catch {
    throw new Error(
      'Workflow state is busy; retry after the current writer finishes. Inspect a stale lock before removing it.'
    )
  }
  const temporary = join(dirname(path), `${randomUUID()}.tmp`)
  try {
    const state = readWorkflow(root, item)
    if (state.revision !== expectedRevision) throw new Error('Workflow state changed; re-read before updating it.')
    change(state)
    state.revision += 1
    if (!validState(state)) throw new Error('Invalid workflow update; no records were written.')
    writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 })
    renameSync(temporary, path)
    return state
  } finally {
    closeSync(fd)
    rmSync(temporary, { force: true })
    rmSync(lock, { force: true })
  }
}
