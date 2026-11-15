# Intelli-Learn

Intelli-Learn is an AI-powered STEM learning app for children from Pre-K to
Grade 8. It gives each child an adaptive stream of playful, interactive
challenges in maths, science, technology, engineering and logic, pitched at
their school grade and at how they are actually doing.

It is a local-first web app that can be installed on a tablet or computer. A
parent sets it up behind a password. Everything a child does stays on the
device for the parent to review. There are no accounts, no ads and no tracking.

> **Status:** in active development. This README describes the design in
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), which is the source of truth
> for what each module does.

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
- A helper bot that reads aloud, gives a nudge, then a stronger hint, then a
  step-by-step walkthrough. There is no skip button, and help never costs stars.
- "Teach it back" moments, where the child explains the idea to the helper.
- Stars, badges, collectibles, streaks and a companion that grows. Rewards are
  never taken away.
- Optional voice: read-aloud, and a hold-to-talk microphone if a parent enables it.
- Accessibility options: dyslexia-friendly font, large text, high contrast,
  calm mode with reduced motion, and automatic read-aloud.

**School-grade levels**

- A skill map of about 40 skills across five strands, each with a concrete
  expectation for every grade where it applies (Pre-K, K, Grades 1 to 8).
- Every grade has four steps: Starting, Growing, Strong, Ready for next grade.
  That gives 40 stages, so a level such as "Grade 3, Strong" is precise.
- The parent sets the enrolled grade. A short placement finds the real starting
  point per subject, which may be above or below it.
- **Concept checks.** Doing well is not enough to move up. Before a level
  rises, the child gets a brand-new challenge on the same idea in a different
  format. Only solving that without hints raises the level.
- Spaced reviews after 2, 7 and 21 days re-test older ideas, and a walkthrough
  is always followed by an easier item on the same idea.

**For parents**

- Setup wizard and a password-protected parent area with lockout and auto-lock.
- Controls for daily play time, allowed hours, subjects, voice, microphone,
  open chat, AI pictures, real-world missions and content strictness, with
  per-child overrides.
- Dashboard and full history: every challenge, answer and helper conversation,
  levels over time, a learner summary and weekly reports with ideas for
  screen-free activities.
- **Canvas library.** Every AI-built challenge is kept. Parents can replay and
  rate it; low-rated ones are retired. Good ones are reused for other children
  at the same level, or re-themed to their interests, which saves AI requests.
- AI request budgets per day and per month.
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

Then, in the parent area's AI settings, choose **Direct**, set the base URL to
`http://localhost:8787/v1` and enter any text as the key. The mock returns
valid, varied challenges for every interaction type and grade. See
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
| `npm run e2e` | End-to-end tests (Playwright) |
| `npm run mock-ai` | OpenAI-compatible mock server on port 8787 |
| `npm run proxy` | The AI proxy on port 8788, for running it without Docker |

The development and preview servers forward `/ai-proxy` to `http://localhost:8788`
(change it with the `AI_PROXY_TARGET` environment variable), so the Proxy AI mode
can be tried without Docker: start `npm run mock-ai`, then
`UPSTREAM_BASE_URL=http://127.0.0.1:8787/v1 npm run proxy`, then `npm run dev`.

## Configuring the AI

A parent chooses the AI mode in the parent area. Nothing is configured at build time.

| Mode | What happens | Key |
| --- | --- | --- |
| **Demo** | Built-in challenges only. No network requests | None |
| **Direct** | The browser calls the AI endpoint | Stored encrypted on the device |
| **Proxy** | The browser calls `/ai-proxy/v1` on the app's own address; a small server adds the key | On the server only |

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
  security/      parent password, lockout, parent gate, API key encryption
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
  child/         profile picker, adventure map, rewards shelf
  parent/        setup wizard, settings, profiles, dashboard, history
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

Unit tests sit next to the code they test (`x.test.ts`). The mock AI's output
is tested against the app's real schemas and content validator, so it cannot
drift from what the app accepts. CI runs the typecheck, the unit tests and the
build on every push and pull request, and builds the Docker images.

## Safety and privacy

- The child's nickname is never sent to the AI. Only age group, grade,
  interests and the challenge context are.
- What a child types or says to the helper is passed to the AI as data, never
  as instructions, and all AI text is safety-checked before it is shown or spoken.
- No external links, ads, analytics, remote fonts or remote scripts.
- The microphone is off unless a parent enables it, is only used while the
  child holds or taps the button, and audio is never stored.
- In Direct mode the API key is on the device. Use a separate key with a
  spending limit, or use Proxy mode.

Read [docs/PRIVACY_AND_SAFETY.md](docs/PRIVACY_AND_SAFETY.md) for what is
stored, what is sent, the parent controls, and how to export or delete data.

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
