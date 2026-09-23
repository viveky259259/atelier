import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Session, Stage } from "./types.js";

export class UnknownSessionError extends Error {
  constructor(id: string) {
    super(`No session ${id}`);
    this.name = "UnknownSessionError";
  }
}

interface Row {
  id: string;
  paper_file_id: string;
  stage: string;
  brief: string;
  created_at: string;
  updated_at: string;
}

const toSession = (r: Row): Session => ({
  id: r.id,
  paperFileId: r.paper_file_id,
  stage: r.stage as Stage,
  brief: r.brief,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class SessionStore {
  #db: DatabaseSync;

  constructor(dbPath: string) {
    this.#db = new DatabaseSync(dbPath);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id            TEXT PRIMARY KEY,
        paper_file_id TEXT NOT NULL,
        stage         TEXT NOT NULL,
        brief         TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_file ON sessions(paper_file_id);
    `);
  }

  create(input: { paperFileId: string; brief: string }): Session {
    const now = new Date().toISOString();
    const row: Row = {
      id: randomUUID(),
      paper_file_id: input.paperFileId,
      stage: "DISCOVERY",
      brief: input.brief,
      created_at: now,
      updated_at: now,
    };
    this.#db
      .prepare(
        `INSERT INTO sessions (id, paper_file_id, stage, brief, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.paper_file_id, row.stage, row.brief, row.created_at, row.updated_at);
    return toSession(row);
  }

  get(id: string): Session | undefined {
    const r = this.#db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Row | undefined;
    return r ? toSession(r) : undefined;
  }

  getByFileId(fileId: string): Session | undefined {
    const r = this.#db
      .prepare(`SELECT * FROM sessions WHERE paper_file_id = ? ORDER BY updated_at DESC LIMIT 1`)
      .get(fileId) as Row | undefined;
    return r ? toSession(r) : undefined;
  }

  setStage(id: string, stage: Stage): Session {
    const now = new Date().toISOString();
    const res = this.#db
      .prepare(`UPDATE sessions SET stage = ?, updated_at = ? WHERE id = ?`)
      .run(stage, now, id);
    if (res.changes === 0) throw new UnknownSessionError(id);
    const found = this.get(id);
    if (found === undefined) throw new UnknownSessionError(id);
    return found;
  }

  close(): void {
    this.#db.close();
  }
}
