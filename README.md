# Intelli-Learn

Intelli-Learn is an AI-powered STEM learning app for children from Pre-K to
Grade 8. It gives each child an adaptive stream of playful, interactive
challenges in maths, science, technology, engineering and logic, pitched at
their school grade and at how they are actually doing.

It is a local-first web app that can be installed on a tablet or computer. A
parent sets it up behind a password. Everything a child does stays on the
device for the parent to review. There are no accounts, no ads and no tracking.

> **Status:** in active development. Everything listed under Features is built
> and is played through in a real browser by the end-to-end tests, against a
> mock AI. It has not been run against a real AI model yet: read
> [Known limitations](#known-limitations) before you rely on it.
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the source of truth for what
> each module does.

## How it works

Three rules shape the app:

1. **The AI describes, the app draws.** The AI only returns structured data
   that matches fixed schemas. The app validates it and renders it with its own
   canvas and interaction widgets. No AI-written code ever runs.
2. **The app owns progression.** Levels, rewards, time limits and the no-skip
   rule are enforced in code, never by the AI.
3. **Local-first.** All records live in the browser's IndexedDB. The only
   outside service the app can talk to is the AI endpoint a parent configured.

## Features

**For children**

- Eight ways to answer: pick, tap, sort, match, put in order, type a number,
  program a robot through a maze, and build an invention within a budget.
- Ten play modes: quests, Story Quest, Experiment Lab, Robot Coder, Mystery
  Detective, Fix the Bot, Invention Workshop, Wonder of the Day, Imagination
  Studio and real-world missions.
- Animated scenes drawn by the app from the AI's description.
- Pip, an animated helper robot that reads aloud, gives a nudge, then a
  stronger hint, then a step-by-step walkthrough. There is no skip button, and
  help never costs stars. After a walkthrough the child still answers, and the
  next challenge is an easier one on the same idea. An unfinished challenge
  comes back first, whatever world or mode the child opens next.
- "Teach it back" moments, where the child explains the idea to the helper.
- A breathing break when a child is guessing in a hurry, and a friendly rest
  screen when the day's play time is used up. A challenge in progress is never
  cut off.
- Stars, badges, collectibles to buy with stars, streaks and a companion that
  grows and can be named. Rewards are never taken away.
- Optional voice: read-aloud, and a hold-to-talk microphone if a parent enables it.
- Accessibility options: dyslexia-friendly font, large text, high contrast,
  calm mode with reduced motion, and automatic read-aloud.

**School-grade levels**

- A skill map of about 40 skills across five strands, each with a concrete
  expectation for every grade where it applies (Pre-K, K, Grades 1 to 8).
- Every grade has four steps: Starting, Growing, Strong, Ready for next grade.
  That gives 40 stages, so a level such as "Grade 3, Strong" is precise.
- The parent sets the enrolled grade. A short placement game of eight
  challenges finds the real starting point per subject, which may be above or
  below it (at most two grades from where it starts).
- **Concept checks.** Doing well is not enough to move up. Before a level
  rises, the child gets a brand-new challenge on the same idea in a different
  format. Only solving that without hints raises the level, and finding the
  answer by trying the options one after another does not count. A child who
  keeps solving checks alone at the first try moves up faster.
- Spaced reviews after 2, 7 and 21 days re-test older ideas, and a walkthrough
  is always followed by an easier item on the same idea.

**For parents**

- Setup wizard and a password-protected parent area with lockout and auto-lock.
  A forgotten password can only be reset after a 24-hour wait that is shown on
  the device and that the right password cancels.
- Controls for daily play time, allowed hours, subjects, voice, microphone,
  open chat, AI pictures, real-world missions and content strictness, with
  per-child overrides.
- Dashboard and full history: every challenge, answer and helper conversation,
  levels over time, a learner summary and weekly reports with ideas for
  screen-free activities.
- **Canvas library.** Every AI-built challenge is kept. Parents can replay and
  rate it; low-rated ones are retired. Good ones are reused for other children
  at the same level, or re-themed to their interests, which saves AI requests.
- AI request budgets per day and per month, and a panel that shows how many of
  today's challenges the AI delivered, what went wrong when it did not, and the
  tokens used. After three failed builds in a row the app stops asking for a
  while and uses its built-in challenges.
- Backup, restore, per-child delete and full reset.

**Technical**

- Works with no AI at all (Demo mode) from a built-in challenge bank and
  procedural generators, and falls back to them whenever the AI is unavailable.
- Works with OpenAI, any OpenAI-compatible endpoint, or a local model.
- Installable and offline-capable (PWA). Interface languages: English, Spanish, Hindi.
- Docker image, optional server-side AI proxy and optional automatic HTTPS.

## Quick start

Requires Node 22.

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. The setup wizard asks for a parent password and a
first child profile.

**Try it without a key.** The app starts in Demo mode, which needs no AI.

**Try the AI flow without a real model.** Start the mock AI in a second terminal:

```bash
npm run mock-ai
```

Then, in the parent area under Settings, AI connection, choose **OpenAI or
compatible service** (Direct mode), set the service address to
`http://localhost:8787/v1`, enter any text as the key and any model name, and
press **Test connection**. The mock returns valid, varied challenges for every
interaction type and grade. See
[docs/AI_PROMPT_MARKERS.md](docs/AI_PROMPT_MARKERS.md).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on port 5173 |
| `npm run build` | Typecheck, then build the production app into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript check only |
| `npm test` | Unit tests (Vitest), including the proxy and mock AI tests |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run e2e` | End-to-end tests in Chromium (Playwright). Builds the app first; uses ports 4173 and 8787 |
| `npm run mock-ai` | OpenAI-compatible mock server on port 8787 |
| `npm run proxy` | The AI proxy on port 8788, for running it without Docker |

The development and preview servers forward `/ai-proxy` to `http://localhost:8788`
(change it with the `AI_PROXY_TARGET` environment variable), so the Proxy AI mode
can be tried without Docker: start `npm run mock-ai`, then
`UPSTREAM_BASE_URL=http://127.0.0.1:8787/v1 npm run proxy`, then `npm run dev`.

## Configuring the AI

A parent chooses the AI mode in the parent area. Nothing is configured at build time.

| Mode | Name in the app | What happens | Key |
| --- | --- | --- | --- |
| **Demo** | Demo mode | Built-in challenges only. No network requests | None |
| **Direct** | OpenAI or compatible service | The browser calls the AI endpoint | Stored encrypted on the device |
| **Proxy** | Proxy on my server | The browser calls `/ai-proxy/v1` on the app's own address; a small server adds the key | On the server only |

- **OpenAI.** Direct mode, base URL `https://api.openai.com/v1`, your API key,
  and a chat model such as `gpt-4o-mini`. Create a separate key for this app and
  set a monthly spending limit on it.
- **Any OpenAI-compatible endpoint.** Direct mode with that service's base URL,
  key and model name. The service has to accept requests from browsers.
- **Local models (Ollama, LM Studio).** Either Direct mode on the same computer
  (`http://localhost:11434/v1`, with `OLLAMA_ORIGINS` set to the app's address),
  or, for tablets and other devices, through the proxy.
- **Proxy mode.** Recommended for shared or child-held devices, because no key
  is on the device. Needs the Docker setup below.

Details and troubleshooting: [docs/HOSTING.md](docs/HOSTING.md).

## Docker

```bash
cp .env.example .env
docker compose up -d --build                                    # app on http://localhost:8080
docker compose --profile proxy up -d --build                    # + AI proxy (key stays on the server)
docker compose --profile proxy --profile https up -d --build    # + automatic HTTPS with Caddy
```

The app needs a secure page for the parent password, offline install and the
microphone. `http://localhost` counts as secure; every other address needs
HTTPS. [docs/HOSTING.md](docs/HOSTING.md) explains the options, including HTTPS
on a home network without a domain name.

The web container runs nginx as a non-root user with a read-only filesystem and
a strict Content-Security-Policy. `.env.example` documents every setting.

## Project structure

```text
src/
  core/          shared types, zod schemas, grade helpers, defaults
  core/skills/   the grade-mapped skill map
  data/          IndexedDB database, backup and restore, usage counters
  security/      parent password, lockout, forgotten-password wait, parent gate, API key encryption
  offline/       built-in challenge bank and procedural generators
  engine/        scene renderer, interaction widgets, answer checking, validators
  ai/            OpenAI-compatible client, prompts, generation, safety checks
  progression/   levels, item selection, placement, concept checks, rewards, limits
  voice/         text-to-speech and speech-to-text behind one interface
  i18n/          interface strings
  ui/            shared components and theme
  library/       canvas library: keep, rate, reuse, remix
  play/          challenge queue, play screen, help ladder, teach-back
  bot/           the floating helper bot
  bot/pip/       Pip, the animated mascot
  child/         profile picker, adventure map, rewards shelf, Imagination Studio, rest screen
  parent/        setup wizard, password gate, overview, children, history, canvas library, settings
e2e/             end-to-end tests (Playwright) and their helpers
server/proxy/    optional AI proxy (plain Node, no dependencies)
tools/mock-ai/   OpenAI-compatible mock server (plain Node, no dependencies)
docker/          nginx configuration and Caddyfile
docs/            architecture, hosting, privacy and safety, Android, prompt markers
```

## Testing

```bash
npm run typecheck
npm test                      # all unit tests
npx vitest run src/engine     # one module
npx vitest run server tools   # the AI proxy and the mock AI
npm run e2e                   # end-to-end tests
```

Unit tests sit next to the code they test (`x.test.ts`): 2,511 tests in 111
files at the last count. The mock AI's output is tested against the app's real
schemas and content validator, so it cannot drift from what the app accepts.
There are 18 end-to-end tests, each run at two screen sizes.

### End-to-end tests

`npm run e2e` plays through the product in a real browser. It needs Chromium
once (`npx playwright install chromium`), and ports 4173 and 8787 must be free.
The command builds the app, serves the build with `vite preview`, starts the
mock AI and runs every spec in `e2e/` twice: as a phone (390 x 844) and as a
tablet in landscape (1180 x 820).

```bash
npm run e2e                               # everything, about 13 minutes
npm run e2e -- --project=phone            # one screen size
npm run e2e -- e2e/02-play.spec.ts        # one spec
```

The specs cover the first-run wizard, the placement game and the play loop with
all eight ways to answer, the help ladder up to the walkthrough (and that
nothing on screen is ever called "skip"), concept checks, the parent gate and
its lockout, history, rating and retiring canvases, switching a subject off, AI
mode against the mock (including a check that no request holds the child's
nickname), reuse of canvases for a second child, the daily time limit and
allowed hours, Robot Coder, Imagination Studio, Story Quest, the rewards shelf,
and a sweep of every screen for console errors, requests to other origins,
buttons without a name, sideways scrolling at 360 px and touch targets under
48 px in the child area.

Each run saves screenshots of every major screen to `e2e/screenshots/phone/`
and `e2e/screenshots/tablet/` (not committed).

CI runs the typecheck, the unit tests and the build on every push and pull
request, runs the end-to-end tests (and keeps their screenshots as an
artifact), and builds the Docker images.

## Safety and privacy

- The child's nickname is never sent to the AI. Only age group, grade,
  interests and the challenge context are.
- What a child types or says to the helper is passed to the AI as data, never
  as instructions, and all AI text is safety-checked before it is shown or spoken.
  With open chat switched off there is nowhere for a child to type free text,
  and text typed into the address of the play screen is ignored. (With the
  microphone switched on, what the child says to the helper still goes to the
  AI as text, in both cases.)
- A challenge that is reused from the library or was waiting in the queue is
  checked again against the content rules of the child who gets it.
- No external links, ads, analytics, remote fonts or remote scripts.
- The microphone is off unless a parent enables it, is only used while the
  child holds or taps the button, and audio is never stored.
- In Direct mode the API key is on the device, and it is only ever sent to the
  service it was entered for. Use a separate key with a spending limit, or use
  Proxy mode.

Read [docs/PRIVACY_AND_SAFETY.md](docs/PRIVACY_AND_SAFETY.md) for what is
stored, what is sent, the parent controls, and how to export or delete data.

## Known limitations

Read this before you give the app to a child.

**Not verified in the real world**

- **Never run against a real AI model.** Everything that involves the AI
  (prompts, the repair rounds, cut-off replies, timeouts, budgets, the
  moderation check, the helper's replies) has only been exercised against the
  mock AI in `tools/mock-ai` and against mocked responses in unit tests. How
  good, how safe, how fast and how expensive a real model's challenges are is
  unknown. Local models (Ollama, LM Studio) are untested too; the app cannot
  detect a model's context length, so follow `docs/HOSTING.md`, section 6.
- **Only Chromium is tested.** The end-to-end tests run in desktop Chromium at
  a phone and a tablet size, driven with a mouse; touch was tried with
  synthetic events only. Safari (iPad, iPhone), Firefox, Android browsers and
  real touch screens have not been tried.
- **Voice is untested on real devices.** Reading aloud and the microphone are
  tested against a fake speech driver only. Which voices and which speech
  recognition a device offers, and how well they work for young children, is
  unknown.
- **Spanish and Hindi have not been reviewed by a native speaker.** The
  interface strings exist in both, written without review. The built-in
  challenge bank (Demo mode, and every fallback when the AI does not deliver)
  is in English only, and so are the AI error messages shown to the parent.
- **The learning rules are untested with children.** The numbers behind
  mastery, concept checks, faster step-ups after a run of solo solves, and the
  placement game were tuned with simulations, not with real learners.
- A few layouts were checked from generated data or measurements only, not by
  eye on a device (for example the Pre-K counter cards for "2 plus 1").

**Not built**

- The Android wrapper (see Roadmap) and any backend: no accounts, no sync
  between devices, no multi-family (multi-tenant) hosting. One device, one
  family, one browser profile.
- A linter: the repository has a typecheck and tests, but no ESLint setup.

**Safety and security limits**

- The content filter on the device is a list of words and phrasings in
  English, Spanish and Hindi. A new phrasing can get past it, most easily
  where the AI service has no moderation check. Content that is reused from
  the library is checked again with this list only. Text that a picture draws
  as shapes cannot be read by it.
- The check that keeps the helper from giving the answer away does not cover
  tap, robot and build challenges.
- The 24-hour wait before a forgotten password can be reset is measured with
  the device's clock; someone who can change the system date can shorten it.
  The parent password needs only 6 characters. Clearing the browser's site
  data resets the app without any password.
- In Direct mode the API key is on the device and can be captured by someone
  with access to the unlocked browser. In Proxy mode the proxy has no login
  of its own: anyone who can reach the app's address can send requests
  through it, limited only by the rate limit per address and the optional
  model allowlist (the app's request budget is kept on each device, not on the
  server). Do not put it on the public internet without your own access
  control, and set a spending limit on the key.

**Product behaviour to be aware of**

- No skipping is strict: an unfinished challenge comes back in every world and
  mode, so a child who is stuck has the help ladder (hint, strong hint,
  walkthrough) as the only way on.
- Without the AI, about one in eight combinations of skill, grade and answer
  format has no content of its own in the built-in bank; the app then uses
  another format of the same skill, and for practice (never for a concept
  check) sometimes a neighbouring skill. A long-playing child will see
  built-in challenges repeat.
- In Demo mode Imagination Studio cannot draw the child's idea; Pip says so
  and gives a ready-made puzzle.
- With a slow AI the first challenge can take up to 8 seconds (20 for a studio
  idea or a story chapter) before the built-in bank steps in.
- On a very small phone in landscape (568 x 320) the teach-back sheet still
  needs scrolling.
- On touch screens a quick straight-down drag on a sort or match card scrolls
  the page instead of moving the card; hold briefly or move sideways to drag.

## Roadmap

- **Android app.** A Capacitor wrapper around the same build. The configuration
  is in `capacitor.config.json` and the steps are in
  [docs/ANDROID.md](docs/ANDROID.md). Capacitor itself is not installed yet.
- **Not built:** cloud sync between devices, and parent accounts. Today each
  device keeps its own data, and a backup file is the way to move it.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): modules, contracts and rules
- [docs/HOSTING.md](docs/HOSTING.md): Docker, HTTPS, AI proxy, local models
- [docs/PRIVACY_AND_SAFETY.md](docs/PRIVACY_AND_SAFETY.md): data, AI, parent controls
- [docs/AI_PROMPT_MARKERS.md](docs/AI_PROMPT_MARKERS.md): the prompt marker protocol and the mock AI
- [docs/ANDROID.md](docs/ANDROID.md): the planned Android wrapper
