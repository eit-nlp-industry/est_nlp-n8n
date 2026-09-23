# 外部框架 API 接入 n8n 说明

面向外部业务框架 / 知识库 / 中台：如何把 API 接到自托管 n8n（含 Agent 工具）。

按 **通用性** 与 **接口数量** 选下面四种方式之一。

| 方式 | 条件 | 在 n8n 里怎么接 |
|------|------|-----------------|
| **A** | 通用性强，接口数量可观 | 框架提供 MCP Server；n8n **内置 MCP Client 预设节点**（参考 RAGFlow） |
| **B** | 通用性强，接口数量不可观 | n8n **内置 Tool**（不必做 MCP Server） |
| **C** | 通用性不强，接口数量可观 | 框架提供 MCP Server；n8n 用官方 **MCP Client Tool** |
| **D** | 通用性不强，接口数量不可观 | n8n **HTTP Request** / **HTTP Request Tool** 直接调 API |

说明：

- 「内置」指 n8n 产品侧的节点/预设，**不是**把对方 MCP Server 进程编进 n8n。  
- MCP Server 始终由外部框架独立部署；n8n 只做客户端或 HTTP 调用。  
- 「接口数量可观」经验上约 ≥5～8 个可给 Agent 选用的操作；可按实际情况调整。

---

## 方式 A：通用性强 + 接口可观 → MCP Server + n8n 内置 Client 预设

### 适用

全员都会用、工具多、希望在 Agent「添加工具」里一键出现（如知识库 RAGFlow）。

### 架构

```text
外部框架 ──部署──► MCP Server（SSE / streamable-HTTP）
                         ▲
                         │ MCP（Bearer 等）
n8n（自定义镜像）──► 预设节点（如 RAGFlow）──► Agent
```

### 外部框架侧

1. 实现并部署 **MCP Server**（推荐同时支持或明确一种 transport：`/sse` 或 `/mcp`）。  
2. 定义鉴权（常见 Bearer API Key）。  
3. 暴露工具：名称、描述、入参 JSON Schema 对 LLM 友好。  
4. 提供接入信息给 n8n 维护方：
   - Base URL（容器/内网可达地址）  
   - Transport  
   - 鉴权方式  
   - 示例 curl  

### n8n 侧（维护方）

1. 在源码增加 **MCP Client Tool 预设节点**（复制/包装 `mcpClientTool`）：  
   - 展示名：业务名（如 RAGFlow）  
   - 默认 `endpointUrl`、默认 `serverTransport`  
   - **鉴权与凭据不写死**，由用户选择  
2. 注册到 `@n8n/nodes-langchain` 的 `package.json`。  
3. 若挂到 Agent JSON 工具配置：`metadata.nodeTypeName` 可用预设类型名，但**不得**使用 `@n8n/mcp-registry.*` 前缀（那是官方云端 Registry）。  
4. 构建并发布自定义镜像（如 `pnpm deploy:local`）。

### 使用方（业务配置）

1. Agent → 添加工具 → 选预设名（如 RAGFlow）。  
2. 确认 Endpoint（可改默认）。  
3. Authentication 选 Bearer（或框架要求的方式）→ **自选凭据**。  
4. 保存后对话/运行，确认工具已加载。

### 参考实现

- 节点：`packages/@n8n/nodes-langchain/nodes/mcp/RagFlowMcpClientTool/`  
- 发布：`pnpm deploy:local` 或 `/srv/apps/n8n/deploy-from-source.sh`

### 验收

- [ ] 工具列表出现预设名称  
- [ ] 用户自选凭据后可列出/调用 MCP tools  
- [ ] 改 Endpoint 后仍可连其它环境  

---

## 方式 B：通用性强 + 接口不可观 → 内置 Tool（无 MCP）

### 适用

能力要产品化、全员可见，但只有很少几个稳定接口（例如 1～3 个查询/动作）。

### 架构

```text
外部框架 HTTP API
       ▲
       │ HTTPS/HTTP + 鉴权
n8n 内置 Tool 节点 ──► Agent
```

### 可选实现（择一）

1. **自研 Tool 子节点**  
   - 参考：`ToolCalculator`、`ToolWikipedia`、`ToolHttpRequest`  
   - 输出类型为 `AiTool`，挂到 Agent。  

2. **业务节点 + `usableAsTool: true`**  
   - 少量 operation，描述写清楚供 LLM 选择。  

3. **产品模板**  
   - 预置好的 **HTTP Request Tool** 工作流/Agent 模板（接口极少时）。  

### 外部框架侧

