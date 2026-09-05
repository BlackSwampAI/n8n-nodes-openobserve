import type { INodeProperties } from 'n8n-workflow';

export const logProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['log'] } },
		options: [
			{
				name: 'Ingest',
				value: 'ingest',
				action: 'Ingest one log record',
				description: 'Send one structured JSON object as a one-record array',
			},
			{
				name: 'Ingest Many',
				value: 'ingestMany',
				action: 'Ingest input items',
				description: 'Send all input item JSON objects in one deterministic JSON array',
			},
		],
		default: 'ingest',
	},
	{
		displayName: 'Stream Name',
		name: 'streamName',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		description: 'The stream is inferred and created when it does not exist',
		displayOptions: { show: { resource: ['log'] } },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchStreams', searchable: true },
			},
			{ displayName: 'By Name', name: 'id', type: 'string', placeholder: 'application_logs' },
		],
	},
	{
		displayName: 'Record JSON',
		name: 'recordJson',
		type: 'json',
		required: true,
		default: '{}',
		description: 'Structured log object; it is sent unchanged inside a one-element array',
		displayOptions: { show: { resource: ['log'], operation: ['ingest'] } },
	},
];
