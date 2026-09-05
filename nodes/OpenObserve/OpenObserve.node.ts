import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

/** Compile-safe Batch 0 shell. OpenObserve operations and credentials begin in Batch 1. */
export class OpenObserve implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'OpenObserve',
		name: 'openObserve',
		group: ['transform'],
		version: 1,
		description: 'Connect workflows to OpenObserve',
		defaults: { name: 'OpenObserve' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'This development scaffold does not contain OpenObserve operations yet',
				name: 'batchZeroNotice',
				type: 'notice',
				default: '',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return [this.getInputData()];
	}
}
