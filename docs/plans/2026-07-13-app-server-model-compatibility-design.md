# Claude 插件 App Server 模型兼容性修复设计

## 目标

让 Claude Code 中的 Codex 插件在不修改 `~/.codex/config.toml`、不降级模型的前提下，使用当前已安装的 `/opt/homebrew/bin/codex`（`codex-cli 0.144.3`）正常调用 `gpt-5.6-sol` 完成 session review。

## 已确认事实

- 同一台机器上，Codex CLI 可以正常使用 `gpt-5.6-sol`。
- Claude 插件通过 `codex app-server` 发起 review 时收到 HTTP 400：模型要求更新 Codex。
- 失败进程使用的可执行文件是 `/opt/homebrew/bin/codex`，版本输出为 `codex-cli 0.144.3`。
- 插件使用共享 broker；broker 内部启动一个直接连接的 `codex app-server`，后续 review 请求复用该连接。
- 目前没有证据证明插件清单版本是根因，因此不得据此直接修改生产代码。

## 方案比较

### 方案 A：同一 CLI 的 App Server A/B 诊断后做最小修复（采用）

使用同一个 Codex 二进制、配置、模型、工作目录和测试提示，仅改变 app-server 初始化或 thread 请求中的一个字段。记录每组 initialize、thread/start、turn/start 和 error/turn-completed 结果，定位触发 400 的最小差异。随后先写能稳定复现该差异的失败测试，再修改插件。

优点：修复基于证据；保留共享运行时、session review 和现有状态管理。缺点：真实 A/B 需要一次或数次小型模型请求。

### 方案 B：review 改走 `codex exec`

避开 app-server，但会失去共享线程、通知流、取消和 session review 现有集成，改动面过大，不采用。

### 方案 C：覆盖或降级模型

只能绕过症状，并违背继续使用 `gpt-5.6-sol` 的目标，不采用。

## 诊断设计

先建立 CLI 成功基线，再按一次只改变一个变量的顺序运行 app-server：

1. CLI 基线：显式使用 `/opt/homebrew/bin/codex` 和 `gpt-5.6-sol` 执行最小只读提示。
2. 插件当前路径：复用当前插件的 client info、thread 参数和 broker/direct 行为。
3. 直接 app-server：绕过 broker，保持其余参数不变，排除 broker 状态影响。
4. 如果直接路径仍失败，分别只改变 initialize client info、thread `serviceName` 等与 CLI 请求不同的字段。
5. 每一轮只接受完整的成功响应或原始 400 作为证据，不根据错误文案推测客户端版本。

如果当前路径在全新 app-server 上成功，而共享 broker 失败，则修复 broker 生命周期或失效检测；如果某个请求字段稳定决定成功/失败，则只修复该字段的构造或传播。

## 实现边界

- 不修改用户全局 Codex 配置。
- 不硬编码 `0.144.3`、`gpt-5.6-sol` 或 Homebrew 路径。
- 不把插件清单版本替换为 CLI 版本，除非 A/B 明确证明该字段就是服务端兼容性判断输入。
- 不重写 review 为 `codex exec`。
- 保留 macOS、Linux 和 Windows 的现有启动方式。
- 对无法探测或无法验证的环境保持现有行为，并返回可执行的原始错误信息。

## 测试设计

- 在现有 fake Codex fixture 中记录 app-server initialize 与 thread 请求。
- 先写一个针对已确认根因的失败测试，并确认它在修改生产代码前按预期失败。
- 增加 direct 与 broker 两条路径的回归覆盖，确保二者构造相同的有效请求信息。
- 运行目标测试、完整 `npm test`、版本元数据检查和 `git diff --check`。
- 最后使用真实 Codex CLI 运行最小 app-server review；只有原始 400 消失并返回完成事件，才算问题解决。

## 错误处理与回退

真实 A/B 若不能区分变量，不修改生产逻辑，继续采集 app-server 原始协议和进程环境证据。若修复依赖未公开、仅对单一模型有效的伪装字段，则不将其作为通用修复合入；改为保留诊断信息并报告上游兼容性问题。
