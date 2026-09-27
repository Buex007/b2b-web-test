# b2b-web-test

[中文](README.md) · **English**

Browser-driven testing for internal-facing web apps (admin consoles, CRMs, SaaS
back offices), built on **ego-browser** (execution) and **Jev** (per-step element
decision). Give it an entry URL and a plain-language case description; an AI
agent runs each case and leaves behind screenshots, a step timeline and a
verdict in its own working directory, plus an offline-viewable dashboard.

**MIT** · macOS · no runtime dependencies (no jq, node or python required)

![Dashboard](docs/dashboard.png)

---

## Background

Regression testing of internal systems has been stuck between two options that
each carry a real cost:

| Approach | Strength | Cost |
|---|---|---|
| Classic scripts (Selenium / Playwright) | Near-zero marginal cost per run; deterministic | Selectors break on every front-end change; maintenance lands entirely on people; tests are tightly coupled to implementation |
| Pure LLM agent driving the page | Flexible; copes with screens it has never seen | Every step ships a screenshot and the DOM to a large model — high token volume, second-scale latency, cost compounds across long flows |
| **This project** | Element decisions go to a small model; comprehension and judgement stay with the AI; the record is the tool's job | Requires macOS + ego lite + a Jev backend key |

The underlying judgement: **"which element to click" and "what this page means"
are different jobs.** The first is repetitive and structured — a small model can
decide it step by step. The second needs comprehension, and only that
justifies a large model. Separating them improves cost and stability at once.

## What it is

Three layers, each with one responsibility:

