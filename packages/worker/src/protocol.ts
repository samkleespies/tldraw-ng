// Communication protocol between UI thread and Worker thread

export type MsgFromUI =
  | { type: 'init'; canvas: OffscreenCanvas; devicePixelRatio: number }
  | { type: 'resize'; width: number; height: number }
  | { type: 'pointerMove'; x: number; y: number; buttons: number }
  | { type: 'pointerDown'; x: number; y: number; buttons: number }
  | { type: 'pointerUp'; x: number; y: number }
  | { type: 'wheel'; dx: number; dy: number }
  | { type: 'command'; name: 'undo' | 'redo' | 'duplicate' | 'deleteSelection' | 'clear' }
  | { type: 'toolChange'; tool: 'select' | 'rectangle' | 'ellipse' }
  | { type: 'createShape'; tool: 'rectangle' | 'ellipse'; x: number; y: number; width?: number; height?: number }
  | { type: 'panCamera'; dx: number; dy: number };

export type MsgFromWorker =
  | { type: 'initialized' }
  | { type: 'selectionChanged'; selectedIds: string[] }
  | { type: 'shapeCountChanged'; count: number }
  | { type: 'error'; message: string };

export function isMsgFromUI(msg: any): msg is MsgFromUI {
  return msg && typeof msg.type === 'string';
}
