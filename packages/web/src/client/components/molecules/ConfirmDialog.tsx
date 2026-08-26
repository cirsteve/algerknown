import { ReactNode, useState } from 'react';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
  loading?: boolean;
  confirmText?: string;
  confirmTextLabel?: string;
}

/**
 * ConfirmDialog molecule - Modal dialog for confirming actions
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  loading = false,
  confirmText,
  confirmTextLabel,
}: ConfirmDialogProps) {
  const [inputValue, setInputValue] = useState('');

  if (!open) return null;

  const canConfirm = confirmText ? inputValue === confirmText : true;
  
  const handleClose = () => {
    setInputValue('');
    onClose();
  };

  const handleConfirm = () => {
    if (canConfirm) {
      onConfirm();
      setInputValue('');
    }
  };

  const titleColor = variant === 'danger' ? 'text-red-700 dark:text-red-400' : 
                     variant === 'warning' ? 'text-yellow-700 dark:text-yellow-400' : 
                     'text-content-strong';

  const confirmVariant = variant === 'danger' ? 'danger' : 
                         variant === 'warning' ? 'secondary' : 
                         'primary';

  return (
    <div className="fixed inset-0 bg-slate-900/60 dark:bg-black/70 flex items-center justify-center z-50">
      <div 
        className="bg-surface-raised border border-edge shadow-xl rounded-lg p-6 max-w-md w-full mx-4 space-y-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <h2 id="dialog-title" className={`text-xl font-bold ${titleColor}`}>
          {title}
        </h2>
        
        <div className="text-content-muted">
          {message}
        </div>

        {confirmText && (
          <div className="space-y-2">
            {confirmTextLabel && (
              <p className="text-sm text-content-muted">{confirmTextLabel}</p>
            )}
            <p className="font-mono text-sm bg-surface-sunken border border-edge p-2 rounded text-content">
              {confirmText}
            </p>
            <Input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Type to confirm"
              className="font-mono text-sm"
              autoFocus
            />
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <Button
            variant="secondary"
            onClick={handleClose}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            onClick={handleConfirm}
            disabled={!canConfirm || loading}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
