import type { INodeProperties } from 'n8n-workflow';
const show = (operations: string[]) => ({
	displayOptions: { show: { resource: ['function'], operation: operations } },
});
const selected = ['getDependencies', 'update', 'delete'];
const configured = ['create', 'update'];
export const functionProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['function'] } },
		default: 'create',
		options: [
			{ name: 'Create', value: 'create', action: 'Create a function' },
			{ name: 'Delete', value: 'delete', action: 'Delete a function' },
			{
				name: 'Get Dependencies',
				value: 'getDependencies',
				action: 'Get function pipeline and stream dependencies',
				description: 'Get dependency information, not the function definition',
			},
			{ name: 'Get Many', value: 'getMany', action: 'Get many functions' },
			{ name: 'Update', value: 'update', action: 'Update a function' },
			{ name: 'Validate VRL', value: 'validate', action: 'Validate VRL against sample events' },
		],
	},
	{
		displayName: 'Function',
		name: 'functionName',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		...show(selected),
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchFunctions', searchable: true },
			},
			{ displayName: 'By Name', name: 'id', type: 'string' },
		],
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		required: true,
		default: '',
		...show(['create']),
	},
	{
		displayName: 'VRL',
		name: 'vrl',
		type: 'string',
		typeOptions: { rows: 8 },
		required: true,
		default: '.\n',
		description: 'Vector Remap Language transformation',
		...show([...configured, 'validate']),
	},
	{
		displayName: 'Parameter Names',
		name: 'params',
		type: 'string',
		default: '',
		description: 'Comma-separated parameter names used by the function',
		...show(configured),
	},
	{
		displayName: 'Argument Count',
		name: 'numArgs',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 0,
		...show(configured),
	},
	{
		displayName: 'Advanced Function JSON',
		name: 'advancedJson',
		type: 'json',
		default: '{}',
		description:
			'Supplements the friendly function fields with other verified fields; friendly fields win on conflicts',
		...show(configured),
	},
	{
		displayName: 'Sample Events JSON',
		name: 'eventsJson',
		type: 'json',
		required: true,
		default: '[{}]',
		description: 'JSON array of sample events passed to VRL validation',
		...show(['validate']),
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		...show(['getMany']),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: {
			show: { resource: ['function'], operation: ['getMany'], returnAll: [false] },
		},
	},
	{
		displayName: 'I Understand This Permanently Deletes the Function',
		name: 'confirmDestructive',
		type: 'boolean',
		default: false,
		...show(['delete']),
	},
];
