# Project Profile — Pickett Classroom

> Auto-generated project conventions and verification recipe.
> Edit this file as your project evolves.

**Product type:** GUI app (responsive web) — React/Vite frontend + Node/Express backend

**Stack:** TypeScript everywhere. npm workspaces (`shared` / `server` / `client`).
Server: Node 20+, Express 5, Prisma 6 + SQLite, `tsx` for dev. Client: React 19,
Vite 7, plain CSS with design tokens as custom properties (no Tailwind — see
`docs/product/05-implementation.md`). Shared: zod schemas exported as both
runtime validators and inferred types.
**Test runner:** Vitest (node env on the server, jsdom on the client) + supertest
**Package manager:** npm (workspaces)


## How to run / build / test

**First-time setup:**
```bash
npm install
npm run -w server db:push     # apply the Prisma schema + generate the client
npm run -w server seed        # idempotent F1-F14 fixture seed
```

**Development** (two processes; the Vite dev server proxies `/api` to the
backend so local dev is same-origin and the session cookie actually travels):
```bash
npm run dev:server            # http://localhost:4000
npm run dev:client            # http://localhost:5173
```

**Build:**
```bash
npm run build                 # shared -> server -> client
```

**Test:**
```bash
npm test                      # shared + server + client
```

**Lint:**
```bash
npm run lint
```

## Verify recipe

When code changes are complete, run:

1. npm test
2. npm run build
3. npm run lint

## Quality budgets

> Landed by the engineer stage alongside the tests that measure them (D21). Every
> row below names a command that exists and produces a number; each prints a
> `[budget] …` line so the measured value is visible, not just pass/fail.

A **sibling** of the Verify recipe above, never rows appended to it. The recipe
is fail-fast — it breaks at the first failure — so an advisory miss there would
abort a blocking check behind it. Budgets run **every** row and never break.

| Dimension | Key | Metric | Target | Tier | Check |
|---|---|---|---|---|---|
| performance | `engine_throughput_f4_50posts` | Server-side engine time for F4's 50 posts, excluding client poll overhead, with F12's slow mode OFF | `< 120s` | advisory | `npm run test:perf` |
| correctness | `reconciliation_invariant_all_fixtures` | `transferred + fallback_shell + skipped == count(items) == scan.totalPostsScanned` read from the persisted scan row, topics excluded, for every fixture | `100% pass, 0 failures` | advisory | `npm run test:budget:reconciliation` |
| correctness | `no_pending_after_completion` | No job reaches `completed` with a pending item, across injected PermissionError / NotFoundError / arbitrary Error / top-level throw — **and** no successfully-created post is reported as "nothing was written", across the three POST-CREATE throw sites (`clearPause`, `getRubric`, `updateCourseWork*Description`) | `0 pending, 0 stuck jobs, 0 created-but-denied posts` | advisory | `npm run test:budget:totality` |
| correctness | `executor_lease_mutual_exclusion` | A reconciler firing mid-flight against a live executor: exactly one writes the terminal state, the displaced executor stands down, and the executor heartbeats through topic creation and the hydration enumeration | `1 terminal writer, invariant holds, heartbeats in both gaps` | advisory | `npm run test:budget:lease` |
| performance | `selection_screen_call_cost` | Provider calls behind `GET /courses` — the first authenticated call the app makes | `0 post enumerations; 1 count per course; postCount == enumerator` | advisory | `npm run test:budget:courses` |
| fidelity | `fixture_f1_zero_fallback` | Fallback-shell rate on the healthy F1 course | `0 fallback shells, >=95% fidelity` | advisory | `npm run test:budget:f1` |
| resilience | `fixture_f13_exhaustion_terminal` | F13's persistently-429'd item after exactly 5 attempts | `attemptCount == 5, outcome == fallback_shell, targetPostId != null` | advisory | `npm run test:budget:f13` |
| integrity | `interrupted_items_verified_not_assumed` | Interrupted items resolved on evidence the JOB OWNS (`claimedTargetPostId`), with the title fallback scoped by `job.startedAt`, sibling-claimed ids excluded and ambiguity refused; gated by three false-positive cases (pre-existing colliding post / dirty target from a previous run / duplicate source titles) as well as the true positives | `0 false "transferred", no two items sharing a targetPostId, skippedByUser == 0` | advisory | `npm run test:budget:reconcile` |
| resumability | `fixture_f12_reconnect_fidelity` | Disconnect/reconnect mid-batch on F12's slow-mode run | `0 duplicated or missing items` | advisory | `npm run test:budget:f12` |
| accessibility | `wcag_aa_automated_per_step` | axe violations across the wizard surfaces, plus an arithmetic WCAG contrast audit of every token pairing | `0 critical/serious violations; every pairing >= its threshold` | advisory | `npm run test:budget:a11y` |
| cold start | `coldstart_overlay_timing` | Overlay appears at ~2s on an unresolved call; a distinct error state at the 60s ceiling | `both bounds hold` | advisory | `npm run test:budget:coldstart` |

