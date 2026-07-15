import { Badge } from '../atoms/Badge';
import { reasonCodeMessage } from '../../lib/reasonCodes';
import type { EvaluatorVerdict } from '../../lib/governanceApi';

interface RailVerdictsProps {
  verdicts: EvaluatorVerdict[];
}

/** Every evaluator verdict with its code/message -- never collapsed to a single pass/fail summary. */
export function RailVerdicts({ verdicts }: RailVerdictsProps) {
  if (verdicts.length === 0) {
    return <p className="text-sm text-slate-500">No evaluator verdicts recorded.</p>;
  }

  return (
    <ul className="space-y-2">
      {verdicts.map((verdict, i) => (
        <li key={`${verdict.evaluator}-${i}`} className="bg-slate-900/50 rounded p-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant={verdict.passed ? 'success' : 'danger'}>{verdict.passed ? 'passed' : 'failed'}</Badge>
            <span className="font-medium text-slate-200">{verdict.evaluator}</span>
          </div>
          {verdict.reasonCodes.length > 0 && (
            <ul className="mt-2 space-y-1">
              {verdict.reasonCodes.map((code) => (
                <li key={code} className="text-xs text-slate-400">
                  <span className="font-mono text-slate-500">{code}</span> — {reasonCodeMessage(code)}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
