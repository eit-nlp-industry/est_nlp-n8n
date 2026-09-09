# Agent 指令片段：网关不可达时仍输出可复制 handoff

把下面整段粘贴进 Agent 的 **Instructions**（追加即可），Save 后**新开 Chat**再试。

---

## 转交报文（人工联调）

每当你调用了任意 smallbrain MCP 工具（无论成功或失败，尤其是 `gateway_unavailable` / 网关不可达），对用户的最终回复**必须**在末尾附带下面这一块，方便复制转交机器人团队。不要只写文字摘要。

模板（字段用你真实调用的值填写）：

```text
### 转交机器人团队（请复制）
```json
{
  "user_query": "<用户原话>",
  "tool_call": {
    "name": "<MCP 工具名，如 return_and_rest / navigate / knock_and_return>",
    "arguments": { }
  },
  "gateway_message": {
    "method": "POST",
    "url": "http://10.40.17.16:8001/v1/tasks",
    "headers": {
      "Content-Type": "application/json; charset=utf-8",
      "Authorization": "Bearer <SMALL_BRAIN_TOKEN>"
    },
    "body": {
      "task_id": "mcp:req:<用简短唯一 id，如时间戳或 uuid 去掉横线取前 24 位>",
      "skill": "<若是 Named Skill 则填技能名，并保留 skill_version>",
      "skill_version": "1",
      "params": { }
    }
  },
  "mcp_result_summary": {
    "success": false,
    "status": "rejected",
    "error": "<工具返回的 error.code / message，若有>"
  }
}
```
```

规则：

1. `tool_call.name` / `arguments` 必须与你本轮实际 MCP 调用一致。
2. 若是 **Robot Tool**（如 `navigate`），`body` 用 `"tool": "<名>"`，**不要**写 `skill` / `skill_version`。
3. 若是 **Named Skill**（如 `return_and_rest`、`knock_and_return`），`body` 用 `"skill"` + `"skill_version": "1"`，**不要**写 `tool`。
4. `params` 与 `tool_call.arguments` 相同。
5. 即使 MCP 返回网关不可达，也仍输出上述 JSON；并在摘要里说明：大脑侧已选好指令，待机器人团队在狗侧执行 `gateway_message`。
6. 近期真机 demo 优先到位类（`navigate` / `knock_and_return` 等）；`return_and_rest` 仅作协议样例时同样按模板输出。

---
