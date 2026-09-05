import type { INodeProperties } from 'n8n-workflow';

const streamOperations = [
	{
		name: 'Delete',
		value: 'delete',
		action: 'Delete a stream',
		description: 'Permanently delete a stream',
	},
	{
		name: 'Delete Fields',
		value: 'deleteFields',
		action: 'Delete stream fields',
		description: 'Permanently remove fields from a stream schema',
	},
	{
		name: 'Get Many',
		value: 'getMany',
		action: 'Get many streams',
		description: 'List streams in the organization',
	},
	{
		name: 'Get Schema',
		value: 'getSchema',
		action: 'Get a stream schema',
		description: 'Get fields, settings, and statistics for a stream',
	},
	{
		name: 'Update Settings',
		value: 'updateSettings',
		action: 'Update stream settings',
		description: 'Apply supported settings to a stream',
	},
] as const;

const streamType: INodeProperties = {
	displayName: 'Stream Type',
	name: 'streamType',
	type: 'options',
	options: [
		{ name: 'Logs', value: 'logs' },
		{ name: 'Metrics', value: 'metrics' },
		{ name: 'Traces', value: 'traces' },
	],
	default: 'logs',
};

const existingStream: INodeProperties = {
	displayName: 'Stream',
	name: 'streamName',
	type: 'resourceLocator',
	required: true,
	default: { mode: 'list', value: '' },
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: { searchListMethod: 'searchStreams', searchable: true },
		},
		{ displayName: 'By Name', name: 'id', type: 'string', placeholder: 'my_stream' },
	],
};

export const streamProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['stream'] } },
		options: [...streamOperations],
		default: 'getMany',
	},
	{
		...streamType,
		displayOptions: { show: { resource: ['stream'] } },
	},
	{
		...existingStream,
		displayOptions: {
			show: {
				resource: ['stream'],
				operation: ['delete', 'deleteFields', 'getSchema', 'updateSettings'],
			},
		},
	},
	{
		displayName: 'Settings JSON',
		name: 'settingsJson',
		type: 'json',
		required: true,
		default: '{}',
		description:
			'OpenObserve stream settings object; it must contain at least one setting, and only supplied keys are changed',
		displayOptions: { show: { resource: ['stream'], operation: ['updateSettings'] } },
	},
	{
		displayName: 'Fields',
		name: 'fields',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'temporary_field,old_field',
		description: 'Comma-separated field names to permanently delete from the schema',
		displayOptions: { show: { resource: ['stream'], operation: ['deleteFields'] } },
	},
	{
		displayName: 'I Understand This Permanently Changes the Stream',
		name: 'confirmDestructive',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: ['stream'], operation: ['delete', 'deleteFields'] } },
	},
	{
		displayName: 'Delete Related Resources',
		name: 'deleteAll',
		type: 'boolean',
		default: false,
		description:
			'Whether to also delete related OpenObserve resources such as alerts and dashboards',
		displayOptions: { show: { resource: ['stream'], operation: ['delete'] } },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['stream'], operation: ['getMany'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['stream'], operation: ['getMany'], returnAll: [false] } },
	},
	{
		displayName: 'Keyword',
		name: 'keyword',
		type: 'string',
		default: '',
		displayOptions: { show: { resource: ['stream'], operation: ['getMany', 'getSchema'] } },
	},
	{
		displayName: 'Sort',
		name: 'sort',
		type: 'string',
		default: '',
		description: 'Optional OpenObserve stream-list sort expression',
		displayOptions: { show: { resource: ['stream'], operation: ['getMany'] } },
	},
];
