# Intelli-Learn architecture and module contracts

Intelli-Learn is a local-first, installable web app (PWA) that gives children an
adaptive stream of AI-generated STEM challenges. A parent configures it behind a
password. Everything a child does is stored on the device for the parent to review.

Three rules shape the design:

1. **The AI describes, the app draws.** The model only returns JSON that matches
   the zod schemas in `src/core/schemas.ts`. The app validates it and renders it
   with its own canvas engine and interaction widgets. No AI-written code,
   HTML or script ever runs. AI-written SVG is sanitized before drawing.
2. **The app owns progression.** Skill stages, school-grade levels, rewards,
   time limits and the no-skip rule are enforced in code, never by the model.
3. **Local-first.** All records live in IndexedDB (`src/data/db.ts`). No
   analytics, no accounts, no third-party requests except the AI endpoint the
   parent configured.

## Stack

React 19, TypeScript (strict, `noUncheckedIndexedAccess`), Vite, Tailwind CSS 4,
Zustand, Dexie (+ `dexie-react-hooks`), Zod 4, `motion` (Framer Motion),
DOMPurify, react-router-dom 7, Vitest + Testing Library + fake-indexeddb,
Playwright. Import alias: `@/` = `src/`.

## Module map

| Directory | Responsibility | Depends on |
| --- | --- | --- |
| `src/core` | Shared types, zod schemas, grade helpers, defaults | nothing |
| `src/core/skills` | Grade-mapped skill map | core |
| `src/data` | Dexie database, backup/restore, usage counters, child CRUD | core |
| `src/security` | Admin password, lockout, forgotten-password wait, parent gate, API key encryption | core, data |
| `src/offline` | Built-in challenge bank and procedural generators (no AI needed) | core, skills (the engine only in tests: `crosscheck.test.ts`) |
| `src/engine` | Canvas scene renderer, interaction widgets, answer checking, validators | core |
| `src/ai` | OpenAI-compatible client, prompts, generation, safety | core, skills, data, security, offline, engine (validators) |
| `src/progression` | Stage engine, item selection, placement, rewards, limits | core, skills, data |
| `src/voice` | Text-to-speech and speech-to-text behind one interface | core |
| `src/i18n` | UI strings and `t()`, including the translations of the engine's labels | core |
| `src/ui` | Shared React components and theme | core, i18n, react-router-dom (`PageShell` back link) |
| `src/library` | Canvas library: keep, rate, reuse and remix built challenges | core, data |
| `src/play` | Challenge supply queue (`supply.ts`), play session store, play screen, help ladder, teach-back | core, skills, data, ai, engine, library, offline, progression, voice, i18n, ui, bot (`HelperBot`, `Pip`); `child` only for the badge names and the studio's picture ideas (`buildIdea`), loaded on demand |
| `src/bot` | Floating helper bot. It only shows and drives the play session store | data (`kv`), play (store), voice, i18n, ui, `./pip` |
| `src/bot/pip` | Pip, the mascot: one SVG with 20 moods (`Pip`, `usePipMood`) | i18n, ui (`useReducedMotion`) |
| `src/child` | Profile picker, adventure map home, mode launcher, rewards shelf, Imagination Studio, rest screen | core, data, security (`getResetRequest`, for the reset notice on the profile picker), ai (`localSafetyCheck`), progression, voice, i18n, ui, bot/pip |
| `src/parent` | Setup wizard, password gate, overview, children, history, canvas library, settings | core, skills, data, security, ai, engine (replay), library, progression, i18n, ui; `play` only for `supplyIdle`, loaded on demand before a reset |
| `server/proxy` | Optional AI proxy that keeps the API key server-side | none (plain Node) |
| `tools/mock-ai` | OpenAI-compatible mock server for development and e2e tests | none (plain Node) |

A module only exports its public API from its `index.ts` / `index.tsx`. Other
modules import from the module root (`@/engine`, never `@/engine/internal/x`).

### App shell (`src/App.tsx`)

The shell owns three page-wide concerns, so no screen has to:

- **Interface language.** It calls `setLocale(settings.locale)` when the settings
  load and whenever they change. A screen that saves a new language only writes
  the setting.
- **Accessibility.** On every route under `/kids/:childId` it applies that child's
  `accessibility` settings with `applyAccessibility`, live. On every other route
  (profile picker, setup, parent area) it clears them. Screens never call
  `applyAccessibility` themselves.
- **Toasts.** It mounts the one `<ToastViewport />`. Screens call `useToast()` or
  `showToast()`.

In development and preview, Vite forwards `/ai-proxy` to the AI proxy
(`npm run proxy`, port 8788; override with `AI_PROXY_TARGET`), the same path nginx
serves in the Docker image.

## Routes

| Path | Component | Owner |
| --- | --- | --- |
| `/` | redirects to `/setup` until setup is complete, then `/kids` | app |
| `/setup` | `SetupWizard` (goes to `/parent` once setup is complete) | parent |
| `/parent/*` | `ParentArea` (shows the password gate itself) | parent |
| `/parent` | overview | parent |
| `/parent/children` | the children. Query: `add=1` opens "Add a child" | parent |
| `/parent/child/:childId` | one child. Query: `tab` = `progress`, `history`, `report`, `profile` or `data` | parent |
| `/parent/library` | canvas library | parent |
| `/parent/settings` | settings. Query: `section` = `ai`, `controls`, `language`, `password`, `backup`, `danger` or `about` | parent |
| `/kids` | profile picker | child (`ChildArea`) |
| `/kids/:childId` | adventure map home | child |
| `/kids/:childId/shelf` | rewards shelf and companion | child |
| `/kids/:childId/studio` | Imagination Studio idea picker | child |
| `/kids/:childId/rest` | rest screen (play time is used up, or outside the allowed hours) | child |
| `/kids/:childId/play` | `PlayScreen`. Query: `mode` (a `Mode`), `strand`, and for the studio `pick` (three chip ids) or `idea` (typed text, honoured only while open chat is on) | play |

The parent gate lives in memory only: loading any page, leaving the parent area
or pressing "Lock" locks it again. Child routes redirect to `/setup` until setup
is complete; an unknown child id goes back to `/kids`.

## Core concepts

### Grades and stages

A learning stage is one integer `gradeIndex * 4 + stepIndex` (`StageValue`, 0..39).
Grades are US school grades `PK, K, 1..8`. Steps are `starting, growing, strong, ready`.
Use `src/core/grades.ts` (`makeStage`, `stageGrade`, `stageStep`, `stageLabel`, ...).

- A child has an enrolled `grade` (set by the parent) and an `ageGroup`.
  The age group controls tone, reading level and voice-first presentation.
  The grade and stage control content difficulty.
- Each skill (`SkillDef`) lists a concrete expectation for every grade where it
  exists (`gradeExpectations`). A `SkillState` holds the child's `stage` and
  `mastery` (0-100 inside the current step) for that skill.
- A strand's stage is aggregated from its practised skills (`getStrandStages`).

### Challenge = content + interaction + scene

`Challenge` (see `ChallengeSchema`) has text (intro, question, read-aloud text,
two hints, a walkthrough, an explanation, an optional teach-back question), one
`interaction` (the answer mechanic) and one `scene` (declarative artwork).

Interaction kinds and the answer value each produces (`Answer` in `@/engine`):

| Kind | Child does | Answer value | Correct when |
| --- | --- | --- | --- |
| `choice` | picks option(s) | `string[]` of option ids | set equals `correctIds` |
| `tap` | taps scene objects | `string[]` of object ids | set equals `targetIds` |
| `sort` | drags items into bins | `Record<itemId, binId>` | every item in its `binId` |
| `match` | connects pairs | `Record<leftPairId, rightPairId>` | every left matched to its own pair id |
| `order` | arranges items | `string[]` of item ids | equals the schema order |
| `number` | types a number | `number` | within `tolerance` of `answer` |
| `robot` | arranges command blocks | `RobotProgram` | simulation reaches goal, no crash, all gems, within `maxCommands` |
| `build` | picks parts | `string[]` of part ids | power sum >= `target` and cost sum <= `budget` |

### Modes

A `Mode` is the creative framing: `quest`, `story`, `experiment`, `robot`,
`detective`, `fixbot`, `invention`, `wonder`, `studio`, `mission`. Mode-to-interaction
defaults: `robot` -> `robot`; `invention` -> `build`; `experiment`, `detective`,
`fixbot`, `wonder` -> `choice` (or `number`/`order` where natural); `mission` ->
`choice` or `number` (the child reports what they found); `story` and `studio`
and `quest` -> any kind that suits the skill.

### No skipping, always help

There is no skip control anywhere. The help ladder escalates one level per request:
level 1 nudge (`hints[0]`), level 2 strong hint (`hints[1]`), level 3 walkthrough
(`walkthrough[]`, one step at a time). After a walkthrough the child still enters
the answer themselves. Help is also offered automatically after two wrong tries
or a long pause. The child may leave to the home screen; an `active` challenge
resumes when they return, whatever world or mode they open next: `takeNext`
gives the unfinished challenge back first, Pip says "Let us finish this one
first", and what was asked for (the world, the mode, the studio's picture idea)
is served once it is finished. Only the parent's switches take an unfinished
challenge away (its subject or real-world missions switched off, or stricter
content rules).

### Outcomes and mastery

`AttemptOutcome` is derived from what happened: `independent` (first try, no
help), `second-try` (wrong tries, no help), `nudge`, `hint`, `walkthrough`.
The progression module turns an outcome into a mastery change and possibly a
stage change (see `src/progression`).

