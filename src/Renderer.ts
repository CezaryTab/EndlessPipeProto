import { getCellAnimationState, type AnimationState } from './Animation';
import { ENDPOINT_COLOR_PALETTE, type GameState } from './GameState';
import {
  ALL_DIRECTIONS,
  directionToDelta,
  getPipeTopology,
  type Orientation,
  type PipeKind
} from './Pipe';
import type { Cell, RouteId } from './RouteSolver';

export interface GridRenderMetrics {
  originX: number;
  originY: number;
  cellSize: number;
  gridSize: number;
}

export interface DragRenderState {
  active: boolean;
  hoveredCell: Cell | null;
  isValidHover: boolean;
  offer: {
    kind: PipeKind;
    orientation: Orientation;
  } | null;
}

export interface RenderFrameModel {
  game: GameState;
  animation: AnimationState;
  drag: DragRenderState;
  width: number;
  height: number;
}

interface CellCenter {
  x: number;
  y: number;
}

export const ROUTE_PREVIEW_STYLE_BY_ID: Record<RouteId, {
  dash: number[];
  alpha: number;
  width: number;
  color: string;
}> = {
  easy: { dash: [1, 12], alpha: 0.56, width: 2.9, color: '#4fdf7f' },
  medium: { dash: [1, 8], alpha: 0.54, width: 2.7, color: '#f4d24d' },
  hard: { dash: [1, 5], alpha: 0.52, width: 2.5, color: '#ff6464' }
};

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized
        .split('')
        .map((part) => `${part}${part}`)
        .join('')
    : normalized;

  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function mixHexColors(from: string, to: string, t: number): string {
  const ratio = Math.max(0, Math.min(1, t));
  const a = parseHexColor(from);
  const b = parseHexColor(to);

  const r = Math.round(a.r + (b.r - a.r) * ratio);
  const g = Math.round(a.g + (b.g - a.g) * ratio);
  const bValue = Math.round(a.b + (b.b - a.b) * ratio);

  return `rgb(${r}, ${g}, ${bValue})`;
}

function computeGridMetrics(width: number, height: number, gridSize: number): GridRenderMetrics {
  const padding = 22;
  const boardPixels = Math.max(120, Math.min(width - padding * 2, height - padding * 2));
  const cellSize = boardPixels / gridSize;

  return {
    originX: (width - boardPixels) / 2,
    originY: (height - boardPixels) / 2,
    cellSize,
    gridSize
  };
}

function cellCenter(cell: Cell, metrics: GridRenderMetrics): CellCenter {
  return {
    x: metrics.originX + cell.col * metrics.cellSize + metrics.cellSize / 2,
    y: metrics.originY + cell.row * metrics.cellSize + metrics.cellSize / 2
  };
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): void {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#0c141c');
  gradient.addColorStop(1, '#162638');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  metrics: GridRenderMetrics
): void {
  const boardPixels = metrics.cellSize * metrics.gridSize;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 1;

  for (let i = 0; i <= metrics.gridSize; i += 1) {
    const offset = metrics.originX + i * metrics.cellSize;
    ctx.beginPath();
    ctx.moveTo(offset, metrics.originY);
    ctx.lineTo(offset, metrics.originY + boardPixels);
    ctx.stroke();
  }

  for (let i = 0; i <= metrics.gridSize; i += 1) {
    const offset = metrics.originY + i * metrics.cellSize;
    ctx.beginPath();
    ctx.moveTo(metrics.originX, offset);
    ctx.lineTo(metrics.originX + boardPixels, offset);
    ctx.stroke();
  }
}

