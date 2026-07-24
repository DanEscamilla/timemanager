# mailbox-worker

Polls enabled mailboxes, applies domain filters, runs `mailbox_kit` extractors, and writes messages / extraction artifacts into the `mailbox` database.

```bash
nx serve mailbox-worker   # depends on mailbox-api:migrate
```

Uses the same env as [`mailbox-api`](../mailbox-api) (`PGDATABASE=mailbox`). Set `POLL_INTERVAL_MS` (default `300000`).