| Layer | Component | Responsibility |
|---|---|---|
| Execution | ego-browser (provided by [ego lite](https://lite.ego.app/)) | Open pages, semantic snapshots, click / fill / select, screenshots, in-page requests, session reuse |
| Decision | Jev (TypeSafe System One) | Per step: snapshot → number the interactive elements → one call picks the operation and its target. **It never reads content, never writes text, never looks at a screenshot** |
| Orchestration | `scripts/lib/` in this repo | Working directory and records, verdicts and evidence, reports and dashboard, session reuse, usage accounting |

The loop for one case:

```
create working dir → open entry URL → [ Jev decides → ego acts → record evidence ] × N
                   → AI verifies against page facts → write the verdict → render reports
```

Typical deployment: **DeepSeek v4.1 Flash orchestrates** (reading pages, judging,
writing the script) while **Jev makes the per-step decisions** (which element to
click). Measured usage for that pairing is in the results section below.

## Measured results

The numbers below come from real runs of this project (macOS + ego lite + a real
Jev backend). They are measurements, not estimates; the offline half can be
reproduced with `b2b-test selfcheck`.

**Real case** (public form page: fill two fields and verify — 3 steps)

| Metric | Measured |
|---|---|
| Total case duration (including navigation) | **6.60 s** |
| Steps / screenshots | 3 / 3 |
| Decision loop | 3 steps, 3.76 s total |
| Per-decision latency | 0.77 – 1.85 s (avg 1.13 s) |
| Semantic snapshot | 18 – 40 ms |
| DOM sweep for non-ARIA clickables | 2 – 5 ms |
| Action execution (fill / click) | 122 – 139 ms |
| Verdict check (reading field values) | 8 ms |
| Tokens | **9,016 in / 1,963 out** across 3 calls (≈3.0K in per call) |
| Serving model | typesafe/jev-1.13-20260917 |
| Verdict | pass (both field values matched exactly) |

> Token use scales with the number of candidate elements on the page. This page
> was tiny (≈3.0K in per call); upstream measured ≈11K in per step at 20–120
> candidates. Every case records its own usage.

**Model pairing and measured usage** (DeepSeek v4.1 Flash orchestrating + Jev deciding)

| Metric | Value |
|---|---|
| Orchestration model | DeepSeek v4.1 Flash |
| Decision model | Jev (TypeSafe System One) |
| Jev tokens for one 3-step case | 9,016 in / 1,963 out |
| How it is recorded | call count and tokens go into the `jev` field of `result.json` |

> Usage scales with flow length and the number of candidate elements on the page.
> These are **measurements recorded by the tool itself**, not estimates, and every
> case keeps its own breakdown in the record.

**Offline self-check** (built-in mock decider; no network, no token spend)

| Metric | Measured |
|---|---|
| Total case duration | 1.9 – 3.6 s |
| Steps / screenshots | 3 / 3 |
| Checks | 3 / 3 passed |
| Tokens | **0** |
| Chain covered | working dir → record → screenshots → verdict → report → dashboard |

**Regression batch** (2 cases in one batch)

| Metric | Measured |
|---|---|
| Batch duration | 4.27 s |
| Cases / passed | 2 / 2 |
| Artifacts | 3 process screenshots + timeline + verdict + per-case report, per case |

**Bundled tests**

| Metric | Measured |
|---|---|
| Unit and integration tests | **39 / 39 passing** (including portability guards) |
| How to run | `b2b-test test` (pure logic; no browser, no network) |

## Install

**Option 1 — let the AI do it (recommended)**

> Install and configure b2b-web-test for me: repo
> `https://github.com/Buex007/b2b-web-test`. Run `init` and `selfcheck`, handle
> anything missing yourself, and show me the results.

**Option 2 — install it yourself**

```sh
git clone https://github.com/Buex007/b2b-web-test.git ~/.codex/skills/b2b-web-test
sh ~/.codex/skills/b2b-web-test/install.sh
```

`install.sh` links the skill into every skill directory that already exists on
the machine (Codex / Claude / shared) and then runs the initialisation. Preview
what it will do first with `sh install.sh --dry-run`.

## Prerequisites

### Only two things must be done by a human

Everything else — installing, configuring, creating working directories, running
cases, producing reports — can be delegated to the AI.

| You must do | Why the AI cannot |
|---|---|
| **1. Download and open ego lite; complete first-run onboarding** | Onboarding is a GUI flow a script cannot click through, and it is what registers the `ego-browser` command |
| **2. Obtain a Jev backend key** | Signing up needs an email and possibly a card, and a key should not be relayed through a chat window |

**1. ego lite (one-off, about 2 minutes)**

1. Open <https://lite.ego.app/> and download the macOS build
2. Install it, then **open it** and finish the onboarding (skip the browser-data
   import if you like)
3. Onboarding registers the `ego-browser` command into `~/.local/bin`
4. If Gatekeeper blocks it: **System Settings → Privacy & Security → Open Anyway**

**2. A Jev key** (pick one)

| Option | Where | How |
|---|---|---|
| ① OpenRouter (recommended) | <https://openrouter.ai/settings/keys> | Sign up → **Create Key** → copy the `sk-or-v1-…` string |
| ② TypeSafe | <https://typesafe.ai/> | Sign up → copy the API key from the console |
| ③ Vercel AI Gateway | <https://vercel.com/dashboard> | Open AI Gateway → generate an API key |

> ⚠️ **Do not paste the key into the chat window.** Have the AI run
> `b2b-test key` and paste it into the terminal prompt it opens (input is not
> echoed), or run that command yourself. It infers the backend, writes a `0600`
> config file, and immediately verifies the key against the provider.

## Usage

### Talking to the AI (recommended)

Copy this to any agent that can run shell commands (Codex, Claude Code, Cursor,
your own):

> Run a B-end test case with b2b-web-test.
> Entry URL: `https://your-app`
> Case description: `what you want verified, e.g. "create an order after login and confirm it appears in the list"`
>
> Do the configuration and execution yourself — don't make me run commands by
> hand. Come back to me only for the parts I must do in person (ego lite
> onboarding, the Jev key, signing in / MFA in the browser).

The agent then runs `install.sh` → `init` → `doctor` → `new` → writes `plan.mjs`
→ `exec` → `report`. You are only interrupted for **ego lite onboarding**, the
**Jev key**, and **sign-in / SMS / MFA**.

### Doing it by hand (when no agent is around)

```sh
b2b-test init                                       # check ego lite, write config, run offline self-check
b2b-test key                                        # set the Jev key (interactive, no echo, verified at once)
b2b-test doctor                                     # environment health check
b2b-test new "case description" --url https://... --label v2.3.1   # create the working dir first
b2b-test exec "<case dir>"                          # run it and write the record
b2b-test report --open                              # open the dashboard
```

| Command | Purpose |
|---|---|
| `b2b-test key check` | Show key source, backend and validity (uses no generation quota) |
| `b2b-test exec "<dir>" --junit` | Also emit `junit.xml` for CI |
| `b2b-test exec "<dir>" --mock` | Run with the built-in mock decider (offline; for self-checking) |
| `b2b-test ls [--limit N]` | List batches and per-case verdicts |
| `b2b-test session list` / `close <env>` | Inspect / close reused login sessions |
| `b2b-test prune --keep 10` | Prune old records by batch |
| `b2b-test selfcheck` | Offline end-to-end self-check |
| `b2b-test test` | Code self-test (pure logic) |

Common `new` options:

| Option | Meaning |
|---|---|
| `--url <url>` | Entry URL (required) |
| `--label <text>` | Batch label, e.g. `v2.3.1`, `smoke` |
| `--continue` | Attach to the most recent batch (batch regression runs) |
| `--env <name>` | Environment name, recorded |
| `--out <dir>` | Write records under a given directory (e.g. inside the project under test) |
| `--shots step\|fail\|off` | Screenshot policy; defaults to one per step |

### Verdicts and exit codes

Verdicts are `pass` / `fail` / `need-human` / `blocked` / `error` / `running`,
mapping to exit codes `0` / `1` / `2` / `3` / `1` / `4` for CI.

## The record

Written by default to `~/.local/share/b2b-web-test/` — outside the repository, so
customer data never lands in version control:

```
batches/<batch id>/cases/<NN-case-slug>/
  case.md        the entry URL and the case description, verbatim
  plan.mjs       the execution script
  steps.jsonl    step timeline, appended as it runs
  shots/         process screenshots
  result.json    the verdict (machine readable)
  report.md      plain-text report
  report.html    single-file viewer
reports/index.html   global dashboard (batches + per-case history)
```

![Case record](docs/case-report.png)

## Boundaries

- Jev **does not read content, write free text, or look at screenshots** — those
  go back to the AI. That is the division of labour, not a gap.
- **Login / MFA / captcha are not automated** — they are handed back, and the
  session is reused afterwards.
- **Sequential only**: one session per case, no parallelism, no load testing.
- **Canvas / heavily visual pages**: when the semantic snapshot offers nothing
  actionable the loop reports `blocked`; such screens need bespoke coordinates.
- Destructive actions (delete / pay / permission changes) are blocked by default
  and handed back.

## Portability

- **Any macOS user**: no hard-coded home directories, skill paths or ego lite
  versions — every path is resolved at run time.
- **Any agent**: the capability contract is "can run shell commands" plus "can
  feed a script to `ego-browser nodejs`". Humans can drive the same CLI.
- **Zero runtime dependencies**: the launcher is POSIX sh; no `jq`, `node` or
  `python` needed.
- Guards are baked into the test suite: hard-coded paths, pinned versions and
  GNU-only `sed` / `grep` extensions all fail the build.

## Documentation

[SKILL.md](SKILL.md) (the agent entry point) ·
[initialization](references/initialization.md) ·
[portability](references/portability.md) ·
[record protocol](references/workdir-protocol.md) ·
[dashboard](references/visualization.md) ·
[B-end patterns](references/b2b-patterns.md) ·
[fusion and upgrades](references/jev-fusion.md)

## Licence

**MIT** — see [LICENSE](LICENSE).

This repository contains third-party code: `scripts/vendored/jev-loop.mjs` is
copied byte-for-byte from ego-jev (MIT) with no modifications. Per the upstream
declaration:

> MIT. Policy, snapshot, and question text are derived from jev-ultrafast (MIT, Browser Use).

Full attribution and maintenance notes: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
