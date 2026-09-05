export type StreamType = 'logs' | 'metrics' | 'traces';

export interface StreamSummary {
	name: string;
	stream_type?: StreamType;
	[key: string]: unknown;
}

export interface StreamListResponse {
	list: StreamSummary[];
	total: number;
}