1. 提供稳定 REST（或等价）接口文档与鉴权。  
2. 约定超时、错误体；避免无界长耗时。  

### n8n 侧

1. 实现节点 → 注册 → 打自定义镜像发布。  
2. UI 文案走 i18n（若进 editor-ui）。  

### 使用方

1. Agent → 添加工具 → 选该内置 Tool。  
2. 配置凭据与必要参数。  

### 验收

- [ ] 工具出现在内置/产品目录  
- [ ] Agent 能按描述调用且参数正确  
- [ ] 无 MCP 会话依赖  

---

## 方式 C：通用性不强 + 接口可观 → MCP Server + 通用 MCP Client

### 适用

某一项目/客户专用、工具较多，但不值得做进全员预设目录。

### 架构

```text
外部框架 ──► MCP Server
                 ▲
                 │
n8n 官方「MCP Client」/「MCP Client Tool」──► Agent 或工作流
```

### 外部框架侧

与方式 A 相同：独立 MCP Server、鉴权、工具 Schema、可达 URL。

### n8n 侧（使用方即可，无需改源码）

1. Agent → 添加工具 → **MCP Client**（或 MCP Client Tool）。  
2. 填写：  
   - Endpoint（如 `http://host:port/sse`）  
   - Server Transport  
   - Authentication + 凭据  
   - Tools to Include：All / 选定  
3. 保存后使用。  

工作流中逐步调用单个 MCP 工具时，可用 **MCP Client** 节点（非 Tool 子节点）。

### 验收

- [ ] `list tools` 成功  
- [ ] Agent 能选用其中工具  
- [ ] 不出现在全员「品牌预设」目录（预期如此）  

### 升级路径

若日后变成全员标准能力 → 升为方式 **A**（做 Client 预设）。

---

## 方式 D：通用性不强 + 接口不可观 → HTTP 直接调用

### 适用

临时对接、接口很少、不必维护 MCP。

### 架构

```text
外部框架 HTTP API
       ▲
n8n HTTP Request 或 HTTP Request Tool
```

### 非 Agent（编排/同步）

1. 使用 **HTTP Request** 节点。  
2. 配置 Method、URL、Header/Query/Body、鉴权凭据。  
3. 按需分页、重试、错误分支。  

### Agent 场景

1. 使用 **HTTP Request Tool**（给 LLM 选的工具）。  
2. 为每个需要让模型调用的 API 配一个 Tool（或把固定调用封进 **Call n8n Workflow Tool**）。  
3. Tool 的 description 写清何时调用、参数含义。  

### 外部框架侧

提供：Base URL、路径、鉴权、请求/响应示例（OpenAPI 更佳）。

### 验收

- [ ] 单次请求成功  
- [ ] Agent 场景下模型能选对 Tool 并带上参数  

### 升级路径

接口变多或要自动发现工具 → 升为方式 **C**（MCP）或 **A**。

---

## 公共要求（四种都适用）

### 网络

- n8n 容器必须能访问框架地址（Docker 网络名、宿主机 IP、反代域名一致）。  
- 对外 HTTPS 时，Webhook/回调类还需配置 `N8N_HOST` / `N8N_PROTOCOL` / `WEBHOOK_URL` 等（与工具调用无直接关系，但影响完整环境）。  

### 安全

- 密钥只放在 n8n **Credentials**，不要写进节点默认值或文档示例明文长期留存。  
- 内网服务限制来源 IP / 网络策略。  

### 不要与 MCP Registry 混淆

- **MCP Registry**：官方云端目录（Notion 等），类型名 `@n8n/mcp-registry.*`。  
- 自建框架走 A/C，**不要**注册进 Registry，也勿复用该前缀。  

---

## 选型速查

1. 要给 Agent **自动发现很多工具**？ → A 或 C（先上 MCP）。  
2. **全员一键添加**？ → A 或 B（改 n8n / 发镜像）。  
3. **只有两三个接口**？ → B 或 D。  
4. **项目私用、工具多**？ → C。  
5. **项目私用、接口少**？ → D。  

---

## 相关命令与路径（本环境）

| 项 | 路径 / 命令 |
|----|-------------|
| 接入策略本文 | `docs/custom/external-framework-api-integration.md` |
| RAGFlow 预设（A 样例） | `packages/@n8n/nodes-langchain/nodes/mcp/RagFlowMcpClientTool/` |
| 本地构建发布 | `pnpm deploy:local` 或 `/srv/apps/n8n/deploy-from-source.sh` |
| 自托管 compose | `/srv/apps/n8n/` |
