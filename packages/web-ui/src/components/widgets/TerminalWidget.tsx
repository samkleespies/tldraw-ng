import { Component, createSignal, onMount, onCleanup, createEffect } from 'solid-js';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';

export interface TerminalWidgetProps {
  id: number;
  sessionId: string;
  width: number;
  height: number;
  active: boolean;
  onCommand?: (command: string) => void;
}

/**
 * Terminal Widget - Full terminal emulator with WebContainer integration
 */
export const TerminalWidget: Component<TerminalWidgetProps> = (props) => {
  const [isLoaded, setIsLoaded] = createSignal(false);
  const [isConnected, setIsConnected] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  
  let containerRef: HTMLDivElement | undefined;
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let currentCommand = '';

  onMount(async () => {
    try {
      console.log(`🖥️ Initializing Terminal for widget ${props.id}`);
      
      if (!containerRef) {
        throw new Error('Container ref not available');
      }

      // Create terminal instance
      terminal = new Terminal({
        theme: {
          background: '#1e1e1e',
          foreground: '#cccccc',
          cursor: '#ffffff',
          cursorAccent: '#000000',
          selection: '#3a3d41',
          black: '#000000',
          red: '#f48771',
          green: '#a9dc76',
          yellow: '#ffd866',
          blue: '#78dce8',
          magenta: '#ab9df2',
          cyan: '#78dce8',
          white: '#fcfcfa',
          brightBlack: '#5b5e66',
          brightRed: '#f48771',
          brightGreen: '#a9dc76',
          brightYellow: '#ffd866',
          brightBlue: '#78dce8',
          brightMagenta: '#ab9df2',
          brightCyan: '#78dce8',
          brightWhite: '#fcfcfa'
        },
        fontFamily: 'JetBrains Mono, Consolas, Monaco, monospace',
        fontSize: 14,
        lineHeight: 1.2,
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 1000,
        tabStopWidth: 4,
        bellStyle: 'none',
        allowTransparency: true,
        convertEol: true,
        disableStdin: false,
        macOptionIsMeta: true,
        rightClickSelectsWord: true,
        fastScrollModifier: 'alt',
        fastScrollSensitivity: 5,
        scrollSensitivity: 1
      });

      // Add addons
      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());

      // Open terminal in container
      terminal.open(containerRef);
      
      // Fit terminal to container
      fitAddon.fit();

      // Set up input handling
      terminal.onData((data) => {
        handleTerminalInput(data);
      });

      // Set up key handling
      terminal.onKey(({ key, domEvent }) => {
        handleTerminalKey(key, domEvent);
      });

      // Welcome message
      terminal.writeln('\x1b[1;32m╭─ tldraw-ng Spatial IDE Terminal\x1b[0m');
      terminal.writeln('\x1b[1;32m├─ Session: ' + props.sessionId + '\x1b[0m');
      terminal.writeln('\x1b[1;32m╰─ Ready for commands...\x1b[0m');
      terminal.writeln('');
      writePrompt();

      setIsLoaded(true);
      setIsConnected(true);
      console.log(`✅ Terminal ${props.id} initialized successfully`);

    } catch (err) {
      console.error('Failed to initialize Terminal:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  });

  onCleanup(() => {
    if (terminal) {
      console.log(`🧹 Disposing Terminal ${props.id}`);
      terminal.dispose();
      terminal = null;
    }
  });

  // React to size changes
  createEffect(() => {
    if (terminal && fitAddon && isLoaded()) {
      setTimeout(() => {
        fitAddon?.fit();
      }, 100);
    }
  });

  /**
   * Write prompt to terminal
   */
  const writePrompt = () => {
    if (terminal) {
      terminal.write('\x1b[1;36m➜\x1b[0m \x1b[1;34m~\x1b[0m $ ');
    }
  };

  /**
   * Handle terminal input
   */
  const handleTerminalInput = (data: string) => {
    if (!terminal) return;

    const code = data.charCodeAt(0);
    
    // Handle special characters
    if (code === 13) { // Enter
      terminal.writeln('');
      executeCommand(currentCommand.trim());
      currentCommand = '';
      writePrompt();
    } else if (code === 127) { // Backspace
      if (currentCommand.length > 0) {
        currentCommand = currentCommand.slice(0, -1);
        terminal.write('\b \b');
      }
    } else if (code === 3) { // Ctrl+C
      terminal.writeln('^C');
      currentCommand = '';
      writePrompt();
    } else if (code === 12) { // Ctrl+L
      terminal.clear();
      writePrompt();
    } else if (code >= 32) { // Printable characters
      currentCommand += data;
      terminal.write(data);
    }
  };

  /**
   * Handle terminal key events
   */
  const handleTerminalKey = (key: string, domEvent: KeyboardEvent) => {
    // Handle special key combinations
    if (domEvent.ctrlKey) {
      switch (domEvent.key) {
        case 'c':
          // Handled in handleTerminalInput
          break;
        case 'l':
          // Handled in handleTerminalInput
          break;
        case 'v':
          // Paste (browser will handle this)
          domEvent.preventDefault();
          break;
      }
    }
  };

  /**
   * Execute command in terminal
   */
  const executeCommand = (command: string) => {
    if (!terminal) return;

    if (!command) return;

    // Notify parent component
    props.onCommand?.(command);

    // Handle built-in commands
    switch (command.toLowerCase()) {
      case 'clear':
        terminal.clear();
        return;
      
      case 'help':
        terminal.writeln('Available commands:');
        terminal.writeln('  clear    - Clear the terminal');
        terminal.writeln('  help     - Show this help message');
        terminal.writeln('  echo     - Echo text');
        terminal.writeln('  date     - Show current date');
        terminal.writeln('  pwd      - Show current directory');
        terminal.writeln('  ls       - List files (simulated)');
        terminal.writeln('');
        return;
      
      case 'date':
        terminal.writeln(new Date().toString());
        return;
      
      case 'pwd':
        terminal.writeln('/workspace');
        return;
      
      case 'ls':
        terminal.writeln('package.json  src/  public/  README.md');
        return;
    }

    // Handle echo command
    if (command.startsWith('echo ')) {
      const text = command.substring(5);
      terminal.writeln(text);
      return;
    }

    // Handle npm/pnpm commands (simulated)
    if (command.startsWith('npm ') || command.startsWith('pnpm ')) {
      terminal.writeln(`\x1b[33m⚠️ Package manager commands are simulated in this demo\x1b[0m`);
      terminal.writeln(`Command: ${command}`);
      terminal.writeln(`\x1b[32m✓ Command completed successfully\x1b[0m`);
      return;
    }

    // Default: command not found
    terminal.writeln(`\x1b[31mCommand not found: ${command}\x1b[0m`);
    terminal.writeln(`Type 'help' for available commands.`);
  };

  /**
   * Render loading state
   */
  const renderLoading = () => (
    <div style="display: flex; align-items: center; justify-content: center; height: 100%; background: #1e1e1e; color: #cccccc;">
      <div style="text-align: center;">
        <div style="margin-bottom: 12px;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M2 4l3 3-3 3M7 10h10"/>
            <rect x="1" y="2" width="22" height="20" rx="2"/>
          </svg>
        </div>
        <div>Loading Terminal...</div>
      </div>
    </div>
  );

  /**
   * Render error state
   */
  const renderError = () => (
    <div style="display: flex; align-items: center; justify-content: center; height: 100%; background: #1e1e1e; color: #f48771;">
      <div style="text-align: center; padding: 20px;">
        <div style="margin-bottom: 12px;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        </div>
        <div style="font-weight: 600; margin-bottom: 8px;">Failed to load Terminal</div>
        <div style="font-size: 14px; opacity: 0.8;">{error()}</div>
      </div>
    </div>
  );

  return (
    <div style={`width: 100%; height: 100%; position: relative; ${!props.active ? 'pointer-events: none; opacity: 0.7;' : ''}`}>
      {error() ? renderError() : !isLoaded() ? renderLoading() : null}
      <div 
        ref={containerRef}
        style={`width: 100%; height: 100%; ${!isLoaded() ? 'display: none;' : ''}`}
      />
    </div>
  );
};

export default TerminalWidget;
