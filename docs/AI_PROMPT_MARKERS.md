# AI prompt marker lines

Every chat request the app sends to the AI endpoint carries a few short,
machine-readable **marker lines**. A real model simply reads past them. The mock
AI server (`tools/mock-ai/server.mjs`) uses them to decide what to return, so
development, demos and end-to-end tests work without a real model.

This file is the contract between `src/ai` (which writes the markers) and
`tools/mock-ai` (which reads them). Change both together.

## Format

- One marker per line: `KEY: value`.
- `KEY` is upper case letters and underscores, at the start of the line
  (leading spaces or tabs are allowed). Exactly one colon follows the key.
  Spaces around the value are ignored.
- Matching pattern: `^[ \t]*([A-Z][A-Z_]{1,30}):[ \t]*(.*?)[ \t]*$`, applied to
  every line of every message.
- Message content may be a plain string or an array of `{ type: 'text', text }` parts.
- Unknown keys are ignored, so new markers can be added without breaking the mock.

## Where to put them

Put all markers in the **system message**, each on its own line, ideally as one
block at the top or bottom of the prompt.

The mock reads system (and `developer`) messages first, then the others, and
**the first occurrence of a key wins**. Text typed or spoken by a child goes in a
later user message, so a child can never override a marker by typing
`TASK: something`. Markers in a user message are accepted only for keys the
system message did not set.

`src/ai` also makes sure that no line of a user message has the shape of a
marker: text that did not come from the app (child input, parent notes, story
text, earlier questions) is flattened to one line, and a line that would still
start like a marker gets a dash in front. `src/ai/integration.test.ts` feeds the
real prompts to the mock's parser to keep both sides in step.

Because the first occurrence wins, never write a line in the system prompt that
starts with a marker key unless it is the marker. For example, write
"The grade is listed below" rather than starting a prose line with `GRADE:`.

## Markers

| Key | Required for | Values | Notes |
| --- | --- | --- | --- |
| `TASK` | every request | `challenge`, `tutor`, `story`, `notes`, `report`, `safety` | Lower case. Decides the JSON shape of the answer. |
| `INTERACTION_KIND` | `challenge` | `choice`, `tap`, `sort`, `match`, `order`, `number`, `robot`, `build` | The `InteractionKind` from the `ChallengePlan`. |
| `GRADE` | `challenge` | `PK`, `K`, `1`, `2`, `3`, `4`, `5`, `6`, `7`, `8` | The grade of the plan's stage (`stageGrade(plan.stage)`), not the child's enrolled grade. |
| `MODE` | `challenge` | `quest`, `story`, `experiment`, `robot`, `detective`, `fixbot`, `invention`, `wonder`, `studio`, `mission` | The `Mode` from the plan. |
| `THEME` | optional, `challenge` and `story` | free text, e.g. `dinosaurs` | The plan's theme (one of the child's interests or a neutral theme). Never a name. |
| `CHAPTERS` | optional, `story` | `2` to `5` | Number of chapters wanted. Default 3. |
| `INTENT` | optional, `tutor` | `nudge`, `hint`, `walkthrough-step`, `wrong-answer`, `chat`, `praise`, `teachback-feedback` | The `TutorRequest.intent`. Only changes the wording of the mock's reply. |

`remixChallenge` uses `TASK: challenge` with the same four challenge markers as
a fresh generation. Concept checks and sibling items do too.

### Example

```text
TASK: challenge
INTERACTION_KIND: robot
GRADE: 3
MODE: robot
THEME: space
```

## What the mock returns

The answer is always a normal chat completion whose `choices[0].message.content`
is a JSON **string**. Parse it and validate it with the schema in the last column.

| `TASK` | `message.content` | Schema in `src/core/schemas.ts` |
| --- | --- | --- |
| `challenge` | A complete challenge of the requested kind with a scene of emoji objects. Robot mazes are solvable inside `maxCommands`; build items are solvable but not by picking every part. Numbers grow a little with the grade. | `ChallengeSchema` |
| `tutor` | `{"say": "...", "highlightIds": [], "redirected": false}` | `TutorReplySchema` |
| `story` | A story outline with `CHAPTERS` chapters (clamped to 2..5, default 3). | `StoryOutlineSchema` |
| `notes` | `{summary, strengths, struggles, nextFocus}` | `LearnerNotesSchema` |
| `report` | `{headline, highlights, struggles, homeActivities}` | `WeeklyReportSchema` |
| `safety` | `{"safe": true, "reason": ""}` | `SafetyVerdictSchema` |
| missing or unknown | `{"ok": true, "say": "Hello from the Intelli-Learn mock AI."}` | none: use this for a connection test |

Details that matter to the caller:

- **Fallbacks.** An unknown `INTERACTION_KIND` falls back to `choice`, an unknown
  `GRADE` to Grade 2 and an unknown `MODE` to `quest`. The mock does not report
  an error for these, so send exact values.
- **Variation.** The mock keeps a counter. Every challenge, tutor and story
  request advances it, so two identical requests in a row give different
  content. Content is in English regardless of the content language.
- **Usage.** Every chat completion has `usage.prompt_tokens`,
  `usage.completion_tokens` and `usage.total_tokens` (rough estimates), so
  `recordUsage` has something to count.
- **Streaming.** With `"stream": true` the same content is sent as
  server-sent events and ends with `data: [DONE]`.

## Test words

Two literal, case-sensitive words let tests reach the unhappy paths. They work
anywhere in the conversation.

| Word | Effect |
| --- | --- |
| `FLAGME` | `TASK: safety` returns `{"safe": false, ...}`. `POST /v1/moderations` returns `flagged: true` for each input that contains the word. Nothing else is ever flagged. |
| `REDIRECTME` | `TASK: tutor` returns `"redirected": true`. |

## Other endpoints of the mock

| Endpoint | Behaviour |
| --- | --- |
| `GET /v1/models` | Lists `mock-stem-1`, `mock-image-1`, `mock-moderation-1`. Any model name is accepted in requests. |
| `POST /v1/moderations` | One result per input. Flags only inputs containing `FLAGME`. |
| `POST /v1/images/generations` | `data[].b64_json` with a valid 1 x 1 PNG whose colour depends on the prompt. |
| `GET /__mock/log` | The last 50 request bodies with their parsed markers, for tests (for example: assert that a nickname was never sent). |
| `POST /__mock/reset` | Resets the counter and clears the log. |

Any API key is accepted. CORS is open to every origin.

## Environment variables of the mock

| Variable | Default | Meaning |
| --- | --- | --- |
| `MOCK_PORT` (or `PORT`) | `8787` | Port. |
| `MOCK_HOST` | loopback only | Bind address. Set `0.0.0.0` to reach the mock from another device. |
| `MOCK_DELAY_MS` | `0` | Delay before every POST answer, to see loading states. |
| `MOCK_FAIL_RATE` | `0` | Share (0..1) of POST requests answered with HTTP 500. |
| `MOCK_INVALID_RATE` | `0` | Share (0..1) of challenge answers that break the schema on purpose, to exercise retry and offline fallback. |
| `MOCK_REJECT_RESPONSE_FORMAT` | off | Set `1` to answer HTTP 400 whenever a request carries `response_format`, to exercise that fallback. |
| `MOCK_SEED` | `0` | Start value of the content counter. |
| `MOCK_QUIET` | off | Set `1` to silence the request log. |
