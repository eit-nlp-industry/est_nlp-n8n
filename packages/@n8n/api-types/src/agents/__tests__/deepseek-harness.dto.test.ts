import { CreateDeepSeekHarnessAgentDto } from '../dto';

describe('CreateDeepSeekHarnessAgentDto', () => {
	it('accepts an empty creation payload', () => {
		const result = CreateDeepSeekHarnessAgentDto.safeParse({});

		expect(result.success).toBe(true);
	});

	it('rejects unsupported creation fields', () => {
		expect(CreateDeepSeekHarnessAgentDto.safeParse({ name: 'Research agent' }).success).toBe(false);
	});
});
