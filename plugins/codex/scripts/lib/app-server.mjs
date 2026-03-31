/**
 * @typedef {Error & { data?: unknown, rpcCode?: number }} ProtocolError
 * @typedef {import("./app-server-protocol").AppServerMethod} AppServerMethod
 * @typedef {import("./app-server-protocol").AppServerNotification} AppServerNotification
 * @typedef {import("./app-server-protocol").AppServerNotificationHandler} AppServerNotificationHandler
 * @typedef {import("./app-server-protocol").ClientInfo} ClientInfo
 * @typedef {import("./app-server-protocol").CodexAppServerClientOptions} CodexAppServerClientOptions
 * @typedef {import("./app-server-protocol").InitializeCapabilities} InitializeCapabilities
 */
import fs from "node:fs";
import net from "node:net";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";
import { parseBrokerEndpoint } from "./broker-endpoint.mjs";
import { ensureBrokerSession } from "./broker-lifecycle.mjs";

const PLUGIN_MANIFEST_URL = new URL("../../.claude-plugin/plugin.json", import.meta.url);
const PLUGIN_MANIFEST = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST_URL, "utf8"));

export const BROKER_ENDPOINT_ENV = "CODEX_COMPANION_APP_SERVER_ENDPOINT";
export const BROKER_BUSY_RPC_CODE = -32001;

/**
 * Cached sandbox probe results, keyed by resolved codex binary path.
 * @type {Map<string, { type: "bwrap" | "landlock" | "none", configArgs: string[] }>}
 */
const sandboxProbeCache = new Map();

/**
 * Resolve the absolute path to the `codex` binary that would be used with
 * the given env. This ensures the probe matches the actual spawn context.
 */
function resolveCodexPath(env) {
  const result = spawnSync("which", ["codex"], {
    encoding: "utf8",
    stdio: "pipe",
    shell: false,
    env: env ?? process.env
  });
  return (!result.error && result.status === 0) ? result.stdout.trim() : "codex";
}

/**
 * Probes whether the Linux sandbox works on this system.
 * - First tries bwrap (the default).
 * - If bwrap fails (e.g. missing CAP_NET_ADMIN in containers/WSL), tries Landlock.
 * - Caches per resolved codex binary path so different env/PATH combos get
 *   their own probe result.
 *
 * On non-Linux platforms the sandbox is handled natively (Seatbelt/macOS,
 * Windows restricted token) and never needs this fallback.
 *
 * @param {string} cwd - Working directory for the probe.
 * @param {{ env?: NodeJS.ProcessEnv }} [options] - Optional env to match the spawn context.
 */
export function probeSandboxSupport(cwd, options) {
  const env = options?.env ?? undefined;
  // When a custom env is supplied, skip caching — the caller may have a
  // different PATH or config that changes sandbox behaviour.
  const useCache = !options?.env;

  if (process.platform !== "linux") {
    return { type: "bwrap", configArgs: [] };
  }

  const codexPath = resolveCodexPath(env);
  if (useCache) {
    const cached = sandboxProbeCache.get(codexPath);
    if (cached) {
      return cached;
    }
  }

  const spawnOpts = { cwd, encoding: "utf8", stdio: "pipe", shell: false, env };

  // First, verify codex itself can launch. If it can't (ENOENT, permission error),
  // that's a launcher problem, not a sandbox problem — surface it directly.
  const launchTest = spawnSync("codex", ["--version"], spawnOpts);
  if (launchTest.error) {
    const code = launchTest.error.code ?? "";
    throw new Error(
      `Codex CLI cannot be launched (${code || launchTest.error.message}). ` +
      "Verify that codex is installed and on your PATH."
    );
  }

  const bwrapTest = spawnSync("codex", ["sandbox", "linux", "echo", "ok"], spawnOpts);
  if (!bwrapTest.error && bwrapTest.status === 0) {
    const result = { type: "bwrap", configArgs: [] };
    if (useCache) sandboxProbeCache.set(codexPath, result);
    return result;
  }

  const landlockTest = spawnSync(
    "codex",
    ["-c", "use_legacy_landlock=true", "sandbox", "linux", "echo", "ok"],
    spawnOpts
  );
  if (!landlockTest.error && landlockTest.status === 0) {
    const result = {
      type: "landlock",
      configArgs: ["-c", "use_legacy_landlock=true"]
    };
    if (useCache) sandboxProbeCache.set(codexPath, result);
    return result;
  }

  const result = { type: "none", configArgs: [] };
  if (useCache) sandboxProbeCache.set(codexPath, result);
  return result;
}

