import { getStrokePoints } from 'perfect-freehand';

export interface DrawPoint {
  x: number;
  y: number;
  pressure?: number;
}

export interface StrokeOptions {
  size?: number;
  thinning?: number;
  smoothing?: number;
  streamline?: number;
  simulatePressure?: boolean;
  last?: boolean;
}

/**
 * Convert perfect-freehand stroke outline points to SVG path data
 */
export function getSvgPathFromStroke(points: number[][], closed = true): string {
  const len = points.length;

  if (len < 4) {
    return '';
  }

  let a = points[0];
  let b = points[1];
  const c = points[2];

  let result = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${((b[0] + c[0]) / 2).toFixed(2)},${((b[1] + c[1]) / 2).toFixed(2)} T`;

  for (let i = 2, max = len - 1; i < max; i++) {
    a = points[i];
    b = points[i + 1];
    result += `${((a[0] + b[0]) / 2).toFixed(2)},${((a[1] + b[1]) / 2).toFixed(2)} `;
  }

  if (closed) {
    result += 'Z';
  }

  return result;
}

/**
 * Convert perfect-freehand stroke outline points to triangulated vertices
 * for WebGPU rendering
 */
export function getTrianglesFromStroke(points: number[][]): Float32Array {
  if (points.length < 3) {
    return new Float32Array(0);
  }

  // Use earcut or simple fan triangulation for the polygon
  const vertices: number[] = [];
  
  // Simple fan triangulation from first point
  const center = points[0];
  
  for (let i = 1; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    
    // Triangle: center -> p1 -> p2
    vertices.push(
      center[0], center[1],  // center
      p1[0], p1[1],          // p1
      p2[0], p2[1]           // p2
    );
  }
  
  return new Float32Array(vertices);
}

/**
 * Convert perfect-freehand stroke outline to vertex objects for Rust core
 */
export function strokeToVertexObjects(
  strokeOutline: number[][],
  color: [number, number, number, number] = [1, 1, 1, 1]
): Array<{
  position: [number, number];
  color: [number, number, number, number];
  uv: [number, number];
  shape_type: number;
}> {
  if (strokeOutline.length < 3) {
    return [];
  }

  const vertices: Array<{ position: [number, number]; color: [number, number, number, number]; uv: [number, number]; shape_type: number }> = [];

  // Use centroid-based fan triangulation (same as Rust implementation)
  let centroidX = 0;
  let centroidY = 0;
  for (const point of strokeOutline) {
    centroidX += point[0];
    centroidY += point[1];
  }
  centroidX /= strokeOutline.length;
  centroidY /= strokeOutline.length;

  // Create triangles from centroid to each edge
  for (let i = 0; i < strokeOutline.length; i++) {
    const p1 = strokeOutline[i];
    const p2 = strokeOutline[(i + 1) % strokeOutline.length];

    // Triangle: centroid -> p1 -> p2
    vertices.push(
      {
        position: [centroidX, centroidY],
        color,
        uv: [0.5, 0.5],
        shape_type: 0.0 // Use basic shape type for solid fill
      },
      {
        position: [p1[0], p1[1]],
        color,
        uv: [0.0, 0.0],
        shape_type: 0.0
      },
      {
        position: [p2[0], p2[1]],
        color,
        uv: [1.0, 0.0],
        shape_type: 0.0
      }
    );
  }

  return vertices;
}

/**
 * Create a smooth path from input points using perfect-freehand (just the centerline)
 */
export function createSmoothPath(
  inputPoints: DrawPoint[],
  options: StrokeOptions = {}
): DrawPoint[] {
  // Convert our points to perfect-freehand format
  const pfPoints = inputPoints.map(p => [p.x, p.y, p.pressure ?? 0.5]);

  // Default options optimized for smooth drawing
  const strokeOptions = {
    size: options.size ?? 4,
    thinning: options.thinning ?? 0.5,
    smoothing: options.smoothing ?? 0.5,
    streamline: options.streamline ?? 0.5,
    simulatePressure: options.simulatePressure ?? true,
    last: options.last ?? true,
    ...options
  };

  // Get the smoothed stroke points (not the outline, just the centerline)
  const strokePoints = getStrokePoints(pfPoints, strokeOptions);

  // Convert back to our format - just use the smoothed points
  return strokePoints.map(sp => ({
    x: sp.point[0],
    y: sp.point[1],
    pressure: sp.pressure
  }));
}

/**
 * Create a smooth stroke from input points using perfect-freehand
 */
// Simple line rendering function that actually works
export function createSimpleLine(
  inputPoints: DrawPoint[],
  lineWidth: number = 2,
  _color: [number, number, number, number] = [1.0, 1.0, 1.0, 1.0]
): Float32Array {
  if (inputPoints.length < 2) {
    return new Float32Array(0);
  }

  const vertices: number[] = [];

  for (let i = 0; i < inputPoints.length - 1; i++) {
    const p1 = inputPoints[i];
    const p2 = inputPoints[i + 1];

    // Calculate perpendicular vector for line width
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length === 0) continue;

    // Normalize and get perpendicular
    const nx = -dy / length;
    const ny = dx / length;

    // Half width offset
    const hw = lineWidth / 2;
    const offsetX = nx * hw;
    const offsetY = ny * hw;

    // Create quad for this line segment
    const x1 = p1.x + offsetX;
    const y1 = p1.y + offsetY;
    const x2 = p1.x - offsetX;
    const y2 = p1.y - offsetY;
    const x3 = p2.x + offsetX;
    const y3 = p2.y + offsetY;
    const x4 = p2.x - offsetX;
    const y4 = p2.y - offsetY;

    // First triangle: (x1,y1), (x2,y2), (x3,y3)
    vertices.push(x1, y1, x2, y2, x3, y3);

    // Second triangle: (x2,y2), (x4,y4), (x3,y3)
    vertices.push(x2, y2, x4, y4, x3, y3);
  }

  return new Float32Array(vertices);
}

export function createSmoothStroke(
  inputPoints: DrawPoint[],
  options: StrokeOptions = {}
): {
  outlinePoints: number[][];
  triangles: Float32Array;
  svgPath: string;
} {
  // Use simple line rendering instead of perfect-freehand for now
  const lineWidth = options.size ?? 2;
  const triangles = createSimpleLine(inputPoints, lineWidth);

  // Create dummy outline points for compatibility
  const outlinePoints = inputPoints.map(p => [p.x, p.y]);

  // Create dummy SVG path
  const svgPath = inputPoints.length > 0 ?
    `M ${inputPoints[0].x} ${inputPoints[0].y} ` +
    inputPoints.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ') : '';

  return {
    outlinePoints,
    triangles,
    svgPath
  };
}

/**
 * Convert triangulated vertices to our Vertex format for WebGPU
 */
export function trianglesToVertices(
  triangles: Float32Array,
  color: [number, number, number, number] = [1, 1, 1, 1]
): Array<{
  position: [number, number];
  color: [number, number, number, number];
  uv: [number, number];
  shape_type: number;
}> {
  const vertices: Array<{ position: [number, number]; color: [number, number, number, number]; uv: [number, number]; shape_type: number }> = [];

  for (let i = 0; i < triangles.length; i += 6) {
    // Each triangle has 3 vertices, each vertex has 2 coordinates
    const x1 = triangles[i];
    const y1 = triangles[i + 1];
    const x2 = triangles[i + 2];
    const y2 = triangles[i + 3];
    const x3 = triangles[i + 4];
    const y3 = triangles[i + 5];

    // Debug: Log first triangle coordinates
    if (i === 0) {
      console.log('🎨 First triangle vertices:', [x1, y1], [x2, y2], [x3, y3]);
    }
    
    vertices.push(
      {
        position: [x1, y1] as [number, number],
        color,
        uv: [0, 0] as [number, number],
        shape_type: 0 // World coordinates with camera transformation
      },
      {
        position: [x2, y2] as [number, number],
        color,
        uv: [0, 1] as [number, number],
        shape_type: 0
      },
      {
        position: [x3, y3] as [number, number],
        color,
        uv: [1, 0] as [number, number],
        shape_type: 0
      }
    );
  }
  
  return vertices;
}
