import type { INodeProperties } from 'n8n-workflow';
const show = (operations: string[]) => ({
	displayOptions: { show: { resource: ['dashboard'], operation: operations } },
});
const selected = ['get', 'update', 'delete'];
export const dashboardProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['dashboard'] } },
		default: 'create',
		options: [
			{ name: 'Create', value: 'create', action: 'Create a dashboard' },
			{ name: 'Delete', value: 'delete', action: 'Delete a dashboard' },
			{ name: 'Get', value: 'get', action: 'Get a dashboard' },
			{ name: 'Get Many', value: 'getMany', action: 'Get many dashboards' },
			{ name: 'Update', value: 'update', action: 'Update a dashboard' },
		],
	},
	{
		displayName: 'Folder',
		name: 'folderId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: 'default' },
		...show(['create', 'get', 'update', 'delete']),
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchDashboardFolders', searchable: true },
			},
			{ displayName: 'By ID', name: 'id', type: 'string' },
		],
	},
	{
		displayName: 'Dashboard',
		name: 'dashboardId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		...show(selected),
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchDashboards', searchable: true },
			},
			{ displayName: 'By ID', name: 'id', type: 'string' },
		],
	},
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		...show(['create']),
	},
	{
		displayName: 'Description',
		name: 'description',
		type: 'string',
		default: '',
		...show(['create']),
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		description:
			'Friendly fields to replace; omitted fields retain their current values and Dashboard JSON is applied first',
		...show(['update']),
		options: [
			{ displayName: 'Description', name: 'description', type: 'string', default: '' },
			{ displayName: 'Title', name: 'title', type: 'string', default: '' },
		],
	},
	{
		displayName: 'Dashboard JSON',
		name: 'dashboardJson',
		type: 'json',
		default: '{"version":8,"tabs":[]}',
		description: 'Dashboard definition fields; Title and Description take precedence',
		...show(['create']),
	},
	{
		displayName: 'Dashboard JSON',
		name: 'dashboardJson',
		type: 'json',
		default: '{}',
		description:
			'Fields to merge into the current dashboard definition; Title and Description take precedence and omitted fields are preserved',
		...show(['update']),
	},
	{
		displayName: 'Folder Filter',
		name: 'folderFilter',
		type: 'string',
		default: '',
		description:
			'Folder ID; blank with no title lists only the default folder per OpenObserve semantics',
		...show(['getMany']),
	},
	{
		displayName: 'Title Filter',
		name: 'titleFilter',
		type: 'string',
		default: '',
		...show(['getMany']),
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
			show: { resource: ['dashboard'], operation: ['getMany'], returnAll: [false] },
		},
	},
	{
		displayName: 'I Understand This Permanently Deletes the Dashboard',
		name: 'confirmDestructive',
		type: 'boolean',
		default: false,
		...show(['delete']),
	},
];
