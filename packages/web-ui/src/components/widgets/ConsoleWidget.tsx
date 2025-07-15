import { Component, createSignal, createEffect, onMount, onCleanup, For } from 'solid-js';
import { useWidgetLinking } from '../../context/WidgetLinkingContext';
import { consoleBroadcaster, ConsoleMessage } from '../../utils/console-broadcaster';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source?: string;
  data?: any;
  category?: 'build' | 'runtime' | 'system' | 'webcontainer' | 'preview';
  count?: number;
  firstTimestamp?: Date;
  lastTimestamp?: Date;
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
  const [filterCategory, setFilterCategory] = createSignal<string>('all');
  const [searchTerm, setSearchTerm] = createSignal('');
  const [autoScroll, setAutoScroll] = createSignal(true);
  const [isPaused, setIsPaused] = createSignal(false);
  const [timestampRefresh, setTimestampRefresh] = createSignal(0);
  const [stats, setStats] = createSignal({
    total: 0,
    errors: 0,
    warnings: 0,
    info: 0,
    debug: 0,
    logs: 0
  });

  const { handleTitleBarDrag } = useWidgetLinking();

  let consoleRef: HTMLDivElement | undefined;
  let unsubscribeFromBroadcaster: (() => void) | null = null;

  /**
   * Update statistics based on current logs
   */
  const updateStats = () => {
    const allLogs = logs();
    const newStats = {
      total: allLogs.length,
      errors: allLogs.filter(log => log.level === 'error').length,
      warnings: allLogs.filter(log => log.level === 'warn').length,
      info: allLogs.filter(log => log.level === 'info').length,
      debug: allLogs.filter(log => log.level === 'debug').length,
      logs: allLogs.filter(log => log.level === 'log').length
    };
    setStats(newStats);
  };

  onMount(() => {
    console.log(`📊 Initializing Console Widget ${props.id}`);

    // Subscribe to console broadcaster
    unsubscribeFromBroadcaster = consoleBroadcaster.addListener((message: ConsoleMessage) => {
      // Handle special clear message
      if (message.message === '__CONSOLE_CLEAR__') {
        setLogs([]);
        setFilteredLogs([]);
        updateStats();
        return;
      }

      if (!isPaused()) {
        const logEntry: LogEntry = {
          id: message.id,
          timestamp: message.timestamp,
          level: message.level,
          message: message.message,
          source: message.source,
          data: message.data,
          category: message.category,
          count: message.count,
          firstTimestamp: message.firstTimestamp,
          lastTimestamp: message.lastTimestamp
        };

        setLogs(prev => {
          // Check if this is an update to an existing grouped message
          const existingIndex = prev.findIndex(log => log.id === message.id);
          if (existingIndex !== -1) {
            // Update existing message
            const newLogs = [...prev];
            newLogs[existingIndex] = logEntry;
            return newLogs;
          } else {
            // Add new message
            const newLogs = [...prev, logEntry];
            // Keep only last 1000 logs for performance
            return newLogs.slice(-1000);
          }
        });

        // Update statistics
        updateStats();

        props.onLogEntry?.(logEntry);

        // Auto-scroll to bottom if enabled
        if (autoScroll()) {
          setTimeout(() => {
            if (consoleRef) {
              consoleRef.scrollTop = consoleRef.scrollHeight;
            }
          }, 10);
        }
      }
    });

    // Load existing history
    const history = consoleBroadcaster.getHistory();

    const logEntries: LogEntry[] = history.map(message => ({
      id: message.id,
      timestamp: message.timestamp,
      level: message.level,
      message: message.message,
      source: message.source,
      data: message.data,
      category: message.category
    }));
    setLogs(logEntries);

    // Update initial statistics
    updateStats();

    // Set up timestamp refresh interval
    const timestampInterval = setInterval(() => {
      setTimestampRefresh(prev => prev + 1);
    }, 30000); // Update every 30 seconds

    // Initial log
    consoleBroadcaster.info(`Console Widget ${props.id} connected`, 'console-widget', 'system');

    onCleanup(() => {
      clearInterval(timestampInterval);
    });
  });

  onCleanup(() => {
    // Unsubscribe from console broadcaster
    if (unsubscribeFromBroadcaster) {
      unsubscribeFromBroadcaster();
      unsubscribeFromBroadcaster = null;
    }

    consoleBroadcaster.info(`Console Widget ${props.id} disconnected`, 'console-widget', 'system');
  });

  /**
   * Filter logs based on level, category, and search term
   */
  const filterLogs = () => {
    const allLogs = logs();
    let filtered = allLogs;

    // Filter by level
    if (filterLevel() !== 'all') {
      filtered = filtered.filter(log => log.level === filterLevel());
    }

    // Filter by category
    if (filterCategory() !== 'all') {
      filtered = filtered.filter(log => log.category === filterCategory());
    }

    // Filter by search term
    const search = searchTerm().toLowerCase();
    if (search) {
      filtered = filtered.filter(log =>
        log.message.toLowerCase().includes(search) ||
        log.source?.toLowerCase().includes(search) ||
        log.category?.toLowerCase().includes(search)
      );
    }

    setFilteredLogs(filtered);
  };

  // Update filtered logs when logs, filter level, or search term changes
  createEffect(() => {
    // Watch for changes in logs, filterLevel, filterCategory, and searchTerm
    logs();
    filterLevel();
    filterCategory();
    searchTerm();

    filterLogs();
  });

  /**
   * Clear all logs
   */
  const clearLogs = () => {
    consoleBroadcaster.clear();
    // Also clear the local logs state immediately
    setLogs([]);
    setFilteredLogs([]);
    updateStats();
  };

  /**
   * Export logs to file
   */
  const exportLogs = () => {
    const logsToExport = filteredLogs().length > 0 ? filteredLogs() : logs();

    const exportData = logsToExport.map(log => ({
      timestamp: log.timestamp.toISOString(),
      level: log.level,
      source: log.source || 'unknown',
      category: log.category || 'unknown',
      message: log.message
    }));

    // Create CSV content
    const csvHeader = 'Timestamp,Level,Source,Category,Message\n';
    const csvContent = exportData.map(log =>
      `"${log.timestamp}","${log.level}","${log.source}","${log.category}","${log.message.replace(/"/g, '""')}"`
    ).join('\n');

    const csvData = csvHeader + csvContent;

    // Create and download file
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `console-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    consoleBroadcaster.info(`Exported ${logsToExport.length} console logs to CSV`, 'console-widget', 'system');
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
   * Get color for category badge
   */
  const getCategoryColor = (category: string): string => {
    switch (category) {
      case 'build': return '#f59e0b';
      case 'runtime': return '#10b981';
      case 'webcontainer': return '#3b82f6';
      case 'preview': return '#8b5cf6';
      case 'system': return '#6b7280';
      default: return '#6b7280';
    }
  };

  /**
   * Highlight search terms in text
   */
  const highlightSearchTerm = (text: string, searchTerm: string): string => {
    if (!searchTerm.trim()) return text;

    try {
      // Try to use as regex if it looks like one
      const isRegex = searchTerm.startsWith('/') && searchTerm.endsWith('/');
      if (isRegex) {
        const regexPattern = searchTerm.slice(1, -1);
        const regex = new RegExp(regexPattern, 'gi');
        return text.replace(regex, (match) => `<mark style="background: #fbbf24; color: #000; padding: 1px 2px; border-radius: 2px;">${match}</mark>`);
      } else {
        // Simple text search
        const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        return text.replace(regex, (match) => `<mark style="background: #fbbf24; color: #000; padding: 1px 2px; border-radius: 2px;">${match}</mark>`);
      }
    } catch (e) {
      // If regex is invalid, fall back to simple text search
      const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      return text.replace(regex, (match) => `<mark style="background: #fbbf24; color: #000; padding: 1px 2px; border-radius: 2px;">${match}</mark>`);
    }
  };

  /**
   * Format timestamp with relative time
   */
  const formatTimestamp = (timestamp: Date): string => {
    const now = new Date();
    const diff = now.getTime() - timestamp.getTime();

    // If less than 1 minute ago, show relative time
    if (diff < 60000) {
      const seconds = Math.floor(diff / 1000);
      return seconds < 5 ? 'now' : `${seconds}s`;
    }

    // If less than 1 hour ago, show minutes
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes}m`;
    }

    // If today, show time only
    if (timestamp.toDateString() === now.toDateString()) {
      return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Otherwise show date and time
    return timestamp.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div style={`width: 100%; height: 100%; display: flex; flex-direction: column; background: #1e1e1e; color: #cccccc; ${!props.active ? 'pointer-events: none; opacity: 0.7;' : ''}`}>
      {/* Draggable Title Bar */}
      <div
        style="
          background: #2d2d30;
          border-bottom: 1px solid #3e3e42;
          padding: 8px 12px;
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
          cursor: move;
          user-select: none;
        "
        onMouseDown={(e) => {
          // Use the drag handler from context
          if (handleTitleBarDrag) {
            handleTitleBarDrag(e, props.id);
          }
        }}
      >
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
            onMouseDown={(e) => e.stopPropagation()} // Prevent drag when using controls
            style="background: #3c3c3c; border: 1px solid #555; color: #cccccc; padding: 4px 8px; border-radius: 4px; font-size: 12px;"
          >
            <option value="all">All Levels</option>
            <option value="log">Log</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
            <option value="debug">Debug</option>
          </select>

          <select
            value={filterCategory()}
            onChange={(e) => setFilterCategory(e.currentTarget.value)}
            onMouseDown={(e) => e.stopPropagation()} // Prevent drag when using controls
            style="background: #3c3c3c; border: 1px solid #555; color: #cccccc; padding: 4px 8px; border-radius: 4px; font-size: 12px;"
          >
            <option value="all">All Sources</option>
            <option value="build">Build</option>
            <option value="runtime">Runtime</option>
            <option value="webcontainer">WebContainer</option>
            <option value="preview">Preview</option>
            <option value="system">System</option>
          </select>
          
          <div style="position: relative;">
            <input
              type="text"
              placeholder="Search (use /regex/ for regex)..."
              value={searchTerm()}
              onInput={(e) => setSearchTerm(e.currentTarget.value)}
              onMouseDown={(e) => e.stopPropagation()} // Prevent drag when using controls
              style={`background: #3c3c3c; border: 1px solid ${searchTerm().startsWith('/') && searchTerm().endsWith('/') ? '#10b981' : '#555'}; color: #cccccc; padding: 4px 8px; border-radius: 4px; font-size: 12px; width: 160px;`}
            />
            {searchTerm().startsWith('/') && searchTerm().endsWith('/') && (
              <span style="position: absolute; right: 6px; top: 50%; transform: translateY(-50%); color: #10b981; font-size: 10px; pointer-events: none;">
                REGEX
              </span>
            )}
          </div>

          <button
            onClick={() => setIsPaused(!isPaused())}
            onMouseDown={(e) => e.stopPropagation()} // Prevent drag when clicking button
            style={`background: ${isPaused() ? '#dc2626' : '#16a34a'}; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 12px; cursor: pointer;`}
            title={isPaused() ? 'Resume' : 'Pause'}
          >
            {isPaused() ? '▶️' : '⏸️'}
          </button>

          <button
            onClick={clearLogs}
            onMouseDown={(e) => e.stopPropagation()} // Prevent drag when clicking button
            style="background: #6b7280; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 12px; cursor: pointer;"
            title="Clear"
          >
            🗑️
          </button>

          <button
            onClick={exportLogs}
            onMouseDown={(e) => e.stopPropagation()} // Prevent drag when clicking button
            style="background: #10b981; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 12px; cursor: pointer;"
            title="Export Logs to CSV"
          >
            📥
          </button>

          <button
            onClick={() => {
              consoleBroadcaster.info('Test message from Console widget', 'console-test', 'system');
              consoleBroadcaster.warn('Test warning message', 'console-test', 'system');
              consoleBroadcaster.error('Test error message', 'console-test', 'system');
            }}
            onMouseDown={(e) => e.stopPropagation()} // Prevent drag when clicking button
            style="background: #3b82f6; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 12px; cursor: pointer;"
            title="Test Console"
          >
            🧪
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
                {(() => {
                  // Trigger re-render when timestampRefresh changes
                  timestampRefresh();
                  return formatTimestamp(log.timestamp);
                })()}
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
              {log.category && (
                <span style={`
                  background: ${getCategoryColor(log.category)};
                  color: white;
                  font-size: 9px;
                  padding: 2px 6px;
                  border-radius: 3px;
                  text-transform: uppercase;
                  font-weight: 600;
                  min-width: 50px;
                  text-align: center;
                  flex-shrink: 0;
                `}>
                  {log.category}
                </span>
              )}
              <span
                style="flex: 1; word-break: break-word; white-space: pre-wrap;"
                innerHTML={highlightSearchTerm(log.message, searchTerm())}
              ></span>

              {log.count && log.count > 1 && (
                <span style="
                  background: #374151;
                  color: #d1d5db;
                  font-size: 10px;
                  padding: 2px 6px;
                  border-radius: 10px;
                  margin-left: 8px;
                  flex-shrink: 0;
                  font-weight: 600;
                ">
                  {log.count}
                </span>
              )}
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
      <div style="background: #2d2d30; border-top: 1px solid #3e3e42; padding: 6px 12px; font-size: 11px; color: #9ca3af; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <span>{filteredLogs().length} of {stats().total} logs</span>

          {/* Statistics */}
          <div style="display: flex; align-items: center; gap: 8px;">
            {stats().errors > 0 && (
              <span style="color: #ef4444; display: flex; align-items: center; gap: 2px;">
                <span>❌</span>
                <span>{stats().errors}</span>
              </span>
            )}
            {stats().warnings > 0 && (
              <span style="color: #f59e0b; display: flex; align-items: center; gap: 2px;">
                <span>⚠️</span>
                <span>{stats().warnings}</span>
              </span>
            )}
            {stats().info > 0 && (
              <span style="color: #3b82f6; display: flex; align-items: center; gap: 2px;">
                <span>ℹ️</span>
                <span>{stats().info}</span>
              </span>
            )}
            {stats().debug > 0 && (
              <span style="color: #8b5cf6; display: flex; align-items: center; gap: 2px;">
                <span>🐛</span>
                <span>{stats().debug}</span>
              </span>
            )}
          </div>
        </div>

        <label style="display: flex; align-items: center; gap: 4px;">
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