**Who adds a row, and at what tier:**

- The **engineer** scaffolds the quality tests (`test/quality/*` or this
  stack's equivalent) as part of building the thing being measured — not
  `init-project-profile.js`, which cannot know what this project will need and
  would only be guessing a path into existence.
- Every new row enters as **`advisory`**: measured and reported, never
  blocking. A budget nobody has watched hold even once is a hypothesis.
- The ratchet to **`blocking`** has a named actor on both ends: **QA proposes
  the tier flip in its report** once the row has passed at least once, and **the
  human approves it at the existing gate**. Nothing promotes itself.

Run them **from your Agent-C checkout** — the runner lives there, not in this
project — pointing at this project's path:

```bash
node scripts/agent-c-budgets.js run "/Users/brettevanssf/Code/Pickett Classroom"
```

### Not declared, and why

- **"Median sign-in-to-done < 5 minutes"** (brief §5) is a human-timed,
  full-session UX metric, not an engine-time budget a script isolates. QA is the
  right stage to instrument it with a timed browser run.
- **Term-boundary retention** (brief §5) is post-launch usage data with no
  pre-launch check.
- **Real-browser E2E.** The architecture specified Playwright + `@axe-core/playwright`;
  the suite is Vitest + jsdom + `axe-core` instead (see
  `docs/product/05-implementation.md` and the backlog). The consequence is
  stated plainly: `wcag_aa_automated_per_step` runs axe against the rendered DOM
  with **no layout**, so axe's own `color-contrast` rule cannot evaluate and is
  reported as incomplete. The contrast half of that row is covered instead by a
  deterministic arithmetic WCAG audit over the token pairings — which is
  stronger than a jsdom axe run that silently skips the check, but is not the
  same thing as a real-browser pass.

## Architecture & key patterns

> Document your project's architecture, key patterns, and integration points.
> Reference this when designing new features (engineers use it to conform).

- **Structure:** npm workspaces. `shared/` holds every client<->server DTO as a
  zod schema (the ONLY declaration — the client never redeclares a payload
  shape). `server/` is a modular monolith with ports-and-adapters at the Google
  boundary. `client/` is feature-folder-per-wizard-step.
- **State management:** server-side. The transfer job is a DB-backed state
  machine; the client polls. No client-side source of truth beyond
  pre-submission form state.
- **Routing:** Express routers mounted under `/api`; the client is a single
  linear wizard driven by React state, no router library.
- **Key services/modules developers must know:**
  - `server/src/services/post-enumerator.ts` — the SINGLE owner of "all posts":
    the paginated loop over both coursework surfaces, the merge, and the total
    ordering key `(creationTime, sourceType, sourceId)`. Never open-code a merge.
  - `server/src/services/preflight-engine.ts` — PERSISTS the scan. `count(items)`
    and `totalPostsScanned` are one measurement read twice.
  - `server/src/services/transfer-engine.ts` — the outcome function is TOTAL;
    every error class terminates its item, a sweep runs before `completed`, and
    the top level catches into `failed`.
  - `server/src/services/job-reconciler.ts` — verifies interrupted items against
    the target instead of assuming a skip; runs at boot AND on an interval.
  - `server/src/adapters/` — the type-only port emits no JS, so nothing can
    import a concrete provider through it. `server/src/app.ts` is the only
    module that names `MockClassroomProvider`.
- **Testing:** `*.test.ts(x)` beside the code; `server/test/` for integration and
  `server/test/quality/` for the budget rows. Each server test file gets its own
  SQLite copy of a schema-only template (`server/test/helpers/db.ts`) — a shared
  file plus SQLite's single writer produces flaky SQLITE_BUSY failures that look
  exactly like product bugs.
- **CI/CD:** none configured. Deployment target is two Render services; nothing
  is deployed by this project's tooling.

## Design system

> Document tokens, components, and conventions GUI work must follow.

- **Colors:** `client/src/styles/tokens.css` — paper-0/1/2, line/line-strong,
  ink-900/700/500, teal-700/600/100, amber-700/100, green-700/100, red-700/100,
  slate-600, focus. Values come from `docs/product/03-ui-direction.md` §2 and are
  asserted against it by `client/src/styles/contrast.a11y.test.ts`.
- **Typography:** Source Serif 4 (headings), Public Sans (UI/body), IBM Plex Mono
  (numbers and tabular data only — never prose).
- **Spacing/radii:** `--radius: 3px` throughout. Paperwork controls, not pills.
- **Components:** `client/src/components/shared/` — ColdStartOverlay,
  NarrationBanner, StepIndicator, OutcomeIcon, OutcomePill, Button, Badge,
  ErrorState.
- **Accessibility:** WCAG AA. `OutcomeIcon` cannot render glyph-only — it has no
  prop that suppresses its text label. The progress live region is throttled
  (never per-item). Focus moves to the Completion Summary heading on mount. The
  Action Sheet is focus-trapped with sentinel nodes. Narrow viewport: stat grid
  reflows 5->3->2; the log table horizontal-scrolls with a sticky title column.

## Conventions

- **Naming:** kebab-case files on the server, PascalCase components on the
  client. Enum-ish vocabularies are lower_snake strings matching the zod schema.
- **Lint/format:** flat-config ESLint (`eslint.config.js`) with
  typescript-eslint recommended. No Prettier; 2-space indent, no semicolons,
  single quotes, 100-col soft wrap.
- **Comments:** comment the WHY, especially where a shape exists to make a
  failure unrepresentable. Several modules carry a header explaining the defect
  their design closes — keep those current rather than deleting them.
- **Imports/exports:** `.js` extensions on relative imports (NodeNext).
  Cross-tier types come from `@classroom-copier/shared` only.
- **Error handling:** provider errors are typed classes normalised by one Express
  error middleware. Logging is `server/src/logger.ts` — structured JSON to stdout
  AND to `logs/app-YYYY-MM-DD.log`, which is the file QC scans.

## "How to add X here"

> Concrete recipes for adding common things to this project.

- **Adding an endpoint:** declare its request/response schema in
  `shared/src/api-types.ts` FIRST, then add the route under `server/src/routes/`,
  then a method on `client/src/lib/api-client.ts` that parses the response
  through the shared schema. Never hand-declare a payload type on the client.
- **Adding a provider capability:** add it to
  `server/src/adapters/classroom-provider.interface.ts` shaped to the REAL
  Google API (filters, pagination, batching), implement it in the mock, and add a
  case to `server/test/classroom-provider.contract.test.ts` — the contract suite
  is what will catch drift when the real adapter arrives.
- **Adding a component:** `client/src/components/shared/` if reused, else the
  owning feature folder. Test behaviour; do not fake tests for pure styling.
- **Adding a data model:** edit `server/prisma/schema.prisma`, run
  `npm run -w server db:push`, and extend `server/src/fixtures/` if it needs a
  seed. Prefer a shape that makes the bad state unrepresentable over a comment
  saying not to do it.
- **Adding a quality budget:** write the test under `server/test/quality/` (or
  the client equivalent), add an `npm run test:budget:*` script, and add the row
  to the table above at tier `advisory`.

## Lessons learned

> Project-specific recurring findings. Capture patterns and anti-patterns
> discovered during QA/QC so the next feature/phase avoids them.

- **Cross-references must resolve, and identifiers must be assigned where they are
  defined, not where they are cited.** Four stages running, this project has shipped a
  citation to something that does not exist (`F: cold-start sim` in the wireframes; a
  nonexistent Deltas row; and at the architect stage `D1`–`D10`, cited 26 times against
  Deltas tables that carry no identifiers at all — 8 of those cites inside the
  machine-parsed `agent-c:modules` block the engineer's dispatch planner reads). The
  pattern is always the same: the author invents a shorthand while writing, uses it
  consistently, and never goes back to define it. Before any artifact is handed off,
  grep it for every `[A-Z]\d+` token and confirm each one resolves to a labelled row in
  a named document.
- **A guarantee is structural only if the failure it forbids is unrepresentable — not
  merely undesirable.** The architect's "reconciliation by construction" correctly made
  *double-counting* unrepresentable via a single-valued NOT-NULL enum, then relied on
  prose for the three failure modes the schema does not forbid: fall-through (`pending`
  with no declared exit for non-429 errors), an identity between two independent
  measurements asserted as "true by definition", and a "guaranteed" fallback executed
  through the very call that was failing. When claiming a guarantee is structural,
  enumerate how it could fail and check each way against the schema — whatever the
  schema does not forbid is still living in the paragraph.

## Next: Use this profile

When designing or building features, read the relevant sections above:
- **Architects** read "Architecture & key patterns" + "Stack" to design
- **Engineers** read "Conventions" + "How to add X" to implement
- **QA** reads "Design system" to verify conformance
- **Product** reads the verify recipe to understand validation needs
