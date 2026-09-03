import { readBindings, writeBindings } from '../store'
import { runHook } from './runtime'

runHook((payload, root) => {
  const worktreePath = typeof payload.worktree_path === 'string' ? payload.worktree_path : root
  const bindings = readBindings(root)
  const kept = bindings.bindings.filter((b) => b.worktreePath !== worktreePath)
  if (kept.length !== bindings.bindings.length) writeBindings(root, { version: 1, bindings: kept })
  return ''
})
