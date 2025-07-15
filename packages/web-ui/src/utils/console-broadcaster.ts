/**
 * Global Console Broadcasting System
 * Centralizes console messages from various sources and broadcasts to Console widgets
 */

export interface ConsoleMessage {
  id: string;
  timestamp: Date;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source: string;
  data?: any;
  category?: 'build' | 'runtime' | 'system' | 'webcontainer' | 'preview';
  count?: number;
  firstTimestamp?: Date;
  lastTimestamp?: Date;
}

export type ConsoleMessageListener = (message: ConsoleMessage) => void;

class ConsoleBroadcaster {
  private listeners: Set<ConsoleMessageListener> = new Set();
  private messageHistory: ConsoleMessage[] = [];
  private maxHistorySize = 1000;

  /**
   * Add a listener for console messages
   */
  addListener(listener: ConsoleMessageListener): () => void {
    this.listeners.add(listener);
    
    // Send existing history to new listener
    this.messageHistory.forEach(message => {
      listener(message);
    });

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Broadcast a console message to all listeners with grouping
   */
  broadcast(message: Omit<ConsoleMessage, 'id' | 'timestamp'>): void {
    const now = new Date();

    // Check if this message should be grouped with the last message
    const lastMessage = this.messageHistory[this.messageHistory.length - 1];
    const shouldGroup = lastMessage &&
      lastMessage.message === message.message &&
      lastMessage.level === message.level &&
      lastMessage.source === message.source &&
      lastMessage.category === message.category &&
      (now.getTime() - lastMessage.lastTimestamp!.getTime()) < 5000; // Group within 5 seconds

    if (shouldGroup) {
      // Update existing message
      lastMessage.count = (lastMessage.count || 1) + 1;
      lastMessage.lastTimestamp = now;

      // Broadcast updated message
      this.listeners.forEach(listener => {
        try {
          listener(lastMessage);
        } catch (error) {
          console.error('Error in console message listener:', error);
        }
      });
    } else {
      // Create new message
      const fullMessage: ConsoleMessage = {
        id: `console_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: now,
        count: 1,
        firstTimestamp: now,
        lastTimestamp: now,
        ...message
      };

      // Add to history
      this.messageHistory.push(fullMessage);

      // Trim history if too large
      if (this.messageHistory.length > this.maxHistorySize) {
        this.messageHistory = this.messageHistory.slice(-this.maxHistorySize);
      }

      // Broadcast to all listeners
      this.listeners.forEach(listener => {
        try {
          listener(fullMessage);
        } catch (error) {
          console.error('Error in console message listener:', error);
        }
      });
    }
  }

  /**
   * Log a message with automatic source detection
   */
  log(level: ConsoleMessage['level'], message: string, source: string, category?: ConsoleMessage['category'], data?: any): void {
    this.broadcast({
      level,
      message,
      source,
      category,
      data
    });
  }

  /**
   * Convenience methods for different log levels
   */
  info(message: string, source: string, category?: ConsoleMessage['category'], data?: any): void {
    this.log('info', message, source, category, data);
  }

  warn(message: string, source: string, category?: ConsoleMessage['category'], data?: any): void {
    this.log('warn', message, source, category, data);
  }

  error(message: string, source: string, category?: ConsoleMessage['category'], data?: any): void {
    this.log('error', message, source, category, data);
  }

  debug(message: string, source: string, category?: ConsoleMessage['category'], data?: any): void {
    this.log('debug', message, source, category, data);
  }

  /**
   * Clear all message history
   */
  clear(): void {
    this.messageHistory = [];
    // Broadcast a special clear event that widgets can listen to
    this.broadcast({
      level: 'info',
      message: '__CONSOLE_CLEAR__',
      source: 'system',
      category: 'system'
    });
  }

  /**
   * Get current message history
   */
  getHistory(): ConsoleMessage[] {
    return [...this.messageHistory];
  }

  /**
   * Get listener count (for debugging)
   */
  getListenerCount(): number {
    return this.listeners.size;
  }
}

// Global singleton instance
export const consoleBroadcaster = new ConsoleBroadcaster();

// Initialize with welcome message
consoleBroadcaster.info('Console broadcasting system initialized', 'tldraw-ng', 'system');
consoleBroadcaster.info('Ready to capture WebContainer, build, and runtime logs', 'console-broadcaster', 'system');

// Export for use in components
export default consoleBroadcaster;
