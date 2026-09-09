# 大脑 Agent 对接用 MCP Server 标准

- 适用：机器人 / 小脑团队
- 对接：Agent（`AgentJsonConfig`）
- 基线能力：`BRAIN_SMALLBRAIN_REGISTRY_REVIEW_V1`（10 Robot Tool + 6 Skill + Control）
- 文档版本：`brain.mcp.server.standard.v2`

---

## 1. 目的

大脑只识别意图并选能力。能力清单、参数校验、Skill 展开、导航恢复都在你们这边。

大脑**不会**去调你们现有的 `POST /v1/tasks`。它只连 **一个 MCP Server**。你们把小脑 HTTP API **包成 MCP** 即可。

---

## 2. Agent 怎么调用你们？是不是提供一个 HTTP 服务？

**是。对外就是一个 HTTP 服务。** 但不是普通 REST 业务接口，而是 **MCP 协议跑在 HTTP 上**。

```text
用户说话
  → Agent（大脑）
  → 内置 MCP Client
  → HTTP 访问你们给的 URL（例如 http://10.40.17.16:8001/mcp）
  → 你们的 MCP Server
  → 内部再转成小脑 POST /v1/tasks 等
```

你们需要交付的只有三件事：

1. **一个长期在线的 HTTP 地址**（agent 进程能访问，不要 stdio、不要只监听 127.0.0.1 除非 agent 也在同一台机器）
2. **该地址讲 MCP Streamable HTTP**（JSON-RPC，不是自己发明的 JSON API）
3. **鉴权方式**（无鉴权 / Bearer Token / Header / OAuth2）

agent 里只需填：

```json
{
  "name": "smallbrain",
  "url": "http://<小脑可达地址>:8001/mcp",
  "transport": "streamableHttp",
  "authentication": "bearerAuth"
}
```

Agent 启动后会自动：

1. 连这个 URL，做 MCP 握手（`initialize`）
2. 调 **`tools/list`**，拿到全部能力（name / description / 参数 schema）
3. 用户说话时，模型从这份清单里选一个 `name`
4. 调 **`tools/call`**，把参数发给你们
5. 读你们返回的 JSON，再决定下一步或回复用户

建议另开一个普通健康检查：`GET /health`，给运维用，不参与 Agent 调用。

---

## 3. 标准化 MCP Server 是什么？里面要提供什么？

标准化 MCP Server = **HTTP 服务 + 三件 MCP 能力 + 一份工具目录**。

| 必须实现 | 作用 |
|----------|------|
| `initialize` | 握手，声明「我支持 tools」 |
| `tools/list` | 返回当前所有可调用能力 |
| `tools/call` | 按 `name` 执行一次，返回结果 |

**没有**单独的 `call_skill`。Skill 也登记成一条 tool，靠 description 标明「这是 Named Skill」。

工具目录当前应包含三类（`name` 必须与小脑 wire 名一致）：

| 类型 | 有哪些 | 在 MCP 里怎么表现 |
|------|--------|-------------------|
| Robot Tool | `navigate` `knock_door` `find_object` `approach_object` `follow_person` `sit` `lie_down` `stand_up` `wait` `perform_action` | `description` 以 `Robot Tool.` 开头 |
| Named Skill | `handoff_delivery` `knock_and_return` `find_and_approach_at` `return_and_rest` `asset_check_at` `finite_patrol` | `description` 以 `Named Skill v1.` 开头；SOP 在服务端展开 |
| Control / Helper | `x5_stream` `patrol_stop` `get_task_status` | 标明不进 / 如何进 FIFO |

不要暴露：`return_home`（用 `navigate`）、commissioning-only 高危动作。

`tools/call("knock_and_return", params)` 在你们内部应转成：

```json
POST /v1/tasks
{ "skill": "knock_and_return", "skill_version": "1", "params": { ... } }
```

`tools/call("navigate", params)` 转成 `{ "tool": "navigate", "params": { ... } }`。

Agent **看不到** `/v1/tasks`；它只看到 MCP 工具名。

---

## 4. 入参 / 出参（合同）

### 4.1 `tools/list`：每条能力长这样

```json
{
  "name": "knock_and_return",
  "description": "Named Skill v1 (敲门并返回). Server expands SOP; call once, do not split into atom tools. Prefer over knock_door when return is required.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "door_anchor": { "type": "string", "description": "必填，Atlas 规范 Anchor" },
      "via_anchors": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["door_anchor"]
  }
}
```

Agent 随后这样调：

```json
{
  "name": "knock_and_return",
  "arguments": {
    "door_anchor": "110实验室",
    "via_anchors": ["上楼点"]
  }
}
```