function drawEndpoints(
  ctx: CanvasRenderingContext2D,
  game: GameState,
  metrics: GridRenderMetrics,
  animation: AnimationState
): void {
  const radius = metrics.cellSize * 0.16;

  for (const endpoint of game.endpointNodes) {
    const center = cellCenter({ row: endpoint.row, col: endpoint.col }, metrics);
    const groupColor = ENDPOINT_COLOR_PALETTE[endpoint.colorId % ENDPOINT_COLOR_PALETTE.length] ?? '#ffffff';
    const color = animation.phase === 'idle'
      ? groupColor
      : mixHexColors(groupColor, animation.color, 0.4);

    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.96;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawPipeSymbol(
  ctx: CanvasRenderingContext2D,
  center: CellCenter,
  cellSize: number,
  kind: PipeKind,
  orientation: Orientation,
  color: string,
  alpha: number,
  scale: number
): void {
  const armLength = cellSize * 0.38;
  const lineWidth = cellSize * 0.21;
  const topology = getPipeTopology(kind, orientation);

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.scale(scale, scale);

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;

  if (kind === 'doubleElbow') {
    const cornerRadius = cellSize * 0.2;

    for (const [from, to] of topology.pairs) {
      const fromDelta = directionToDelta(from);
      const toDelta = directionToDelta(to);
      const cornerX = (fromDelta.dc + toDelta.dc) * cornerRadius;
      const cornerY = (fromDelta.dr + toDelta.dr) * cornerRadius;

      ctx.beginPath();
      ctx.moveTo(fromDelta.dc * armLength, fromDelta.dr * armLength);
      ctx.lineTo(cornerX, cornerY);
      ctx.lineTo(toDelta.dc * armLength, toDelta.dr * armLength);
      ctx.stroke();
    }

    ctx.restore();
    return;
  }

  for (const direction of ALL_DIRECTIONS) {
    if ((topology.mask & direction) === 0) {
      continue;
    }

    const delta = directionToDelta(direction);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(delta.dc * armLength, delta.dr * armLength);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(0, 0, lineWidth * 0.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawPlacedPipes(
  ctx: CanvasRenderingContext2D,
  game: GameState,
  metrics: GridRenderMetrics,
  animation: AnimationState
): void {
  for (let row = 0; row < game.gridSize; row += 1) {
    for (let col = 0; col < game.gridSize; col += 1) {
      const tile = game.tiles[row][col];
      if (!tile) {
        continue;
      }

      const animationState = getCellAnimationState(animation, row, col);
      const groupColor = tile.groupId
        ? ENDPOINT_COLOR_PALETTE[
            (game.endpointGroups.find((group) => group.id === tile.groupId)?.colorId ?? 0) %
              ENDPOINT_COLOR_PALETTE.length
          ]
        : '#ffffff';
      const fillProgress = animationState.flowProgress;
      const flowingColor = fillProgress <= 0
        ? '#ffffff'
        : mixHexColors('#ffffff', groupColor, fillProgress);
      const color = flowingColor;
      const alpha = 1 - animationState.burstProgress;
      const scale = 1 - 0.35 * animationState.burstProgress;
      const center = cellCenter({ row, col }, metrics);

      drawPipeSymbol(
        ctx,
        center,
        metrics.cellSize,
        tile.kind,
        tile.orientation,
        color,
        alpha,
        scale
      );
    }
  }
}

function drawRoutes(
  ctx: CanvasRenderingContext2D,
  game: GameState,
  metrics: GridRenderMetrics
): void {
  if (!game.showRoutePreviews) {
    return;
  }

  const nodeById = new Map(game.endpointNodes.map((node) => [node.id, node]));

  for (const route of game.routes) {
    if (route.cells.length === 0) {
      continue;
    }

    const fromNode = nodeById.get(route.fromNodeId);
    const toNode = nodeById.get(route.toNodeId);
    if (!fromNode || !toNode) {
      continue;
    }

    const style = ROUTE_PREVIEW_STYLE_BY_ID[route.id];
    const points: CellCenter[] = [
      cellCenter({ row: fromNode.row, col: fromNode.col }, metrics),
      ...route.cells.map((cell) => cellCenter(cell, metrics)),
      cellCenter({ row: toNode.row, col: toNode.col }, metrics)
    ];

    ctx.save();
    ctx.globalAlpha = style.alpha;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.lineCap = 'round';
    ctx.setLineDash(style.dash);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      ctx.lineTo(points[index].x, points[index].y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function drawHoverState(
  ctx: CanvasRenderingContext2D,
  drag: DragRenderState,
  metrics: GridRenderMetrics
): void {
  if (!drag.active || !drag.hoveredCell) {
    return;
  }

  const cell = drag.hoveredCell;
  const x = metrics.originX + cell.col * metrics.cellSize;
  const y = metrics.originY + cell.row * metrics.cellSize;

  ctx.save();
  ctx.fillStyle = drag.isValidHover
    ? 'rgba(84, 214, 162, 0.23)'
    : 'rgba(247, 112, 112, 0.24)';
  ctx.fillRect(x + 1, y + 1, metrics.cellSize - 2, metrics.cellSize - 2);

  ctx.strokeStyle = drag.isValidHover
    ? 'rgba(84, 214, 162, 0.95)'
    : 'rgba(247, 112, 112, 0.95)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 2, y + 2, metrics.cellSize - 4, metrics.cellSize - 4);
  ctx.restore();
}

function drawInvalidPlacement(
  ctx: CanvasRenderingContext2D,
  game: GameState,
  metrics: GridRenderMetrics
): void {
  if (!game.invalidCell) {
    return;
  }

  const x = metrics.originX + game.invalidCell.col * metrics.cellSize;
  const y = metrics.originY + game.invalidCell.row * metrics.cellSize;

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 99, 132, 0.95)';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 3, y + 3, metrics.cellSize - 6, metrics.cellSize - 6);
  ctx.restore();
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  model: RenderFrameModel
): GridRenderMetrics {
  const metrics = computeGridMetrics(model.width, model.height, model.game.gridSize);

  drawBackground(ctx, model.width, model.height);
  drawRoutes(ctx, model.game, metrics);
  drawGrid(ctx, metrics);
  drawHoverState(ctx, model.drag, metrics);
  drawInvalidPlacement(ctx, model.game, metrics);
  drawPlacedPipes(ctx, model.game, metrics, model.animation);
  drawEndpoints(ctx, model.game, metrics, model.animation);

  return metrics;
}
