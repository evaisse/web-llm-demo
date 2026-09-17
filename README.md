# WebLLM Workbench

An install-first, local browser AI workbench built around [WebLLM](https://github.com/mlc-ai/web-llm). The page can download a local model and separately load a JavaScript compiler and SQLite WASM database before the model is allowed to use them.

## Run locally

This is a static vanilla ESM app. It has no build step and no runtime npm dependency.

```bash
make
```

Open <http://localhost:8080> in a Chromium browser with a working WebGPU adapter. Use `make serve PORT=9000` to select another port. Opening `index.html` directly with `file://` is not supported because browser modules and WASM require an HTTP origin.

The source is plain JavaScript modules under `src/*.mjs`. Third-party runtimes are fetched from pinned npm-compatible ESM CDN URLs only after their install action is confirmed:

- WebLLM 0.2.85 from esm.run.
- esbuild-wasm 0.28.2 and its WASM binary from jsDelivr.
- SQLite WASM 3.53.4-build1 and its WASM binary from jsDelivr.

The model download is cached by WebLLM in the browser. Tool runtimes are loaded only after their install action is confirmed.

### Proxy or redirecting downloads

Hugging Face model files may first respond with a signed `307 Location` redirect. A browser cannot force a corporate proxy to follow that redirect, so configure a model relay that returns the model files directly and append its origin to the page URL:

```text
https://evaisse.github.io/web-llm-demo/?model-source=https%3A%2F%2Fmodels.example.internal
```

The relay must expose the same repository paths below its origin, for example `/mlc-ai/Hermes-3-Llama-3.1-8B-q4f16_1-MLC`, support CORS for the workbench origin, and avoid redirects for model files. Without `model-source`, the app keeps using the official Hugging Face URLs.

## Deploy on GitHub Pages

The repository is deployed as-is to GitHub Pages. There is no build step: the workflow publishes the repository root and runs automatically after each push to `main`.

1. Open **Settings > Pages** on GitHub.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Push to `main`, or start **Deploy static site to GitHub Pages** manually from the **Actions** tab.

The site will be available at `https://evaisse.github.io/web-llm-demo/`. The model and WASM runtimes are downloaded by each user's browser from the pinned CDN URLs.

## Included tools

- **Compiler** — esbuild WASM compiles a TypeScript or JavaScript snippet in-browser.
- **SQLite** — the official SQLite WASM package runs queries against a local in-memory database and can export the database file.

The chat protocol uses WebLLM's OpenAI-compatible `tools` flow when available, keeps a valid structural-tag response format and manual `<tool_call>` parser as compatibility fallbacks, and bounds each user turn to three rounds and six total tool calls. The **Try a sample run** action demonstrates the complete tool trace without requiring a model download.
