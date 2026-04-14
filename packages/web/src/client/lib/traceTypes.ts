export interface Span {
  id: string;
  trace_id: string;
  parent_id: string | null;
  kind: string;
  name: string;
  input: string | null;
  output: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  error: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cost: number | null;
  } | null;
}

export interface TraceGroup {
  trace_id: string;
  name: string;
  started_at: string;
  duration_ms: number | null;
  error: string | null;
  step_count: number;
  error_count: number;
}

export interface TracesResponse {
  traces: TraceGroup[];
  next_cursor: string | null;
}

export interface TraceDetailResponse {
  spans: Span[];
}
