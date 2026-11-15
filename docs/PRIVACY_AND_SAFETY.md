# Privacy and safety

This page tells a parent, in plain terms, what Intelli-Learn stores, what it
sends to an AI service, what it never sends, which controls a parent has, and
how to export or delete everything. It describes how the app is designed to
work (see `docs/ARCHITECTURE.md`). It is not legal advice.

## The short version

- Everything about your child stays **on the device**, in the browser's own
  storage. There are no accounts, no cloud storage, no analytics, no ads and no
  links to other websites.
- The app talks to **one** outside service, and only if a parent sets it up:
  the AI endpoint. In Demo mode it talks to nobody.
- The AI is told an age group, a school grade and interests. It is **never told
  the child's name**.
- The AI only ever returns a description (text and a picture layout). The app
  checks it and draws it itself. Nothing the AI writes is run as a program.
- A parent password protects settings, history and the AI key.

## What is stored on the device

Stored in the browser's IndexedDB for the app's address:

| What | Details |
| --- | --- |
| Parent password | Only a salted hash (PBKDF2-SHA256, 600,000 rounds; an older hash is renewed the next time the right password is entered). The password itself is never stored |
| App settings | AI mode and endpoint, parental controls, languages |
| AI key (Direct mode only) | Encrypted. See "The API key" below |
| Child profiles | Nickname, avatar emoji, age group, school grade, interests, accessibility choices |
| Learning progress | Level and mastery per skill, level changes over time |
| Challenges and answers | Each challenge shown, the answers given, hints used, time taken, the outcome |
| Helper conversation | What the child typed or said to the helper (as text) and the replies, when "keep transcripts" is on |
| Rewards and play time | Stars, badges, collectibles, the companion, streaks, session lengths |
| Notes and reports | The learner summary and weekly reports written for the parent |
| Stories | Story Quest chapters and progress |
| Canvas library | Every AI-built challenge that passed the checks, with parent ratings. It holds nothing about a child except internal ids |
| AI usage counters | Number of AI requests, tokens and failed builds per day, for the budget and the usage meters |
| Log of recent AI results | For the parent area: what became of the latest AI requests (which task, which model, whether it worked, and an error text the app wrote). It holds nothing a child typed or said, keeps at most 45 entries, and is emptied when the AI settings change |
| Forgotten-password request | Only while one is pending: when it was asked for and when the wait ends |

Not stored anywhere: audio recordings, photos, location, contacts, email
addresses, real names (unless you type one as the nickname).

Each device and each browser has its own separate storage. Clearing the
browser's site data for the app deletes it.

## What is sent to the AI

Nothing, in **Demo** mode.

In **Direct** or **Proxy** mode, the app sends requests to the AI endpoint the
parent configured. They contain:

