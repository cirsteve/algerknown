interface StatusIndicatorProps {
  status: 'online' | 'offline' | 'checking' | 'unknown';
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
  className?: string;
}

// Solid dots: the light scheme needs a darker shade to stay visible on white.
const statusColors = {
  online: 'bg-green-600 dark:bg-green-500',
  offline: 'bg-red-600 dark:bg-red-500',
  checking: 'bg-yellow-600 dark:bg-yellow-500',
  unknown: 'bg-yellow-600 dark:bg-yellow-500',
};

const sizeStyles = {
  sm: 'w-1.5 h-1.5',
  md: 'w-2 h-2',
  lg: 'w-3 h-3',
};

/**
 * StatusIndicator atom - A colored dot indicating connection/status
 */
export function StatusIndicator({ 
  status, 
  size = 'md', 
  pulse = false,
  className = '' 
}: StatusIndicatorProps) {
  const shouldPulse = pulse || status === 'checking';
  
  return (
    <div
      className={`
        rounded-full 
        ${statusColors[status]} 
        ${sizeStyles[size]} 
        ${shouldPulse ? 'animate-pulse' : ''}
        ${className}
      `}
      role="status"
      aria-label={`Status: ${status}`}
    />
  );
}

interface ConnectionStatusProps {
  connected: boolean | null;
  checking?: boolean;
  label?: string;
  className?: string;
}

/**
 * ConnectionStatus atom - Status indicator with optional label
 */
export function ConnectionStatus({ 
  connected, 
  checking = false, 
  label,
  className = '' 
}: ConnectionStatusProps) {
  const status = checking 
    ? 'checking' 
    : connected === null 
      ? 'unknown' 
      : connected 
        ? 'online' 
        : 'offline';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <StatusIndicator status={status} />
      {label && <span className="text-sm text-content-muted">{label}</span>}
    </div>
  );
}
