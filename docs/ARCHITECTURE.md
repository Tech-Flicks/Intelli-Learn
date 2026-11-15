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
| `src/security` | Admin password, lockout, parent gate, API key encryption | core, data |
| `src/offline` | Built-in challenge bank and procedural generators (no AI needed) | core, skills (the engine only in tests: `crosscheck.test.ts`) |
| `src/engine` | Canvas scene renderer, interaction widgets, answer checking, validators | core |
| `src/ai` | OpenAI-compatible client, prompts, generation, safety | core, skills, data, security, offline, engine (validators) |
| `src/progression` | Stage engine, item selection, placement, rewards, limits | core, skills, data |
| `src/voice` | Text-to-speech and speech-to-text behind one interface | core |
| `src/i18n` | UI strings and `t()`, including the translations of the engine's labels | core |
| `src/ui` | Shared React components and theme | core, i18n, react-router-dom (`PageShell` back link) |
| `src/library` | Canvas library: keep, rate, reuse and remix built challenges | core, data |
| `src/play` | Challenge supply queue, play screen, help ladder, teach-back | everything above, bot |
| `src/bot` | Floating helper bot | core, ai, voice, ui, play store |
| `src/child` | Profile picker, adventure map home, mode launcher, rewards shelf | core, data, progression, ui |
| `src/parent` | Setup wizard, password gate, settings, profiles, dashboard, history | core, data, security, ai, progression, ui |
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
| `/setup` | `SetupWizard` | parent |
| `/parent/*` | `ParentArea` (shows the password gate itself) | parent |
| `/kids` | profile picker | child (`ChildArea`) |
| `/kids/:childId` | adventure map home | child |
| `/kids/:childId/shelf` | rewards shelf and companion | child |
| `/kids/:childId/studio` | Imagination Studio idea picker | child |
| `/kids/:childId/play` | `PlayScreen`. Query: `mode` (a `Mode`), `idea` (studio), `strand` | play |

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
resumes when they return.

### Outcomes and mastery

`AttemptOutcome` is derived from what happened: `independent` (first try, no
help), `second-try` (wrong tries, no help), `nudge`, `hint`, `walkthrough`.
The progression module turns an outcome into a mastery change and possibly a
stage change (see `src/progression`).

### Concept checks (back testing)

Mastery alone never raises a stage. When a skill's mastery reaches the step-up
threshold, the skill is marked `checkPending` and the child's next item on that
skill is a **concept check** (`purpose: 'check'`): a brand-new challenge on the
same grade expectation, in a different interaction kind from the skill's
`recentInteractions` where the skill offers one, and in a different context.
The AI is told the previous questions so it tests the same idea in a new way.

- Check solved `independent` or `second-try`: the stage steps up, `checksPassed`
  increases, a spaced review is scheduled, `checkPending` clears.
- Check solved with a `nudge` or `hint`: no step up, mastery drops to 60,
  `checkPending` clears (more practice, then another check).
- Check needed a `walkthrough`: no step up, mastery drops to 40, `checkPending` clears.

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
  to future generations as something to avoid. Ratings of 4 or 5 mark it as preferred.
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
export function setAdminPassword(password: string): Promise<void>;          // PBKDF2-SHA256, random salt, 210_000 iterations. Throws Error(passwordProblems) or Error(INSECURE_CONTEXT_MESSAGE)
export interface VerifyResult { ok: boolean; lockedUntil: number | null; attemptsLeft: number; }
export function verifyAdminPassword(password: string, now?: number): Promise<VerifyResult>;
export function changeAdminPassword(current: string, next: string): Promise<boolean>; // false: wrong current password or locked. Throws when `next` is unacceptable
export function hasAdminPassword(): Promise<boolean>;
export function getLockoutState(now?: number): Promise<{ lockedUntil: number | null; attemptsLeft: number }>;
export function encryptSecret(plain: string): Promise<EncryptedBlob>;       // AES-GCM with a non-exportable CryptoKey kept in db.kv
export function decryptSecret(blob: EncryptedBlob): Promise<string>;
export function setApiKey(plain: string | null): Promise<void>;             // writes settings.ai.apiKeyCipher; null or blank removes it
export function getApiKey(): Promise<string | null>;                        // never throws; null = no usable key
export function hasApiKey(): Promise<boolean>;                              // true only when the stored key really decrypts on this device

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
```

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
/** Semantic problems the zod schema cannot express. Empty array = valid. */
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
export function getAiStatus(): Promise<{ provider: AiProvider; ready: boolean; reason: string }>;
export function testConnection(override?: Partial<{ provider: AiProvider; baseUrl: string; apiKey: string; chatModel: string }>): Promise<{ ok: boolean; message: string; latencyMs: number }>;
export function ageStyleCard(age: AgeGroup): string;
/** Forgets what was learned about the endpoint in this session. Call it after the parent saves changed AI settings. */
export function resetAiSession(): void;
export type AiErrorKind = 'no-config' | 'budget' | 'network' | 'auth' | 'rate-limit' | 'bad-response' | 'refused' | 'aborted';
export class AiError extends Error { readonly kind: AiErrorKind; readonly status: number | null; readonly detail: string; readonly timedOut: boolean; readonly code: string; }
```

