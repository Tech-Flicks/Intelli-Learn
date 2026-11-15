# Hosting Intelli-Learn

Intelli-Learn is a static web app. The server only hands out files; everything a
child does is stored in the browser of the device they use. That makes hosting
simple: one small container, no database.

This guide covers:

1. [Quick start with Docker](#1-quick-start-with-docker)
2. [Why you need HTTPS](#2-why-you-need-https)
3. [HTTPS on a home network](#3-https-on-a-home-network)
4. [HTTPS with a public domain](#4-https-with-a-public-domain)
5. [The AI proxy: keeping the API key on the server](#5-the-ai-proxy-keeping-the-api-key-on-the-server)
6. [Local models: Ollama and LM Studio](#6-local-models-ollama-and-lm-studio)
7. [Updating](#7-updating)
8. [What the containers do and log](#8-what-the-containers-do-and-log)
9. [Troubleshooting](#9-troubleshooting)

## 1. Quick start with Docker

You need Docker with the Compose plugin (Docker Desktop includes both).

```bash
git clone <this repository>
cd Intelli-Learn
cp .env.example .env        # optional: the defaults work
docker compose up -d --build
```

Open <http://localhost:8080> on the same computer. The setup wizard asks for a
parent password and a first child profile. The app starts in **Demo mode**, which
uses the built-in challenge bank and needs no AI key.

Useful commands:

```bash
docker compose ps            # "healthy" means the app is being served
docker compose logs -f web   # request log
docker compose down          # stop (learning data stays in the browsers)
```

Without Compose:

```bash
docker build -t intelli-learn-web .
docker run -d --name intelli-learn -p 8080:8080 --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges intelli-learn-web
```

All settings live in `.env`; `.env.example` documents each one.

## 2. Why you need HTTPS

Browsers only switch on certain features for pages they consider secure. That
means `https://` addresses, plus `http://localhost` as a special case.
Intelli-Learn depends on three of those features:

| Feature | Used for | Without a secure page |
| --- | --- | --- |
| Web Crypto | Hashing the parent password and encrypting a stored API key | **Setup cannot be completed** |
| Service worker | Installing the app and using it offline | No install, no offline use |
| Microphone | Letting a child talk to the helper (only if a parent enables it) | Microphone unavailable |

So:

- **On the computer that runs Docker**, `http://localhost:8080` works as is.
- **On any other device** (a tablet opening `http://192.168.1.50:8080`), the page
  is not secure and setup will not work. Use one of the HTTPS options below.

## 3. HTTPS on a home network

The `https` profile adds [Caddy](https://caddyserver.com), a web server that
handles certificates by itself. On a home network there is no public domain, so
Caddy acts as its own small certificate authority (`tls internal`). You tell
each device once to trust it.

### Pick an address

Choose the address people will type on their devices. Any of these works:

- The server's IP address on your network, for example `192.168.1.50`. Give the
  server a fixed address in your router so it does not change.
- A local name your router can serve, for example `learn.home.arpa`.
- A `.local` name if the server announces one, for example `myserver.local`.

### Start it

In `.env`:

```ini
SITE_ADDRESS=192.168.1.50
CADDY_TLS=internal
WEB_BIND=127.0.0.1          # optional: plain HTTP for this computer only
```

```bash
docker compose --profile https up -d --build
```

The app is now at `https://192.168.1.50`. Until a device trusts Caddy's
certificate authority, its browser shows a warning.

To avoid typing `--profile` every time, set `COMPOSE_PROFILES=https` (or
`proxy,https`) in `.env`.

### Trusting the certificate

Copy Caddy's root certificate out of the container:

```bash
docker compose --profile https cp caddy:/data/caddy/pki/authorities/local/root.crt ./intelli-learn-root.crt
```

Send that file to each device (email, a USB stick, a shared folder) and install it:

- **Android tablet or phone:** Settings, then Security (or "Security and
  privacy"), then "More security settings" or "Encryption and credentials",
  then "Install a certificate", then "CA certificate". Pick the file. Chrome
  trusts it afterwards. The exact menu names differ a little between brands.
- **iPad or iPhone:** Open the file, then go to Settings, "Profile Downloaded",
  and install it. Afterwards open Settings, General, About, "Certificate Trust
  Settings" and switch on full trust for "Caddy Local Authority".
- **Windows:** Double-click the file, "Install Certificate", "Local Machine",
  and place it in "Trusted Root Certification Authorities".
- **macOS:** Open the file to add it to Keychain Access, open the certificate
  there, and set "When using this certificate" to "Always Trust".
- **Chromebook:** Settings, "Privacy and security", "Manage certificates",
  "Authorities", "Import".

Treat `intelli-learn-root.crt` as specific to your home: it only helps devices
trust *your* server. The matching private key never leaves the `caddy_data`
Docker volume. Keep that volume: if it is deleted, Caddy creates a new
authority and every device has to trust the new certificate.

### Already have a reverse proxy or tunnel?

Skip the `https` profile and point your own proxy (Traefik, nginx, a tunnel
service, a NAS reverse proxy) at `http://<server>:8080`. Two rules:

- Pass the `Host` header through unchanged. The AI proxy compares it with the
  browser's `Origin` to refuse requests from other websites.
- Do not buffer responses under `/ai-proxy/`.

## 4. HTTPS with a public domain

If a domain name points at your server and ports 80 and 443 are reachable from
the internet, Caddy can get a free, publicly trusted certificate. No device
needs to install anything.

```ini
SITE_ADDRESS=learn.example.com
CADDY_TLS=you@example.com
WEB_BIND=127.0.0.1
```

```bash
docker compose --profile https up -d --build
```

Think before doing this. The app has no user accounts: anyone who finds the
address can open it and create their own local profiles (they cannot see your
children's data, which lives on your devices). More importantly, **if the AI
proxy is enabled, anyone who can reach the address can spend your AI budget**,
up to the rate limit. For a family, a home network or a private VPN is the
better home for this app. If it must be public, set `ALLOWED_MODELS`, keep
`RATE_LIMIT_PER_MINUTE` low, and set a spending limit with your AI provider.

## 5. The AI proxy: keeping the API key on the server

There are three AI modes, chosen in the parent area under AI settings:

| Mode | Where the API key lives | Good for |
| --- | --- | --- |
| Demo | No key | Trying the app, or using it without AI |
| Direct | Encrypted in the browser of each device | A single trusted device |
| Proxy | On the server only | Shared or child-held devices |

In Direct mode the browser itself calls the AI service, so the key has to be on
the device. In Proxy mode the browser calls `/ai-proxy/` on the app's own
address, and a small server adds the key and forwards the request.

Enable it:

```ini
# .env
UPSTREAM_BASE_URL=https://api.openai.com/v1
UPSTREAM_API_KEY=sk-...your key...
ALLOWED_MODELS=gpt-4o-mini,omni-moderation-latest
RATE_LIMIT_PER_MINUTE=60
```

```bash
docker compose --profile proxy up -d --build
# with HTTPS as well:
docker compose --profile proxy --profile https up -d --build
```

Then, on each device, open the parent area, go to the AI settings, choose
**Proxy** and keep the suggested base URL `/ai-proxy/v1`. No key is entered on
the device. Use the connection test there to check it.

What the proxy does and does not do:

- It forwards exactly three kinds of requests: chat completions, moderation
  checks and image generation. Everything else is refused.
- It adds the key on the server and discards any `Authorization` header,
  cookies and other browser headers before forwarding.
- It refuses requests from other websites, bodies over 256 KB, models that are
  not in `ALLOWED_MODELS` (when set), and more than `RATE_LIMIT_PER_MINUTE`
  requests per device per minute.
- It is not published on a host port. Only the web container can reach it.
- It logs one line per request: time, method, path, status, duration. Never the
  prompt, the answer or the key.
- It has **no login**. Anyone who can open the app can use it, within the rate
  limit. The app's own daily and monthly request budgets are enforced in the
  browser, so they do not protect a shared proxy. Set a spending limit with
  your AI provider.

`ALLOWED_MODELS` must list every model the app is set to use: the chat model,
the image model if you enabled AI pictures, and the provider's moderation
model if it requires one to be named.

The rate limit counts each device separately, with or without Caddy: nginx in
the web container works out the device's address and passes that one value to
the proxy. Leave `TRUSTED_PROXY_HOPS` at `1`. (Caddy talks to the web container
on port 8081, which is not published; there nginx takes the address Caddy
reports. On the published port 8080 nginx ignores any `X-Forwarded-For` a
client sends, so a made-up address cannot be used to get around the limit.)

If you put your own reverse proxy in front of port 8080 instead of using the
`https` profile, every device behind it counts as one address. Raise
`RATE_LIMIT_PER_MINUTE` to fit, and do not raise `TRUSTED_PROXY_HOPS`: with a
higher number the proxy would believe an address the device can write itself.

## 6. Local models: Ollama and LM Studio

Any server that speaks the OpenAI chat completions format works. The model has
to be able to return JSON reliably; small models often struggle with that, and
the app then falls back to its built-in challenges.

### Give the model room: context length and time

A challenge request is long (the rules, the child's level, the JSON format),
and the answer is a JSON object of several hundred words. Two defaults of
local servers get in the way:

- **Context length.** Ollama cuts every request to its default context
  (4096 tokens in many versions) without an error, so the model never sees the
  end of the instructions and answers with something else. Start it with at
  least 8192: `OLLAMA_CONTEXT_LENGTH=8192 ollama serve` (or set the variable
  for the service or the app, as with `OLLAMA_ORIGINS` below). In LM Studio set
  "Context Length" to 8192 or more when you load the model.
- **Time.** On a computer without a fast graphics card a challenge takes 20 to
  90 seconds, and the first request also loads the model. The app waits up to
  180 seconds for a model on this computer (direct mode) and 90 seconds through
  the proxy (the proxy's own limit); for a service on the internet it is 45
  seconds. A child never waits that long: after 8 seconds a built-in challenge
  is shown and the AI challenge is kept for later.

For a local address the app asks for a simpler picture (fewer objects, no
drawings), which shortens the answer. When the model still cannot do it, the
parent area shows why under **Settings > AI > Last AI results** (for example
"the answer was cut off" or "not valid JSON"), and after three failed
challenges in a row the app stops asking for 10 minutes instead of using up the
request budget.

### Recommended: through the AI proxy

This works from every device, over HTTPS, with no browser restrictions,
because the browser only ever talks to the app's own address.

```ini
# .env: Ollama on the Docker host
UPSTREAM_BASE_URL=http://host.docker.internal:11434/v1
UPSTREAM_API_KEY=
ALLOWED_MODELS=
```

```ini
# .env: LM Studio on the Docker host
UPSTREAM_BASE_URL=http://host.docker.internal:1234/v1
UPSTREAM_API_KEY=
```

```bash
docker compose --profile proxy up -d --build
```

In the app choose **Proxy** and enter the model's name as the chat model, for
example `llama3.1`. Notes:

- The model server must listen on an address the container can reach. For
  Ollama on Linux set `OLLAMA_HOST=0.0.0.0` before starting it. In LM Studio
  switch on "Serve on local network".
- A model server on another machine works too:
  `UPSTREAM_BASE_URL=http://192.168.1.60:11434/v1`.
- `OLLAMA_ORIGINS` is **not** needed on this route, because the request comes
  from the proxy and not from a browser.

### Direct from the browser

Use this only when the browser and the model run on the **same computer**. In
the app choose **Direct**, set the base URL to `http://localhost:11434/v1`
(Ollama) or `http://localhost:1234/v1` (LM Studio), and enter any text as the
key.

A browser will only let a web page call another server if that server says the
page's address is welcome. For Ollama, list the app's address in
`OLLAMA_ORIGINS` and restart Ollama:

```bash
# the address you open the app at, exactly as shown in the address bar
OLLAMA_ORIGINS=http://localhost:8080 ollama serve
# several addresses
OLLAMA_ORIGINS=http://localhost:8080,https://192.168.1.50 ollama serve
```

On macOS with the Ollama app: `launchctl setenv OLLAMA_ORIGINS "http://localhost:8080"`
and restart the app. On Windows set it as a user environment variable. In LM
Studio switch on "Enable CORS" in the local server settings.

Limits of this route:

- The app's security policy only allows plain `http://` connections to
  `localhost` and `127.0.0.1`. A model server elsewhere on the network
  (`http://192.168.1.60:11434`) is blocked, and a browser would block it anyway
  when the app is served over HTTPS. Use the proxy for that.
- Some browsers (Safari) refuse `http://localhost` from an HTTPS page.

## 7. Updating

```bash
git pull
docker compose up -d --build        # add the same --profile flags you normally use
docker image prune -f               # optional: remove old images
```

- Learning data is stored in each device's browser, not in a container.
  Updating, restarting or deleting containers does not touch it.
- Installed devices pick up the new version by themselves the next time the
  app is opened with a connection to the server. It can take one extra reload.
- Before a big update, export a backup from the parent area on each device.
- Each device and browser has its own data. To move a child to another device,
  export a backup on the old one and import it on the new one.
- Clearing "site data" or "browsing data" for the app's address on a device
  deletes that device's learning data. Export backups regularly.

## 8. What the containers do and log

| Service | Image | Runs as | Notes |
| --- | --- | --- | --- |
| `web` | nginx (unprivileged) | uid 101 | Read-only filesystem, no Linux capabilities, health check on `/healthz` |
| `ai-proxy` | Node 22 | uid 1000 | Read-only filesystem, no capabilities, no dependencies, not published |
| `caddy` | Caddy 2 | root inside the container | Read-only filesystem, only the capability to bind ports 80 and 443 |

The web server sends a strict Content-Security-Policy: scripts, styles, fonts
and images load from the app's own address only, the page cannot be framed, and
network connections are limited to the app's address, `https://` endpoints and
`http://localhost`.

Logs:

- `web`: time, method, path, status, size, duration. No device address, no
  query string, no referrer, no browser name. Error lines written by nginx
  itself (for example when the AI proxy is not running) do include the device
  address and request line.
- `ai-proxy`: time, method, path, status, duration.
- `caddy`: its own start-up and certificate messages. Request logging is off.

## 9. Troubleshooting

**Setup stops at the password step, or the browser says the page is "Not
secure".** The page is not served over HTTPS. See section 2.

**The browser warns about the certificate.** The device does not trust Caddy's
authority yet (section 3), or it trusted an older one because the `caddy_data`
volume was recreated.

**The app says the AI proxy is not running (HTTP 503 "proxy_unavailable").**
The `proxy` profile is not started. Run `docker compose --profile proxy up -d`.

**HTTP 503 "proxy_not_configured".** `UPSTREAM_BASE_URL` is empty or is not a
plain `http://` or `https://` URL.

**HTTP 502 "upstream_auth_error".** The AI service rejected `UPSTREAM_API_KEY`.

**HTTP 502 "upstream_error" with a local model.** The proxy container cannot
reach the model server. Check that it listens on all interfaces, not only on
`127.0.0.1` (section 6).

**HTTP 400 "This model is not allowed by the proxy".** Add the model to
`ALLOWED_MODELS`, or empty the list.

**HTTP 403 "Cross-origin requests are not allowed".** A reverse proxy in front
changed the `Host` header. Make it pass the header through, or list the
address people type in `ALLOWED_ORIGINS` (for example `https://learn.example.com`).

**HTTP 429 from the proxy.** More than `RATE_LIMIT_PER_MINUTE` requests came
from one address. If every device is limited together, they reach the app
through a reverse proxy of your own (section 5): raise `RATE_LIMIT_PER_MINUTE`.

**Direct mode with Ollama fails with a network or CORS error.** Set
`OLLAMA_ORIGINS` to the app's exact address (section 6), or use the proxy.

**After an update a device still shows the old version.** Close every tab of
the app and open it again while connected to the server.
