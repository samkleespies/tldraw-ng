import { Component, createSignal, onMount, onCleanup } from 'solid-js';

export interface ShapeToolsDropdownProps {
  selectedTool: string;
  onToolChange: (tool: 'rectangle' | 'ellipse') => void;
  disabled?: boolean;
}

/**
 * Shape Tools Dropdown - tldraw-style dropdown menu for shape tools
 */
const ShapeToolsDropdown: Component<ShapeToolsDropdownProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  let dropdownRef: HTMLDivElement | undefined;

  // Close dropdown when clicking outside
  const handleClickOutside = (e: MouseEvent) => {
    if (dropdownRef && !dropdownRef.contains(e.target as Node)) {
      setIsOpen(false);
    }
  };

  onMount(() => {
    document.addEventListener('mousedown', handleClickOutside);
  });

  onCleanup(() => {
    document.removeEventListener('mousedown', handleClickOutside);
  });

  const toggleDropdown = () => {
    if (!props.disabled) {
      setIsOpen(!isOpen());
    }
  };

  const selectTool = (tool: 'rectangle' | 'ellipse') => {
    props.onToolChange(tool);
    setIsOpen(false);
  };

  // Determine which icon to show in the main button
  const getMainIcon = () => {
    if (props.selectedTool === 'rectangle') {
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="4" y="4" width="8" height="8" rx="1"/>
        </svg>
      );
    } else if (props.selectedTool === 'ellipse') {
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="8" cy="8" r="4"/>
        </svg>
      );
    } else {
      // Default to rectangle icon
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="4" y="4" width="8" height="8" rx="1"/>
        </svg>
      );
    }
  };

  const isShapeToolSelected = () => {
    return props.selectedTool === 'rectangle' || props.selectedTool === 'ellipse';
  };

  return (
    <div class="shape-tools-dropdown" ref={dropdownRef}>
      {/* Main button with caret */}
      <div class="shape-tools-main">
        <button
          class={`tool-btn ${isShapeToolSelected() ? 'active' : ''}`}
          onClick={toggleDropdown}
          disabled={props.disabled}
          title="Shape Tools"
        >
          {getMainIcon()}
        </button>
        <button
          class={`tool-btn caret-btn ${isOpen() ? 'open' : ''}`}
          onClick={toggleDropdown}
          disabled={props.disabled}
          title="More Shapes"
        >
          <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 12L3 7h10l-5 5z"/>
          </svg>
        </button>
      </div>

      {/* Dropdown menu */}
      {isOpen() && (
        <div class="shape-tools-menu">
          <div class="shape-tools-grid">
            {/* Rectangle */}
            <button
              class={`shape-tool-item ${props.selectedTool === 'rectangle' ? 'active' : ''}`}
              onClick={() => selectTool('rectangle')}
              title="Rectangle (R)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="6" y="6" width="12" height="12" rx="2"/>
              </svg>
            </button>

            {/* Circle */}
            <button
              class={`shape-tool-item ${props.selectedTool === 'ellipse' ? 'active' : ''}`}
              onClick={() => selectTool('ellipse')}
              title="Circle (O)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="6"/>
              </svg>
            </button>

            {/* Triangle - placeholder for future */}
            <button
              class="shape-tool-item disabled"
              disabled
              title="Triangle (Coming Soon)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M12 2L22 20H2L12 2Z"/>
              </svg>
            </button>

            {/* Diamond - placeholder for future */}
            <button
              class="shape-tool-item disabled"
              disabled
              title="Diamond (Coming Soon)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M12 2L20 12L12 22L4 12L12 2Z"/>
              </svg>
            </button>

            {/* Hexagon - placeholder for future */}
            <button
              class="shape-tool-item disabled"
              disabled
              title="Hexagon (Coming Soon)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M8 2L16 2L20 8L20 16L16 22L8 22L4 16L4 8L8 2Z"/>
              </svg>
            </button>

            {/* Star - placeholder for future */}
            <button
              class="shape-tool-item disabled"
              disabled
              title="Star (Coming Soon)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M12 2L15.09 8.26L22 9L17 14L18.18 21L12 17.77L5.82 21L7 14L2 9L8.91 8.26L12 2Z"/>
              </svg>
            </button>

            {/* Cloud - placeholder for future */}
            <button
              class="shape-tool-item disabled"
              disabled
              title="Cloud (Coming Soon)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M18 10H16.74C16.24 6.67 13.5 4 10 4C6.5 4 3.76 6.67 3.26 10H2C0.9 10 0 10.9 0 12S0.9 14 2 14H18C19.1 14 20 13.1 20 12S19.1 10 18 10Z"/>
              </svg>
            </button>

            {/* Heart - placeholder for future */}
            <button
              class="shape-tool-item disabled"
              disabled
              title="Heart (Coming Soon)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M20.84 4.61C19.32 3.09 17.16 3.09 15.64 4.61L12 8.25L8.36 4.61C6.84 3.09 4.68 3.09 3.16 4.61C1.64 6.13 1.64 8.29 3.16 9.81L12 18.65L20.84 9.81C22.36 8.29 22.36 6.13 20.84 4.61Z"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShapeToolsDropdown;