Details the callers rely on:

- `TutorRequest.walkthroughStep` is a zero-based index into `challenge.walkthrough`.
  For `teachback-feedback`, pass the chosen option's id or label as `childText`.
- `tutorReply` already applies `localSafetyCheck` and an answer-leak check, and
  `highlightIds` only name existing scene objects (never tap targets before the
  challenge is solved). `praise` is always answered on the device. `chat` never
  gives more help than the hint level the child already reached.
- `generateChallenge` runs schema -> `normalizeChallenge` -> kind check ->
  `validateChallengeContent` -> `checkChallengeSafety`, with one feedback round,
  and costs at most 5 chat requests before the offline fallback.
- `remixChallenge` keeps `original.interaction.kind` and returns null when the
  result has the same title or question as the original.
- `generateImage` only reads the global `settings.controls.aiImages`. A caller
  with a child must check `effectiveControls(settings, child).aiImages` first.
  It asks for `b64_json` and returns null for a remote image URL.
- `generateLearnerNotes` and `generateWeeklyReport` write in the parent's
  interface language (`settings.locale`).
- `testConnection` returns `ok: true` with a "nothing to test" message in demo
  mode, skips the budget check, and in direct mode accepts a local address
  (localhost, 10.x, 192.168.x, `*.local`) without an API key.
- Every prompt carries the marker lines of `docs/AI_PROMPT_MARKERS.md` in the
  **system** message; text from a child or parent can never form a marker line.
- Proxy mode: errors of the app's own proxy are recognised by `error.type`
  (`proxy_unavailable`, `proxy_not_configured`, `upstream_auth_error`,
  `upstream_error`, `upstream_timeout`, `rate_limit_exceeded`, `forbidden`) and
  `testConnection` turns each into advice that names the server setting to fix.

The AI client sends `POST {baseUrl}/chat/completions` with
`response_format: { type: 'json_object' }`, falls back to no `response_format`
when the endpoint rejects it, extracts the first JSON object from the reply,
validates with zod, and retries up to two times with the validation errors fed
back. In `proxy` mode it sends no Authorization header. Every request is counted
with `recordUsage` and refused when `checkBudget` says no.

### `@/progression`

