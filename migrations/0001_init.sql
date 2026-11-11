CREATE TABLE tapes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slots INTEGER NOT NULL,
  key_hash TEXT NOT NULL,
  deadline INTEGER,
  opened_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tape_id TEXT NOT NULL REFERENCES tapes(id),
  token_hash TEXT NOT NULL,
  nick TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  art TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (tape_id, token_hash)
);

CREATE INDEX tracks_tape ON tracks (tape_id, id);