The stage engine does not take a `second-try` at face value. It works with the
**credited outcome** (`creditedOutcome(outcome, wrongTries, answerSpace)`): a
`second-try` counts as a `nudge` when the child needed more than
`TUNING.mastery.secondTryMaxWrong` wrong tries, or when the question has fewer
than `secondTryMinAnswers` possible answers (`answerSpace(content)`), because
the remaining options then give the answer away. The stored attempt, the stars
and the badges keep the plain outcome; mastery, concept checks and placement
use the credited one, and the play screen decides "check passed" the same way.

### Concept checks (back testing)

Mastery alone never raises a stage. When a skill's mastery reaches the step-up
threshold, the skill is marked `checkPending` and the child's next item on that
skill is a **concept check** (`purpose: 'check'`): a brand-new challenge on the
same grade expectation, in a different interaction kind from the skill's
`recentInteractions` where the skill offers one, and in a different context.
The AI is told the previous questions so it tests the same idea in a new way.

- Check solved `independent` or `second-try` (credited, see above): the stage
  steps up, `checksPassed` increases, a spaced review is scheduled,
  `checkPending` clears. One step is the rule. A check solved `independent`
  after a run of independent solves on that skill moves further:
  `accelerateSteps` (2) from a streak of `accelerateStreak` (5), `leapSteps` (4,
  a whole grade) from `leapStreak` (8), never past the top of the skill. A child
  who is far ahead of the starting level is not held to one step per check.
- Check solved with a `nudge` or `hint`: no step up, mastery drops to 60,
  `checkPending` clears (more practice, then another check).
- Check needed a `walkthrough`: no step up, mastery drops to 40, `checkPending` clears.

A check is always about the skill it tests. Without the AI (Demo mode, no
budget, a failed generation) the supply builds it from the offline bank's own
content for that skill (`pickOwnSkillChallenge`), in a form the child has not
solved before, switching to another interaction kind of the skill when the
planned one has nothing new. When the bank has nothing new at all, no check is
served: the skill is set aside for `SUPPLY.checkRetryMs`, the planner is told
(`withoutChecks`) and the child practises, and on the third try in a row the
item is built as ordinary practice. A check is served whatever game mode the
child asked for, and the planner falls back to quest mode when the child's mode
offers only the interaction kind the child has just used.

Spaced reviews (2, 7, 21 days) re-test old concepts later, and a walkthrough is
always followed by an easier sibling item. Together these make sure a level
shown to the parent reflects understanding, not a lucky streak.

### Canvas library (keep, rate, reuse, remix)

Every AI-built challenge that passes validation is saved as a `LibraryItem`
(`db.library`), which is shared by all children on the device.

- **Keep.** Parents can browse every built canvas, replay it exactly as the
  child saw it, and see how children did on it.
- **Rate.** Parents rate canvases 1-5 stars with an optional note. A rating of
  1 or 2 retires the item so it is never served again, and its note is passed
  to future generations as something to avoid. That includes copies that were
  already waiting in a child's queue or left unfinished: the supply discards
  them (with their saved run) the next time it looks at the queue. Ratings of 4 or 5 mark it as preferred.
- **Reuse.** Before asking the AI, the supply queue looks for a library item
  with the same skill, grade and interaction, a compatible age group and
  locale, not retired, and not yet seen by this child. A fitting item is served
  as-is (`source: 'reused'`), which is instant and free.
- **Remix.** When the item's theme does not match this child's interests and
  the AI is available, the item is remixed instead: same concept and structure,
  new theme, new numbers and details (`remixChallenge`). The remix is saved as
  a new library item with `remixOf` set.
- To keep content fresh, at most about half of a child's queue comes from the
  library, concept checks are never served from items the child has seen, and
  procedural offline items are not stored in the library.

## Public contracts

These signatures are the agreement between modules. Implementations may add
more exports, but must not change these without updating this file.

### `@/data`

```ts
export { db, getSettings, updateSettings, CHILD_TABLES, IntelliLearnDB } from './db';

// children.ts
export interface NewChildInput { nickname: string; avatar: string; ageGroup: AgeGroup; grade: Grade; interests: string[]; }
export function createChild(input: NewChildInput, now?: number): Promise<ChildProfile>;   // validates (throws Error), fills defaults, gives an egg companion
export function updateChild(id: string, patch: Partial<ChildProfile>): Promise<ChildProfile>; // throws when not found or invalid; id and createdAt never change
export function deleteChild(id: string): Promise<void>;   // the profile, every row in CHILD_TABLES, kv keys ending in `:${id}`, and the id in library `seenBy` lists
export function getChild(id: string): Promise<ChildProfile | undefined>;
export function listChildren(): Promise<ChildProfile[]>;  // oldest first
export const COMPANION_SPECIES: readonly ['dragon', 'owl', 'fox', 'robot', 'turtle', 'unicorn']; // the keys of COMPANIONS in @/progression
export const NICKNAME_MAX_LENGTH = 20; export const MAX_INTERESTS = 8; export const INTEREST_MAX_LENGTH = 30;
export function cleanNickname(nickname: unknown): string;     // for form validation; throws Error(message)
export function cleanInterests(interests: unknown): string[];

// usage.ts
export function recordUsage(delta: Partial<Omit<UsageRecord, 'day'>>, now?: number): Promise<void>;
export function getUsageToday(now?: number): Promise<UsageRecord>;
export function getUsageThisMonth(now?: number): Promise<{ requests: number; imageRequests: number; promptTokens: number; completionTokens: number }>;
/** `requests + imageRequests` count against both limits. A limit of 0 means unlimited. */
export function checkBudget(now?: number): Promise<{ allowed: boolean; reason: 'ok' | 'daily-budget' | 'monthly-cap' }>;

// backup.ts
export interface BackupFile { app: 'intelli-learn'; version: 1; exportedAt: number; tables: Record<string, unknown[]>; }
export interface ImportResult { children: number; records: number; libraryItems: number; skipped: number; }
export function exportBackup(opts?: { childId?: string; now?: number }): Promise<BackupFile>;
export function parseBackup(file: unknown): ParsedBackup;                    // validation only; throws Error with a readable message
export function importBackup(file: unknown, mode: 'merge' | 'replace'): Promise<ImportResult>;
export function wipeEverything(): Promise<void>;                             // full reset, including settings, library, usage and kv

// backupFile.ts (browser helpers)
export function downloadBackup(file: BackupFile, filename?: string): void;
export function readBackupFile(file: File): Promise<unknown>;                // JSON.parse only; pass the result to importBackup
export function backupFileName(file: Pick<BackupFile, 'exportedAt'>): string;
```

Live queries (`useLiveQuery`) may only read: Dexie throws `ReadOnlyError` on any
write inside one, in the browser as well as in tests. `getSettings()` is the one
function that is safe there although it can write: inside a live query it
returns unsaved defaults when no record exists yet, and the app shell stores the
record at start-up. Do not call any other writing function (`updateSettings`,
`recordUsage`, `startSession`, ...) from a live query.

Backup rules:

- A backup holds the children, every `CHILD_TABLES` table, the canvas library
  and the settings **with `auth` and `ai.apiKeyCipher` removed**. It never holds
  `kv` (device key, caches) or `usage`. A one-child export holds only that
  child's rows and the library items the child saw.
- `importBackup` validates the whole file with zod before it writes anything,
  and writes in one transaction. Unknown tables or fields, duplicate keys and
  rows that fail their schema reject the file. Challenge and library `content`
  must pass `ChallengeSchema`, so **every row a module writes to `db.challenges`
  or `db.library` must hold content that passes `ChallengeSchema.parse`** (the
  offline bank and the mock AI are tested for this).
- An import never touches the admin password, the AI settings or the API key.
  Parental controls are taken over only in `replace` mode. The library is
  always merged, never cleared: an incoming item whose fingerprint is already
  on the device is not stored twice.
- `replace` removes every child on the device first, also when the file is a
  one-child export.
- Rows whose `childId` is unknown are skipped and counted in `skipped`.
- `kv` convention: a per-child entry has a key that ends in `:${childId}`
  (for example `progression:placement:${childId}`). `deleteChild` and a
  `replace` import remove those entries.

### `@/security`

