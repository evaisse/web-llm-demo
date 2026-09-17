const ESBUILD_MODULE_URL = "https://cdn.jsdelivr.net/npm/esbuild-wasm@0.28.2/esm/browser.js";
const ESBUILD_WASM_URL = "https://cdn.jsdelivr.net/npm/esbuild-wasm@0.28.2/esbuild.wasm";
let compiler = null;
let initializing = null;
function isCompilerReady() {
  return compiler !== null;
}
async function installCompiler(onProgress) {
  if (compiler) {
    onProgress(1, "Compiler ready");
    return;
  }
  if (!initializing) {
    initializing = (async () => {
      onProgress(0.22, "Loading esbuild WASM");
      const module = await import(ESBUILD_MODULE_URL);
      await module.initialize({ wasmURL: ESBUILD_WASM_URL, worker: true });
      compiler = module;
      onProgress(1, "Compiler ready");
    })();
  }
  try {
    await initializing;
  } finally {
    initializing = null;
  }
}
async function compileCode(code) {
  if (!compiler) {
    throw new Error("Install the compiler before running this tool.");
  }
  const result = await compiler.build({
    bundle: false,
    format: "esm",
    logLevel: "silent",
    minify: false,
    platform: "browser",
    target: "es2020",
    write: false,
    stdin: {
      contents: code,
      loader: "ts",
      resolveDir: "/",
      sourcefile: "workbench-snippet.ts"
    }
  });
  const output = result.outputFiles?.[0]?.text ?? "";
  return { output, bytes: new TextEncoder().encode(output).byteLength, language: "TypeScript" };
}
export {
  compileCode,
  installCompiler,
  isCompilerReady
};
