-- Extra database for mailbox-api / mailbox-worker (same Postgres instance).
-- Runs only on fresh volumes via /docker-entrypoint-initdb.d.
CREATE DATABASE mailbox;
