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

Keep the peer fed, you are the coordinator:
- When Claude reports idle, finishes a task, or asks for work, assign the next concrete task or explicitly park Claude. Do not leave the peer idle without direction.

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

Useful ContextRelay tools for Codex:
- `handoff_to_claude` for normal delegation to Claude.
- `deliberate_with_claude` for a bounded live debate/convergence pass with Claude on an open decision.
- `headless_run` to spin up an on-demand, read-only Claude/Codex reviewer (one-shot, fresh context). Fan out several for parallel independent review, then orchestrate the result yourself: reconcile the reviews (`deliberate_with_claude` on open disagreement) and synthesize them into a decision you record (`append_note` / `propose_final`). `headless_run` is a one-shot primitive — the deliberation/orchestration lives in the caller, not the tool.
- `send_to_claude` for a direct live message to Claude.
- For independent validation requests, call `handoff_to_claude` with `wait_for_reply: true`; use `wait_for_claude` for an explicit follow-up wait.
- `read_context`, `wait_for_claude`, `append_note`, `session_info`, `task_state`, and `record_artifact` for durable shared context.
- `propose_final` when work appears complete.

If Codex MCP tools are unavailable, use these fallback markers at the very start of a message:

```text
[IMPORTANT] CONTEXTRELAY_READ_CONTEXT: <optional focus>
[IMPORTANT] CONTEXTRELAY_TASK_STATE
[IMPORTANT] CONTEXTRELAY_NOTE: <note>
[IMPORTANT] CONTEXTRELAY_ARTIFACT:
kind: patch_summary|test_report|command_log|release_gate|escalation_suggestion|idle_opportunity|idle_ask_for_work|idle_action_result|idle_fleet_result|idle_evaluation_result
title: <short title>
summary: <what happened>
status: passed|failed|blocked|unknown|skipped|timed_out
evidence:
- <optional evidence>
[IMPORTANT] CONTEXTRELAY_HANDOFF_TO_CLAUDE: <ask>
[IMPORTANT] CONTEXTRELAY_PROPOSE_FINAL:
summary: <what is complete>
evidence: <why it is complete>
remaining_risk: <optional risk>
[IMPORTANT] DONE: <summary>
[HUMAN] <human-directed side note that should not be delivered as Claude-actionable context>
```

Agents cannot see each other's hidden reasoning. Write useful context into messages or the ledger: goal, current plan, files touched, blockers, decisions, and next step.

Do not loop indefinitely. If the other agent responds, summarize what changed, decide the next step, and continue or finalize.
<!-- contextrelay:end -->
