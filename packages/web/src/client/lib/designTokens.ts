export const JOB_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30',
  running: 'bg-sky-500/20 text-sky-300 border border-sky-500/30',
  complete: 'bg-green-500/20 text-green-300 border border-green-500/30',
  failed: 'bg-red-500/20 text-red-300 border border-red-500/30',
};

export const JOB_TYPE_COLORS: Record<string, string> = {
  query: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30',
  ingest: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
};

export const SPAN_KIND_COLORS: Record<string, string> = {
  pipeline_run: 'bg-cyan-500/20 text-cyan-300',
  pipeline_step: 'bg-slate-500/20 text-slate-300',
  llm_call: 'bg-yellow-500/20 text-yellow-300',
  tool_call: 'bg-green-500/20 text-green-300',
  memory_query: 'bg-purple-500/20 text-purple-300',
  grading: 'bg-blue-500/20 text-blue-300',
  agent_run: 'bg-purple-500/20 text-purple-300',
};

export const PIPELINE_COLORS: Record<string, string> = {
  query: 'bg-sky-500/20 text-sky-300',
  proposal: 'bg-amber-500/20 text-amber-300',
  proposal_batch: 'bg-amber-500/20 text-amber-300',
};