### 4.2 `tools/call`：返回一段 JSON 文本

成功：

```json
{
  "success": true,
  "status": "succeeded",
  "kind": "skill",
  "task_id": "brain:conv:turn:task:001",
  "tool": null,
  "skill": "knock_and_return",
  "skill_version": "1",
  "params": { "door_anchor": "110实验室" },
  "last_reached_anchor": "110实验室",
  "recovery": null,
  "observation": "已完成敲门并返回",
  "result": {},
  "error": null,
  "steps": []
}
```

失败（顶层仍 failed，恢复单独写）：

```json
{
  "success": false,
  "status": "failed",
  "kind": "skill",
  "task_id": "brain:…",
  "skill": "knock_and_return",
  "last_reached_anchor": "上楼点",
  "recovery": { "status": "succeeded", "action": "navigate", "query": "上楼点" },
  "observation": "门未找到；已自动返回 last_reached_anchor",
  "error": { "code": "door_not_found", "message": "door not found" }
}
```

---

## 5. 字段怎么用

### 5.1 能力声明 / 入参

| 字段 | 干什么 | 注意 |
|------|--------|------|
| `name` | 唯一调用名 | 与小脑完全一致，大脑原样 call |
| `description` | 给 LLM 选型 | 写用途、边界、何时优先于相近能力；Skill 加中文别名 |
| `inputSchema` | 限制能传的参数 | JSON Schema；只接受声明字段 |
| `arguments` | 一次调用的实参 | Anchor 必须是当前 Atlas 可解析名；未知则明确拒绝，禁止静默改写 |

`description` 模板：

```text
Robot Tool. <一句用途>.
Scope: <边界>. Do NOT send: pose, path, atlas, connector, lease.
Prefer Skill <X> when <多步>; use this when <单步>.
```

```text
Named Skill v1 (aliases: <中文别名>).
Server expands SOP; call once — do NOT expand into atom tools.
Runtime: last_reached_anchor / whitelist recovery handled server-side.
Prefer this over <原子 Tool> when <用户意图>.
```

### 5.2 出参

| 字段 | 干什么 | 注意 |
|------|--------|------|
| `success` | 粗成功 | 要和 `status` 一起看 |
| `status` | 顶层任务态 | `succeeded` `failed` `canceled` `rejected` `timed_out` `interrupted` `accepted` `running` `resting`。只信顶层，不信单步 |
| `kind` | 类别 | `robot_tool` / `skill` / `control_tool` |
| `task_id` | 查询 / 停止句柄 | 巡航、跟随、长任务必填 |
| `tool` / `skill` / `skill_version` | 回显调了谁 | Skill 当前 `"1"` |
| `observation` | 给大脑下一轮推理 | **建议必填**，一两句真实观测 |
| `last_reached_anchor` | Skill 内最后成功导航点 | 仅完整 Atlas `navigate` 成功后更新 |
| `recovery` | 业务失败自动返航 | 无则 `null`；有则大脑不要再返航一次。顶层仍 `failed` |
| `result` | 业务数据 | 如 `target_id` |
| `error` | 失败码 | `{ code, message }` |
| `steps` | 调试轨迹 | 可选；禁止当作成败依据 |

大脑可传：语义 Anchor、物体/人文本、白名单动作、有限时长、`task_id`。  
禁止传：pose / path / atlas / connector / lease。  
禁止：在 prompt 里枚举全部工具、把 Skill 拆成原子 SOP。

---

## 6. 服务端运行时（大脑不重做）

1. 仅 Named Skill 内 `navigate` 被 Atlas 判成功后更新 `last_reached_anchor`。
2. 仅 Skill + 白名单业务失败可自动 `navigate(last_reached_anchor)` 一次；顶层仍 `failed`，写入 `recovery`。
3. 安全 / 定位 / lease 失败不自动返航。
4. 普通 Robot Tool fail-fast，无 Skill recovery。

其它：

- `finite_patrol`：持续循环；停用 `patrol_stop(task_id)`，不要当普通 cancel。`return_anchor` 不是 stop 后回家。
- `x5_stream`：仅 `start|status|stop` + `session_id`。普通视觉任务不要先开 X5。
- `get_task_status`：只回顶层任务。
- `perform_action`：仅生产白名单动作。

新增 Tool / Skill（schema + description 完整）→ 大脑通常零改动。改 `name` 或删能力 → 双端公告。

---

## 7. 自己怎么验通（交付前必做）

把下面的 `MCP_URL` 换成你们的地址。有 Bearer 时给 curl 加上 `-H "Authorization: Bearer <token>"`。

