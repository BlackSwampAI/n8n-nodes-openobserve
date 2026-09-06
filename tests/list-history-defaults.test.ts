import type { IExecuteFunctions } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('../nodes/OpenObserve/shared/transport', () => ({ openObserveApiRequest: requestMock }));

import { executeAlert } from '../nodes/OpenObserve/resources/alert/execute';
import { executeAlertDestination } from '../nodes/OpenObserve/resources/alertDestination/execute';
import { executeAlertTemplate } from '../nodes/OpenObserve/resources/alertTemplate/execute';
import { executePipeline } from '../nodes/OpenObserve/resources/pipeline/execute';
import { getManyStreams } from '../nodes/OpenObserve/resources/stream/execute';

function context(parameters: Record<string, unknown> = {}): IExecuteFunctions {
	return {
		getNodeParameter: (name: string, _itemIndex: number, fallback: unknown) =>
			parameters[name] ?? fallback,
	} as unknown as IExecuteFunctions;
}

describe('Get Many and Get History editor defaults', () => {
	beforeEach(() => requestMock.mockReset());

	it('returns empty output for the audited blank/default Get Many configurations', async () => {
		const cases: Array<{
			response: unknown;
			run: () => Promise<unknown[]>;
		}> = [
			{ response: { list: [] }, run: () => getManyStreams(context()) },
			{ response: [], run: () => executeAlertTemplate(context(), 'getMany', 0) },
			{ response: [], run: () => executeAlertDestination(context(), 'getMany', 0) },
			{
				response: { list: [] },
				run: () =>
					executeAlert(context({ alertFolder: { mode: 'list', value: 'default' } }), 'getMany', 0),
			},
			{ response: { list: [] }, run: () => executePipeline(context(), 'getMany', 0) },
		];
		for (const testCase of cases) {
			requestMock.mockResolvedValueOnce(testCase.response);
			expect(await testCase.run()).toEqual([]);
		}
		expect(requestMock).toHaveBeenCalledTimes(cases.length);
	});

	it('uses the v2 Alert History empty wrapper with no optional filters', async () => {
		requestMock.mockResolvedValueOnce({ total: 0, from: 0, size: 50, hits: [] });
		expect(await executeAlert(context(), 'getHistory', 0)).toEqual([]);
		expect(requestMock.mock.calls[0][0]).toMatchObject({
			apiPathMode: 'v2',
			pathSegments: ['alerts', 'history'],
			query: { from: 0, size: 50 },
		});
	});

	it('refuses blank Pipeline History before transport', async () => {
		await expect(executePipeline(context(), 'getHistory', 6)).rejects.toThrow(/Pipeline.*item 6/);
		expect(requestMock).not.toHaveBeenCalled();
	});
});
