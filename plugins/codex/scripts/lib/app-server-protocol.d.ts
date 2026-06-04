import type {
  ClientInfo,
  InitializeCapabilities,
  InitializeParams,
  InitializeResponse,
  ServerNotification
} from "../../.generated/app-server-types/index.js";
import type {
  ReviewStartParams,
  ReviewStartResponse,
  ReviewTarget,
  Thread,
  ThreadItem,
  ThreadListParams,
  ThreadListResponse,
  ThreadResumeParams as RawThreadResumeParams,
  ThreadResumeResponse,
  ThreadSetNameParams,
  ThreadSetNameResponse,
  ThreadStartParams as RawThreadStartParams,
  ThreadStartResponse,
  Turn,
  TurnInterruptParams,
  TurnInterruptResponse,
  TurnStartParams,
  TurnStartResponse,
  UserInput
} from "../../.generated/app-server-types/v2/index.js";

export type {
  ClientInfo,
  InitializeCapabilities,
  InitializeParams,
  InitializeResponse,
  ReviewTarget,
  Thread,
  ThreadItem,
  ThreadListParams,
  Turn,
  TurnInterruptParams,
  TurnStartParams,
  UserInput
};

export type ThreadStartParams = Omit<RawThreadStartParams, "persistExtendedHistory">;
export type ThreadResumeParams = Omit<RawThreadResumeParams, "persistExtendedHistory">;

export interface CodexAppServerClientOptions {
  env?: NodeJS.ProcessEnv;
  clientInfo?: ClientInfo;
  capabilities?: InitializeCapabilities;
  brokerEndpoint?: string;
  disableBroker?: boolean;
  reuseExistingBroker?: boolean;
  /**
   * Spawn the app-server in its own process group (POSIX) so the whole
   * subtree (codex + MCP children) can be reaped via a group signal on
   * close(). Only set this from a supervising parent that installs its own
   * SIGINT/SIGTERM handlers; an unsupervised foreground client must leave it
   * unset so a terminal interrupt still reaches the child via the group.
   */
  detachProcessGroup?: boolean;
}

export interface AppServerMethodMap {
  initialize: { params: InitializeParams; result: InitializeResponse };
  "thread/start": { params: ThreadStartParams; result: ThreadStartResponse };
  "thread/resume": { params: ThreadResumeParams; result: ThreadResumeResponse };
  "thread/name/set": { params: ThreadSetNameParams; result: ThreadSetNameResponse };
  "thread/list": { params: ThreadListParams; result: ThreadListResponse };
  "review/start": { params: ReviewStartParams; result: ReviewStartResponse };
  "turn/start": { params: TurnStartParams; result: TurnStartResponse };
  "turn/interrupt": { params: TurnInterruptParams; result: TurnInterruptResponse };
}

export type AppServerMethod = keyof AppServerMethodMap;
export type AppServerRequestParams<M extends AppServerMethod> = AppServerMethodMap[M]["params"];
export type AppServerResponse<M extends AppServerMethod> = AppServerMethodMap[M]["result"];
export type AppServerNotification = ServerNotification;
export type AppServerNotificationHandler = (message: AppServerNotification) => void;
