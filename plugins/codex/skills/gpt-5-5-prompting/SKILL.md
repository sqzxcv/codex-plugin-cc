---
name: gpt-5-5-prompting
description: Internal guidance for composing Codex / GPT-5 prompts (GPT-5.5 current, GPT-5.4 legacy) for coding, review, diagnosis, and research tasks inside the Codex Claude Code plugin
user-invocable: false
---

# Codex / GPT-5 Prompting (current model: GPT-5.5)

Use this skill when `codex:codex-rescue` or any other Codex-driven workflow needs to ask Codex for help. Source of truth is OpenAI's GPT-5.5 prompt guidance (developers.openai.com); this skill captures the rules that matter inside the Codex Claude Code plugin.

GPT-5.5 reasons more efficiently than GPT-5.4 and pays a real cost for noisy, process-heavy prompts. Default to short, outcome-first prompts. Add structure only where it changes correctness, safety, or output usability. The XML-tag block library in `references/` is still available but should be applied selectively, not stacked.

## Core rules (GPT-5.5)

- **Outcome over process.** Define the destination and success criteria. Let GPT-5.5 choose the path. Do not transcribe every step you would take.
- **Re-evaluate reasoning effort.** GPT-5.5's `low` and `medium` are stronger than GPT-5.4 at the same level. Start lower than you would have on 5.4 and only escalate when the prompt is already tight and the result is still wrong.
- **One clear task per Codex run.** Split unrelated asks into separate runs. Use `task --resume-last` for true follow-ups; send only the delta unless the direction changed.
- **Reserve absolutes for invariants.** Use `must`, `never`, `only` for safety rules, required output fields, or actions that genuinely cannot happen. For judgment calls write conditions ("if X, prefer Y") so the model can balance trade-offs.
- **Anchor claims to evidence.** If something is a hypothesis, label it. Add explicit grounding rules for review, research, or any task where unsupported guesses would hurt quality.
- **Tighten the prompt before raising effort.** Better contracts beat more reasoning tokens.

## Recommended prompt skeleton (GPT-5.5)

Use this shape as the default. Drop sections that don't add value for the run.

```
Role: <one or two sentences: model's function and context>

# Personality
<short tone/collaboration cue: directness, when to ask vs assume, how proactive to be>

# Goal
<user-visible outcome>

# Success criteria
<what must be true before the final answer>

# Constraints
<policy, safety, scope, evidence, side-effect limits>

# Output
<sections, length, tone; use text.verbosity=low if you want brevity>

# Stop rules
<when to retry, fall back, abstain, ask, or stop>
```

Do not also wrap each section in XML unless you are passing the prompt to a downstream parser. The headers above are enough.

## When to add the XML blocks from `references/prompt-blocks.md`

Treat them as opt-in modules, not a default stack:

- **Coding or debugging.** Add `completeness_contract` and `verification_loop` only if there is a real risk of stopping early. Add `missing_context_gating` only if a missing fact would change correctness or be irreversible.
- **Review or adversarial review.** Prefer the built-in `review` / `adversarial-review` commands — they already carry the contract. Add `grounding_rules` and `dig_deeper_nudge` only when the default contract is not enough.
- **Research or recommendation tasks.** Add `research_mode` and `citation_rules` so claims stay sourced.
- **Write-capable tasks.** Add `action_safety` so Codex stays narrow and avoids unrelated refactors.

If a block is not changing behavior on GPT-5.5, remove it. Stacking blocks pushes the model toward mechanical answers.

## Stopping conditions and retrieval budgets

- Make stopping explicit when the task is multi-step or tool-heavy: state when Codex should stop, retry, fall back, or ask. After each tool result, the prompt should let Codex ask "Can I answer the core request now?".
- For retrieval-heavy work, set a budget: one broad search first; another retrieval call only if the top results miss the core question, a required fact is missing, or the user asked for exhaustive coverage.

## Validation defaults

- Coding agents: after changes, run the smallest useful validation — targeted unit tests, type/lint checks, build for affected packages, or a minimal smoke test when full validation is too expensive.
- Visual artifacts: render before finalizing; inspect for clipping, spacing, missing content; revise until the rendered output matches.
- Implementation plans: list requirements with where each is addressed, named resources/files/APIs, state transitions, validation commands, failure behavior, and open questions that materially affect implementation.

## Verbosity, formatting, phases

- `text.verbosity` defaults to `medium`. Set `low` when you want concise prose. Override per-run rather than baking length rules into every prompt.
- Default to plain paragraphs for conversational output. Use headers, bold, and bullets sparingly — only when they help scanning.
- For long-running tool workflows that surface intermediate updates, keep `phase` values intact: `phase: "commentary"` for intermediate user-visible updates, `phase: "final_answer"` for completed answers, no `phase` on user messages. Preserve assistant `phase` values exactly when replaying items manually.

## Preamble for tool-heavy runs

If Codex will make multiple tool calls before answering, instruct it to send a short user-visible acknowledgement and first-step statement before the first tool call. This keeps perceived responsiveness up without padding the final answer.

## Choosing the entry point

- Use built-in `review` or `adversarial-review` when the job is reviewing local git changes.
- Use `task` when the task is diagnosis, planning, research, or implementation and you need to control the prompt directly.
- Use `task --resume-last` for follow-up instructions on the same Codex thread. Send only the delta; restate the whole prompt only if the direction changed materially.

## Working rules

- Prefer explicit prompt contracts over vague nudges.
- Use stable XML tag names that match the block names in the reference file when (and only when) you opt in to a block.
- Do not raise reasoning or complexity first. Tighten the prompt and verification rules before escalating.
- Ask Codex for brief, outcome-based progress updates only when the task is long-running or tool-heavy.
- Keep claims anchored to observed evidence. If something is a hypothesis, say so.

## Prompt assembly checklist (GPT-5.5)

1. Write `Goal` and `Success criteria` first. If you cannot, the task is not ready to send.
2. Add `Constraints` and `Stop rules` only where defaults would fail.
3. Decide whether Codex should keep going by default or stop for missing high-risk details.
4. Pull in XML blocks from `references/prompt-blocks.md` only where they change behavior.
5. Remove anything that is process narration or duplicates the model's defaults before sending.

## References

- Reusable XML blocks (opt-in): [references/prompt-blocks.md](references/prompt-blocks.md). Library originated for GPT-5.4; on GPT-5.5 use selectively.
- End-to-end templates: [references/codex-prompt-recipes.md](references/codex-prompt-recipes.md).
- Common failure modes: [references/codex-prompt-antipatterns.md](references/codex-prompt-antipatterns.md). The biggest GPT-5.5-specific anti-pattern is carrying GPT-5.4 process-heavy stacks forward verbatim.
