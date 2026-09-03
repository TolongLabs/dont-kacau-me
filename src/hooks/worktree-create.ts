import { resolveWorkItem } from '../github'
import { readBindings, writeBindings } from '../store'
import { runHook } from './runtime'

runHook((payload, root) => {
  const worktreePath = typeof payload.worktree_path === 'string' ? payload.worktree_path : root
  const branch = typeof payload.branch === 'string' ? payload.branch : ''
  const bindings = readBindings(root)
  const existing = bindings.bindings.find((b) => b.worktreePath === worktreePath)
  if (existing !== undefined) return ''

  bindings.bindings.push({
    worktreePath,
    bound: branch.length > 0 ? resolveWorkItem(root, branch) : null,
    followed: [],
    ambient: true
  })
  writeBindings(root, bindings)
  return ''
})
