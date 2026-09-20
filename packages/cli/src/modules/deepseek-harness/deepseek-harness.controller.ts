import {
	CreateDeepSeekHarnessAgentDto,
	type DeepSeekHarnessAgentDto,
	UpdateDeepSeekHarnessAgentDto,
} from '@n8n/api-types';
import type { AuthenticatedRequest } from '@n8n/db';
import { Body, Delete, Get, Param, Patch, Post, ProjectScope, RestController } from '@n8n/decorators';

import { NotFoundError } from '@/errors/response-errors/not-found.error';

import { DeepSeekHarnessService } from './deepseek-harness.service';

@RestController('/projects/:projectId/deepseek-harness/agents')
export class DeepSeekHarnessController {
	constructor(private readonly service: DeepSeekHarnessService) {}

	@Post('/')
	@ProjectScope('agent:create')
	async create(
		req: AuthenticatedRequest<{ projectId: string }>,
		_res: unknown,
		@Body _dto: CreateDeepSeekHarnessAgentDto,
	): Promise<DeepSeekHarnessAgentDto> {
		return await this.service.createForProject(req.user.email, req.params.projectId);
	}

	@Get('/')
	@ProjectScope('agent:list')
	async list(req: AuthenticatedRequest<{ projectId: string }>): Promise<DeepSeekHarnessAgentDto[]> {
		return await this.service.listForProject(req.params.projectId);
	}

	@Get('/:agentId')
	@ProjectScope('agent:read')
	async get(
		req: AuthenticatedRequest<{ projectId: string }>,
		_res: unknown,
		@Param('agentId') agentId: string,
	): Promise<DeepSeekHarnessAgentDto> {
		const agent = await this.service.getForProject(agentId, req.params.projectId);
		if (!agent) throw new NotFoundError(`DeepSeek Harness agent "${agentId}" not found`);
		return agent;
	}

	@Patch('/:agentId')
	@ProjectScope('agent:update')
	async update(
		req: AuthenticatedRequest<{ projectId: string }>,
		_res: unknown,
		@Param('agentId') agentId: string,
		@Body dto: UpdateDeepSeekHarnessAgentDto,
	): Promise<DeepSeekHarnessAgentDto> {
		const agent = await this.service.updateForProject(agentId, req.params.projectId, dto.name);
		if (!agent) throw new NotFoundError(`DeepSeek Harness agent "${agentId}" not found`);
		return agent;
	}

	@Delete('/:agentId')
	@ProjectScope('agent:delete')
	async delete(
		req: AuthenticatedRequest<{ projectId: string }>,
		_res: unknown,
		@Param('agentId') agentId: string,
	): Promise<{ success: true }> {
		const deleted = await this.service.deleteForProject(agentId, req.params.projectId);
		if (!deleted) throw new NotFoundError(`DeepSeek Harness agent "${agentId}" not found`);
		return { success: true };
	}
}
