import { useSearchParams } from 'react-router-dom';
import { TracesView } from '../components/organisms/TracesView';

export function TracesPage() {
  const [searchParams] = useSearchParams();
  const highlightTraceId = searchParams.get('highlight');

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-content-strong sm:text-2xl">Pipeline Traces</h1>
        <p className="mt-1 text-sm text-content-muted">
          View pipeline execution traces with step-by-step details
        </p>
      </div>
      <TracesView highlightTraceId={highlightTraceId} />
    </div>
  );
}
