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
| `src/offline` | Built-in challenge bank and procedural generators (no AI needed) | core, skills |
| `src/engine` | Canvas scene renderer, interaction widgets, answer checking, validators | core |
| `src/ai` | OpenAI-compatible client, prompts, generation, safety | core, skills, data, security, offline, engine (validators) |
| `src/progression` | Stage engine, item selection, placement, rewards, limits | core, skills, data |
| `src/voice` | Text-to-speech and speech-to-text behind one interface | core |
| `src/i18n` | UI strings and `t()` | core |
| `src/ui` | Shared React components and theme | core, i18n |
| `src/play` | Challenge supply queue, play screen, help ladder, teach-back | everything above, bot |
| `src/bot` | Floating helper bot | core, ai, voice, ui, play store |
| `src/child` | Profile picker, adventure map home, mode launcher, rewards shelf | core, data, progression, ui |
| `src/parent` | Setup wizard, password gate, settings, profiles, dashboard, history | core, data, security, ai, progression, ui |
| `server/proxy` | Optional AI proxy that keeps the API key server-side | none (plain Node) |
| `tools/mock-ai` | OpenAI-compatible mock server for development and e2e tests | none (plain Node) |

A module only exports its public API from its `index.ts` / `index.tsx`. Other
modules import from the module root (`@/engine`, never `@/engine/internal/x`).

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

## Public contracts

These signatures are the agreement between modules. Implementations may add
more exports, but must not change these without updating this file.

### `@/data`

```ts
export { db, getSettings, updateSettings, CHILD_TABLES } from './db';

// children.ts
export interface NewChildInput { nickname: string; avatar: string; ageGroup: AgeGroup; grade: Grade; interests: string[]; }
export function createChild(input: NewChildInput): Promise<ChildProfile>;   // fills defaults, hatches an egg companion
export function updateChild(id: string, patch: Partial<ChildProfile>): Promise<ChildProfile>;
export function deleteChild(id: string): Promise<void>;                     // removes the profile and every row in CHILD_TABLES

// usage.ts
export function recordUsage(delta: Partial<Omit<UsageRecord, 'day'>>): Promise<void>;
export function getUsageToday(): Promise<UsageRecord>;
export function getUsageThisMonth(): Promise<{ requests: number; imageRequests: number; promptTokens: number; completionTokens: number }>;
export function checkBudget(): Promise<{ allowed: boolean; reason: 'ok' | 'daily-budget' | 'monthly-cap' }>;

// backup.ts
export interface BackupFile { app: 'intelli-learn'; version: 1; exportedAt: number; tables: Record<string, unknown[]>; }
export function exportBackup(opts?: { childId?: string }): Promise<BackupFile>;   // never includes auth hash, API key cipher or kv
export function importBackup(file: unknown, mode: 'merge' | 'replace'): Promise<{ children: number; records: number }>; // validates shape
export function wipeEverything(): Promise<void>;                             // full reset, including settings and kv
```

### `@/security`

```ts
export function passwordProblems(password: string): string | null;          // null when acceptable (min 6 chars)
export function setAdminPassword(password: string): Promise<void>;          // PBKDF2-SHA256, random salt, >= 210_000 iterations
export function verifyAdminPassword(password: string): Promise<{ ok: boolean; lockedUntil: number | null; attemptsLeft: number }>;
// 5 wrong attempts -> lockout that doubles each time (30 s, 60 s, ... max 15 min). Counters persist in settings.auth.
export function changeAdminPassword(current: string, next: string): Promise<boolean>;
export function encryptSecret(plain: string): Promise<EncryptedBlob>;       // AES-GCM with a non-exportable CryptoKey kept in db.kv
export function decryptSecret(blob: EncryptedBlob): Promise<string>;
export function setApiKey(plain: string | null): Promise<void>;             // writes settings.ai.apiKeyCipher
export function getApiKey(): Promise<string | null>;
export function hasApiKey(): Promise<boolean>;

// gate.ts: in-memory only, never persisted
export const useParentGate: UseBoundStore<StoreApi<{
  unlocked: boolean;
  unlock(password: string): Promise<{ ok: boolean; lockedUntil: number | null; attemptsLeft: number }>;
  lock(): void;
  touch(): void;            // call on parent-area activity; auto-locks after 5 idle minutes
}>>;
```

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
/** Always returns a valid Challenge for the plan: a curated item when one fits, else a procedurally generated one. */
export function pickOfflineChallenge(plan: ChallengePlan, opts?: { avoidTitles?: string[]; seed?: number }): Challenge;
export const OFFLINE_BANK_SIZE: number;
```

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
  /** Text labels for the buttons, already localized. */
  labels?: Partial<{ check: string; clear: string; run: string }>;
}): JSX.Element;
```

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

