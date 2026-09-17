const WEBLLM_MODULE_URL = "https://esm.run/@mlc-ai/web-llm@0.2.85";
const DEFAULT_MODEL = "Hermes-3-Llama-3.1-8B-q4f16_1-MLC";
const modelCatalog = [
  {
    id: "Hermes-3-Llama-3.1-8B-q4f16_1-MLC",
    name: "Hermes 3 \xB7 8B",
    size: "~5.0 GB",
    note: "tool calling",
    supportsTools: true
  },
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    name: "Qwen 2.5 \xB7 1.5B",
    size: "~1.0 GB",
    note: "fastest start",
    supportsTools: false
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    name: "Llama 3.2 \xB7 3B",
    size: "~1.8 GB",
    note: "stronger reasoning",
    supportsTools: false
  }
];
let engine = null;
let loading = null;
const structuralResponseFormat = {
  type: "structural_tag",
  structural_tag: {
    type: "triggered_tags",
    triggers: ["<tool_call>"],
    tags: [
      {
        type: "tag",
        begin: "<tool_call>",
        end: "</tool_call>",
        content: {
          type: "json_schema",
          json_schema: {
            type: "object",
            properties: {
              name: { type: "string", enum: ["compiler", "sqlite"] },
              arguments: { type: "object" }
            },
            required: ["name", "arguments"]
          }
        }
      }
    ]
  }
};
function isModelReady() {
  return engine !== null;
}
async function installModel(modelId, onProgress) {
  if (engine) {
    onProgress({ progress: 1, text: "Model ready" });
    return;
  }
  if (!loading) {
    loading = (async () => {
      onProgress({ progress: 0.02, text: "Loading WebLLM runtime" });
      const webllm = await import(WEBLLM_MODULE_URL);
      const appConfig = createModelAppConfig(webllm, modelId);
      engine = await webllm.CreateMLCEngine(modelId, {
        appConfig,
        initProgressCallback: (progress) => {
          onProgress({
            progress: progress.progress ?? 0,
            text: progress.text ?? "Downloading model files"
          });
        }
      });
      onProgress({ progress: 1, text: "Model ready" });
    })();
  }
  try {
    await loading;
  } finally {
    loading = null;
  }
}
function createModelAppConfig(webllm, modelId) {
  const modelSource = getModelSource();
  if (!modelSource) {
    return void 0;
  }
  const modelRecord = webllm.prebuiltAppConfig.model_list.find((item) => item.model_id === modelId);
  if (!modelRecord) {
    throw new Error(`WebLLM does not contain a model record for ${modelId}.`);
  }
  const sourceUrl = new URL(modelSource);
  const modelUrl = new URL(modelRecord.model);
  return {
    ...webllm.prebuiltAppConfig,
    model_list: [{
      ...modelRecord,
      model: new URL(`${modelUrl.pathname}${modelUrl.search}`, sourceUrl).href
    }]
  };
}
function getModelSource() {
  const value = new URLSearchParams(globalThis.location?.search ?? "").get("model-source")?.trim();
  if (!value) {
    return "";
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      throw new Error("The model source must use HTTPS or localhost.");
    }
    return url.href.endsWith("/") ? url.href : `${url.href}/`;
  } catch {
    throw new Error("Invalid model source. Use an HTTPS URL, for example ?model-source=https%3A%2F%2Fhf-mirror.example.");
  }
}
function resetModel() {
  engine = null;
}
async function askModel(messages, allowTools = true) {
  if (!engine) {
    throw new Error("Install a local model before sending a chat message.");
  }
  const request = {
    messages,
    max_tokens: 640,
    temperature: 0.15,
    stream: false
  };
  if (allowTools) {
    try {
      const response2 = await engine.chat.completions.create({
        ...request,
        messages: messages.filter((message) => message.role !== "system"),
        tool_choice: "auto",
        tools: toolDefinitions
      });
      return getResponseReply(response2);
    } catch (error) {
      if (!(error instanceof Error) || !/tool|function|unsupported|response.?format|system/i.test(error.message)) {
        throw error;
      }
    }
  }
  if (allowTools) {
    try {
      const response2 = await engine.chat.completions.create({
        ...request,
        response_format: structuralResponseFormat
      });
      return getResponseReply(response2);
    } catch (error) {
      if (!(error instanceof Error) || !/tool|function|unsupported|response.?format|structural/i.test(error.message)) {
        throw error;
      }
    }
  }
  const response = await engine.chat.completions.create(request);
  return getResponseReply(response);
}
function parseToolCall(content) {
  const tagged = content.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i)?.[1];
  const candidate = tagged ?? content.match(/\{\s*"name"\s*:\s*"[^"]+"[\s\S]*\}/i)?.[0];
  if (!candidate) {
    return null;
  }
  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed.name !== "string") {
      return null;
    }
    const argumentsValue = parsed.arguments;
    return {
      name: parsed.name,
      arguments: typeof argumentsValue === "string" ? JSON.parse(argumentsValue) : argumentsValue ?? {}
    };
  } catch {
    return null;
  }
}
function stripToolCall(content) {
  return content.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "").trim();
}
function getResponseReply(response) {
  const choice = response?.choices?.[0];
  const message = choice?.message;
  const text = getContentText(message?.content);
  const rawToolCalls = message?.tool_calls ?? [];
  const toolCalls = rawToolCalls.filter((toolCall) => Boolean(toolCall.function?.name)).map((toolCall, index) => ({
    id: toolCall.id ?? `local-tool-${index + 1}`,
    name: toolCall.function?.name ?? "",
    arguments: parseArguments(toolCall.function?.arguments)
  }));
  return {
    text,
    toolCalls,
    assistantMessage: rawToolCalls.length ? {
      role: "assistant",
      content: text,
      tool_calls: rawToolCalls.map((toolCall, index) => ({
        id: toolCall.id ?? `local-tool-${index + 1}`,
        type: "function",
        function: {
          name: toolCall.function?.name ?? "",
          arguments: toolCall.function?.arguments ?? "{}"
        }
      }))
    } : void 0
  };
}
function getContentText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === "string" ? part : part.text ?? "").join("");
  }
  return "";
}
function parseArguments(argumentsValue) {
  if (!argumentsValue) {
    return {};
  }
  try {
    return JSON.parse(argumentsValue);
  } catch {
    return { _rawArguments: argumentsValue };
  }
}
const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "compiler",
      description: "Compile a TypeScript or JavaScript snippet locally and return browser-ready ESM.",
      parameters: {
        type: "object",
        properties: { code: { type: "string", description: "The TypeScript or JavaScript source to compile." } },
        required: ["code"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "sqlite",
      description: "Run SQL against the local snippets database and return JSON rows.",
      parameters: {
        type: "object",
        properties: { sql: { type: "string", description: "The SQL statement to execute." } },
        required: ["sql"]
      }
    }
  }
];
const systemPrompt = `You are Workbench, a local-first browser assistant. You can use exactly two local tools.

Tool protocol: when a tool is useful, output only one tag in this exact shape and do not wrap it in markdown:
<tool_call>{"name":"compiler","arguments":{"code":"..."}}</tool_call>
or
<tool_call>{"name":"sqlite","arguments":{"sql":"..."}}</tool_call>

Compiler compiles TypeScript or JavaScript. SQLite runs SQL against a local snippets table. Never invent a tool result. After receiving a tool result, answer with a concise explanation and include the important output. If a tool is not installed, explain that the user needs to install it from the toolbox first.`;
export {
  DEFAULT_MODEL,
  askModel,
  installModel,
  isModelReady,
  modelCatalog,
  parseToolCall,
  resetModel,
  stripToolCall,
  systemPrompt
};

