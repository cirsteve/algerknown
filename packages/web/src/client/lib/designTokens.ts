/**
 * Shared status/type color classes.
 *
 * Each entry pairs a light-scheme triple (tinted fill, dark text, solid border)
 * with a `dark:` triple (translucent fill, light text, translucent border). The
 * hues themselves are the semantics and are identical across schemes; only the
 * contrast pairing changes.
 */

export const JOB_STATUS_COLORS: Record<string, string> = {
  pending:
    'bg-yellow-100 text-yellow-800 border border-yellow-300 dark:bg-yellow-500/20 dark:text-yellow-300 dark:border-yellow-500/30',
  running:
    'bg-sky-100 text-sky-800 border border-sky-300 dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-500/30',
  complete:
    'bg-green-100 text-green-800 border border-green-300 dark:bg-green-500/20 dark:text-green-300 dark:border-green-500/30',
  failed:
    'bg-red-100 text-red-800 border border-red-300 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/30',
};

export const JOB_TYPE_COLORS: Record<string, string> = {
  query:
    'bg-cyan-100 text-cyan-800 border border-cyan-300 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/30',
  ingest:
    'bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30',
};

export const SPAN_KIND_COLORS: Record<string, string> = {
  pipeline_run: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-300',
  pipeline_step: 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
  llm_call: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300',
  tool_call: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
  memory_query: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300',
  grading: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  agent_run: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300',
};

export const PIPELINE_COLORS: Record<string, string> = {
  query: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300',
  proposal: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  proposal_batch: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
};