- the child's **age group**, **school grade**, **interests** and the content language;
- the skill being practised and what is expected at that grade;
- recent challenge titles and questions, so the AI does not repeat itself;
- the short learner summary (for example "strong at counting, rushes
  multi-step questions");
- while the helper is in use: the current challenge, a description of a wrong
  answer, and **what the child typed or said to the helper**. That text is
  marked as data, with an instruction to the AI not to follow it;
- an idea the child picked in Imagination Studio (a sentence built from the app's own picture words), or, only while **Open chat** is on, an idea the child typed;
- in Story Quest: the story chapter the challenge belongs to (the AI wrote it earlier);
- for the parent's notes and weekly report: skill names, grades, outcomes,
  questions and totals such as minutes played;
- text to be safety-checked, when the endpoint offers a moderation check;
- a picture description, only if a parent switched on AI pictures.

Two things a parent types can reach the AI. Do not put names or personal
details in them:

- **Interests.** They are used as themes ("dinosaurs", "space").
- **Notes on low ratings.** When you rate a challenge 1 or 2 stars and add a
  note, the note is passed on as something for the AI to avoid.

As a safety net, the app cuts these texts and anything a child types to one
short line and removes whatever looks like an e-mail address, a web address or
a phone number before sending. It cannot recognise a name, so the advice above
still stands.

## What is never sent to the AI

- The child's nickname or avatar.
- The parent password or anything derived from it.
- Audio. (See "Voice" below for what the browser itself may do.)
- The device's files, location, contacts or other apps' data.
- Other children's data. The shared canvas library contains challenges, not children.

What the app cannot control: like any website you contact, the AI service sees
the internet address the request comes from (your device in Direct mode, your
server in Proxy mode), and in Direct mode the usual browser details. What the
AI provider keeps, and for how long, is governed by **its** terms. Read them
and prefer a provider or a local model you trust. With a local model
(`docs/HOSTING.md`, section 6) nothing leaves your home.

## How AI content is kept safe

1. **The AI describes, the app draws.** The AI must answer in a fixed data
   format. The app validates every answer against that format and rejects
   anything else. It never runs AI-written code or shows AI-written web pages.
   AI-drawn pictures (SVG) are stripped of scripts and outside references first.
2. **Content checks.** All AI text is checked against a built-in blocklist
   before it is shown or spoken. The blocklist also refuses a helper reply
   that asks the child for personal information (name, age, address, school,
   family, photos, other apps), that threatens, or that holds a web address.
   When the AI endpoint offers a moderation check, challenges, story outlines
   and the helper's free replies in open chat are checked with that too. A
   challenge that fails is thrown away and replaced; a helper reply that fails
   is replaced by a line the app wrote itself.
   A challenge that is reused from the canvas library, or that was already
   waiting for the child, is checked again with the blocklist under the
   content strictness of the child who gets it, so a challenge made under
   "standard" for one child is not shown to a child on "strict" unless it
   passes the strict rules too. (The moderation check is not repeated then.)
3. **Sense checks.** The app verifies that a challenge can actually be solved
   and that the hints do not give the answer away. The helper is not given the
   answer key when it writes a nudge, a hint or a chat reply, and its replies
   are checked for giving the answer away before they are shown.
4. **The app owns the rules.** Levels, rewards, time limits and the no-skip
   rule are enforced by the app's code. The AI cannot change them, whatever a
   child types.
5. **Fallback.** If the AI is unavailable, over budget or returns something
   unusable, the app uses its own built-in challenges.
6. **Nothing else loads.** No external links, adverts, trackers, remote fonts
   or scripts. The Docker image also sends a Content-Security-Policy that
   blocks them at the browser level.

No filter is perfect. The blocklist is a list of words and phrasings in
English, Spanish and Hindi: a new phrasing can get past it, most easily where
the AI endpoint has no moderation check (many local models do not). It reads
text, so it cannot read letters that a picture draws as shapes. The check for
"giving the answer away" does not cover every kind of challenge (not the tap,
robot and build kinds). And this version has only been run against a mock AI,
never against a real model (see "Known limitations" in the README). The strict
setting is the default; review the history now and then, rate challenges you
do not like (1 or 2 stars removes one for good, also from a child's waiting
queue), and sit with younger children.

## Parent controls

Behind the parent password:

- **Daily play time** and **allowed hours** (defaults: 30 minutes, 7:00 to 20:00).
- **Subjects** switched on or off (maths, science, technology, engineering,
  logic). A challenge of a switched-off subject that was waiting or unfinished
  is thrown away, not served.
- **Voice output** on or off.
- **Microphone** on or off. Off by default.
- **Open chat** on or off: whether the child may ask the helper about things
  beyond the current challenge and type their own ideas. Off by default.
  While it is off the child has no text box, Imagination Studio offers only
  the app's own picture words, and text typed into the address of the play
  screen is ignored.
- **AI pictures** on or off. Off by default.
- **Real-world missions** on or off.
- **Content strictness**: strict (default) or standard.
- **Keep transcripts** of the helper conversation, on or off.
- **AI budget**: maximum AI requests per day and per month for the device.
- Per-child overrides of the controls above.
- **History**: every challenge and answer, the helper conversation, levels
  over time, weekly reports.
- **Canvas library**: review, replay, rate and retire AI-built challenges.

The password gate locks again after 5 minutes without activity, or when the
app has been in the background for a minute. Five wrong passwords in a row lock
it for 30 seconds; every further five wrong ones lock it twice as long, up to
15 minutes.
There is no password reset by email, because there are no accounts: if the
password is lost, the only way back in is a full reset of the app's data on
that device. So that a child cannot do that in one sitting, "Forgot password?"
only starts a **24-hour wait**. During the wait nothing is deleted, the request
is shown on the password screen and on the profile picker where you will see
it, and entering the right password cancels it. Only after the wait can the
reset be confirmed, and never while the gate is locked after wrong passwords.
If you see such a notice and did not ask for it, enter your password.

Limits you should know: the wait is measured with the device's own clock, so
someone who can change the device's date in its system settings can shorten it
(setting the clock back does not count as waiting). The password must have at
least 6 characters; choose a longer one. And the gate protects the parent
area of the app, not the device: someone who can open the browser's settings
can clear the app's data, which is the same as a full reset.

## Voice

- **Speaking aloud** uses the speech voices built into the device or browser.
- **Listening** happens only while the child holds or taps the microphone
  button, and only if a parent enabled the microphone. Intelli-Learn never
  stores audio and never sends audio to the AI. It only receives the
  recognised text. Closing the helper stops the listening at once.
- Turning speech into text is done by the browser. **Some browsers send the
  audio to the browser maker's speech service to do this** (Chrome does). If
  that is not acceptable, leave the microphone off: the app works fully without it.

## The API key

How the key is handled depends on the AI mode.

**Proxy mode (recommended for shared devices).** The key lives on your server
only. Devices never see it. See `docs/HOSTING.md`, section 5.

**Direct mode.** The browser calls the AI service itself, so the key must be on
the device:

- It is stored encrypted (AES-GCM) with a key the browser is asked to keep
  unreadable to scripts. It is never included in backups. A few browsers cannot
  keep such a key unreadable; there the protection is weaker.
- That protects the key from being read out of storage or a backup. It does
  **not** protect it from someone who can use the unlocked device: the browser
  has to send the key with every request, and a person with access to the
  browser's developer tools, a malicious browser extension or malware on the
  device can capture it there.
- The key is only ever sent to the service it was entered for. If the service
  address is changed to another one (also just for "Test connection"), the
  saved key is not used: the app asks for the key of the new service and
  removes the old key when the new address is saved.

So, for Direct mode:

1. Create a **separate key** just for this app.
2. Set a **monthly spending limit** on the AI provider's website. This is the
   real safety net: a leaked key can then cost only that much.
3. Give the key as few permissions as the provider allows.
4. If a device is lost or you are unsure, **revoke the key** at the provider
   and create a new one.

The app's own daily and monthly request budgets limit what the app itself
spends. They cannot limit someone who has copied the key.

## Exporting your data

From the parent area you can export a backup file, for one child or for
everything. It contains the child profiles, progress, challenges and answers,
helper conversations, rewards, notes, reports, stories, the canvas library and
the settings.

It never contains the parent password hash, the AI key, the device's secret
encryption key, the AI usage counters, the log of recent AI results or a
pending forgotten-password request.

The backup file is **not encrypted** and includes nicknames and the full
learning history. Keep it somewhere private.

Importing a backup (to move to a new device, or to restore) checks the whole
file first and changes nothing if the file is damaged. You choose whether to
merge it with what is on the device or replace it. Replacing removes every
child that is on the device first. Whatever the file contains, an import never
changes the parent password, the AI settings or the stored key; it takes over
the parental controls only when you choose to replace.

## Deleting your data

- **One child:** deleting a profile in the parent area removes the profile and
  every record about that child: progress, challenges, answers, helper
  conversations, rewards, sessions, notes, stories and reports.
- **Everything:** the full reset in the parent area erases all children, the
  canvas library, settings, the password and the stored key.
- **Without the app:** clearing the site data for the app's address in the
  browser's settings, or uninstalling the installed app and clearing its data,
  has the same effect as a full reset.
- **Backups** you exported are ordinary files. Delete them yourself.
- **The AI provider:** the app cannot delete what was already sent to an AI
  service. Use the provider's own data controls for that.
- **Server logs:** if you host with Docker, the logs hold no prompts, answers
  or names (see `docs/HOSTING.md`, section 8). `docker compose down` removes
  the containers and their logs.

## For children: the promises the app keeps

- You can always ask for help, and help never costs stars.
- Rewards are never taken away.
- There is no skip button, but there is always a next hint, and you can always
  go back to the home screen.
