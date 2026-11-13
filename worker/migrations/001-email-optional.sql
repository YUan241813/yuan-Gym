-- yuan-Gym — migration: email becomes optional.
--
-- Signing up used to need an address plus a code mailed to it. The code needed a mail provider,
-- so the whole email step is gone: an account is a name and a password. The columns stay (a client
-- may still send one as a label) but they must accept NULL, and several rows without an address.
--
-- SQLite cannot drop NOT NULL in place, so the table is rebuilt. `users` is the only table with a
-- foreign-key-like relationship and none are declared, so nothing else needs touching.
--
--   wrangler d1 execute yuangym --remote --file=migrations/001-email-optional.sql

CREATE TABLE users_new (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  name_lower    TEXT NOT NULL UNIQUE,
  email         TEXT,
  email_lower   TEXT UNIQUE,
  verifier      TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  logins        INTEGER NOT NULL DEFAULT 0,
  ip            TEXT,
  ua            TEXT
);

INSERT INTO users_new (id, name, name_lower, email, email_lower, verifier, created_at, last_login_at, logins, ip, ua)
SELECT id, name, name_lower, NULLIF(email, ''), NULLIF(email_lower, ''), verifier, created_at, last_login_at, logins, ip, ua
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
