# Security

- Keep `.env`, tokens, database dumps, logs and real screenshots out of Git.
- Use a dedicated bot and a read-only metrics endpoint. The bot never needs your
  application database credentials or the ability to charge money.
- Approving a viewer grants access to **all report fields**, including balances.
  This is not per-customer row-level isolation. Use separate deployments/endpoints
  for different customers or add a carefully reviewed tenancy layer.
- Telegram IDs and display names are personal data. Access records are persisted
  in Redis; define retention and backup policies for your deployment.
- Reports are plain text, with no adapter-provided HTML or arbitrary callback URLs.
  Endpoint redirects are disabled. Dashboard URLs must not contain access tokens.
- Redis must remain private. Compose exposes no Redis or health ports by default.
  In a multi-tenant infrastructure add Redis authentication/network isolation.
- Optional Telegram IPv4 routing preserves the official host, SNI and certificate
  verification. Do not disable TLS validation or route tokens through a proxy.
- Do not paste security vulnerabilities or credentials into public issues. Use
  the repository's private vulnerability reporting if enabled. Otherwise contact
  the maintainer privately without sending secrets.

If a credential was committed, rotate it immediately; deleting the file does not
erase Git history. Do not use real accounts in tests or examples.
