import { compileCode, installCompiler, isCompilerReady } from "./compiler.mjs";
import { exportSQLite, installSQLite, isSQLiteReady, querySQLite } from "./sqlite.mjs";
const toolDescriptors = [
  {
    id: "compiler",
    name: "Compiler",
    kicker: "ESBUILD / WASM",
    description: "Compile TypeScript and JavaScript locally, with no source leaving the page.",
    size: "13.3 MB",
    version: "v0.28.2",
    capability: "Transpile TS \u2192 browser-ready ESM",
    inputHint: "code: the TypeScript or JavaScript source to compile"
  },
  {
    id: "sqlite",
    name: "SQLite",
    kicker: "SQLITE / WASM",
    description: "Query a local in-memory database from the model and inspect the returned rows.",
    size: "1.1 MB",
    version: "v3.53.4",
    capability: "Run SQL \u2192 JSON rows",
    inputHint: "sql: a read or write SQL statement"
  }
];
function isToolReady(id) {
  return id === "compiler" ? isCompilerReady() : isSQLiteReady();
}
async function installTool(id, onProgress) {
  if (id === "compiler") {
    await installCompiler(onProgress);
  } else {
    await installSQLite(onProgress);
  }
}
async function runTool(id, args) {
  if (id === "compiler") {
    const code = typeof args.code === "string" ? args.code : "";
    if (!code.trim()) {
      throw new Error("The compiler needs a non-empty code argument.");
    }
    return compileCode(code);
  }
  const sql = typeof args.sql === "string" ? args.sql : "SELECT * FROM snippets;";
  if (sql.trim().toLowerCase().startsWith("export")) {
    const bytes = exportSQLite();
    return { exported: true, bytes: bytes.byteLength, message: "SQLite database is ready to download." };
  }
  return querySQLite(sql);
}
const sampleInputs = {
  compiler: {
    code: `type Signal = { label: string; value: number };

const signals: Signal[] = [
  { label: "local", value: 100 },
  { label: "private", value: 96 },
];

export const summary = signals.map(({ label, value }) => ({ label, value }));`
  },
  sqlite: {
    sql: `INSERT INTO snippets (title, language, source, created_at)
VALUES ('hello wasm', 'typescript', 'const local = true', datetime('now'));

SELECT id, title, language, created_at FROM snippets ORDER BY id DESC LIMIT 3;`
  }
};
export {
  installTool,
  isToolReady,
  runTool,
  sampleInputs,
  toolDescriptors
};

