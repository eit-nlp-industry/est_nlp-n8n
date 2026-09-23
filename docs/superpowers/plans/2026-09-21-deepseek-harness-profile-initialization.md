# DeepSeek Harness Profile Initialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Initialize one real DeepSeek Harness Profile for every newly created n8n DeepSeek Harness agent.

**Architecture:** n8n owns one isolated `DSH_HOME` directory per agent. A small CLI adapter runs the official Harness `dsh` command with that home and verifies the generated profile files. The existing agent service keeps ownership of database ordering and cleanup.

**Tech Stack:** TypeScript, `@n8n/config`, `@n8n/di`, Node `child_process.execFile`, Vitest, TypeORM-backed n8n service.

**Spec:** `.agents/specs/deepseek-harness-profile-initialization.md`

## Global Constraints

- Do not modify DeepSeek Harness source code.
- Use `N8N_DEEPSEEK_HARNESS_HOME` for the n8n-owned root.
- Use `N8N_DEEPSEEK_HARNESS_PATH` as the Harness CLI working directory.
- Use the profile name from `N8N_DEEPSEEK_HARNESS_PROFILE`, default `n8n-web`.
- Do not start a long-lived Studio process in this change.
- Use tests that write only to temporary directories.

## Review Focus

- Missing Harness path must fail before a child process runs.
- Windows must use `pnpm.cmd`; other platforms must use `pnpm`.
- A failed child process must remove the new agent home.
- A successful child process that does not create the expected profile files must fail.
- A database save failure after successful initialization must remove the new agent home.

### Task 1: Add configuration and the CLI adapter

**Files:**
- Modify: `packages/@n8n/config/src/configs/deepseek-harness.config.ts`
- Create: `packages/cli/src/modules/deepseek-harness/deepseek-harness-cli.service.ts`
- Create: `packages/cli/src/modules/deepseek-harness/__tests__/deepseek-harness-cli.service.test.ts`

**Interfaces:**
- Consumes: `DeepSeekHarnessConfig.home`, `.path`, and `.profile`.
- Produces: `DeepSeekHarnessCliService.initializeProfile(home: string): Promise<void>`.

- [x] Write tests for missing path, platform command selection, environment propagation, and generated-file verification.
- [x] Run the focused CLI service test and verify it fails because the service does not exist.
- [x] Add the three config fields and implement the minimal `execFile` adapter with the boot-free `--dump-config` mode.
- [x] Run the focused CLI service test and verify it passes.

### Task 2: Connect profile initialization to agent creation

**Files:**
- Modify: `packages/cli/src/modules/deepseek-harness/deepseek-harness.service.ts`
- Modify: `packages/cli/src/modules/deepseek-harness/deepseek-harness.module.ts`
- Modify: `packages/cli/src/modules/deepseek-harness/__tests__/deepseek-harness.service.test.ts`

**Interfaces:**
- Consumes: `DeepSeekHarnessCliService.initializeProfile(home: string): Promise<void>`.
- Produces: Agent creation that saves only after Harness initialization succeeds.

- [x] Add a failing service test for CLI initialization before persistence.
- [x] Add a failing service test for initialization failure cleanup.
- [x] Inject the CLI service and call it after home creation and before repository save.
- [x] Preserve existing database-save cleanup behavior.
- [x] Run the focused service tests and verify they pass.

### Task 3: Verify and synchronize documentation

**Files:**
- Modify: `.agents/specs/deepseek-harness-profile-initialization.md`

- [x] Run the DeepSeek Harness module tests.
- [x] Run CLI typecheck and lint.
- [x] Re-read the spec against the implementation.
- [x] Mark completed TODO items and record any deferred Studio runtime work.

## Verification Commands

```powershell
pnpm --filter n8n test:unit -- src/modules/deepseek-harness/__tests__
pnpm --filter n8n typecheck
pnpm --filter n8n lint
```
