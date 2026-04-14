import { useSearchParams } from 'react-router-dom';
import { TracesView } from '../components/organisms/TracesView';

export function TracesPage() {
  const [searchParams] = useSearchParams();
  const highlightTraceId = searchParams.get('highlight');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Pipeline Traces</h1>
        <p className="text-sm text-slate-400 mt-1">
          View pipeline execution traces with step-by-step details
        </p>
      </div>
      <TracesView highlightTraceId={highlightTraceId} />
    </div>
  );
}
