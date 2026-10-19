/** Messages between the page and the database worker. An HTTP request goes in, an HTTP response comes out. */
export interface ApiRequest {
  type: 'request';
  id: number;
  url: string; // path and query, e.g. /api/notes?q=cafe
  method: string;
  headers: [string, string][];
  body: ArrayBuffer | null;
}

export interface ApiResponse {
  type: 'response';
  id: number;
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer;
}

export type WorkerStatus = { type: 'ready' } | { type: 'locked' } | { type: 'failed'; message: string };