export function generateStoryOutline(req: { child: ChildContext; theme: string; chapters: number; signal?: AbortSignal }): Promise<StoryOutline>; // never throws; offline fallback story
export function generateLearnerNotes(req: { child: ChildContext; attempts: { skill: string; grade: Grade; outcome: AttemptOutcome; question: string; misconceptions: string[] }[] }): Promise<LearnerNotesOutput | null>;
export function generateWeeklyReport(req: { child: ChildContext; stats: WeeklyReport['stats']; strandStages: { strand: Strand; label: string }[]; learnerSummary: string; }): Promise<WeeklyReportOutput>; // never throws; template fallback
export function generateImage(prompt: string, signal?: AbortSignal): Promise<string | null>;   // data URL, or null when unavailable
export function localSafetyCheck(text: string, strictness?: 'strict' | 'standard'): SafetyVerdict;       // synchronous blocklist
export function checkChallengeSafety(c: Challenge, strictness: 'strict' | 'standard'): Promise<SafetyVerdict>; // blocklist + moderation endpoint when available
export function getAiStatus(): Promise<{ provider: AiProvider; ready: boolean; reason: string }>;
export function testConnection(override?: Partial<{ provider: AiProvider; baseUrl: string; apiKey: string; chatModel: string }>): Promise<{ ok: boolean; message: string; latencyMs: number }>;
export function ageStyleCard(age: AgeGroup): string;
```

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
```

### `@/voice`

```ts
export function voiceSupport(): { tts: boolean; stt: boolean };
export function speak(text: string, opts?: { rate?: number; locale?: Locale; onStart?: () => void; onEnd?: () => void }): Promise<void>; // resolves when done or stopped; never rejects
export function stopSpeaking(): void;
export function listenOnce(opts?: { locale?: Locale; timeoutMs?: number }): Promise<string>; // rejects with Error('unsupported' | 'denied' | 'no-speech')
export function useSpeaking(): boolean;   // true while speech is playing
```

### `@/i18n`

```ts
export function t(key: string, vars?: Record<string, string | number>): string;   // falls back to English, then to the key
export function useT(): typeof t;                 // re-renders on locale change
export function setLocale(locale: Locale): void;
export function getLocale(): Locale;
export const LOCALE_NAMES: Record<Locale, string>;
```

### `@/ui`

Shared, touch-friendly components: `Button`, `BigButton`, `IconButton`, `Card`,
`Modal`, `Field`, `TextInput`, `Select`, `Toggle`, `Chip`, `ProgressBar`,
`StarCount`, `Spinner`, `PageShell`, `EmptyState`, `Toast` + `useToast`,
`ConfirmDialog`, and `applyAccessibility(settings | null)` which sets classes
on `<html>` (`a11y-dyslexia`, `a11y-large`, `a11y-contrast`, `a11y-calm`).
Theme tokens live in `src/index.css`.

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

- Never send the child's nickname, or any free text typed by a parent, to the AI.
  Send age group, grade, interests and challenge context only.
- Anything the child types or says is passed to the AI as clearly delimited data
  with an instruction not to follow it.
- All AI text is checked with `localSafetyCheck` before it is shown or spoken.
- No external links, ads, analytics or remote fonts/scripts in the app.
- The microphone is only used while the child holds or taps the mic button, and
  only when the parent enabled it. Audio is never stored.
- Rewards are never taken away. Help never costs stars.

## Conventions

- TypeScript strict. No `any` unless unavoidable and commented. No default exports except lazy route components.
- Pure logic lives in plain `.ts` files with unit tests next to them (`x.test.ts`).
- Time is injectable (`now?: number`) in logic that depends on it.
- UI: Tailwind utility classes, minimum 48 px touch targets in the child area, every interactive element keyboard reachable with an accessible name.
- Child-facing strings go through `t()`. Parent-facing strings too where practical.
- Do not add npm dependencies without need. Do not edit files outside your module unless the task says so.