/** Reset the cached sandbox probe (for testing). */
export function resetSandboxProbeCache() {
  sandboxProbeCache.clear();
}

/** @type {ClientInfo} */
const DEFAULT_CLIENT_INFO = {
  title: "Codex Plugin",
  name: "Claude Code",
  version: PLUGIN_MANIFEST.version ?? "0.0.0"
};

/** @type {InitializeCapabilities} */
const DEFAULT_CAPABILITIES = {
  experimentalApi: false,
  optOutNotificationMethods: [
    "item/agentMessage/delta",
    "item/reasoning/summaryTextDelta",
    "item/reasoning/summaryPartAdded",
    "item/reasoning/textDelta"
  ]
};

function buildJsonRpcError(code, message, data) {
  return data === undefined ? { code, message } : { code, message, data };
}

function createProtocolError(message, data) {
  const error = /** @type {ProtocolError} */ (new Error(message));
  error.data = data;
  if (data?.code !== undefined) {
    error.rpcCode = data.code;
  }
  return error;
}

class AppServerClientBase {
  constructor(cwd, options = {}) {
    this.cwd = cwd;
    this.options = options;
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = "";
    this.closed = false;
    this.exitError = null;
    /** @type {AppServerNotificationHandler | null} */
    this.notificationHandler = null;
    this.lineBuffer = "";
    this.transport = "unknown";

    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  setNotificationHandler(handler) {
    this.notificationHandler = handler;
  }

  /**
   * @template {AppServerMethod} M
   * @param {M} method
   * @param {import("./app-server-protocol").AppServerRequestParams<M>} params
   * @returns {Promise<import("./app-server-protocol").AppServerResponse<M>>}
   */
  request(method, params) {
    if (this.closed) {
      throw new Error("codex app-server client is closed.");
    }

    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.sendMessage({ id, method, params });
    });
  }

  notify(method, params = {}) {
    if (this.closed) {
      return;
    }
    this.sendMessage({ method, params });
  }

  handleChunk(chunk) {
    this.lineBuffer += chunk;
    let newlineIndex = this.lineBuffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.lineBuffer.slice(0, newlineIndex);
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
      this.handleLine(line);
      newlineIndex = this.lineBuffer.indexOf("\n");
    }
  }

  handleLine(line) {
    if (!line.trim()) {
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.handleExit(createProtocolError(`Failed to parse codex app-server JSONL: ${error.message}`, { line }));
      return;
    }

    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message);
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(createProtocolError(message.error.message ?? `codex app-server ${pending.method} failed.`, message.error));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    if (message.method && this.notificationHandler) {
      this.notificationHandler(/** @type {AppServerNotification} */ (message));
    }
  }

  handleServerRequest(message) {
    this.sendMessage({
      id: message.id,
      error: buildJsonRpcError(-32601, `Unsupported server request: ${message.method}`)
    });
  }

  handleExit(error) {
    if (this.exitResolved) {
      return;
    }

    this.exitResolved = true;
    this.exitError = error ?? null;

    for (const pending of this.pending.values()) {
      pending.reject(this.exitError ?? new Error("codex app-server connection closed."));
    }
    this.pending.clear();
    this.resolveExit(undefined);
  }

  sendMessage(_message) {
    throw new Error("sendMessage must be implemented by subclasses.");
  }
}

class SpawnedCodexAppServerClient extends AppServerClientBase {
  constructor(cwd, options = {}) {
    super(cwd, options);
    this.transport = "direct";
  }