```ts
export function cryptoAvailable(): boolean;                                  // false on a page that is not a secure context (plain http, not localhost)
export const INSECURE_CONTEXT_MESSAGE: string;                              // what to tell the parent then
export function passwordProblems(password: string): string | null;          // null when acceptable (6 to 128 characters, not blank)
export function setAdminPassword(password: string): Promise<void>;          // PBKDF2-SHA256, random salt, 600_000 iterations. Throws Error(passwordProblems) or Error(INSECURE_CONTEXT_MESSAGE)
export interface VerifyResult { ok: boolean; lockedUntil: number | null; attemptsLeft: number; }
export function verifyAdminPassword(password: string, now?: number): Promise<VerifyResult>; // the right password also cancels a pending reset request and replaces a hash made with fewer iterations
export function changeAdminPassword(current: string, next: string): Promise<boolean>; // false: wrong current password or locked. Throws when `next` is unacceptable
export function hasAdminPassword(): Promise<boolean>;
export function getLockoutState(now?: number): Promise<{ lockedUntil: number | null; attemptsLeft: number }>;
export function encryptSecret(plain: string): Promise<EncryptedBlob>;       // AES-GCM with a non-exportable CryptoKey kept in db.kv
export function decryptSecret(blob: EncryptedBlob): Promise<string>;
export function setApiKey(plain: string | null, address?: string): Promise<void>; // writes settings.ai.apiKeyCipher; null or blank removes it. `address`: the service the key was entered for
export function getApiKey(): Promise<string | null>;                        // never throws; null = no usable key
export function hasApiKey(): Promise<boolean>;                              // true only when the stored key really decrypts on this device
export function getApiKeyFor(address: string): Promise<string | null>;      // the key, but only for the service it was entered for (same scheme, host and port); null for any other address
export function getApiKeyOrigin(): Promise<string | null>;                  // origin of that service; null without a usable key or when it is not known. Read-only
export function keepApiKeyOrigin(): Promise<void>;                          // writes that origin down; call before the saved address changes
export function serviceOrigin(address: string): string | null;              // scheme, host and port of an http(s) address

// recovery.ts: the forgotten-password reset is a request with a wait, never a one-step delete
export const RESET_WAIT_MS: number;                                          // 24 hours
export interface ResetRequest { requestedAt: number; readyAt: number; }
export interface ResetRequestResult { ok: boolean; request: ResetRequest | null; lockedUntil: number | null; }
export function requestReset(now?: number): Promise<ResetRequestResult>;    // starts the wait, or returns the running one (never restarts it). ok: false while the gate is locked after wrong tries
export function getResetRequest(): Promise<ResetRequest | null>;            // read-only: safe inside a live query
export function cancelResetRequest(): Promise<void>;
export function resetIsReady(request: ResetRequest | null, now?: number): boolean;
export function resetAllowed(now?: number): Promise<boolean>;               // the wait is over and the gate is not locked: check it right before deleting

// gate.ts: in-memory only, never persisted
export const useParentGate: UseBoundStore<StoreApi<{
  unlocked: boolean;
  unlock(password: string): Promise<VerifyResult>;   // ok: false while no password exists
  lock(): void;
  touch(): void;            // call on parent-area activity; auto-locks after 5 idle minutes, or after 60 s with the page hidden
}>>;
```

Lockout: every 5th wrong attempt in a row starts a lock: 30 s, 60 s, 2 min,
4 min, 8 min, then 15 min each time. While locked, even the right password is
refused and not counted. A correct password resets the counters, which persist
in `settings.auth`. Only `@/security` reads `settings.auth` and
`settings.ai.apiKeyCipher`; other modules use the functions above.

Forgotten password: a reset needs no password, so it is never one step.
`requestReset` only starts a 24-hour wait (`kv` key `security:reset-request`,
never in a backup). While it runs, the gate and the profile picker show a notice
where a parent will see it, and the right password cancels it. Only when
`resetAllowed()` is true may the gate delete anything. A request cannot be
started, and the reset cannot be carried out, while the gate is locked after
wrong tries.

The API key belongs to the service it was entered for (`kv` key
`security:api-key-origin`; a key saved before this was recorded belongs to the
saved Direct address). `@/ai` only ever asks `getApiKeyFor(address)`, so a newly
typed address, in a connection test or in the settings, never receives the
stored key: the parent has to enter the key of that service.

### `@/core/skills`

```ts
export const SKILLS: SkillDef[];                       // about 40 skills across the 5 strands, PK-8
export function getSkill(id: string): SkillDef | undefined;
export function skillsForStrand(strand: Strand): SkillDef[];
export function skillGrades(skill: SkillDef): Grade[]; // grades where the skill exists, ascending
export function skillExistsAt(skill: SkillDef, grade: Grade): boolean;
/** Expectation text for the stage's grade, or the nearest grade where the skill exists. */
export function expectationAt(skill: SkillDef, stage: StageValue): { grade: Grade; text: string };
/** Clamp a stage into the range of grades where the skill exists. */
export function clampStageToSkill(skill: SkillDef, stage: StageValue): StageValue;
```

### `@/offline`

```ts
/** Always returns a valid Challenge of `plan.interaction`: a curated item when one fits, else a procedurally generated one. Never throws. */
export function pickOfflineChallenge(plan: ChallengePlan, opts?: { avoidTitles?: string[]; seed?: number }): Challenge;
/** One of the built-in five-chapter tales, cut to `chapters` (2..5). The same theme always gives the same story. */
export function pickOfflineStory(theme: string, chapters: number): StoryOutline;
export interface CuratedItem { id: string; skillId: string; strand: Strand; grades: readonly [Grade, Grade]; mode: Mode; challenge: Challenge; }
export const CURATED: readonly CuratedItem[];           // the hand-written bank; `item.challenge` is the playable challenge
export const OFFLINE_BANK_SIZE: number;                 // CURATED.length
/** Like pickOfflineChallenge, but only from content written for `plan.skillId` itself (never the same-strand or other-strand fallback). Null when the bank has nothing for the skill in this kind and grade, or nothing that `accept` lets through. */
export function pickOwnSkillChallenge(plan: ChallengePlan, opts?: { avoidTitles?: string[]; seed?: number; accept?: (c: Challenge) => boolean }): Challenge | null;
```

`pickOfflineChallenge` may borrow from another skill of the strand, or from
another strand, to always return something; that is fine for practice of last
resort and wrong for a concept check. The supply therefore asks
`pickOwnSkillChallenge` first (passing an `accept` that leaves out exact repeats
of what the child has solved, by `fingerprintOf`) and uses the wide search only
for practice. Every skill has own content at every grade in at least one of its
kinds; about one in eight skill x grade x kind combinations has none, and the
supply switches kind there.

Rules the bank's content keeps (tested in `offline.test.ts`): a corner
decoration never shows an emoji the scene itself shows; Pre-K and Kindergarten
add with pictures of counters and totals within 5 (no written sums), and are
never asked to find a group that is defined by "not" (they still sort into it);
picture graphs show one picture per vote in Grades 1 and 2 and get a key only
from Grade 3; the answers of a matching set do not fit each other's questions.

Offline content is already in normalized form: `src/offline/crosscheck.test.ts`
checks that every curated item and every generated challenge (each skill, grade,
interaction kind, mode and five seeds) parses with `ChallengeSchema`, is left
unchanged by `normalizeChallenge`, has no problems in `validateChallengeContent`,
and has an answer key that `checkAnswer` accepts. Pass recent titles in
`avoidTitles`: generated titles look like "Space Count" and would repeat
otherwise. Creative-mode framing exists only where a curated item fits; for
`mission` prefer `number` or `choice`, for `invention` use `build`.

### `@/engine`

```tsx
export type RobotStep = { cmd: 'forward' | 'left' | 'right' } | { cmd: 'repeat'; times: number; body: RobotStep[] };
export type RobotProgram = RobotStep[];
export type Answer = string[] | Record<string, string> | number | RobotProgram;

export interface CheckResult {
  correct: boolean;
  /** Kind feedback for a wrong answer when known (e.g. the chosen option's misconception). */
  misconception: string | null;
  /** 0..1 share of the answer that was right, for partial-credit style feedback ("3 of 5 are in the right place"). */
  progress: number;
}
export function checkAnswer(interaction: Interaction, answer: Answer): CheckResult;

export function runRobot(i: RobotInteraction, program: RobotProgram): { reached: boolean; crashed: boolean; gems: number; steps: { x: number; y: number; dir: string }[]; commandCount: number };
export function solveRobot(i: RobotInteraction): RobotProgram | null;      // shortest plain program or null when unsolvable
export function buildIsSolvable(i: BuildInteraction): boolean;
/** Semantic problems the zod schema cannot express. Empty array = valid. Besides the structural rules it reports answers a child cannot tell apart or get wrong: a tap target that looks exactly like a tappable non-target, two sort items that look the same but go in different bins, and a number tolerance wider than a tenth of the answer (none below 20, a little slack for decimals). */
export function validateChallengeContent(c: Challenge): string[];
/** Safe fix-ups: dedupe ids, mark tap targets tappable, clamp positions, drop unsafe svg. Returns a new object. */
export function normalizeChallenge(c: Challenge): Challenge;
export function sanitizeSvg(svg: string): string | null;                   // null when nothing safe is left

export function SceneCanvas(props: {
  scene: Scene;
  highlightIds?: string[];
  selectedIds?: string[];
  onTapObject?: (id: string) => void;
  reducedMotion?: boolean;
  /** Changing this number fires a celebration burst (confetti, stars). */
  celebrate?: number;
  className?: string;
  ariaLabel?: string;
}): JSX.Element;

/** The scene plus the interaction widget for one challenge. Owns the in-progress answer state. */
export function ChallengeStage(props: {
  challenge: Challenge;
  /** Called when the child presses the big "Check" button with a complete answer. */
  onSubmit: (answer: Answer, result: CheckResult) => void;
  disabled?: boolean;
  highlightIds?: string[];
  reducedMotion?: boolean;
  celebrate?: number;
  /** Bump to clear the current answer (after a wrong try the child's work is kept unless this changes). */
  resetKey?: number;
  /** Every text of the widgets, already localized: pass `useStageLabels()` from `@/i18n`. Anything left out is English. */
  labels?: Partial<StageLabels>;
}): JSX.Element;

/** About 50 texts (check, clear, run, hints, screen-reader names). `{n}`, `{max}`, `{item}`, `{bin}`, `{total}`, `{goal}` are filled by the engine. */
export interface StageLabels { check: string; clear: string; run: string; /* ... see src/engine/widgets/common.tsx */ }
export const DEFAULT_STAGE_LABELS: StageLabels;         // the English defaults
export const SAMPLE_CHALLENGES: Record<InteractionKind, Challenge>;   // development and tests
export function EngineGallery(): JSX.Element;           // development only
```

Rules for users of the engine:

- **Normalize, then validate, then store the normalized challenge.**
  `normalizeChallenge` repairs duplicate ids, untypeable number answers, unsafe
  SVG and stray robot walls; `validateChallengeContent` then reports only real
  problems. Normalizing never turns decoration into tap choices when the scene
  already has a tappable distractor.
