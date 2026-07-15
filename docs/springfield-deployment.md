# Deployment: local single-operator trust profile (Phase 2)

This document covers how Algerknown binds its network listeners by default,
how to turn on the governance auth trust profile, and the honest limits of
what Phase 2 protects. It applies whether you're running directly with
`node`/`agn web`, with the `rag-backend` Docker Compose setup, or on a
homelab machine like Springfield's `willie`.

## Loopback by default

Both the Node web server and the Python RAG backend bind to `127.0.0.1`
unless explicitly told otherwise:

| Service | Env var | Default |
|---|---|---|
| Web server (`packages/web`) | `WEB_HOST` | `127.0.0.1` |
| RAG backend (`rag-backend`) | `RAG_HOST` | `127.0.0.1` |

This is true in code, in `.env.example`, and in both Dockerfiles (`ENV
WEB_HOST=127.0.0.1` / `ENV RAG_HOST=127.0.0.1`). Starting either service
with no configuration never makes it reachable from anywhere but the same
machine.

Docker is a special case: a container process bound to its own `127.0.0.1`
is unreachable through Docker's published-port NAT, even from the host. The
`rag-backend/docker-compose.yml` override therefore sets `RAG_HOST=0.0.0.0`
*inside* the container so the published port works at all, and instead
enforces the loopback boundary on the **host** side of the port mapping:

```yaml
ports:
  - "127.0.0.1:4735:4735"   # never an unqualified "4735:4735"
```

The same pattern applies if you write a Compose file or `docker run`
invocation for `Dockerfile.web`: override `WEB_HOST=0.0.0.0` for the
container's internal bind, and always publish as `127.0.0.1:2393:2393`.

### Reaching a loopback-bound service from another machine

If you need to use the web UI from a laptop while the app runs on a
homelab box (e.g. `willie`), don't change the bind - use an SSH tunnel over
Tailscale instead, so the browser still talks to its own `127.0.0.1` and
every same-origin/CSRF check in this document stays intact:

```bash
ssh -L 2393:127.0.0.1:2393 willie
# then open http://127.0.0.1:2393 locally
```

## Enabling governance auth

Governance auth is opt-in: leave `GOVERNANCE_REVIEWER_ID` /
`GOVERNANCE_REVIEWER_DISPLAY_NAME` / `GOVERNANCE_REVIEWER_SECRET` /
`GOVERNANCE_PROCESSOR_ID` / `GOVERNANCE_PROCESSOR_SECRET` all unset and the
app behaves exactly as it did before Phase 2, with no lock screen and no
`/api/governance/*` routes mounted.

To enable it, set all five together (partial configuration fails startup
closed, on purpose):

```bash
GOVERNANCE_REVIEWER_ID=steve
GOVERNANCE_REVIEWER_DISPLAY_NAME="Steve"
GOVERNANCE_REVIEWER_SECRET=$(openssl rand -hex 32)
GOVERNANCE_PROCESSOR_ID=rag-processor
GOVERNANCE_PROCESSOR_SECRET=$(openssl rand -hex 32)
GOVERNANCE_PUBLIC_ORIGIN=http://127.0.0.1:2393
```

Both secrets must be at least 32 bytes; `openssl rand -hex 32` produces 64
hex characters (32 bytes) and is a reasonable default generator.

For the CLI, don't put the reviewer secret in a dotfile. Either export
`ALGERKNOWN_REVIEWER_SECRET` for automation, or store it in your OS
keychain once:

```bash
GOVERNANCE_REVIEWER_ID=steve agn auth store-reviewer-secret
agn auth status
```

## Non-loopback (private network) deployment

Phase 2 permits binding somewhere other than loopback only when all of the
following hold - anything less is refused at startup:

- `GOVERNANCE_PRIVATE_DEPLOYMENT=true`
- `GOVERNANCE_PUBLIC_ORIGIN` is a single explicit **HTTPS** origin (no
  wildcard, no comma-separated list)
- `GOVERNANCE_TRUSTED_PROXY_HOSTS` lists the exact proxy address(es)
  allowed to set `X-Forwarded-Host`
- You provide your own TLS termination and private-network access control
  in front of the app; this profile does not add either

Springfield's own convention is direct Tailscale-hostname port access with
no reverse proxy (see the Springfield repo's machine READMEs) - that
convention does not satisfy the HTTPS requirement above. Until TLS
termination is deliberately added (Caddy, nginx, or Tailscale Serve), use
the SSH tunnel approach above instead of setting
`GOVERNANCE_PRIVATE_DEPLOYMENT=true`.

## The legacy `/approve` route (retired)

`rag-backend`'s `POST /approve` and `POST /preview` — and the direct YAML
writer (`writer.apply_update`) behind them — have been **retired**. Both
routes now return `410 Gone`, `writer.py` no longer holds any write path, and
`packages/web/tests/governance/write-site-audit.test.ts` statically enforces
that no ungoverned write site reappears. All mutations flow through governed
review actions; there is no direct-write path left to limit by loopback
binding. This closes the Phase 2 gap this section previously tracked.

## Threat model

**In scope for Phase 2:**
- A browser session hijacked via cross-site request (CSRF) or DNS
  rebinding against the same-origin trust boundary
- Casual/automatic exposure from a default bind or wildcard CORS
- A processor credential being used to forge reviewer authority, or vice
  versa
- Online guessing of the reviewer secret

**Explicitly out of scope for Phase 2:**
- Malicious processes running as the same OS user as the server
- Anyone or anything holding the reviewer credential itself
- Host compromise
- Browser XSS
- A compromised private reverse proxy sitting in front of a non-loopback
  deployment

**Explicitly deferred, not implemented:**
- Passkeys or other credential-rotation workflows
- Audit log signing
- Multi-user accounts, roles, or permissions beyond the single reviewer/
  processor pair
- Remote public deployment
- Distributed session revocation (a restart invalidates all sessions; there
  is no cross-instance signal)

Nothing above should be read as a claim that Phase 2 defends against it.
