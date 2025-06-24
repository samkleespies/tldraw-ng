import { Component, createSignal, onMount, onCleanup, For } from 'solid-js';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source?: string;
  data?: any;
}

export interface ConsoleWidgetProps {
  id: number;
  logLevel: string;
  width: number;
  height: number;
  active: boolean;
  onLogEntry?: (entry: LogEntry) => void;
}

/**
 * Console Widget - Log aggregation and filtering
 */
export const ConsoleWidget: Component<ConsoleWidgetProps> = (props) => {
  const [logs, setLogs] = createSignal<LogEntry[]>([]);
  const [filteredLogs, setFilteredLogs] = createSignal<LogEntry[]>([]);
  const [filterLevel, setFilterLevel] = createSignal<string>('all');
  const [searchTerm, setSearchTerm] = createSignal('');
  const [autoScroll, setAutoScroll] = createSignal(true);
  const [isPaused, setIsPaused] = createSignal(false);
  
  let consoleRef: HTMLDivElement | undefined;
  let originalConsole: any = {};

  onMount(() => {
    console.log(`📊 Initializing Console Widget ${props.id}`);

    // Add some initial logs
    addLog('info', 'Console initialized', 'tldraw-ng');
    addLog('log', 'Monitoring application logs...', 'system');

    // Simulate some logs instead of intercepting global console
    simulateLogs();
  });

  // Removed console interception to prevent global console hijacking

  // Removed formatArgs function since we're not intercepting console anymore

  /**
   * Add log entry
   */
  const addLog = (level: LogEntry['level'], message: string, source?: string, data?: any) => {
    const entry: LogEntry = {
      id: `log_${Date.now()}_${Math.random()}`,
      timestamp: new Date(),
      level,
      message,
      source,
      data
    };

    setLogs(prev => {
      const newLogs = [...prev, entry];
      // Keep only last 1000 logs for performance
      return newLogs.slice(-1000);
    });

    props.onLogEntry?.(entry);
    
    // Auto-scroll to bottom if enabled
    if (autoScroll()) {
      setTimeout(() => {
        if (consoleRef) {
          consoleRef.scrollTop = consoleRef.scrollHeight;
        }
      }, 10);
    }
  };

  /**
   * Simulate realistic application logs for demo
   */
  const simulateLogs = () => {
    const initialMessages = [
      { level: 'info' as const, message: 'tldraw-ng application started', source: 'app' },
      { level: 'log' as const, message: 'Loading Rust WASM core...', source: 'wasm' },
      { level: 'info' as const, message: 'WebGPU context initialized successfully', source: 'graphics' },
      { level: 'debug' as const, message: 'Canvas dimensions: 1920x1080', source: 'canvas' },
      { level: 'log' as const, message: 'SolidJS components mounted', source: 'ui' },
      { level: 'info' as const, message: 'Coordinate transformer ready', source: 'core' },
      { level: 'log' as const, message: 'Tool system initialized', source: 'tools' }
    ];

    // Add initial messages with staggered timing
    initialMessages.forEach((msg, index) => {
      setTimeout(() => {
        addLog(msg.level, msg.message, msg.source);
      }, (index + 1) * 500);
    });

    // Continue with periodic realistic logs
    setInterval(() => {
      if (!isPaused()) {
        const realisticMessages = [
          { level: 'log' as const, message: `Shape created: ${['rectangle', 'circle', 'line'][Math.floor(Math.random() * 3)]}`, source: 'canvas' },
          { level: 'debug' as const, message: `FPS: ${Math.round(60 + Math.random() * 84)}`, source: 'performance' },
          { level: 'info' as const, message: 'Auto-save completed', source: 'storage' },
          { level: 'log' as const, message: `Zoom level: ${(0.5 + Math.random() * 2).toFixed(2)}x`, source: 'viewport' },
          { level: 'debug' as const, message: `Memory usage: ${Math.round(20 + Math.random() * 80)}MB`, source: 'system' },
          { level: 'log' as const, message: 'Tool changed to select', source: 'tools' },
          { level: 'info' as const, message: 'Widget rendered successfully', source: 'widgets' },
          { level: 'warn' as const, message: 'High memory usage detected', source: 'performance' },
          { level: 'log' as const, message: 'Undo operation completed', source: 'history' }
        ];
        const msg = realisticMessages[Math.floor(Math.random() * realisticMessages.length)];
        addLog(msg.level, msg.message, msg.source);
      }
    }, 3000 + Math.random() * 4000); // Random interval between 3-7 seconds
  };

  /**
   * Filter logs based on level and search term
   */
  const filterLogs = () => {
    const allLogs = logs();
    let filtered = allLogs;

    // Filter by level
    if (filterLevel() !== 'all') {
      filtered = filtered.filter(log => log.level === filterLevel());
    }

    // Filter by search term
    const search = searchTerm().toLowerCase();
    if (search) {
      filtered = filtered.filter(log => 
        log.message.toLowerCase().includes(search) ||
        log.source?.toLowerCase().includes(search)
      );
    }

    setFilteredLogs(filtered);
  };

  // Update filtered logs when logs, filter level, or search term changes
  (() => {
    filterLogs();
  })();

  /**
   * Clear all logs
   */
  const clearLogs = () => {
    setLogs([]);
    setFilteredLogs([]);
    addLog('info', 'Console cleared', 'system');
  };

  /**
   * Get log level color
   */
  const getLogLevelColor = (level: LogEntry['level']): string => {
    switch (level) {
      case 'error': return '#dc2626';
      case 'warn': return '#d97706';
      case 'info': return '#2563eb';
      case 'debug': return '#7c3aed';
      case 'log':
      default: return '#374151';
    }
  };

  /**
   * Get log level icon
   */
  const getLogLevelIcon = (level: LogEntry['level']): string => {
    switch (level) {
      case 'error': return '❌';
      case 'warn': return '⚠️';
      case 'info': return 'ℹ️';
      case 'debug': return '🐛';
      case 'log':
      default: return '📝';
    }
  };

  /**
   * Format timestamp
   */
  const formatTimestamp = (timestamp: Date): string => {
    return timestamp.toLocaleTimeString();
  };

  return (
    <div style={`width: 100%; height: 100%; display: flex; flex-direction: column; background: #1e1e1e; color: #cccccc; ${!props.active ? 'pointer-events: none; opacity: 0.7;' : ''}`}>
      {/* Header */}
      <div style="background: #2d2d30; border-bottom: 1px solid #3e3e42; padding: 8px 12px; display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="3" width="20" height="14" rx="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <span style="font-weight: 600; font-size: 14px;">Console</span>
        
        {/* Controls */}
        <div style="margin-left: auto; display: flex; align-items: center; gap: 8px;">
          <select
            value={filterLevel()}
            onChange={(e) => setFilterLevel(e.currentTarget.value)}
            style="background: #3c3c3c; border: 1px solid #555; color: #cccccc; padding: 4px 8px; border-radius: 4px; font-size: 12px;"
          >
            <option value="all">All</option>
            <option value="log">Log</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
            <option value="debug">Debug</option>
          </select>
          
          <input
            type="text"
            placeholder="Search..."
            value={searchTerm()}
            onInput={(e) => setSearchTerm(e.currentTarget.value)}
            style="background: #3c3c3c; border: 1px solid #555; color: #cccccc; padding: 4px 8px; border-radius: 4px; font-size: 12px; width: 120px;"
          />
          
          <button
            onClick={() => setIsPaused(!isPaused())}
            style={`background: ${isPaused() ? '#dc2626' : '#16a34a'}; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 12px; cursor: pointer;`}
            title={isPaused() ? 'Resume' : 'Pause'}
          >
            {isPaused() ? '▶️' : '⏸️'}
          </button>
          
          <button
            onClick={clearLogs}
            style="background: #6b7280; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 12px; cursor: pointer;"
            title="Clear"
          >
            🗑️
          </button>
        </div>
      </div>

      {/* Logs */}
      <div 
        ref={consoleRef}
        style="flex: 1; overflow-y: auto; padding: 8px; font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.4;"
      >
        <For each={filteredLogs()}>
          {(log) => (
            <div style="display: flex; align-items: flex-start; gap: 8px; padding: 2px 0; border-bottom: 1px solid #333; margin-bottom: 2px;">
              <span style="color: #6b7280; font-size: 10px; min-width: 60px; flex-shrink: 0;">
                {formatTimestamp(log.timestamp)}
              </span>
              <span style="font-size: 12px; min-width: 16px; flex-shrink: 0;">
                {getLogLevelIcon(log.level)}
              </span>
              <span style={`color: ${getLogLevelColor(log.level)}; font-weight: 600; min-width: 50px; flex-shrink: 0; text-transform: uppercase; font-size: 10px;`}>
                {log.level}
              </span>
              {log.source && (
                <span style="color: #9ca3af; font-size: 10px; min-width: 60px; flex-shrink: 0;">
                  [{log.source}]
                </span>
              )}
              <span style="flex: 1; word-break: break-word; white-space: pre-wrap;">
                {log.message}
              </span>
            </div>
          )}
        </For>
        
        {filteredLogs().length === 0 && (
          <div style="text-align: center; color: #6b7280; margin-top: 40px;">
            <div style="font-size: 24px; margin-bottom: 8px;">📊</div>
            <div>No logs to display</div>
            {searchTerm() && <div style="font-size: 11px; margin-top: 4px;">Try adjusting your search or filter</div>}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style="background: #2d2d30; border-top: 1px solid #3e3e42; padding: 6px 12px; font-size: 11px; color: #9ca3af; display: flex; justify-content: between; align-items: center;">
        <span>{filteredLogs().length} of {logs().length} logs</span>
        <label style="display: flex; align-items: center; gap: 4px; margin-left: auto;">
          <input
            type="checkbox"
            checked={autoScroll()}
            onChange={(e) => setAutoScroll(e.currentTarget.checked)}
          />
          Auto-scroll
        </label>
      </div>
    </div>
  );
};

export default ConsoleWidget;
