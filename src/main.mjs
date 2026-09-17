import { DEFAULT_MODEL, askModel, installModel, isModelReady, modelCatalog, parseToolCall, stripToolCall, systemPrompt } from "./lib/model.mjs";
import { installTool, isToolReady, runTool, sampleInputs, toolDescriptors } from "./lib/tools.mjs";
const app = document.querySelector("#app");
if (!app) {
  throw new Error("App root is missing.");
}
const storageKey = "workbench-install-state";
const persisted = readPersistedState();
const state = {
  model: {
    selected: persisted.model ?? DEFAULT_MODEL,
    status: "available",
    cached: Boolean(persisted.model),
    progress: 0,
    progressText: persisted.model ? "Cached locally \xB7 needs a runtime load" : "Not downloaded"
  },
  tools: {
    compiler: createToolState(persisted.tools.compiler),
    sqlite: createToolState(persisted.tools.sqlite)
  },
  messages: [],
  modelMessages: [{ role: "system", content: systemPrompt }],
  toolRuns: [],
  busy: false,
  notice: "Everything runs in this tab. Nothing is sent to a server."
};
let webGPUState = "checking";
app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="./">Workbench</a><span aria-hidden="true">/</span><span>Conversation</span><span aria-hidden="true">/</span><span>Tools</span>
      </nav>
    </header>

    <main class="app-grid">
      <aside class="intro-panel">
        <section id="model-card" class="model-card" aria-label="Local model installer"></section>
      </aside>

      <section id="chat-column" class="chat-column" aria-label="Chat workspace">
        <div class="workspace-head">
          <div id="readiness-chip" class="readiness-chip" role="status" aria-live="polite"></div>
        </div>
        <div id="readiness-banner" class="readiness-banner"></div>
        <section class="chat-panel">
          <div class="chat-toolbar"><button class="icon-button" data-action="reset" title="Reset the chat" aria-label="Reset the chat">\u21BA</button><span id="chat-context" class="toolbar-context"></span><button class="text-button" data-action="sample">TRY A SAMPLE RUN <span>\u2197</span></button></div>
          <div id="messages" class="messages" aria-live="polite" aria-label="Conversation messages"></div>
          <form id="chat-form" class="composer">
            <label class="sr-only" for="prompt-input">Message the local assistant</label>
            <textarea id="prompt-input" rows="2" placeholder="Install the model and tools to start a local session\u2026" disabled></textarea>
            <div class="composer-foot"><span class="composer-hint">SHIFT + ENTER for a new line</span><button id="send-button" class="send-button" type="submit" disabled>SEND <span>\u2197</span></button></div>
          </form>
        </section>
      </section>

      <aside id="tool-column" class="tool-column" aria-label="Local toolbox">
        <div id="tool-list" class="tool-list"></div>
        <section class="trace-panel" aria-label="Tool activity trace">
          <div class="trace-head"><button class="icon-button small" data-action="copy-trace" title="Copy trace JSON" aria-label="Copy trace JSON">\u25A3</button></div>
          <div id="trace-list" class="trace-list"></div>
        </section>
      </aside>
    </main>

    <footer class="statusbar"><span id="footer-notice" role="status" aria-live="polite"></span></footer>
  </div>