```ts
export function effectiveControls(settings: Settings, child: ChildProfile): ParentalControls;
export function planNext(childId: string, count?: number, opts?: { mode?: Mode; strand?: Strand; now?: number }): Promise<ChallengePlan[]>;
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
export function recordAttempt(input: RecordAttemptInput): Promise<AttemptResult>;
// Concept checks: see "Concept checks (back testing)". planNext emits purpose 'check' for skills with checkPending
// (these take priority over everything except placement), and recordAttempt applies the check rules.
export function outcomeOf(input: Pick<RecordAttemptInput, 'answers' | 'hintsUsed' | 'walkthroughUsed'>): AttemptOutcome;
export function getStrandStages(childId: string): Promise<StrandStage[]>;
export function getPlayAllowance(childId: string, now?: number): Promise<PlayAllowance>;
export function startSession(childId: string, now?: number): Promise<SessionRecord>;
export function tickSession(sessionId: string, activeMsDelta: number, now?: number): Promise<void>;
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
  plan is pitched at the estimate at planning time.
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
/** Saves a validated AI-built challenge. Returns the existing item when the fingerprint is already stored. */
export function saveToLibrary(input: { content: Challenge; plan: ChallengePlan; ageGroup: AgeGroup; locale: Locale; origin: 'ai' | 'remix'; remixOf?: string | null }): Promise<LibraryItem>;
/** Best unseen, non-retired item for the plan and child, or null. Prefers higher ratings, then fewer uses. */
export function findReusable(plan: ChallengePlan, child: { id: string; ageGroup: AgeGroup; interests: string[] }, locale: Locale): Promise<{ item: LibraryItem; themeFits: boolean } | null>;
export function markServed(libraryId: string, childId: string): Promise<void>;
export function recordLibraryOutcome(libraryId: string, outcome: AttemptOutcome): Promise<void>;
/** Sets the rating (1-5 or null) and note, retires on 1-2, and mirrors the rating to challenges that point at the item. */
export function rateLibraryItem(libraryId: string, rating: number | null, note?: string): Promise<LibraryItem>;
export function setRetired(libraryId: string, retired: boolean): Promise<void>;
/** Notes from low-rated items for this skill, passed to the AI as things to avoid. */
export function avoidNotesFor(skillId: string): Promise<string[]>;
export function libraryStats(): Promise<{ total: number; rated: number; retired: number; reusedServes: number }>;
```

### `@/play`

```ts
// supply.ts: keeps 3-5 validated challenges queued per child
export function ensureQueue(childId: string, opts?: { min?: number; target?: number }): Promise<void>;   // background safe, deduplicated per child
export function takeNext(childId: string, opts?: { mode?: Mode; strand?: Strand; idea?: string }): Promise<ChallengeRecord>;  // resumes the active one if any
export function makeSibling(previous: ChallengeRecord): Promise<ChallengeRecord>;                        // easier sibling after a walkthrough

// session store read by the bot
export const usePlaySession: UseBoundStore<StoreApi<PlaySessionState>>;
export function PlayScreen(): JSX.Element;
```

### `@/bot`

```tsx
/** Floating, draggable helper. Reads the current challenge from `usePlaySession`. */
export function HelperBot(props: { childId: string }): JSX.Element;
```

## Child safety rules that code must uphold

- Never send the child's nickname, avatar or id to the AI. Send age group, grade,
  interests and challenge context only.
- Two things a parent types may reach the AI, because the product needs them:
  interests (used as themes) and the notes on 1 or 2 star ratings (`avoidNotes`,
  things to avoid). Both are cut to one short line, stripped of anything that
  looks like an e-mail address, web address or phone number, and sent inside a
  tagged data block that the model is told not to obey. Nothing else a parent
  types is sent. `docs/PRIVACY_AND_SAFETY.md` tells parents exactly this.
- Anything the child types or says is passed to the AI as clearly delimited data
  with an instruction not to follow it.
- All AI text is checked with `localSafetyCheck` before it is shown or spoken.
- No external links, ads, analytics or remote fonts/scripts in the app.
- The microphone is only used while the child holds or taps the mic button, and
  only when the parent enabled it. Audio is never stored.
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
  `cancelListening()` when leaving the screen.
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
- After `wipeEverything()`: `useParentGate.getState().lock()`, then go to `/setup`.
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

## Conventions

- TypeScript strict. No `any` unless unavoidable and commented. No default exports except lazy route components.
- Pure logic lives in plain `.ts` files with unit tests next to them (`x.test.ts`).
- Time is injectable (`now?: number`) in logic that depends on it.
- UI: Tailwind utility classes, minimum 48 px touch targets in the child area, every interactive element keyboard reachable with an accessible name.
- Child-facing strings go through `t()`. Parent-facing strings too where practical.
- Do not add npm dependencies without need. Do not edit files outside your module unless the task says so.
