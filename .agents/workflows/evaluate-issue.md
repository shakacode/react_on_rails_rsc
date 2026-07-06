# Issue Evaluation Workflow

Use this workflow before fixing, batching, or assigning a GitHub issue when value is uncertain, especially when the issue was found by AI/code analysis rather than by real users.

The authoritative rubric lives in the installed/shared `$evaluate-issue` skill. Read and follow that skill first; this workflow exists for agents that prefer workflow-file entry points over skill invocation syntax.

## Sequence

1. Exact issues or PRs:
   - Follow `$evaluate-issue` directly.
   - Report `UNKNOWN` for any fact that cannot be verified.
2. Filters, labels, milestones, pasted lists, or other unverified batch scopes:
   - Run `$plan-pr-batch` first to resolve exact candidates.
   - After exact candidates are known, follow `$evaluate-issue` for targets that are speculative, AI/code-analysis-only, over-scoped, or unclear in value, priority, or fix scope.
3. Batch handoff:
   - Exclude `park / P3`, `close`, and `product decision` items from implementation batches unless the batch is explicitly audit/comment-only.
   - Convert low-value assigned issues into no-PR evidence comments rather than speculative PRs.
   - Carry the disposition into `$pr-batch` as the target outcome: implementation PR, no-PR evidence comment, `document/work around`, or product-decision blocker.
