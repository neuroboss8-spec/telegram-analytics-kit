# Contributing

Use Node.js24+ and synthetic data only. Run `npm ci --ignore-scripts`,
`npm run check`, `npm test` and `npm run smoke`. For integration tests use a
separate Redis and run `npm run integration`.

Keep report definitions and the JSON contract explicit. A missing balance is not
zero. Preserve owner-only access management, revocation checks, private-chat
binding and persistent notification claims.

Do not include customer names, domains, IDs, tokens, logs or production exports in
examples, tests, issues or screenshots. Changes are contributed under MIT.