`;
const messagesElement = getElement("messages");
const toolListElement = getElement("tool-list");
const traceListElement = getElement("trace-list");
const form = getElement("chat-form");
const promptInput = getElement("prompt-input");
const sendButton = getElement("send-button");
const modelCardElement = getElement("model-card");
render();
void refreshWebGPUPreflight();
form.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMessage();
});
promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendMessage();
  }
});
app.addEventListener("click", (event) => {
  const target = event.target;
  const button = target.closest("[data-action]");
  if (!button) {
    return;
  }
  const action = button.dataset.action;
  if (action === "install-model") {
    void handleModelInstall();
  } else if (action === "install-tool" && button.dataset.tool) {
    void handleToolInstall(button.dataset.tool);
  } else if (action === "test-tool" && button.dataset.tool) {
    void handleToolTest(button.dataset.tool);
  } else if (action === "sample") {
    void runSample();
  } else if (action === "reset") {
    resetSession();
  } else if (action === "copy-trace") {
    void copyTrace(button);
  }
});
app.addEventListener("change", (event) => {
  const target = event.target;
  if (target.id !== "model-select" || state.model.status === "installing" || state.model.status === "ready") {
    return;
  }
  state.model.selected = target.value;
  state.model.status = "available";
  state.model.error = void 0;
  state.model.cached = false;
  state.model.progress = 0;
  state.model.progressText = "Not downloaded";
  render();
});
function createToolState(cached) {
  return {
    status: "available",
    cached,
    progress: { value: 0, label: cached ? "Cached locally \xB7 needs a runtime load" : "Not downloaded" }
  };
}
async function handleModelInstall() {
  if (state.model.status === "installing" || state.busy) {
    return;
  }
  const selectedModel = modelCatalog.find((item) => item.id === state.model.selected) ?? modelCatalog[0];
  if (!selectedModel.supportsTools) {
    state.model.status = "error";
    state.model.error = "This profile is not a supported WebLLM function-calling model. Select Hermes 3 for this workbench.";
    state.notice = "Select a model with official tool-calling support.";
    render();
    return;
  }
  const adapter = await requestWebGPUAdapter();
  if (!adapter) {
    state.model.status = "error";
    state.model.error = "WebGPU is unavailable in this browser. Use a Chromium browser with WebGPU enabled before downloading a model.";
    state.notice = "Model download blocked by the WebGPU preflight.";
    render();
    return;
  }
  state.model.status = "installing";
  state.model.error = void 0;
  state.notice = "Downloading and initializing the selected model\u2026";
  render();
  try {
    await installModel(state.model.selected, (progress) => {
      state.model.progress = progress.progress;
      state.model.progressText = progress.text;
      render();
    });
    state.model.status = "ready";
    state.model.cached = true;
    state.notice = "Model ready. Install both tools to unlock chat.";
    persistState();
  } catch (error) {
    state.model.status = "error";
    state.model.error = getErrorMessage(error);
    state.notice = "The model could not be initialized. Check WebGPU and retry.";
  }
  render();
}
async function handleToolInstall(id) {
  const tool = state.tools[id];
  if (tool.status === "installing" || state.busy) {
    return;
  }
  tool.status = "installing";
  tool.error = void 0;
  state.notice = `Loading the ${id} runtime\u2026`;
  render();
  try {
    await installTool(id, (progress, label) => {
      tool.progress = { value: progress, label };
      render();
    });
    tool.status = "installed";
    tool.cached = true;
    state.notice = `${capitalize(id)} ready. Runtime is available in this tab.`;
    persistState();
  } catch (error) {
    tool.status = "error";
    tool.error = getErrorMessage(error);
    state.notice = `${capitalize(id)} failed to initialize. Retry from the toolbox.`;
  }
  render();
}
async function handleToolTest(id) {
  if (state.busy || !isToolReady(id)) {
    return;
  }
  state.busy = true;
  state.notice = `Running the ${id} smoke test\u2026`;
  const run = startToolRun(id, sampleInputs[id]);
  render();
  try {
    const output = await runTool(id, sampleInputs[id]);
    finishToolRun(run.id, output);
    state.notice = `${capitalize(id)} smoke test succeeded.`;
  } catch (error) {
    failToolRun(run.id, getErrorMessage(error));
    state.notice = `${capitalize(id)} smoke test failed.`;
  } finally {
    state.busy = false;
    render();
  }
}
async function runSample() {
  if (state.busy) {
    return;
  }
  const missing = toolDescriptors.filter((descriptor) => !isToolReady(descriptor.id));
  if (missing.length > 0) {
    addMessage("assistant", `The sample is intentionally blocked until you install ${missing.map((item) => item.name).join(" and ")} from the toolbox. No runtime is downloaded implicitly.`);
    state.notice = "Sample blocked: install each tool first.";
    render();
    return;
  }
  state.busy = true;
  addMessage("user", "Run the local tool chain: compile the sample, then store a note in SQLite.");
  state.notice = "Running a deterministic compiler \u2192 SQLite chain\u2026";
  render();
  try {
    const compilerRun = startToolRun("compiler", sampleInputs.compiler);
    render();
    const compilerOutput = await runTool("compiler", sampleInputs.compiler);
    finishToolRun(compilerRun.id, compilerOutput);
    addMessage("tool", "Compiler returned browser-ready ESM.", compilerRun.id);
    const sqliteRun = startToolRun("sqlite", sampleInputs.sqlite);
    render();
    const sqliteOutput = await runTool("sqlite", sampleInputs.sqlite);
    finishToolRun(sqliteRun.id, sqliteOutput);
    addMessage("tool", "SQLite stored the note and returned the latest rows.", sqliteRun.id);
    addMessage("assistant", "Sample complete. The compiler and database both ran locally, and their trace is available on the right.");
    state.notice = "Sample complete. No network request was needed.";
  } catch (error) {
    addMessage("assistant", `The sample stopped with an error: ${getErrorMessage(error)}`);
    state.notice = "Sample failed. Inspect the trace and retry the tool test.";
  } finally {
    state.busy = false;
    render();
  }
}
async function sendMessage() {
  const content = promptInput.value.trim();
  if (!content || state.busy || !isSessionReady()) {
    return;
  }
  state.busy = true;
  promptInput.value = "";
  addMessage("user", content);
  state.modelMessages.push({ role: "user", content });
  state.notice = "The local model is thinking\u2026";
  render();
  try {
    const reply = await askModel(state.modelMessages);
    state.modelMessages.push(reply.assistantMessage ?? { role: "assistant", content: reply.text });
    let pendingCalls = getReplyToolCalls(reply);
    let finalText = reply.text;
    if (pendingCalls.length === 0) {
      addMessage("assistant", stripToolCall(finalText) || "The local model returned an empty answer.");
      state.notice = "Response complete.";
      return;
    }
    let round = 0;
    let totalToolCalls = 0;
    let hitToolCallLimit = false;
    while (pendingCalls.length > 0 && round < 3) {
      round += 1;
      const availableCallBudget = Math.max(0, 6 - totalToolCalls);
      const callsToRun = pendingCalls.slice(0, availableCallBudget);
      const callsOmittedByLimit = pendingCalls.slice(availableCallBudget);
      for (const call of callsToRun) {
        totalToolCalls += 1;
        const run = startToolRun(call.name, call.arguments, call.id);
        addMessage("tool", `The model requested ${call.name}. Running it now.`, run.id);
        state.notice = `Running ${call.name} \xB7 tool round ${round} of 3\u2026`;
        render();
        if (!isKnownTool(call.name)) {
          const error = `Unknown tool "${call.name}". Available tools: compiler, sqlite.`;
          failToolRun(run.id, error);
          state.modelMessages.push({
            role: "tool",
            content: JSON.stringify({ ok: false, error: { code: "UNKNOWN_TOOL", message: error } }),
            tool_call_id: call.id
          });
          continue;
        }
        try {
          const output = await runTool(call.name, call.arguments);
          finishToolRun(run.id, output);
          state.modelMessages.push({ role: "tool", content: JSON.stringify({ ok: true, result: output }), tool_call_id: call.id });
        } catch (error) {
          const message = getErrorMessage(error);
          failToolRun(run.id, message);
          state.modelMessages.push({
            role: "tool",
            content: JSON.stringify({ ok: false, error: { code: "TOOL_EXECUTION_FAILED", message } }),
            tool_call_id: call.id
          });
        }
      }
      if (callsOmittedByLimit.length > 0) {
        hitToolCallLimit = true;
        for (const call of callsOmittedByLimit) {
          const run = startToolRun(call.name, call.arguments, call.id);
          const error = "Tool call limit reached. The workbench allows at most 6 calls per user message.";
          failToolRun(run.id, error);
          state.modelMessages.push({
            role: "tool",
            content: JSON.stringify({ ok: false, error: { code: "TOOL_CALL_LIMIT", message: error } }),
            tool_call_id: call.id
          });
        }
      }
      render();
      const nextReply = await askModel(state.modelMessages, !hitToolCallLimit && round < 3);
      state.modelMessages.push(nextReply.assistantMessage ?? { role: "assistant", content: nextReply.text });
      finalText = nextReply.text;
      pendingCalls = getReplyToolCalls(nextReply);
      if (hitToolCallLimit) {
        pendingCalls = [];
      }
    }
    if (pendingCalls.length > 0) {
      const finalReply = await askModel(state.modelMessages, false);
      state.modelMessages.push(finalReply.assistantMessage ?? { role: "assistant", content: finalReply.text });
      finalText = finalReply.text;
    }
    addMessage("assistant", stripToolCall(finalText) || "The tool completed, but the model did not add a summary.");
    state.notice = "Response complete. Tool activity is recorded in the trace.";
  } catch (error) {
    addMessage("assistant", `The local model stopped: ${getErrorMessage(error)}`);
    state.notice = "Model request failed. The conversation is still intact.";
  } finally {
    state.busy = false;
    render();
  }
}
function startToolRun(tool, input, callId) {
  const run = {
    id: crypto.randomUUID(),
    callId,
    tool,
    label: tool === "compiler" ? "Compile snippet" : tool === "sqlite" ? "Query database" : "Unknown tool",
    input,
    startedAt: Date.now(),
    status: "running"
  };
  state.toolRuns.push(run);
  return run;
}
function getReplyToolCalls(reply) {
  if (reply.toolCalls.length > 0) {
    return reply.toolCalls;
  }
  const parsed = parseToolCall(reply.text);
  return parsed ? [{ id: crypto.randomUUID(), name: parsed.name, arguments: parsed.arguments }] : [];
}
function isKnownTool(tool) {
  return tool === "compiler" || tool === "sqlite";
}
function finishToolRun(id, output) {
  const run = state.toolRuns.find((item) => item.id === id);
  if (!run) {
    return;
  }
  run.output = output;
  run.durationMs = Date.now() - run.startedAt;
  run.status = "complete";
}
function failToolRun(id, error) {
  const run = state.toolRuns.find((item) => item.id === id);
  if (!run) {
    return;
  }
  run.error = error;
  run.durationMs = Date.now() - run.startedAt;
  run.status = "error";
}
function addMessage(role, content, toolRunId) {
  state.messages.push({ id: crypto.randomUUID(), role, content, toolRunId });
}
function resetSession() {
  if (state.busy) {
    return;
  }
  state.messages = [];
  state.modelMessages = [{ role: "system", content: systemPrompt }];
  state.toolRuns = [];
  state.notice = "Session reset. Installed runtimes remain available.";
  render();
}
function render() {
  const sessionReady = isSessionReady();
  const modelInstalled = state.model.cached || state.model.status === "ready";
  const missing = toolDescriptors.filter((descriptor) => !isToolReady(descriptor.id));
  const readinessChip = getElement("readiness-chip");
  const readinessBanner = getElement("readiness-banner");
  const footerNotice = getElement("footer-notice");
  const chatContext = getElement("chat-context");
  const chatColumn = getElement("chat-column");
  const toolColumn = getElement("tool-column");
  chatColumn.classList.toggle("is-hidden", !sessionReady);
  chatColumn.setAttribute("aria-hidden", String(!sessionReady));
  toolColumn.classList.toggle("is-hidden", !modelInstalled);
  toolColumn.setAttribute("aria-hidden", String(!modelInstalled));
  readinessChip.className = `readiness-chip ${sessionReady ? "ready" : "blocked"}`;
  readinessChip.innerHTML = `<span class="chip-dot"></span>${sessionReady ? "SESSION READY" : "INSTALL TO START"}`;
  readinessBanner.className = `readiness-banner ${sessionReady ? "is-ready" : "is-blocked"}`;
  readinessBanner.innerHTML = sessionReady ? `<span class="banner-icon">\u2713</span><div><strong>Everything is running locally.</strong><span>Your model and both tool runtimes are initialized in this tab.</span></div><span class="banner-meta">3 / 3 READY</span>` : `<span class="banner-icon">!</span><div><strong>${getBlockingTitle()}</strong><span>${getBlockingDescription(missing)}</span></div><span class="banner-meta">${getReadyCount()} / 3 READY</span>`;
  footerNotice.textContent = state.notice;
  chatContext.textContent = `${state.modelMessages.filter((message) => message.role !== "system").length} messages \xB7 ${state.toolRuns.length} tool runs`;
  promptInput.disabled = !sessionReady || state.busy;
  promptInput.placeholder = sessionReady ? "Ask the local model to compile code or query SQLite\u2026" : "Install the model and tools to start a local session\u2026";
  sendButton.disabled = !sessionReady || state.busy;
  sendButton.innerHTML = state.busy ? 'WORKING <span class="button-spinner"></span>' : "SEND <span>\u2197</span>";
  renderMessages();
  renderModelCard();
  renderTools();
  renderTrace();
}
function renderModelCard() {
  const model = modelCatalog.find((item) => item.id === state.model.selected) ?? modelCatalog[0];
  const ready = state.model.status === "ready" && isModelReady();
  const status = state.model.status === "error" ? "FAILED" : ready ? "READY" : !model.supportsTools ? "CHAT ONLY" : state.model.cached ? "CACHED" : "NOT INSTALLED";
  const canInstall = model.supportsTools && webGPUState === "available";
  modelCardElement.innerHTML = `<label class="sr-only" for="model-select">Model profile</label>
    <select id="model-select" ${state.model.status === "installing" || ready ? "disabled" : ""}>${modelCatalog.map((item) => `<option value="${item.id}" ${item.id === model.id ? "selected" : ""}>${item.name} \xB7 ${item.size} \xB7 ${item.note}</option>`).join("")}</select>
    ${!model.supportsTools ? `<div class="model-capability">This profile can chat, but WebLLM does not declare it as a function-calling model. Select Hermes 3 to use tools.</div>` : ""}
    ${model.supportsTools && webGPUState === "checking" ? `<div class="model-capability">Checking the WebGPU adapter before enabling download\u2026</div>` : ""}
    ${model.supportsTools && webGPUState === "unavailable" ? `<div class="inline-error" role="alert">WebGPU preflight failed. The model download is unavailable in this browser.</div>` : ""}
    ${state.model.status === "installing" ? `<div class="progress-wrap"><div class="progress-label"><span>${escapeHTML(state.model.progressText)}</span><span>${Math.round(state.model.progress * 100)}%</span></div><div class="progress-track" role="progressbar" aria-label="Model installation progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(state.model.progress * 100)}"><span style="width:${Math.max(4, state.model.progress * 100)}%"></span></div></div>` : ""}
    ${state.model.error ? `<div class="inline-error" role="alert">${escapeHTML(state.model.error)}</div>` : ""}
    <button class="model-install-button ${ready ? "installed" : ""}" data-action="install-model" ${state.model.status === "installing" || ready || !canInstall ? "disabled" : ""}>${state.model.status === "installing" ? "DOWNLOADING" : ready ? "MODEL READY \u2713" : !model.supportsTools ? "SELECT HERMES FOR TOOLS" : state.model.cached ? "LOAD CACHED MODEL \u2197" : "INSTALL MODEL \u2197"}</button>`;
}
function renderMessages() {
  if (state.messages.length === 0) {
    messagesElement.innerHTML = `
      <div class="empty-state">
        <div class="suggestion-row"><button data-action="sample" class="suggestion">Compile a TypeScript snippet <span>\u2197</span></button><button data-action="sample" class="suggestion">Run a SQLite query <span>\u2197</span></button></div>
      </div>`;
    return;
  }
  messagesElement.innerHTML = state.messages.map((message) => {
    const linkedRun = message.toolRunId ? state.toolRuns.find((run) => run.id === message.toolRunId) : void 0;
    return `<article class="message message-${message.role}">
        <div class="message-meta"><span>${message.role === "user" ? "YOU" : message.role === "tool" ? "TOOL EVENT" : "WORKBENCH"}</span>${linkedRun ? `<span class="message-run">${escapeHTML(linkedRun.tool)} \xB7 ${escapeHTML(linkedRun.status)}</span>` : ""}</div>
        <div class="message-content">${formatMessage(message.content)}</div>
      </article>`;
  }).join("");
  messagesElement.scrollTop = messagesElement.scrollHeight;
}
function renderTools() {
  toolListElement.innerHTML = toolDescriptors.map((descriptor) => {
    const tool = state.tools[descriptor.id];
    const ready = tool.status === "installed" && isToolReady(descriptor.id);
    const buttonLabel = tool.status === "installing" ? "LOADING" : ready ? "READY" : tool.cached ? "LOAD RUNTIME" : "INSTALL";
    const statusLabel = tool.status === "error" ? "FAILED" : ready ? "READY" : tool.status === "installing" ? "INITIALIZING" : tool.cached ? "CACHED" : "NOT INSTALLED";
    return `<article class="tool-card ${ready ? "is-ready" : ""} ${tool.status === "error" ? "has-error" : ""}">
        <div class="tool-card-top"><span class="tool-icon ${descriptor.id}">${descriptor.id === "compiler" ? "<>" : "\u2318"}</span><span class="tool-status ${ready ? "status-ready" : ""}"><span class="status-dot"></span>${statusLabel}</span></div>
        <h3>${descriptor.name}</h3>
        ${tool.status === "installing" ? `<div class="progress-wrap"><div class="progress-label"><span>${escapeHTML(tool.progress.label)}</span><span>${Math.round(tool.progress.value * 100)}%</span></div><div class="progress-track" role="progressbar" aria-label="${descriptor.name} installation progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(tool.progress.value * 100)}"><span style="width:${Math.max(4, tool.progress.value * 100)}%"></span></div></div>` : ""}
        ${tool.error ? `<div class="inline-error" role="alert">${escapeHTML(tool.error)}</div>` : ""}
        <div class="tool-actions"><button class="install-button ${ready ? "installed" : ""}" data-action="install-tool" data-tool="${descriptor.id}" ${tool.status === "installing" || ready ? "disabled" : ""}>${buttonLabel} ${ready ? "\u2713" : "\u2197"}</button>${ready ? `<button class="test-button" data-action="test-tool" data-tool="${descriptor.id}" ${state.busy ? "disabled" : ""}>TEST TOOL</button>` : ""}</div>
      </article>`;
  }).join("");
}
function renderTrace() {
  if (state.toolRuns.length === 0) {
    traceListElement.innerHTML = "";
    return;
  }
  traceListElement.innerHTML = state.toolRuns.slice().reverse().map((run) => `<details class="trace-entry ${run.status}" ${run.status === "running" ? "open" : ""}>
      <summary><span class="trace-status">${run.status === "complete" ? "\u2713" : run.status === "error" ? "!" : "\u2026"}</span><span class="trace-name">${escapeHTML(run.label)}</span><code>${escapeHTML(run.tool)}</code><span class="trace-duration">${run.durationMs === void 0 ? "RUNNING" : `${run.durationMs}ms`}</span></summary>
      <div class="trace-body"><div class="trace-block"><span>CALL ID</span><pre>${escapeHTML(run.callId ?? run.id)}</pre></div><div class="trace-block"><span>INPUT</span><pre>${escapeHTML(JSON.stringify(run.input, null, 2))}</pre></div>${run.output !== void 0 ? `<div class="trace-block"><span>OUTPUT</span><pre>${escapeHTML(JSON.stringify(run.output, null, 2))}</pre></div>` : ""}${run.error ? `<div class="trace-block trace-error"><span>ERROR \xB7 RETRY OR EDIT</span><pre>${escapeHTML(run.error)}</pre></div>` : ""}</div>
    </details>`).join("");
}
function isSessionReady() {
  const model = modelCatalog.find((item) => item.id === state.model.selected) ?? modelCatalog[0];
  return model.supportsTools && state.model.status === "ready" && isModelReady() && toolDescriptors.every((descriptor) => state.tools[descriptor.id].status === "installed" && isToolReady(descriptor.id));
}
function getReadyCount() {
  const model = modelCatalog.find((item) => item.id === state.model.selected) ?? modelCatalog[0];
  return (model.supportsTools && state.model.status === "ready" && isModelReady() ? 1 : 0) + toolDescriptors.filter((descriptor) => state.tools[descriptor.id].status === "installed" && isToolReady(descriptor.id)).length;
}
function getBlockingTitle() {
  const model = modelCatalog.find((item) => item.id === state.model.selected) ?? modelCatalog[0];
  if (!model.supportsTools) {
    return "Choose Hermes 3 for tool calling.";
  }
  if (webGPUState === "checking") {
    return "Checking WebGPU availability before downloading.";
  }
  if (webGPUState === "unavailable") {
    return "WebGPU is required before downloading a model.";
  }
  if (state.model.status !== "ready" || !isModelReady()) {
    return "Start by installing a local model.";
  }
  const missing = toolDescriptors.filter((descriptor) => !isToolReady(descriptor.id));
  return `Install ${missing.map((item) => item.name).join(" and ")} to unlock chat.`;
}
function getBlockingDescription(missing) {
  const model = modelCatalog.find((item) => item.id === state.model.selected) ?? modelCatalog[0];
  if (!model.supportsTools) {
    return "Qwen and Llama profiles remain visible for comparison, but this workbench only unlocks tools for an official function-calling model.";
  }
  if (webGPUState === "checking") {
    return "The browser adapter is being checked. No model bytes will be downloaded until this preflight passes.";
  }
  if (webGPUState === "unavailable") {
    return "Use a Chromium browser with WebGPU enabled. No model bytes will be downloaded until this preflight passes.";
  }
  if (state.model.status !== "ready" || !isModelReady()) {
    return "The model is downloaded once and cached by WebLLM. No model download starts from the composer.";
  }
  return `The model can only access initialized tools. ${missing.map((item) => item.name).join(" and ")} ${missing.length === 1 ? "is" : "are"} still unavailable.`;
}
async function requestWebGPUAdapter() {
  const gpu = navigator.gpu;
  if (!gpu?.requestAdapter) {
    return null;
  }
  try {
    return await gpu.requestAdapter();
  } catch {
    return null;
  }
}
async function refreshWebGPUPreflight() {
  webGPUState = await requestWebGPUAdapter() ? "available" : "unavailable";
  render();
}
function persistState() {
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      model: state.model.cached ? state.model.selected : void 0,
      tools: {
        compiler: state.tools.compiler.cached,
        sqlite: state.tools.sqlite.cached
      }
    })
  );
}
function readPersistedState() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return { tools: { compiler: false, sqlite: false } };
    }
    const parsed = JSON.parse(raw);
    return { model: parsed.model, tools: { compiler: Boolean(parsed.tools?.compiler), sqlite: Boolean(parsed.tools?.sqlite) } };
  } catch {
    return { tools: { compiler: false, sqlite: false } };
  }
}
async function copyTrace(button) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.toolRuns, null, 2));
    const original = button.innerHTML;
    button.innerHTML = "\u2713";
    setTimeout(() => {
      button.innerHTML = original;
    }, 1200);
  } catch {
    state.notice = "Clipboard access is unavailable in this browser.";
    render();
  }
}
function formatMessage(content) {
  return escapeHTML(stripToolCall(content)).replace(/\n/g, "<br />");
}
function escapeHTML(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}
function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function getElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element;
}

