/**
 * Coordinate transformation utilities for converting between
 * WebGPU canvas coordinates and DOM overlay coordinates
 */

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenBounds extends Bounds {
  scale: number;
}

/**
 * Coordinate transformation manager
 * Handles conversion between world coordinates (WebGPU canvas) and screen coordinates (DOM overlays)
 */
export class CoordinateTransformer {
  private core: any;

  constructor(core: any) {
    this.core = core;
  }

  /**
   * Convert world coordinates to screen coordinates
   */
  worldToScreen(worldX: number, worldY: number): Point {
    if (!this.core) {
      return { x: worldX, y: worldY };
    }

    const screenCoords = this.core.world_to_screen(worldX, worldY);
    return {
      x: screenCoords[0],
      y: screenCoords[1]
    };
  }

  /**
   * Convert screen coordinates to world coordinates
   */
  screenToWorld(screenX: number, screenY: number): Point {
    if (!this.core) {
      return { x: screenX, y: screenY };
    }

    // Debug: Check what methods are available
    if (typeof this.core.screen_to_world !== 'function') {
      console.error('screen_to_world method not found on core object');
      console.log('Available methods:', Object.getOwnPropertyNames(this.core));
      return { x: screenX, y: screenY };
    }

    const worldCoords = this.core.screen_to_world(screenX, screenY);
    return {
      x: worldCoords[0],
      y: worldCoords[1]
    };
  }

  /**
   * Get camera scale factor
   */
  getScale(): number {
    if (!this.core) {
      return 1.0;
    }
    return this.core.get_camera_scale();
  }

  /**
   * Get camera translation
   */
  getTranslation(): Point {
    if (!this.core) {
      return { x: 0, y: 0 };
    }
    const translation = this.core.get_camera_translation();
    return {
      x: translation[0],
      y: translation[1]
    };
  }

  /**
   * Get widget screen bounds for overlay positioning
   */
  getWidgetScreenBounds(shapeId: number): ScreenBounds | null {
    if (!this.core) {
      return null;
    }

    const boundsJson = this.core.get_widget_screen_bounds(shapeId);
    if (!boundsJson) {
      return null;
    }

    try {
      return JSON.parse(boundsJson);
    } catch (e) {
      console.error('Failed to parse widget screen bounds:', e);
      return null;
    }
  }

  /**
   * Convert widget world bounds to screen bounds
   */
  widgetWorldToScreenBounds(worldBounds: Bounds): ScreenBounds {
    const screenPos = this.worldToScreen(worldBounds.x, worldBounds.y);
    const scale = this.getScale();
    
    return {
      x: screenPos.x,
      y: screenPos.y,
      width: worldBounds.width * scale,
      height: worldBounds.height * scale,
      scale: scale
    };
  }

  /**
   * Get canvas element bounds for overlay positioning
   */
  getCanvasBounds(): DOMRect | null {
    const canvas = document.querySelector('canvas');
    if (!canvas) {
      return null;
    }
    return canvas.getBoundingClientRect();
  }

  /**
   * Convert widget screen bounds to absolute DOM coordinates
   */
  screenBoundsToDOM(screenBounds: ScreenBounds): Bounds | null {
    const canvasBounds = this.getCanvasBounds();
    if (!canvasBounds) {
      return null;
    }

    return {
      x: canvasBounds.left + screenBounds.x,
      y: canvasBounds.top + screenBounds.y,
      width: screenBounds.width,
      height: screenBounds.height
    };
  }

  /**
   * Get complete transformation data for a widget
   */
  getWidgetTransform(shapeId: number): {
    worldBounds: Bounds | null;
    screenBounds: ScreenBounds | null;
    domBounds: Bounds | null;
  } {
    const screenBounds = this.getWidgetScreenBounds(shapeId);
    const domBounds = screenBounds ? this.screenBoundsToDOM(screenBounds) : null;
    
    // Calculate world bounds from screen bounds
    let worldBounds: Bounds | null = null;
    if (screenBounds) {
      const worldPos = this.screenToWorld(screenBounds.x, screenBounds.y);
      worldBounds = {
        x: worldPos.x,
        y: worldPos.y,
        width: screenBounds.width / screenBounds.scale,
        height: screenBounds.height / screenBounds.scale
      };
    }

    return {
      worldBounds,
      screenBounds,
      domBounds
    };
  }
}

/**
 * Global coordinate transformer instance
 */
let globalTransformer: CoordinateTransformer | null = null;

/**
 * Initialize the global coordinate transformer
 */
export function initializeCoordinateTransformer(core: any): CoordinateTransformer {
  globalTransformer = new CoordinateTransformer(core);
  return globalTransformer;
}

/**
 * Get the global coordinate transformer
 */
export function getCoordinateTransformer(): CoordinateTransformer | null {
  return globalTransformer;
}

/**
 * Utility function to get widget DOM bounds directly
 */
export function getWidgetDOMBounds(shapeId: number): Bounds | null {
  const transformer = getCoordinateTransformer();
  if (!transformer) {
    return null;
  }
  
  const transform = transformer.getWidgetTransform(shapeId);
  return transform.domBounds;
}

/**
 * Utility function to check if a point is inside widget bounds
 */
export function isPointInWidget(point: Point, widgetBounds: Bounds): boolean {
  return (
    point.x >= widgetBounds.x &&
    point.x <= widgetBounds.x + widgetBounds.width &&
    point.y >= widgetBounds.y &&
    point.y <= widgetBounds.y + widgetBounds.height
  );
}

/**
 * Utility function to clamp widget bounds to canvas bounds
 */
export function clampWidgetToCanvas(widgetBounds: Bounds): Bounds {
  const transformer = getCoordinateTransformer();
  const canvasBounds = transformer?.getCanvasBounds();
  
  if (!canvasBounds) {
    return widgetBounds;
  }

  return {
    x: Math.max(canvasBounds.left, Math.min(widgetBounds.x, canvasBounds.right - widgetBounds.width)),
    y: Math.max(canvasBounds.top, Math.min(widgetBounds.y, canvasBounds.bottom - widgetBounds.height)),
    width: Math.min(widgetBounds.width, canvasBounds.width),
    height: Math.min(widgetBounds.height, canvasBounds.height)
  };
}
