import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dkmPath, readBindings } from './store'
import type { WorkItemRef } from './types'
import { publishWorkflow, recordRequest, renderWorkflow, requireWorkflow, staleRequest, syncWorkflow } from './workflow'
import { observeWorkflow, planRelease, publishRelease } from './workflow-release'
import { loadWorkflowConfig, readWorkflow } from './workflow-store'

const template = `version = 1
enabled = false
verificationHints = []

[release]
enabled = false
tagPrefix = "v"
targetBranch = "main"
requiredChecks = []
`

function bound(root: string): WorkItemRef {
  const item = readBindings(root).bindings.find((binding) => binding.worktreePath === root)?.bound
  if (!item) throw new Error('Bind this worktree to an explicit intake issue/PR before using the workflow.')
  return item
}

function options(args: string[], allowed: string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (let index = 0; index < args.length; index++) {
    const key = args[index]
    if (!key || !allowed.includes(key) || out.has(key)) throw new Error('Unknown or repeated workflow option.')
    if (key === '--approve') {
      out.set(key, 'true')
      continue
    }
    const value = args[++index]
    if (!value || value.startsWith('--')) throw new Error(`Workflow option ${key} needs a value.`)
    out.set(key, value)
  }
  return out
}

export function runWorkflowCLI(root: string, args: string[]): string {
  const [command = 'status', ...rest] = args
  const commands = [
    'init',
    'status',
    'sync',
    'record',
    'render',
    'publish',
    'observe',
    'release-plan',
    'release-publish'
  ]
  if (!commands.includes(command)) throw new Error(`Unknown workflow command: ${command}`)
  const opts = options(
    rest,
    command === 'record'
      ? ['--input']
      : command === 'release-plan'
        ? ['--version']
        : command === 'release-publish'
          ? ['--version', '--head', '--approve']
          : []
  )
  if (command === 'init') {
    const path = join(dkmPath(root), 'workflow.toml')
    if (existsSync(path)) throw new Error('Workflow contract already exists; it was not overwritten.')
    mkdirSync(dkmPath(root), { recursive: true })
    writeFileSync(path, template, { mode: 0o644 })
    return 'Created workflow.toml with workflow and release publication disabled. Review/enable the contract explicitly; policy is unchanged.'
  }
  const config = loadWorkflowConfig(root)
  if (command === 'status' && !config.enabled) return 'workflow disabled; existing DKM behavior is unchanged'
  requireWorkflow(root)
  const item = bound(root)
  if (command === 'status') {
    const state = readWorkflow(root, item)
    const untriaged = state.comments.filter(
      (comment) => !comment.deleted && !state.requests.some((request) => request.commentId === comment.id)
    ).length
    return `workflow enabled for #${item.number}; ${state.requests.length} request(s), ${untriaged} untriaged comment(s), ${state.requests.filter((request) => staleRequest(state, request)).length} stale review(s); release publication ${config.release.enabled ? 'enabled (separate policy/approval gates apply)' : 'disabled'}\nVerification hints (not executed): ${config.verificationHints.join('; ') || '(none)'}`
  }
  if (command === 'sync') return JSON.stringify(syncWorkflow(root, item), null, 2)
  if (command === 'render') return renderWorkflow(readWorkflow(root, item))
  if (command === 'record') {
    if (opts.get('--input') !== '-')
      throw new Error('Provide one schema-approved request as JSON on stdin: workflow record --input -')
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(0, 'utf8'))
    } catch {
      throw new Error('Invalid structured workflow input; no record was changed.')
    }
    return JSON.stringify(recordRequest(root, item, raw), null, 2)
  }
  if (command === 'publish') return JSON.stringify(publishWorkflow(root, item).publication)
  if (command === 'observe') return JSON.stringify(observeWorkflow(root, item), null, 2)
  const version = opts.get('--version')
  if (!version) throw new Error('Choose a release version explicitly with --version; comment prose cannot choose it.')
  if (command === 'release-plan') return JSON.stringify(planRelease(root, item, version), null, 2)
  const head = opts.get('--head')
  if (!head) throw new Error('Pin --head to the full SHA from the release plan.')
  return JSON.stringify(publishRelease(root, item, version, head, opts.get('--approve') === 'true'), null, 2)
}

export function workflowHint(root: string): string {
  try {
    if (!loadWorkflowConfig(root).enabled) return ''
    const item = bound(root)
    const state = readWorkflow(root, item)
    const untriaged = state.comments.filter(
      (comment) => !comment.deleted && !state.requests.some((request) => request.commentId === comment.id)
    ).length
    const stale = state.requests.filter((request) => staleRequest(state, request)).length
    return `\nDKM optional workflow: #${item.number}, ${untriaged} untriaged comment(s), ${stale} stale review(s). Use dkm-workflow to sync and judge each request. Decisions are reported, never permission; release publication has independent gates.\n`
  } catch {
    return '\nDKM workflow needs a valid config/state and explicit binding; normal coordination continues.\n'
  }
}