- `SceneCanvas` sanitizes every SVG object again when it draws, including
  content read back from the database or a backup.
- A Content-Security-Policy must include `img-src 'self' data: blob:` (sanitized
  SVG is drawn from `blob:` URLs). `docker/nginx.conf` does.
- While a number challenge is mounted and not disabled, digits typed anywhere
  outside an input fill the answer. Pass `disabled` to `ChallengeStage` whenever
  something is on top of it (helper chat, teach-back, break screen, a modal).
- From 1024 px in landscape the picture and the answer widget sit side by side,
  and the picture stays in view (sticky) while a long answer column scrolls.
- **Check stays in reach.** The Check button sits in a sticky bar
  (`[data-check-bar]`) at the bottom of the scrolling page. The bar keeps
  `var(--stage-check-inset)` free at its right end; whoever puts something next
  to Check (the play screen, for Pip) sets that variable on an ancestor.
- **A swipe on a card scrolls the page.** Under a finger, sort items and the
  left match cards are picked up after a short hold (`TOUCH_HOLD_MS`, 140 ms)
  or by a sideways move; a swipe up or down that starts on a card scrolls.
  Order cards are dragged by their grip (`[data-order-grip]`) under a finger
  and anywhere with a mouse. The arrow buttons and the keyboard work as before.
- A word that is wider than its card breaks inside the card (choice options,
  build parts, match cards); with a word of 11 letters or more the choice and
  build grids use one column on a phone.
- `runRobot().steps[0]` is the start pose. Repeat `times` is clamped to 2..5.
  `checkAnswer` treats identical-looking order items and right-hand match cards
  as interchangeable.

### `@/ai`

```ts
export interface ChildContext { ageGroup: AgeGroup; grade: Grade; interests: string[]; locale: Locale; strictness: 'strict' | 'standard'; }
export interface GenerateChallengeRequest {
  plan: ChallengePlan;
  child: ChildContext;
  /** Grade expectation text from the skill map for plan.stage. */
  expectation: { grade: Grade; text: string };
  skillName: string;
  avoidTitles?: string[];           // recent titles, to avoid repeats
  avoidNotes?: string[];            // parent thumbs-down notes
  learnerSummary?: string;
  studioIdea?: string;              // Imagination Studio: what the child asked to see
  story?: { title: string; heading: string; narrative: string; illustration: string };
  previousSibling?: { question: string };   // generate an easier sibling of this item
  /** plan.purpose === 'check': recent questions on this skill; the new item must test the same concept in a NEW way. */
  conceptCheck?: { previousQuestions: string[] };
  signal?: AbortSignal;
}
/** Never throws. Falls back to `pickOfflineChallenge` when the provider is 'demo', the budget is spent, or generation fails. */
export function generateChallenge(req: GenerateChallengeRequest): Promise<{ content: Challenge; source: ChallengeSource }>;

export interface TutorRequest {
  child: ChildContext;
  challenge: Challenge;
  /** What the child wants. 'chat' needs childText. */
  intent: 'nudge' | 'hint' | 'walkthrough-step' | 'wrong-answer' | 'chat' | 'praise' | 'teachback-feedback';
  hintLevel: 0 | 1 | 2 | 3;
  walkthroughStep?: number;
  wrongAnswerSummary?: string;
  misconception?: string | null;
  childText?: string;
  openChat: boolean;
  history?: { role: 'child' | 'bot'; text: string }[];
  signal?: AbortSignal;
}
/** Never throws. Without AI it answers from the challenge's own hints, walkthrough and explanation. */
export function tutorReply(req: TutorRequest): Promise<TutorReply>;

/**
 * Re-themes a library item for another child: same concept, grade and interaction kind, new theme,
 * new numbers and details, new scene. Returns null when the AI is unavailable or the result fails
 * validation or safety (the caller then serves the original as-is).
 */
export function remixChallenge(req: { original: Challenge; plan: ChallengePlan; child: ChildContext; expectation: { grade: Grade; text: string }; skillName: string; signal?: AbortSignal }): Promise<Challenge | null>;

export function generateStoryOutline(req: { child: ChildContext; theme: string; chapters: number; signal?: AbortSignal }): Promise<StoryOutline>; // never throws; offline fallback story
export function generateLearnerNotes(req: { child: ChildContext; attempts: { skill: string; grade: Grade; outcome: AttemptOutcome; question: string; misconceptions: string[] }[] }): Promise<LearnerNotesOutput | null>;
export function generateWeeklyReport(req: { child: ChildContext; stats: WeeklyReport['stats']; strandStages: { strand: Strand; label: string }[]; learnerSummary: string; }): Promise<WeeklyReportOutput>; // never throws; template fallback
export function generateImage(prompt: string, signal?: AbortSignal): Promise<string | null>;   // data URL, or null when unavailable
export function localSafetyCheck(text: string, strictness?: 'strict' | 'standard'): SafetyVerdict;       // synchronous blocklist
export function checkChallengeSafety(c: Challenge, strictness: 'strict' | 'standard'): Promise<SafetyVerdict>; // blocklist + moderation endpoint when available
export function localChallengeSafety(c: Challenge, strictness: 'strict' | 'standard'): SafetyVerdict;    // the blocklist over every text of a challenge, on the device and at once; never throws
export function getAiStatus(): Promise<{ provider: AiProvider; ready: boolean; reason: string }>;
export function testConnection(override?: Partial<{ provider: AiProvider; baseUrl: string; apiKey: string; chatModel: string }>): Promise<{ ok: boolean; message: string; latencyMs: number }>;
export function ageStyleCard(age: AgeGroup): string;
/** True for an address on this computer or the home network (localhost, 127.x, 10.x, 192.168.x, `*.local`): no API key is needed there. */
export function isLocalAddress(baseUrl: string): boolean;
/** Forgets what was learned about the endpoint in this session, and empties the log of AI results. Call it after the parent saves changed AI settings. */
export function resetAiSession(): void;
/** What became of the latest AI requests (`kv` key `ai:recent`, oldest first). Read-only, safe inside a live query; never throws. */
export function recentAiResults(): Promise<AiLogEntry[]>;
export interface AiLogEntry { at: number; task: AiTask; kind?: InteractionKind; model: string; outcome: AiOutcome; message: string; ms: number; }
/** For the parent area: today's builds and how many the AI delivered, the most common problem, failures in a row, a running pause. */
export function summarizeAiResults(entries: readonly AiLogEntry[], now: number): AiResultsSummary;
export type AiErrorKind = 'no-config' | 'budget' | 'network' | 'auth' | 'rate-limit' | 'bad-response' | 'refused' | 'aborted';
export class AiError extends Error { readonly kind: AiErrorKind; readonly status: number | null; readonly detail: string; readonly timedOut: boolean; readonly code: string; }
```

Details the callers rely on:

- `TutorRequest.walkthroughStep` is a zero-based index into `challenge.walkthrough`.
  For `teachback-feedback`, pass the chosen option's id or label as `childText`.
- `tutorReply` already applies `localSafetyCheck` and an answer-leak check, and
  `highlightIds` only name existing scene objects (never tap targets before the
  challenge is solved). `praise` is always answered on the device. `chat` never
  gives more help than the hint level the child already reached. A `chat` reply
  is free conversation, so it also goes through the moderation endpoint when
  there is one; a flagged reply is replaced by the on-device line. The answer
  key is only put into the prompt for the intents that need it (not for a
  nudge, a hint or chat). The blocklist also refuses replies that ask the child
  for personal information (name, address, school, age, family, photos, other
  apps).
- `generateChallenge` runs schema -> `normalizeChallenge` -> kind check ->
  `validateChallengeContent` -> `checkChallengeSafety`, with one feedback round,
  and costs at most 5 chat requests before the offline fallback (one more the
  first time a thinking model returns an empty, cut-off reply: that request is
  repeated once with more room, at most twice per model in a session).
- **Log of AI results.** Every challenge build and remix (also the successful
  ones) and every failed tutor, story, notes or report request adds one entry
  to `ai:recent`: task, interaction kind, model, outcome, and a message this
  app wrote (an error text, or what the validators found). Nothing a child
  typed or said is stored, the log never goes into a backup, and at most 30
  builds and 15 other failures are kept. A build that the validators or the
  safety check rejected also counts one `failures` in `usage`.
- **Pause.** After three failed builds in a row `generateChallenge` and
  `remixChallenge` send nothing for 10 minutes (offline fallback, `null`); one
  build is tried when the pause ends, each further failure doubles it up to an
  hour, and a success ends it. Being offline is not a failure and never counts.
  `getAiStatus().reason` and the parent area say so.
- A retry after a safety rejection is sent as one user message (the request
  again plus the reason), never as two user messages in a row and without an
  echo of the rejected text.
- An endpoint on this computer or the home network gets the compact prompt
  (fewer scene objects, no svg objects), because a small model has a small
  context window.
- `remixChallenge` keeps `original.interaction.kind` and returns null when the
  result has the same title or question as the original.
- `generateImage` only reads the global `settings.controls.aiImages`. A caller
  with a child must check `effectiveControls(settings, child).aiImages` first.
  It asks for `b64_json` and returns null for a remote image URL.
- `generateLearnerNotes` and `generateWeeklyReport` write in the parent's
  interface language (`settings.locale`).
- `testConnection` returns `ok: true` with a "nothing to test" message in demo
  mode, skips the budget check, and in direct mode accepts a local address
  (localhost, 10.x, 192.168.x, `*.local`) without an API key. The stored key is
  used only for the service it was entered for (`getApiKeyFor`): for any other
  address the parent has to type a key, and without one a service on the
  internet is not contacted at all.
