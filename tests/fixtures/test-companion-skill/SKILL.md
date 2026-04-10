---
name: test-companion-skill
description: Integration test skill for codex-plugin-cc. Responds with COMPANION_TEST_OK and the task text.
---

# Test Companion Skill

This skill is used for integration testing of the codex-plugin-cc `/codex:run-skill` command.

When invoked, respond with **exactly** this format and nothing else:

```
COMPANION_TEST_OK: <the user's prompt text>
```

Rules:
- Output only the single line above.
- Do not perform any file operations, code changes, or research.
- Do not add explanations or commentary.
- "The user's prompt text" means the text the user sent after the skill activation phrase.
