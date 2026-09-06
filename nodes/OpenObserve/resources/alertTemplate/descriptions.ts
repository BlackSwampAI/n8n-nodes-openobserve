import type { INodeProperties } from 'n8n-workflow';

const show = (operations: string[]) => ({
	displayOptions: { show: { resource: ['alertTemplate'], operation: operations } },
});

export const alertTemplateProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['alertTemplate'] } },
		default: 'create',
		options: [
			{ name: 'Create', value: 'create', action: 'Create an alert template' },
			{ name: 'Delete', value: 'delete', action: 'Delete an alert template' },
			{ name: 'Get', value: 'get', action: 'Get an alert template' },
			{ name: 'Get Many', value: 'getMany', action: 'Get many alert templates' },
			{ name: 'Get Prebuilt', value: 'getPrebuilt', action: 'Get prebuilt alert templates' },
			{ name: 'Update', value: 'update', action: 'Update an alert template' },
		],
	},
	{
		displayName: 'Template',
		name: 'templateName',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		...show(['get', 'update', 'delete']),
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchAlertTemplates', searchable: true },
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
		displayName: 'Type',
		name: 'templateType',
		type: 'options',
		default: 'http',
		options: [
			{ name: 'Webhook', value: 'http' },
			{ name: 'Email', value: 'email' },
		],
		...show(['create']),
	},
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		description: 'Required email subject',
		displayOptions: {
			show: { resource: ['alertTemplate'], operation: ['create'], templateType: ['email'] },
		},
	},
	{
		displayName: 'Body',
		name: 'body',
		type: 'string',
		typeOptions: { rows: 8 },
		required: true,
		default: '{}',
		...show(['create']),
	},
	{
		displayName: 'Template JSON',
		name: 'templateJson',
		type: 'json',
		default: '{}',
		description: 'Additional supported template fields; friendly fields take precedence',
		...show(['create']),
	},
	{
		displayName: 'Update JSON',
		name: 'templateJson',
		type: 'json',
		default: '{}',
		description:
			'Fields to merge into the current template; the selected template name cannot be changed',
		...show(['update']),
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		...show(['getMany', 'getPrebuilt']),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: {
			show: {
				resource: ['alertTemplate'],
				operation: ['getMany', 'getPrebuilt'],
				returnAll: [false],
			},
		},
	},
	{
		displayName: 'I Understand This Permanently Deletes the Template',
		name: 'confirmDestructive',
		type: 'boolean',
		default: false,
		...show(['delete']),
	},
];