- The text check of a challenge reads an svg drawing twice: every tag as a word
  break, and each `<text>` element in one piece the way it is drawn (tspans,
  character references and CDATA joined), so a word cannot be split to pass.
- Every prompt carries the marker lines of `docs/AI_PROMPT_MARKERS.md` in the
  **system** message; text from a child or parent can never form a marker line.
- Proxy mode: errors of the app's own proxy are recognised by `error.type`
  (`proxy_unavailable`, `proxy_not_configured`, `upstream_auth_error`,
  `upstream_error`, `upstream_timeout`, `rate_limit_exceeded`, `forbidden`) and
  `testConnection` turns each into advice that names the server setting to fix.

The AI client sends `POST {baseUrl}/chat/completions` with
`response_format: { type: 'json_object' }`, falls back to no `response_format`
when the endpoint rejects it, extracts the JSON object of the reply (the whole
reply when it is one object, else the largest complete top-level object, never
a piece from inside an object that is broken or cut off), validates with zod,
and retries up to two times with the validation errors fed back. In `proxy`
mode it sends no Authorization header. Every request is refused when
`checkBudget` says no and counted with `recordUsage` when it was sent: one that
never left the device (no connection, the server not reachable) is not counted,
and when the device is offline nothing is sent to a service on the internet.

- **Cut-off replies.** `finish_reason: "length"` is read. An empty reply of a
  thinking model gets more room for the next request (4,000, then 12,000 tokens
  on top), a cut-off JSON reply is asked for again with up to three times the
  limit (the same conversation; no "your JSON was invalid" round), and what is
  learned holds for the model until `resetAiSession()`. A reply that is still
  cut off fails with `AiError.code === 'output_truncated'`.
- **Time to wait.** 45 s for a service on the internet, 90 s through the proxy
  and for thinking models, 180 s for a local address in direct mode (a local
  model may have to load first). A caller can cap the factor
  (`maxTimeoutScale`; the tutor uses 2).

### `@/progression`

```ts
export function effectiveControls(settings: Settings, child: ChildProfile): ParentalControls;
/** The strands the child may play, in the fixed strand order. The planner and the child's map both use it. */
export function enabledStrands(controls: Pick<ParentalControls, 'strands'>): Strand[];
export function planNext(childId: string, count?: number, opts?: { mode?: Mode; strand?: Strand; now?: number; withoutChecks?: readonly string[] }): Promise<ChallengePlan[]>; // withoutChecks: skill ids that cannot get a concept check right now (nothing new to ask); they are practised instead
export interface RecordAttemptInput {
  challenge: ChallengeRecord;
  answers: AnswerEvent[];           // ends with the correct one
  hintsUsed: 0 | 1 | 2;
  walkthroughUsed: boolean;
  teachBackCorrect: boolean | null;
  timeMs: number;
  now?: number;
}
/** Writes the attempt, updates skill state, stage history, rewards, streak, companion, and marks the challenge completed. */
export function recordAttempt(input: RecordAttemptInput): Promise<RecordedAttempt>;
export interface RecordedAttempt extends AttemptResult { alreadyRecorded?: boolean; } // true: this challenge was recorded before (another tab); the caller must not count it again
// Concept checks: see "Concept checks (back testing)". planNext emits purpose 'check' for skills with checkPending
// (these take priority over everything except placement), and recordAttempt applies the check rules.
export function outcomeOf(input: Pick<RecordAttemptInput, 'answers' | 'hintsUsed' | 'walkthroughUsed'>): AttemptOutcome;
export function wrongTries(answers: readonly AnswerEvent[]): number;
export function answerSpace(content: Pick<Challenge, 'interaction' | 'scene'>): number;   // how many different answers the question allows
export function creditedOutcome(outcome: AttemptOutcome, wrong: number, answers: number): AttemptOutcome; // see "Outcomes and mastery"
export function kindsFor(skill: SkillDef, mode: Mode, ageGroup: AgeGroup): InteractionKind[]; // the interaction kinds a skill offers in a mode for that age group, best first
export function getStrandStages(childId: string): Promise<StrandStage[]>;
export function getPlayAllowance(childId: string, now?: number): Promise<PlayAllowance>;
export function startSession(childId: string, now?: number): Promise<SessionRecord>;
export function tickSession(sessionId: string, activeMsDelta: number, now?: number): Promise<boolean>; // false: nothing was counted (the session is ended and the child has no other open one); start a new session then
export function endSession(sessionId: string, now?: number): Promise<void>;
export function placementStatus(childId: string): Promise<{ done: boolean; answered: number; total: number }>;
export function detectFrustration(recent: { at: number; correct: boolean }[], now?: number): boolean;
export function weekStats(childId: string, weekStart: string): Promise<WeeklyReport['stats']>;

export interface BadgeDef { key: string; name: string; emoji: string; description: string; }
export interface CollectibleDef { key: string; name: string; emoji: string; cost: number; theme: string; }
export interface CompanionDef { species: string; name: string; stages: [string, string, string, string, string]; /* emoji per growth 0..4 */ }
export const BADGES: BadgeDef[];
export const COLLECTIBLES: CollectibleDef[];
export const COMPANIONS: CompanionDef[];
export function buyCollectible(childId: string, key: string): Promise<{ ok: boolean; reason: 'ok' | 'not-enough-stars' | 'owned' | 'unknown' }>;
export function companionEmoji(companion: Companion): string;

// Also exported
export const TUNING: { mastery; review; stars; companion; streak; badges; placement; plan; limits; frustration }; // every number of the rules, documented in tuning.ts
export function makeSiblingPlan(previous: ChallengeRecord): ChallengePlan;      // the easier follow-up after a walkthrough
export function weekStartOf(now?: number): string;                              // YYYY-MM-DD of the local Monday
export function companionProgress(companion: Companion): { growth: number; xp: number; nextGrowthAt: number | null; progress: number };
export function getBadge(key: string): BadgeDef | undefined;
export function getCollectible(key: string): CollectibleDef | undefined;
export function getCompanionDef(species: string): CompanionDef | undefined;
export function setRng(rng: (() => number) | null): void;                       // tests; planNext also takes opts.rng
export function seededRng(seed: number): () => number;
export const FALLBACK_THEMES: readonly string[];
```

Data conventions of the progression module:

- `recordAttempt` is one transaction and is idempotent per challenge. It also
  increments `itemsCompleted` on the child's latest open session.
- Rewards written by `recordAttempt` (all with `at === attempt.completedAt`):
  `star` (key `''`, amount = stars), `badge` (key = badge key, once per child),
  `companion` (key = species, when growth increases), `streak` (key = days, at
  3, 7, 14, 30). `buyCollectible` writes `collectible` with `amount = -cost`.
  `child.stars` always equals the sum of the child's reward amounts.
- Reward reasons and catalogue names are stored in English. A screen that wants
  them translated keys its strings by `kind` + `key` and falls back to the stored text.
- `Companion.name` is `''` until the child names it: show
  `getCompanionDef(species)?.name` then.
- Strand-level `StageChange` rows (`skillId: null`) form one chain per strand.
  `getStrandStages` is the live value and may differ from the last row by one step.
- During placement no `SkillState` is stored until the 8th item. Each placement
  plan is pitched at the estimate at planning time. An estimate moves at most
  `TUNING.placement.maxMove` steps (two grades) from where it started, however
  many items its strand gets (with one subject enabled all eight land on it).
  An item that had to be asked more than `maxItemGap` steps away from the
  estimate, because its skill does not reach that grade, cannot move the
  estimate further away from itself: solving a Grade 2 item says nothing about
  Grade 5. The planner prefers skills that exist at the estimate's grade, and
  asks one of them again before it asks a skill that does not fit.
