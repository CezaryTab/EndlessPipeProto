import type { Cell } from './RouteSolver';

export interface PointerPoint {
  x: number;
  y: number;
}

export interface GridMetrics {
  originX: number;
  originY: number;
  cellSize: number;
  gridWidth: number;
  gridHeight: number;
}

export interface DragCallbacks {
  getGridMetrics: () => GridMetrics;
  onDragStart: (point: PointerPoint) => void;
  onDragMove: (point: PointerPoint) => void;
  onHoverCell: (cell: Cell | null) => void;
  onDrop: (cell: Cell | null, point: PointerPoint) => void;
  onCancel: () => void;
}

export interface InputController {
  beginDrag: (point: PointerPoint) => void;
  isDragging: () => boolean;
  dispose: () => void;
}

function pointToCell(point: PointerPoint, metrics: GridMetrics): Cell | null {
  const localX = point.x - metrics.originX;
  const localY = point.y - metrics.originY;

  if (localX < 0 || localY < 0) {
    return null;
  }

  const col = Math.floor(localX / metrics.cellSize);
  const row = Math.floor(localY / metrics.cellSize);

  if (row < 0 || row >= metrics.gridHeight || col < 0 || col >= metrics.gridWidth) {
    return null;
  }

  return { row, col };
}

export function createInputController(callbacks: DragCallbacks): InputController {
  let dragging = false;

  const moveListener = (event: PointerEvent) => {
    if (!dragging) {
      return;
    }

    event.preventDefault();

    const point = {
      x: event.clientX,
      y: event.clientY
    };

    callbacks.onDragMove(point);
    const metrics = callbacks.getGridMetrics();
    callbacks.onHoverCell(pointToCell(point, metrics));
  };

  const finishDrag = (event: PointerEvent) => {
    if (!dragging) {
      return;
    }

    event.preventDefault();

    const point = {
      x: event.clientX,
      y: event.clientY
    };
    const metrics = callbacks.getGridMetrics();
    const dropCell = pointToCell(point, metrics);

    callbacks.onDrop(dropCell, point);
    callbacks.onHoverCell(null);
    removeListeners();
    dragging = false;
  };

  const cancelListener = (event: PointerEvent) => {
    if (!dragging) {
      return;
    }

    event.preventDefault();
    callbacks.onCancel();
    callbacks.onHoverCell(null);
    removeListeners();
    dragging = false;
  };

  const removeListeners = () => {
    window.removeEventListener('pointermove', moveListener);
    window.removeEventListener('pointerup', finishDrag);
    window.removeEventListener('pointercancel', cancelListener);
  };

  return {
    beginDrag: (point: PointerPoint) => {
      if (dragging) {
        callbacks.onCancel();
        callbacks.onHoverCell(null);
        removeListeners();
      }

      dragging = true;
      callbacks.onDragStart(point);
      callbacks.onDragMove(point);

      window.addEventListener('pointermove', moveListener, { passive: false });
      window.addEventListener('pointerup', finishDrag, { passive: false });
      window.addEventListener('pointercancel', cancelListener, { passive: false });
    },
    isDragging: () => dragging,
    dispose: () => {
      removeListeners();
      dragging = false;
    }
  };
}
