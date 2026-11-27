/** SQL migrations of the mail store, applied in order by PRAGMA user_version. Migration n is MIGRATIONS[n - 1]. */

const V1 = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE threads (
  id            TEXT PRIMARY KEY,
  subject       TEXT NOT NULL DEFAULT '',
  claude_session_id TEXT,
  summary       TEXT NOT NULL DEFAULT '',
  project_cwd   TEXT,
  state         TEXT NOT NULL DEFAULT 'open',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE mails (
  id            INTEGER PRIMARY KEY,
  entry_id      TEXT NOT NULL UNIQUE,
  store_id      TEXT NOT NULL DEFAULT '',
  internet_id   TEXT NOT NULL DEFAULT '',
  thread_id     TEXT NOT NULL REFERENCES threads(id),
  direction     TEXT NOT NULL,
  message_class TEXT NOT NULL DEFAULT 'IPM.Note',
  from_name TEXT NOT NULL DEFAULT '', from_addr TEXT NOT NULL DEFAULT '',
  to_json TEXT NOT NULL DEFAULT '[]', cc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  at            TEXT NOT NULL,
  body_text     TEXT,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  headers_json  TEXT NOT NULL DEFAULT '{}',
  category      TEXT,
  triage_source TEXT,
  summary TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', suggested_action TEXT NOT NULL DEFAULT '',
  needs_action  INTEGER NOT NULL DEFAULT 0,
  phishing      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'new',
  handled       TEXT,
  handled_at    TEXT,
  authorship    TEXT,
  send_token    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX mails_thread ON mails(thread_id, at);
CREATE INDEX mails_open   ON mails(status, category);
CREATE INDEX mails_from   ON mails(from_addr);

CREATE TABLE drafts (
  id INTEGER PRIMARY KEY,
  mail_id   INTEGER NOT NULL REFERENCES mails(id),
  thread_id TEXT NOT NULL REFERENCES threads(id),
  version   INTEGER NOT NULL,
  reply_all INTEGER NOT NULL DEFAULT 0,
  body      TEXT NOT NULL DEFAULT '',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  comment   TEXT NOT NULL DEFAULT '',
  status    TEXT NOT NULL,
  error     TEXT NOT NULL DEFAULT '',
  final_body TEXT,
  send_token TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX drafts_mail ON drafts(mail_id, version);
CREATE INDEX drafts_token ON drafts(send_token);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  thread_id TEXT REFERENCES threads(id),
  mail_id   INTEGER REFERENCES mails(id),
  at        TEXT NOT NULL,
  kind      TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX events_thread ON events(thread_id, at);

CREATE TABLE learning (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  mail_id INTEGER REFERENCES mails(id),
  from_addr TEXT NOT NULL, from_domain TEXT NOT NULL,
  category TEXT,
  suggested_action TEXT NOT NULL DEFAULT '',
  choice TEXT NOT NULL,
  edit_json TEXT
);
CREATE INDEX learning_from ON learning(from_addr);
CREATE INDEX learning_domain ON learning(from_domain);

CREATE TABLE rules (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  pattern TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (kind, pattern)
);

CREATE VIRTUAL TABLE mail_fts USING fts5(subject, body_text, from_name, from_addr, content='mails', content_rowid='id');

CREATE TRIGGER mails_ai AFTER INSERT ON mails BEGIN
  INSERT INTO mail_fts(rowid, subject, body_text, from_name, from_addr)
  VALUES (new.id, new.subject, new.body_text, new.from_name, new.from_addr);
END;
CREATE TRIGGER mails_ad AFTER DELETE ON mails BEGIN
  INSERT INTO mail_fts(mail_fts, rowid, subject, body_text, from_name, from_addr)
  VALUES ('delete', old.id, old.subject, old.body_text, old.from_name, old.from_addr);
END;
CREATE TRIGGER mails_au AFTER UPDATE OF subject, body_text, from_name, from_addr ON mails BEGIN
  INSERT INTO mail_fts(mail_fts, rowid, subject, body_text, from_name, from_addr)
  VALUES ('delete', old.id, old.subject, old.body_text, old.from_name, old.from_addr);
  INSERT INTO mail_fts(rowid, subject, body_text, from_name, from_addr)
  VALUES (new.id, new.subject, new.body_text, new.from_name, new.from_addr);
END;
`;

export const MIGRATIONS: readonly string[] = [V1];