- The strand level (`getStrandStages`) is the attempt-weighted mean of the
  skill stages. A skill the child has finished (it sits at its own top stage,
  below the strand's highest skill) cannot pull the level down: it counts at the
  level of the others. Such an outgrown skill is also not practised again; only
  its due spaced reviews remain.
- At most one item in `TUNING.review.atMostOneIn` (5) is a review, counting due
  reviews and "practise an old skill" reviews together.
- `kv` keys: `progression:placement:${childId}`, `progression:counters:${childId}`.

### `@/voice`

```ts
export function voiceSupport(): { tts: boolean; stt: boolean };
export function speak(text: string, opts?: { rate?: number; locale?: Locale; onStart?: () => void; onEnd?: () => void }): Promise<void>; // resolves when done or stopped; never rejects
export function stopSpeaking(): void;
export function listenOnce(opts?: { locale?: Locale; timeoutMs?: number }): Promise<string>; // rejects with Error('unsupported' | 'denied' | 'no-speech')
export function useSpeaking(): boolean;   // true while speech is playing

// Also exported
export function stopListening(): void;    // hold-to-talk release: settle with what was heard so far
export function cancelListening(): void;  // leave the screen: release the microphone now
export function useListening(): boolean;
export function setVoiceDriver(driver: VoiceDriver | null): void;   // tests, or createWebSpeechDriver({ localVoicesOnly: true })
export function createWebSpeechDriver(options?: { localVoicesOnly?: boolean }): VoiceDriver;
export function cleanForSpeech(text: string): string;
```

`speak` only strips emoji and markdown: AI text must have passed
`localSafetyCheck` before it is spoken. The default language of `speak` and
`listenOnce` is `<html lang>`, which `setLocale` maintains. Browser speech
recognition may send audio to the browser maker (Chrome does); say so next to
the microphone setting. jsdom has no speech: tests of other modules mock `@/voice`.

### `@/i18n`

```ts
export function t(key: string, vars?: Record<string, string | number>): string;   // falls back to English, then to the key
export function useT(): typeof t;                 // re-renders on locale change
export function setLocale(locale: Locale): void;
export function getLocale(): Locale;
export const LOCALE_NAMES: Record<Locale, string>;

// Also exported
export function registerStrings(bundle: Partial<Record<Locale, Record<string, string>>>): void; // call at module import time
export function tn(keyOne: string, keyOther: string, count: number, vars?: Record<string, string | number>): string; // plural-aware, fills {count}
export function useLocale(): Locale;
export function gradeName(grade: Grade): string;        export function gradeShortName(grade: Grade): string;
export function stepName(step: StageStep): string;      export function stepBlurb(step: StageStep): string;
export function stageName(stage: StageValue): string;   // "Grade 3, Strong", translated
export function strandName(strand: Strand): string;     export function ageGroupName(age: AgeGroup): string;
export function modeName(mode: Mode): string;           export function modeBlurb(mode: Mode): string;
export function starCountText(count: number): string;
/** The engine's texts in the active language, in the shape of ChallengeStage's `labels` prop. */
export function stageLabels(): Record<StageLabelKey, string>;
export function useStageLabels(): Record<StageLabelKey, string>;
```

Every module registers its own strings with `registerStrings({ en, es, hi })`
at import time under a module prefix (`play.`, `parent.`, ...) and reads them
with `useT()` in components. Where a user sees a grade, step, stage, strand or
mode, use the name helpers above, not `gradeLabel`/`stageLabel` from core, which
are English only. The common bundle has `common.*` (ok, cancel, save, back,
next, done, close, loading, tryAgain, ...), `grade.*`, `step.*`, `strand.*`,
`age.*`, `mode.*` and `engine.*`.

### `@/ui`

Shared, touch-friendly components: `Button`, `BigButton`, `IconButton`, `Card`,
`Modal`, `Field`, `TextInput`, `Select`, `Toggle`, `Chip`, `ProgressBar`,
`StarCount`, `Spinner`, `PageShell`, `EmptyState`, `Toast` + `useToast`,
`ConfirmDialog`, and `applyAccessibility(settings | null)` which sets classes
on `<html>` (`a11y-dyslexia`, `a11y-large`, `a11y-contrast`, `a11y-calm`).
Theme tokens live in `src/index.css`.

Also exported: `ChildShell` (child-area page frame; tones `day`, `meadow`,
`sunset`, `space`), `PasswordInput`, `NumberInput`, `TextArea`, `Tabs` +
`TabPanel`, `Badge`, `Stat`, `Meter`, `StageBadge` and `StageSteps` (the four
steps of a school grade with mastery fill: use them wherever a learning stage is
shown, so it looks the same for child and parent), `ToastViewport`, `showToast`,
`dismissToast`, `useReducedMotion`, `prefersReducedMotion`, `cx`.

- `Toast` is one toast. The live region is `ToastViewport`, mounted once by the
  app shell; no provider is needed.
- Pass `useReducedMotion()` as the `reducedMotion` prop of `ChallengeStage` and
  `SceneCanvas`.
- Text colours that pass WCAG AA (tested in `src/ui/contrast.test.ts`): on white
  and light tints use `ink-900/700/500`, `brand-700` or the `700` shade of
  sun/leaf/coral/sky. `leaf-600` and `coral-600` are not readable as text on white.
- `NumberInput` reports out-of-range values while typing and clamps on blur.
  Two tab sets on one page need different `idBase` values.

### `@/library`

```ts
export function fingerprintOf(content: Challenge): string;
export interface SaveToLibraryInput { content: Challenge; plan: ChallengePlan; ageGroup: AgeGroup; locale: Locale; origin: 'ai' | 'remix'; remixOf?: string | null; }
/** Saves a validated AI-built challenge. Returns the existing item when the fingerprint is already stored. Throws when `content` fails `ChallengeSchema`. */
export function saveToLibrary(input: SaveToLibraryInput, now?: number): Promise<LibraryItem>;
/** Best unseen, non-retired item for the plan and child, or null. Order: rating 5, 4, unrated, 3; then fewer uses; then newest. `opts.accept` leaves out items the caller cannot use (the supply passes the content rules of the child who gets the item). */
export function findReusable(plan: ChallengePlan, child: { id: string; ageGroup: AgeGroup; interests: string[] }, locale: Locale, opts?: { accept?: (item: LibraryItem) => boolean }): Promise<{ item: LibraryItem; themeFits: boolean } | null>;
export function markServed(libraryId: string, childId: string, now?: number): Promise<void>;   // uses + 1, lastUsedAt, and the child in `seenBy`
export function markSeen(libraryId: string, childId: string): Promise<void>;                    // `seenBy` only (the child got a remix of the item)
export function recordLibraryOutcome(libraryId: string, outcome: AttemptOutcome): Promise<void>;
/** Sets the rating (1-5 or null) and note, retires on 1-2, and mirrors the rating to challenges that point at the item. */
export function rateLibraryItem(libraryId: string, rating: number | null, note?: string): Promise<LibraryItem>;
export function setRetired(libraryId: string, retired: boolean): Promise<void>;
/** Notes from low-rated items for this skill, passed to the AI as things to avoid (at most AVOID_NOTES_LIMIT, each cut to AVOID_NOTE_MAX). */
export function avoidNotesFor(skillId: string): Promise<string[]>;
export interface LibraryStats { total: number; rated: number; retired: number; reusedServes: number; }   // reusedServes: every use of an item after its first
export function libraryStats(): Promise<LibraryStats>;
export interface LibraryFilter { strand?: Strand; grade?: Grade; interaction?: InteractionKind; mode?: Mode; rating?: 'unrated' | 'low' | 'high' | number; retired?: boolean; search?: string; }
export function listLibrary(filter?: LibraryFilter): Promise<LibraryItem[]>;    // the parent area's list, newest first
export function deleteLibraryItem(id: string): Promise<void>;                   // challenges served from it stay in the history, with `libraryId` cleared
export const LIBRARY_NOTE_MAX = 500; export const AVOID_NOTES_LIMIT = 5; export const AVOID_NOTE_MAX = 200;
```

- A plan in a creative mode only reuses items of that mode. A plain quest reuses
  any mode except the context-bound ones (`story`, `studio`, `mission`): a story
  chapter or a studio idea makes no sense out of its context, and a mission must
  never reach a child whose parent switched missions off.
- `themeFits` is false when the item's theme is neither the plan's theme nor one
  of the child's interests; the supply queue then remixes the item when it can.
- All of these write, except `findReusable`, `avoidNotesFor`, `libraryStats` and
  `listLibrary`, which are safe inside a live query.

### `@/play`

```ts
// supply.ts: keeps 3-5 validated challenges queued per child
export const SUPPLY: { queueMin: 3; queueTarget: 5; queueMax: 10; recentTitles: 15; libraryWindow: 10; libraryShare: 0.5; keepAsIsRating: 4; /* ... see supply.ts */ };
export function ensureQueue(childId: string, opts?: { min?: number; target?: number }): Promise<void>;   // background safe, deduplicated per child, never rejects
/** The child's active (unfinished) challenge if there is one, whatever was asked for; else the next queued one that fits the request (built on the spot when the queue is empty). Marks it `active`. */
export function takeNext(childId: string, opts?: TakeOptions): Promise<ChallengeRecord>;
export interface TakeOptions { mode?: Mode; strand?: Strand; idea?: string; pick?: string; }   // from the address of the play screen, which anyone can type
/** The easier sibling after a walkthrough, as a `queued` record that `takeNext` serves next. One per challenge: a second call returns the same record. */
export function makeSibling(previous: ChallengeRecord): Promise<ChallengeRecord>;
/** Builds the concept check of a skill ahead of time. Does nothing unless the skill has `checkPending` and no check is waiting. Never rejects. */
export function prepareConceptCheck(childId: string, skillId: string): Promise<void>;
export function startStory(childId: string, theme?: string): Promise<StoryRecord>;       // 3 chapters for ages 3-8, 4 for older children
export function advanceStory(storyId: string): Promise<StoryRecord | undefined>;         // brings `currentChapter` and `finished` in step with what was solved
export function buildContext(child: ChildProfile, settings: Settings): ChildContext;     // what the AI may know about a child: never the nickname, avatar or id
export function supplyIdle(): Promise<void>;      // resolves when no supply work is running (tests, and before wiping the database)
export interface SupplyDeps { now: () => number; rng: (() => number) | null; onDemandWaitMs: number; madeToOrderWaitMs: number; }
export function setSupplyDeps(next: Partial<SupplyDeps> | null): void;                  // tests
export function resetSupply(): void;                                                     // tests

// session.ts: the one store of the play screen, read and driven by the helper bot
export const usePlaySession: UseBoundStore<StoreApi<PlaySessionState>>;                  // PlaySessionData & PlaySessionActions, see session.ts
export type { BotMessage, BotOffer, PlayDeps, PlaySessionActions, PlaySessionData, PlaySessionState, StoryView, TeachBackView };
export function playHomePath(childId: string): string;
export function recordSettled(): Promise<void>;   // resolves when the attempt of the current challenge is stored
export function setPlayDeps(next: Partial<PlayDeps> | null): void;                      // tests: clock, randomness, the wait for a hint
export function resetPlaySession(): void;                                                // tests

// machine.ts: the pure rules
export const PLAY: { offerAfterWrongTries: 2; walkthroughAfterWrongTries: 3; idleOfferMs: 45_000; teachBackChance: number; /* ... see machine.ts */ };
export type PlayPhase = 'idle' | 'loading' | 'story' | 'presenting' | 'answering' | 'solved' | 'teachback' | 'recorded';
export type HintLevel = 0 | 1 | 2 | 3;
export type Frame = 'check' | 'placement' | 'story' | 'plain';
export interface PlayRequest { mode?: Mode; strand?: Strand; idea?: string; pick?: string; }
export function parseRequest(params: { get(name: string): string | null }): PlayRequest; // unknown values are dropped; `idea` and `pick` (three chip ids, "dragon.baking.moon") only with mode=studio
export function frameOf(record: Pick<ChallengeRecord, 'purpose' | 'storyId'>): Frame;
export function canWalkthrough(run: Pick<Run, 'answers' | 'hintsUsed' | 'walkthroughUsed'>): boolean;   // after the strong hint or three wrong tries
export type { Run, RewardSummary };

export const PLAY_STRINGS: StringBundle;
export function PlayScreen(): JSX.Element;        // mounted at /kids/:childId/play; mounts <HelperBot /> itself
```

How the play module works, for the modules around it:

- **Request.** `mode=quest` and no `mode` mean the same: the planner chooses.
  `mode=story` continues the child's unfinished story or starts one;
  `mode=studio&pick=...` (the studio's chips) or `mode=studio&idea=...` (typed
  text, only while open chat is on) builds one challenge around the idea and
  then goes on as a plain adventure (the store bumps `urlReset`, the screen
  drops the query).
  Only the AI can draw an idea: when the canvas comes from the built-in bank
  (Demo mode, a spent budget, a slow or failed request) Pip says so
  (`play.studio.readyMade`). An idea that is asked for while an older canvas is
  unfinished is kept like any other request: the old canvas comes back with
  "Let us finish this one first", and the idea is drawn afterwards.
- **Supply order.** For every plan: a fitting library item as it is (`source:
  'reused'`), or a remix of it when its theme does not fit and the AI is ready
  (`'remix'`), else `generateChallenge` (`'ai'`, saved to the library), else the
  offline bank (`'offline'`, not saved). Fewer than half of a child's last ten
  challenges come from the library. A child who is waiting on the loading
  screen waits for the AI at most `SUPPLY.onDemandWaitMs` (8 s; 20 s for a
  studio idea or a story chapter, which cannot be reused): after that the
  offline bank answers, an ordinary AI challenge that arrives late is saved to
  the library and put in the queue, and a late remix or made-to-order build is
  aborted. Top-ups in the background are not limited. A queued challenge is thrown away when it
  went stale (the skill moved on, the strand or mode was switched off, the
  placement ended). Queued challenges are *not* thrown away when the parent
  connects or disconnects an AI: the next top-up uses the new setting.
- **Run.** Every submitted answer is an `AnswerEvent`. The run of an unfinished
  challenge (answers, hints, walkthrough step) is kept in `kv` and restored when
  the child comes back. The run is kept until the attempt is recorded: a
  challenge that was solved but not yet recorded (the solved sheet or the
  teach-back was open when the page went away) comes back as solved, after its
  stored right answer was checked again with `checkAnswer`, and is never asked
  a second time. `recordAttempt` is called exactly once, after the
  teach-back when there is one; `recordLibraryOutcome` follows for library items.
  The same wrong answer again within `PLAY.doubleSubmitMs` (0.8 s) is a double
  tap on Check and counts as one try.
- **Help ladder.** Hint 1, hint 2, then the walkthrough (`canWalkthrough`). Help
  is offered, never forced, after two wrong tries or 45 s without interaction.
  After a wrong answer the on-device line appears within `PLAY.feedbackWaitMs`;
  the tutor's own line is not thrown away when it is slower: it is added when
  it arrives within `PLAY.lateFeedbackMs` and the child is still on the same
  try. With a known misconception no request is sent at all.
  A hint or a walkthrough step waits for the tutor's own wording at most
  `PLAY.helpWaitMs` (4 s), with "Pip is thinking..." in the bubble from the
  first moment; then the request is aborted and the hint or step of the
  challenge itself is shown.
  After a walkthrough the next challenge is the sibling from `makeSibling`
  (not during placement). There is no skip action in the store at all.
- **Concept check.** When `AttemptResult` reports `checkPending` for the skill,
  the store calls `prepareConceptCheck`, and `takeNext` serves the check next.
- **What the address may ask for.** The request comes from the URL, which a
  child can type, so `takeNext` enforces the rules itself: a mode is ignored
  until the placement is done; a switched-off subject and switched-off missions
  are ordinary play; free text (`idea`) reaches the AI only while open chat is
  on, otherwise the studio's picture idea (`pick`) is turned into a sentence
  from the studio's own fixed phrases. An unfinished challenge comes back first
  whatever is asked for; the store keeps the request (also a studio idea) and
  asks again once it is finished.
- **Content rules of the child who plays.** A queued challenge, an unfinished
  one and a library item were approved under the rules of the moment they were
  made, possibly for a sibling. Before one is served it is checked again with
  `localChallengeSafety` under this child's strictness, and its subject and
  real-world missions must still be switched on; otherwise it is discarded
  (an unfinished one together with its saved run).
- **Limits.** The store wraps play in `startSession` / `tickSession` /
  `endSession`, counts only active time (when `tickSession` answers false,
  because another tab ended the session, it starts a new one, so play time is
  never lost), and reads `getPlayAllowance` after
  every recorded challenge: when play time is used up, "Next adventure" becomes
  "Time for a rest" and leads to `/kids/:childId/rest`. A challenge in progress
  is never interrupted. Four wrong answers within 15 seconds open a breathing
  break (`detectFrustration`).
- **`kv` keys:** `play:run:${challengeId}:${childId}` (the run in progress),
  `play:story:${storyId}:${childId}` (the picture of a story chapter),
  `bot-muted:${childId}`.
- **DOM hooks:** `[data-bot-dock]` (the column of the question card: Pip's home
  spot is its top right corner), `[data-bot-seat]` (the room the question card
  keeps free for Pip), `[data-bot-keepout]` (the top bar: Pip cannot
  be dragged over it), `[data-star-source]` / `[data-star-target]` (where reward
  stars fly from and to). The play screen sets `--stage-check-inset` on the
  dock from the store's `botInset` (`setBotInset`), which the helper sets
  while Pip rests next to Check.
- **Sheets.** The solved sheet, the teach-back, the rewards, the walkthrough
  and the break are bottom sheets (`.play-sheet`). When a sheet's content is
  taller than the sheet, a round "more below" button (`[data-sheet-more]`)
  scrolls it on. On a short screen (a phone in landscape, below 30rem high)
  the sheet uses the whole height below the top bar and puts its buttons
  beside the text. While the break sheet opens, Pip's line is put away.
- **Test hooks:** `data-testid="play-screen"` carries `data-phase`; also
  `prompt-card` (`data-frame`), `question`, `check-button`, `star-counter`,
  `placement-dots`, `solved-sheet`, `teachback`, `rewards`, `next-button`,
  `walkthrough-sheet`, `break-sheet`, `story-card`, `bot-bubble`, `bot-panel`,
  `helper-bot`. The engine marks the stage with `data-interaction="<kind>"`.

### `@/bot`

```tsx
/** Floating, draggable helper. Reads the current challenge from `usePlaySession` and calls its actions. Renders nothing while no challenge is on screen. */
export function HelperBot(props: { childId: string }): JSX.Element | null;

// The mascot (src/bot/pip), usable on any screen
export const PIP_STATES: readonly ['idle', 'listening', 'thinking', 'talking', 'singing', 'happy', 'giggle', 'sad', 'angry', 'tired', 'sleeping', 'waiting', 'jump_scared', 'curious', 'proud', 'shy', 'teaching', 'reading', 'storytelling', 'celebrating'];
export type PipState = (typeof PIP_STATES)[number];
export function isPipState(value: unknown): value is PipState;
export type PipLookAt = { x: number; y: number } | 'pointer' | null;
export interface PipProps { state?: PipState; size?: number | string; talking?: boolean; mouthLevel?: number; lookAt?: PipLookAt; reducedMotion?: boolean; onTap?: () => void; className?: string; ariaLabel?: string; }
export function Pip(props: PipProps): JSX.Element;
/** A base mood plus short reactions on top: `[state, react, calm]`. */
export function usePipMood(base: PipState, opts?: PipMoodOptions): [PipState, PipReact, () => void];
export type PipReact = (state: PipState, ms?: number) => void;
export function PipGallery(): JSX.Element;        // development only; not routed

export const BOT: { sizeSmall: 72; sizeLarge: 92; bubbleWidth: 304; panelWidth: 400; sheetBelow: 640; /* ... see geometry.ts */ };
export function botSize(viewport: { width: number; height: number }): number;
export function pipStateFor(input: { /* the session's flags */ }): PipState;
export function positionKey(childId: string): string;      // `bot-position:${childId}` in kv
export const BOT_STRINGS: StringBundle;
```

- `Pip` draws one `<svg class="pip-bot" data-state="...">`. `pip.css` selects
  eyes, mouth, props and motion by `data-state`; its size defaults sit in
  `@layer base`, so a Tailwind size utility in `className` wins over them.
  Without `size` or a size class Pip is 10rem wide.
- With `reducedMotion` (default: `useReducedMotion()`) every mood is a still picture.
- The helper is a view of the session store: hints, the walkthrough, open chat,
  reading aloud and muting all go through `usePlaySession` actions. The bot
  itself stores only where it was dragged to (`positionKey`).
- Below 640 px the help panel is a sheet at the bottom. Pip stays below the
  `[data-bot-keepout]` element (the play screen's top bar).
- **Pip never lies on the answers.** At home he sits in `[data-bot-seat]` in
  the question card. When that seat has scrolled away and the Check bar is on
  screen, he rests at the right end of the Check bar (`data-spot="check"`), in
  room the bar keeps for him (`botInset`, see `restPoint` / `restInset` /
  `restsLow` in `geometry.ts`). While a bottom sheet is open (solved,
  teach-back, rewards, walkthrough, break, or his own panel on a phone) he is
  at home in his seat, wherever the child had put him, and cannot be dragged.
- The speech bubble lies over the page. A press anywhere else puts a plain line
  away, on every screen size; a line that offers help stays until it is answered
  or closed. Every line is kept in the panel's conversation. A long line does
  not make the bubble taller than `max(9rem, 30dvh)` of text: the text scrolls
  inside the bubble and an arrow button (`[data-line-more]`) scrolls it on.

### `@/child` and `@/parent`

```tsx
export function ChildArea(): JSX.Element;      // @/child, mounted at /kids/*
export function ParentArea(): JSX.Element;     // @/parent, mounted at /parent/*
export function SetupWizard(): JSX.Element;    // @/parent, mounted at /setup
```

- The child area never shows a link out of the app and never a parent control;
  the "Grown-ups" lock on the profile picker leads to the password gate.
- Resetting the device (`src/parent/reset.ts`, used by the gate's "forgot the
  password" path and by Settings) first waits for `supplyIdle()` (at most five
  seconds), so a challenge that is still being built cannot write into the
  emptied database, then calls `wipeEverything()`.
- "Forgot password?" on the gate never deletes anything by itself: it starts
  the 24-hour wait of `requestReset`, the gate and the profile picker show the
  pending request, the right password cancels it, and the typed confirmation is
  only offered once `resetIsReady` (and checked again with `resetAllowed()`
  right before `resetDevice()`). None of it is offered while the gate is locked.
- The setup wizard unlocks the parent gate when it finishes. Leaving its last
  step in any way other than "Open parent area" locks the gate again.
- The AI settings form treats the stored key as missing for an address of
  another service (`getApiKeyOrigin` against the address in the draft), says
  so, and removes the old key when such an address is saved.

## Child safety rules that code must uphold

- Never send the child's nickname, avatar or id to the AI. Send age group, grade,
  interests and challenge context only.
- Two things a parent types may reach the AI, because the product needs them:
  interests (used as themes) and the notes on 1 or 2 star ratings (`avoidNotes`,
  things to avoid). Both are cut to one short line, stripped of anything that
  looks like an e-mail address, web address or phone number, and sent inside a
  tagged data block that the model is told not to obey. That includes the
  interest that is used as the theme of a challenge or story (`cleanTheme`,
  `interestsBlock`); the `THEME` marker line carries the same stripped text.
  Nothing else a parent types is sent. `docs/PRIVACY_AND_SAFETY.md` tells parents exactly this.
- Anything the child types or says is passed to the AI as clearly delimited data
  with an instruction not to follow it.
- All AI text is checked with `localSafetyCheck` before it is shown or spoken.
- No external links, ads, analytics or remote fonts/scripts in the app.
- The microphone is only used while the child holds or taps the mic button, and
  only when the parent enabled it. Audio is never stored. Closing the helper
  panel (or leaving the screen) releases the microphone at once, and what was
  heard after that is thrown away.
- Rewards are never taken away. Help never costs stars.

## Notes for the modules that build on the first wave

These follow from how the first-wave modules were built. They are part of the
contract for `library`, `play`, `bot`, `child` and `parent`.

### `play` (supply queue and play screen)

- Write `db.challenges` and `db.library` rows exactly as typed in
  `src/core/types.ts`: `stage` an integer 0..39, ratings 1..5 or null, days as
  `YYYY-MM-DD`, story `imageDataUrl` a `data:image/...` URL or null, and
  `content` that passes `ChallengeSchema.parse`. A row that breaks this makes
  the device's own backup impossible to restore.
- Call `generateChallenge` with `expectationAt(skill, plan.stage)`, the skill
  name, recent titles (`avoidTitles`), `avoidNotesFor(skillId)`, the learner
  summary, and for `purpose: 'check'` the recent questions on that skill.
- While `placementStatus(childId).done` is false keep at most one placement item
  queued, and discard queued placement items once placement is done.
- After a walkthrough build the follow-up from `makeSiblingPlan(previous)`.
  Never serve a concept check from a library item the child has seen; a
  discarded check is planned again by `planNext`.
- When the AI does not deliver, build from the offline bank as described under
  "Concept checks": own-skill content the child has not solved first
  (`pickOwnSkillChallenge` with the fingerprints of the child's completed and
  waiting challenges), the wide `pickOfflineChallenge` only for practice. Pass
  the skills that cannot get a check to `planNext` as `withoutChecks`.
- Queued concept checks and walkthrough siblings are served whatever mode the
  child picked (the subject filter still applies). A queued or unfinished copy
  of a canvas the parent retired or rated 1-2 is discarded, not served.
- Tell the library about an attempt (`recordLibraryOutcome`) only when
  `recordAttempt` did not report `alreadyRecorded`.
- Wrap play in `startSession` / `tickSession` / `endSession`, and show a calmer
  pace or a break when `AttemptResult.suggestBreak` is true.
- Pass `labels={useStageLabels()}`, `reducedMotion={useReducedMotion()}` and
  `disabled` (whenever an overlay is open) to `ChallengeStage`. Bump `resetKey`
  only to wipe the child's work on purpose.
- Check `effectiveControls(settings, child)` before `generateImage` (aiImages),
  `listenOnce` (microphone), `speak` (voiceOutput) and open chat.
- Offline and procedural items are not stored in the library.

### `bot`

- Hold-to-talk: `listenOnce()` on press, `stopListening()` on release,
  `cancelListening()` when the panel closes or the screen is left; a transcript
  that arrives after that is dropped.
- `tutorReply` output is already checked and safe to show and speak.
- Store helper messages (`db.messages`) only when `keepTranscripts` is on.

### `child`

- The companion: `companionEmoji(companion)`, `companionProgress(companion)`,
  and `getCompanionDef(species)?.name` while `companion.name` is empty.
- Show levels with `StageSteps` / `StageBadge` and `stageName()`.

### `parent`

- First run: check `cryptoAvailable()` first and show `INSECURE_CONTEXT_MESSAGE`
  when it is false (the page was opened as plain http from another device). Then
  `passwordProblems(pw)`, `setAdminPassword(pw)`, `useParentGate.getState().unlock(pw)`.
- Call `passwordProblems()` before `setAdminPassword` / `changeAdminPassword`
  (both throw on an unacceptable new password). A `false` from
  `changeAdminPassword` means a wrong current password or a lock; show the
  countdown from `getLockoutState()`.
- Call `useParentGate.getState().touch()` on pointer and key activity.
- Reset with `resetDevice()` from `src/parent/reset.ts` (it waits for the supply
  queue, then calls `wipeEverything()`), then `useParentGate.getState().lock()`
  and go to `/setup`.
- Restore: `importBackup(await readBackupFile(file), mode)` and show the thrown
  message. Warn before `replace`: it removes every child on the device, also
  when the file holds one child.
- AI settings: name the modes Demo, Direct and Proxy (as README and
  `docs/HOSTING.md` do), default the proxy base URL to `/ai-proxy/v1`, do not
  require a key for a local address in Direct mode, store the key with
  `setApiKey` only, and call `resetAiSession()` after saving. `testConnection`
  with `ok: true` in Demo mode means "nothing to test".
- Next to the microphone setting, say that the browser's speech recognition may
  send audio to the browser maker.
- Dashboard: `getStrandStages` is the current level; strand history rows can
  lag it by one step.

## End-to-end tests (`e2e/`)

`npm run e2e` builds the app, serves it with `vite preview` on port 4173, starts
the mock AI (`tools/mock-ai/server.mjs`) on port 8787 and runs the Playwright
specs in Chromium twice: as a phone (390 x 844) and as a tablet in landscape
(1180 x 820), both at device scale factor 2. One worker, no retries, tracing off.

- `e2e/helpers/db.ts` reads and seeds the app's IndexedDB directly. The app only
  notices such a write after a reload (Dexie live queries do not see it).
- `e2e/helpers/solver.ts` reads the active `ChallengeRecord`, works out a right
  (or wrong) answer with the engine's own `checkAnswer`, and enters it through
  the real controls of all eight interaction kinds.
- `e2e/helpers/app.ts` holds the steps of a parent and a child (setup wizard,
  unlocking the parent area, connecting the mock AI), `expectNoSkip` and
  `calledWrong`. Both rules are about the app's own words: the words of the
  challenge on screen are taken out first, because a challenge may be about
  skip-counting or about a bot's wrong step.
- `e2e/helpers/audit.ts` checks a screen for buttons without an accessible name,
  horizontal overflow, raw translation keys and touch targets under 48 px.
- Every spec saves screenshots to `e2e/screenshots/<project>/` (not committed;
  CI uploads them as an artifact).
- The parent gate is in memory, so a spec moves through the parent area by its
  navigation, never by `page.goto`.
- The mock AI remembers its latest requests (`GET /__mock/log`, size set with
  `MOCK_LOG_LIMIT`); the privacy spec reads them to prove that no request holds
  the child's nickname or id.

## Conventions

- TypeScript strict. No `any` unless unavoidable and commented. No default exports except lazy route components.
- Pure logic lives in plain `.ts` files with unit tests next to them (`x.test.ts`).
- Time is injectable (`now?: number`) in logic that depends on it.
- UI: Tailwind utility classes, minimum 48 px touch targets in the child area, every interactive element keyboard reachable with an accessible name.
- Child-facing strings go through `t()`. Parent-facing strings too where practical.
- Do not add npm dependencies without need. Do not edit files outside your module unless the task says so.