  async initialize() {
    const sandbox = probeSandboxSupport(this.cwd, { env: this.options.env });
    if (sandbox.type === "none") {
      throw new Error(
        "Codex sandbox is unavailable: neither bwrap nor Landlock works on this system. " +
        "See https://developers.openai.com/codex/concepts/sandboxing#prerequisites for setup instructions."
      );
    }
    const args = [...sandbox.configArgs, "app-server"];
    this.proc = spawn("codex", args, {
      cwd: this.cwd,
      env: this.options.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");

    this.proc.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });

    this.proc.on("error", (error) => {
      this.handleExit(error);
    });

    this.proc.on("exit", (code, signal) => {
      const detail =
        code === 0
          ? null
          : createProtocolError(`codex app-server exited unexpectedly (${signal ? `signal ${signal}` : `exit ${code}`}).`);
      this.handleExit(detail);
    });

    this.readline = readline.createInterface({ input: this.proc.stdout });
    this.readline.on("line", (line) => {
      this.handleLine(line);
    });

    await this.request("initialize", {
      clientInfo: this.options.clientInfo ?? DEFAULT_CLIENT_INFO,
      capabilities: this.options.capabilities ?? DEFAULT_CAPABILITIES
    });
    this.notify("initialized", {});
  }

  async close() {
    if (this.closed) {
      await this.exitPromise;
      return;
    }

    this.closed = true;

    if (this.readline) {
      this.readline.close();
    }

    if (this.proc && !this.proc.killed) {
      this.proc.stdin.end();
      setTimeout(() => {
        if (this.proc && !this.proc.killed) {
          this.proc.kill("SIGTERM");
        }
      }, 50).unref?.();
    }

    await this.exitPromise;
  }

  sendMessage(message) {
    const line = `${JSON.stringify(message)}\n`;
    const stdin = this.proc?.stdin;
    if (!stdin) {
      throw new Error("codex app-server stdin is not available.");
    }
    stdin.write(line);
  }
}

class BrokerCodexAppServerClient extends AppServerClientBase {
  constructor(cwd, options = {}) {
    super(cwd, options);
    this.transport = "broker";
    this.endpoint = options.brokerEndpoint;
  }

  async initialize() {
    await new Promise((resolve, reject) => {
      const target = parseBrokerEndpoint(this.endpoint);
      this.socket = net.createConnection({ path: target.path });
      this.socket.setEncoding("utf8");
      this.socket.on("connect", resolve);
      this.socket.on("data", (chunk) => {
        this.handleChunk(chunk);
      });
      this.socket.on("error", (error) => {
        if (!this.exitResolved) {
          reject(error);
        }
        this.handleExit(error);
      });
      this.socket.on("close", () => {
        this.handleExit(this.exitError);
      });
    });

    await this.request("initialize", {
      clientInfo: this.options.clientInfo ?? DEFAULT_CLIENT_INFO,
      capabilities: this.options.capabilities ?? DEFAULT_CAPABILITIES
    });
    this.notify("initialized", {});
  }

  async close() {
    if (this.closed) {
      await this.exitPromise;
      return;
    }

    this.closed = true;
    if (this.socket) {
      this.socket.end();
    }
    await this.exitPromise;
  }

  sendMessage(message) {
    const line = `${JSON.stringify(message)}\n`;
    const socket = this.socket;
    if (!socket) {
      throw new Error("codex app-server broker connection is not connected.");
    }
    socket.write(line);
  }
}

export class CodexAppServerClient {
  static async connect(cwd, options = {}) {
    let brokerEndpoint = null;
    if (!options.disableBroker) {
      brokerEndpoint = options.brokerEndpoint ?? options.env?.[BROKER_ENDPOINT_ENV] ?? process.env[BROKER_ENDPOINT_ENV] ?? null;
      if (!brokerEndpoint) {
        const brokerSession = await ensureBrokerSession(cwd, { env: options.env });
        brokerEndpoint = brokerSession?.endpoint ?? null;
      }
    }
    const client = brokerEndpoint
      ? new BrokerCodexAppServerClient(cwd, { ...options, brokerEndpoint })
      : new SpawnedCodexAppServerClient(cwd, options);
    await client.initialize();
    return client;
  }
}