若 `initialize` 响应头里有 `mcp-session-id`，后面每次请求都要带上：`-H "mcp-session-id: <值>"`。

统一请求头：

```bash
MCP_URL="http://<host>:<port>/mcp"
HDR=(-H "Content-Type: application/json" -H "Accept: application/json, text/event-stream")
# 有 session 时再加：HDR+=(-H "mcp-session-id: $SID")
```

响应可能是纯 JSON，或 SSE（`data: {...}`）。能解析出 `result` 且没有 `error` 即成功。

### 步骤 0：普通健康检查（可选）

```bash
curl -sS "http://<host>:<port>/health"
```

期望：`{"ok": true, ...}`。这只证明进程活着，**不能**代替下面的 MCP 调用。

### 步骤 1：握手

```bash
curl -sS -D - "${MCP_URL}" "${HDR[@]}" -d '{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": { "name": "smallbrain-self-check", "version": "1.0.0" }
  }
}'
```

期望：HTTP 2xx；body 里有 `result.protocolVersion`、`result.capabilities.tools`。记下响应头 `mcp-session-id`。

然后发一条通知（无 `id`）：

```bash
curl -sS "${MCP_URL}" "${HDR[@]}" -d '{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}'
```

### 步骤 2：拉工具清单

```bash
curl -sS "${MCP_URL}" "${HDR[@]}" -d '{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}'
```

期望：`result.tools` 里能看到基线 `name`（至少 `navigate`、`knock_and_return`、`sit`、`get_task_status`）。每条有 `description` 和 `inputSchema`。

### 步骤 3：用这些入参试 `tools/call`

把 `<name>` / `<arguments>` 换成下表。模板：

```bash
curl -sS "${MCP_URL}" "${HDR[@]}" -d '{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "<name>",
    "arguments": <arguments>
  }
}'
```

| 序号 | 测什么 | `name` | `arguments` | 期望 |
|------|--------|--------|-------------|------|
| A | 原子导航 | `navigate` | `{"query":"110实验室"}` | `status=succeeded`，有 `observation`、`task_id` |
| B | Named Skill（勿拆 SOP） | `knock_and_return` | `{"door_anchor":"110实验室"}` | 一次成功；`kind=skill`；可带 `steps` |
| C | Skill + 途经点 | `knock_and_return` | `{"door_anchor":"110实验室","via_anchors":["上楼点"]}` | 同上 |
| D | 原地姿态 | `sit` | `{}` | `succeeded` |
| E | 定点寻物 Skill | `find_and_approach_at` | `{"search_anchor":"起点","object_query":"椅子"}` | `succeeded`；`result` 可含 `target_id` |
| F | 交接配送 Skill | `handoff_delivery` | `{"pickup_anchor":"图书馆","dropoff_anchor":"生活休息区"}` | `succeeded`；`last_reached_anchor` 为送达点 |
| G | 缺必填（应拒绝） | `navigate` | `{"query":""}` 或 `{}` | `rejected` / 结构化 `error`，不要 500 空包 |
| H | 未知 Anchor（应拒绝） | `navigate` | `{"query":"不存在的地点XYZ"}` | 明确失败（如 422 语义），不要静默改成别的点 |
| I | 非法动作（应拒绝） | `perform_action` | `{"action":"front_flip"}` | `rejected` |
| J | 长任务闭环 | 先 `finite_patrol` | `{"anchors":["110实验室","111实验室"]}` | `running`/`accepted` + `task_id` |
| J2 | 停巡航 | `patrol_stop` | `{"task_id":"<上一步返回的 id>","reason":"brain_requested"}` | `succeeded` |
| K | 查任务 | `get_task_status` | `{"task_id":"<A 或 B 的 task_id>"}` | 回顶层任务，字段与 call 时一致 |

`tools/call` 的业务 JSON 一般在 `result.content[0].text` 里（字符串），需要再 `JSON.parse` 一次。

### 步骤 4：对照「通了」的标准

全部满足再交付：

1. `initialize` + `tools/list` 成功  
2. A、B、D 成功且带 `observation`  
3. G、H、I 是结构化拒绝，不是进程崩溃  
4. J → J2 能停掉巡航  
5. 清单里没有 commissioning-only 动作  

把实际 `MCP_URL`、鉴权方式、`tools/list` 的 name 列表发给我们即可接入。

---

## 8. 参考

- 小脑合同：`BRAIN_SMALLBRAIN_REGISTRY_REVIEW_V1.md`
- 形状参考：`demo/mock-mcp-server.mjs`（开发地址 `http://127.0.0.1:3921/mcp`）
