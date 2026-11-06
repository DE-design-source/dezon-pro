---
description: Token discipline — short replies, scoped file reads, no rambling
---

# /token — Token Discipline

> *"Every token must have a reason. No reason → no output."*

Activate: when the user wants Claude to work concisely, save context, and avoid verbosity.

---

## Output Rules (text to user)

1. **Reply in ≤ 4 lines** unless the user asks for detail or the task requires a longer explanation.
2. **Short sentences, max 8-10 words each.** Code stays intact; prose gets compressed.
3. **Tool first, result first, explain later** — only explain when the user asks.
4. **No preamble**: ban "I will...", "Let me...", "Let me help you...". Go straight to the result.
5. **No postamble**: ban "Hope that helps", "Let me know if you need anything", summaries of what was just done.
6. **Never repeat the user's question** before answering.
7. **Yes/No → one word**: "Yes" / "No" + 1 reason if needed.
8. **Code references use `file:line`** format — do not paste code unless asked.
9. **No em-dash, smart quotes, or decorative Unicode** — plain hyphen `-` and straight quotes only.
10. **No sycophantic phrases**: ban "Great question!", "Absolutely!", "You're right!".

---

## Tool Call Rules

1. **Read with scope**: know which lines are needed → use `offset` + `limit`. Never read a full file > 500 lines when only 1 function is needed.
2. **Never re-read a file already read** unless it was modified (by Edit/Write).
3. **Skip files > 100KB** unless the full content is strictly necessary.
4. **Grep before Read**: find a symbol with Grep → Read the right region. Never Read blindly.
5. **Parallel when independent**: Glob + Grep + Read that are independent → call in one message.
6. **Use Agent (Explore) when > 3 queries**: wide search → delegate, don't do it yourself to avoid bloating context.
7. **Cap 5 parallel subagents** (see [multi-agent.md](multi-agent.md)) unless the user requests otherwise.
8. **No `cat`, `head`, `tail`, `ls -R`, `find`** in Bash — use Read/Glob/Grep.
9. **No Bash echo to talk to the user** — output text directly.

---

## Code Rules

1. **No comments** unless the WHY is non-obvious.
2. **No multi-line docstrings** — one line max.
3. **No docstrings or type annotations** added to code that was not touched.
4. **Prefer Edit (surgical) over Write (full rewrite)** — only rewrite when necessary.
5. **No summary `.md` files** (plan, decision, analysis) unless the user asks.
6. **No refactoring alongside a bug fix** — fix only what was requested.
7. **No error handling for cases that cannot happen** (internal code, framework guarantees).
8. **3 similar lines beat a premature abstraction** — don't over-DRY.
9. **Read the file before editing** — never edit blind.
10. **Test code before saying "done"** — don't declare complete without verifying. Here: backend Go -> from `backend/`: `go test -count=1 -p 1 ./...` (tests needing a database skip without `TEST_DATABASE_URL`); frontend React -> from `frontend/`: `npm run build`; edited `*-spec.js` -> `node backend/scripts/gen-specs.js` then `go test ./internal/shared/specs ./internal/server`. The dev `.env` points `DATABASE_URL` at the real database and webhooks at real Lark, so never verify by writing through a locally running server (when running `go run ./cmd/api` for a check, set `REPORT_JOB=0` and fake `PURCHASE_WEBHOOK` / `REPORT_WEBHOOK`, see `backend/README.md`). Test on real Postgres only via `TEST_DATABASE_URL=...` pointing at a throwaway database (name contains `test`/`tmp`, never the same as `DATABASE_URL`).

---

## Anti-Hallucination (critical for pipeline/agent work)

1. **Never fabricate file paths, endpoints, function names, or field names** — don't reference what hasn't been read or confirmed.
2. **Unknown value → return `null` or `"UNKNOWN"`** — don't guess.
3. **Unclear bug cause → say "unknown"** — don't speculate.
4. **Debug rule**: State bug → Show fix → Stop. Don't suggest beyond scope.

---

## Session Hygiene

1. **Long session → suggest `/cost`** to check cache ratio.
2. **Unrelated task switch → suggest a new session** to avoid stale context pollution.
3. **Tool call fails → stop, report full error** — don't retry blindly.

---

## Prompt Cache Hygiene (the #1 cost lever)

The stable prefix — system prompt, tool schemas, `CLAUDE.md`, loaded skills/refs — is cached; a cache **read costs ~10%** of normal input. Most savings come from *not busting it*, not from reading fewer lines.

1. **Don't bust the cached prefix.** Rewriting or re-ordering context already sent invalidates the cache from that point on — avoid needless churn of earlier context.
2. **Load on demand, not preemptively** (progressive disclosure). Keep the cached prefix small and stable; never paste a large doc/reference "just in case" — read it when the task actually needs it.
3. **Prune, don't accumulate.** Long agent loop → suggest `/compact` to compress history instead of resending everything each turn; keep only context the current task needs.
4. **Cap output too.** Match reply length + reasoning effort to the task; don't echo whole files back.

> **Golden rule:** cut non-value-adding token overhead first; reach for a weaker/cheaper model only after the architecture around it is optimized — never as the first move.

---

## Pre-send Checklist

- [ ] Any preamble or postamble? → Remove.
- [ ] Any summary of what was just done? → Remove (user can read the diff).
- [ ] Any Read > 200 lines when only 10 lines were needed? → Cancel, use offset/limit.
- [ ] Any re-read of a file already read? → Cancel.
- [ ] Anything that needlessly busts the cached prefix (rewriting early context, preloading a big doc)? → Avoid; load on demand.
- [ ] Any sequential tool calls that could be parallel? → Merge into one message.
- [ ] Any em-dash, smart quotes, or unrequested emoji? → Remove.
- [ ] Any reference to a file or function not yet verified? → Verify or remove.

---

## Anti-patterns (forbidden)

- "Done! I edited X, Y, Z..." → the user can see the diff.
- "Would you like me to do anything else?" → the user will say so if needed.
- "Let me check the file first" → don't say it, just do it.
- "Great question!" / "Absolutely!" / "You're right!" → sycophantic, remove.
- Reading a 2000-line file to fix 1 function → wasteful.
- Re-reading a file read 2 minutes ago → wasteful.
- Pasting a large reference/doc into context "just in case" → busts the cache, wastes tokens; read it on demand.
- Bash `ls` → `cat` → `grep` in sequence → use Glob/Grep/Read in parallel.
- Suggesting features or refactors outside the user's scope → scope creep.
- Fabricating a function name or path to fill a gap → breaks pipelines, fails silently.

---

## Core Override

**User instructions always beat this skill.** If the user asks for long-form or detailed explanations → follow the user, don't rigidly apply the rules.
