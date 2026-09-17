const SQLITE_MODULE_URL = "https://cdn.jsdelivr.net/npm/@sqlite.org/sqlite-wasm@3.53.4-build1/dist/index.mjs";
let sqlite = null;
let database = null;
let initializing = null;
const seedSql = `
  CREATE TABLE IF NOT EXISTS snippets (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    language TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;
function isSQLiteReady() {
  return database !== null;
}
async function installSQLite(onProgress) {
  if (database) {
    onProgress(1, "SQLite ready");
    return;
  }
  if (!initializing) {
    initializing = (async () => {
      onProgress(0.2, "Loading SQLite WASM");
      const module = await import(SQLITE_MODULE_URL);
      sqlite = await module.default({
        print: () => void 0,
        printErr: () => void 0
      });
      onProgress(0.72, "Opening in-memory database");
      database = new sqlite.oo1.DB(":memory:", "c");
      database.exec(seedSql);
      onProgress(1, "SQLite ready");
    })();
  }
  try {
    await initializing;
  } finally {
    initializing = null;
  }
}
async function querySQLite(sql) {
  if (!database) {
    throw new Error("Install SQLite before running this tool.");
  }
  const rows = [];
  database.exec({ sql, rowMode: "object", resultRows: rows });
  return { sql, rows: rows.slice(0, 40), count: rows.length };
}
function exportSQLite() {
  if (!database?.export) {
    throw new Error("SQLite export is not available in this browser.");
  }
  return database.export();
}
export {
  exportSQLite,
  installSQLite,
  isSQLiteReady,
  querySQLite
};

