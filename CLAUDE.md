<!-- contextrelay:start -->
## ContextRelay Collaboration

This project uses ContextRelay to connect Claude Code and Codex in the same working session.

Use ContextRelay when:
- You are blocked or uncertain.
- Another agent is better suited for the task.
- You need a second review before finalizing.
- You want implementation help, test help, debugging help, or architecture review.
- You would normally stop to ask the human a planning or decision question that the peer agent can help answer first.

Codex should coordinate:
- Planning and task routing.
- Focused implementation work.
- Test writing or debugging.
- Git writes when runtime permissions allow it and the human has approved this repo policy.

Claude should support Codex with:
- Repo-wide reasoning and architecture review.
- Risk review before large changes.
- Alternative implementation approaches.
- Focused implementation or debugging tasks when Codex delegates them.

Git write policy:
- Git write operations should be handled only by the current coordinator agent or the human.
- Current coordinator: Codex.
- Codex may handle branch, commit, merge, push, and PR work only when runtime permissions allow it and the human has approved that policy.
- Non-coordinator agents should use read-only git commands only and hand off git-sensitive work to Codex or the human.

Ask the coordinator for work, don't sit idle:
- When you finish a task, get blocked, or go idle, proactively ask Codex (the coordinator) for the next task — say what you finished and that you are ready for more. Do not wait silently.
- To ask: Claude uses `handoff` (or `reply`); Codex uses `handoff_to_claude` (or `send_to_claude`).

Use explicit handoffs when passing control:
- State the reason.
- State the concrete ask.
- Include relevant files or context refs.
- Say who should speak next.

Autonomous decision flow:
- When autonomy is enabled and you are unsure about a plan, tradeoff, design choice, risk, or next step, ask the peer agent for a bounded deliberation before asking the human.
- Claude should use `deliberate_with_codex`; Codex should use `deliberate_with_claude`.
- Ask the human only when the decision requires human authority, credentials, external business judgment, spending, destructive action, or changing coordinator/git policy.
- After peer deliberation, synthesize: current consensus, remaining disagreement, decision, and next action.

Useful ContextRelay tools for Claude:
- `handoff` for normal delegation to Codex.
- `deliberate_with_codex` for a bounded live debate/convergence pass with Codex on an open decision.
- `headless_run` to spin up an on-demand, read-only Codex/Claude reviewer (one-shot, fresh context). Fan out several for parallel independent review, then orchestrate the result yourself: reconcile the reviews (`deliberate_with_codex` on open disagreement) and synthesize them into a decision you record (`append_note` / `propose_final`). `headless_run` is a one-shot primitive — the deliberation/orchestration lives in the caller, not the tool.
- `reply`, `get_messages`, and `wait_for_messages` for live Codex communication.
- `read_context`, `append_note`, `session_info`, `task_state`, and `record_artifact` for durable shared context.
- `propose_final` when work appears complete.

Agents cannot see each other's hidden reasoning. Write useful context into messages or the ledger: goal, current plan, files touched, blockers, decisions, and next step.

Do not loop indefinitely. If the other agent responds, summarize what changed, decide the next step, and continue or finalize.
<!-- contextrelay:end -->
