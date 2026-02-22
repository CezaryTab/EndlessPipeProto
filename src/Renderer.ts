import { ENDPOINT_COLOR_PALETTE, type GameState } from './GameState';
import {
  ALL_DIRECTIONS,
  Direction,
  areEdgesConnected,
  directionToDelta,
  getPipeTopology,
  isDirectionOpen,
  oppositeDirection,
  type DirectionBit,
  type Orientation,
  type PipeKind
} from './Pipe';
import type { Cell } from './RouteSolver';

export interface GridRenderMetrics {
  originX: number;
  originY: number;
  cellSize: number;
  gridWidth: number;
  gridHeight: number;
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
  drag: DragRenderState;
  hiddenEndpointIds?: Set<string>;
  width: number;
  height: number;
}

interface CellCenter {
  x: number;
  y: number;
}

interface TraverseState {
  row: number;
  col: number;
  inDir: DirectionBit;
}

interface CrossChannelColors {
  vertical: string | null;
  horizontal: string | null;
}

function toCellKey(row: number, col: number): string {
  return `${row},${col}`;
}

function isInsideGrid(gridHeight: number, gridWidth: number, row: number, col: number): boolean {
  return row >= 0 && row < gridHeight && col >= 0 && col < gridWidth;
}

export function resolveConnectedPipeColors(game: GameState): Map<string, string> {
  const colorIdsByCell = new Map<string, Set<number>>();

  for (const endpoint of game.endpointNodes) {
    const queue: TraverseState[] = [];
    const visitedStates = new Set<string>();

    for (const direction of ALL_DIRECTIONS) {
      const delta = directionToDelta(direction);
      const neighborRow = endpoint.row + delta.dr;
      const neighborCol = endpoint.col + delta.dc;
      if (!isInsideGrid(game.gridHeight, game.gridWidth, neighborRow, neighborCol)) {
        continue;
      }

      const neighborTile = game.tiles[neighborRow]?.[neighborCol];
      if (!neighborTile) {
        continue;
      }

      const incoming = oppositeDirection(direction);
      if (!isDirectionOpen(neighborTile.kind, neighborTile.orientation, incoming)) {
        continue;
      }

      queue.push({
        row: neighborRow,
        col: neighborCol,
        inDir: incoming
      });
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      const stateKey = `${current.row},${current.col},${current.inDir}`;
      if (visitedStates.has(stateKey)) {
        continue;
      }
      visitedStates.add(stateKey);

      const tile = game.tiles[current.row]?.[current.col];
      if (!tile) {
        continue;
      }

      if (!isDirectionOpen(tile.kind, tile.orientation, current.inDir)) {
        continue;
      }

      const cellKey = toCellKey(current.row, current.col);
      const seenColors = colorIdsByCell.get(cellKey) ?? new Set<number>();
      seenColors.add(endpoint.colorId);
      colorIdsByCell.set(cellKey, seenColors);

      for (const outDirection of ALL_DIRECTIONS) {
        if (outDirection === current.inDir) {
          continue;
        }

        if (
          !isDirectionOpen(tile.kind, tile.orientation, outDirection) ||
          !areEdgesConnected(tile.kind, tile.orientation, current.inDir, outDirection)
        ) {
          continue;
        }

        const delta = directionToDelta(outDirection);
        const nextRow = current.row + delta.dr;
        const nextCol = current.col + delta.dc;
        if (!isInsideGrid(game.gridHeight, game.gridWidth, nextRow, nextCol)) {
          continue;
        }

        const nextTile = game.tiles[nextRow]?.[nextCol];
        if (!nextTile) {
          continue;
        }

        const nextIncoming = oppositeDirection(outDirection);
        if (!isDirectionOpen(nextTile.kind, nextTile.orientation, nextIncoming)) {
          continue;
        }

        queue.push({
          row: nextRow,
          col: nextCol,
          inDir: nextIncoming
        });
      }
    }
  }

  const colorByCell = new Map<string, string>();
  for (const [cellKey, colorIds] of colorIdsByCell.entries()) {
    if (colorIds.size !== 1) {
      continue;
    }

    const colorId = colorIds.values().next().value as number;
    colorByCell.set(
      cellKey,
      ENDPOINT_COLOR_PALETTE[colorId % ENDPOINT_COLOR_PALETTE.length] ?? '#f4f7ff'
    );
  }

  return colorByCell;
}

function resolveSingleColor(colorIds: Set<number>): string | null {
  if (colorIds.size !== 1) {
    return null;
  }
  const colorId = colorIds.values().next().value as number;
  return ENDPOINT_COLOR_PALETTE[colorId % ENDPOINT_COLOR_PALETTE.length] ?? '#f4f7ff';
}

export function resolveConnectedCrossChannelColors(game: GameState): Map<string, CrossChannelColors> {
  const channelColorIdsByCell = new Map<string, { vertical: Set<number>; horizontal: Set<number> }>();

  for (const endpoint of game.endpointNodes) {
    const queue: TraverseState[] = [];
    const visitedStates = new Set<string>();

    for (const direction of ALL_DIRECTIONS) {
      const delta = directionToDelta(direction);
      const neighborRow = endpoint.row + delta.dr;
      const neighborCol = endpoint.col + delta.dc;
      if (!isInsideGrid(game.gridHeight, game.gridWidth, neighborRow, neighborCol)) {
        continue;
      }

      const neighborTile = game.tiles[neighborRow]?.[neighborCol];
      if (!neighborTile) {
        continue;
      }

      const incoming = oppositeDirection(direction);
      if (!isDirectionOpen(neighborTile.kind, neighborTile.orientation, incoming)) {
        continue;
      }

      queue.push({
        row: neighborRow,
        col: neighborCol,
        inDir: incoming
      });
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      const stateKey = `${current.row},${current.col},${current.inDir}`;
      if (visitedStates.has(stateKey)) {
        continue;
      }
      visitedStates.add(stateKey);

      const tile = game.tiles[current.row]?.[current.col];
      if (!tile) {
        continue;
      }

      if (!isDirectionOpen(tile.kind, tile.orientation, current.inDir)) {
        continue;
      }

      if (tile.kind === 'cross') {
        const key = toCellKey(current.row, current.col);
        const channelSets = channelColorIdsByCell.get(key) ?? {
          vertical: new Set<number>(),
          horizontal: new Set<number>()
        };

        if (current.inDir === Direction.N || current.inDir === Direction.S) {
          channelSets.vertical.add(endpoint.colorId);
        } else if (current.inDir === Direction.E || current.inDir === Direction.W) {
          channelSets.horizontal.add(endpoint.colorId);
        }
        channelColorIdsByCell.set(key, channelSets);
      }

      for (const outDirection of ALL_DIRECTIONS) {
        if (outDirection === current.inDir) {
          continue;
        }

        if (
          !isDirectionOpen(tile.kind, tile.orientation, outDirection) ||
          !areEdgesConnected(tile.kind, tile.orientation, current.inDir, outDirection)
        ) {
          continue;
        }

        const delta = directionToDelta(outDirection);
        const nextRow = current.row + delta.dr;
        const nextCol = current.col + delta.dc;
        if (!isInsideGrid(game.gridHeight, game.gridWidth, nextRow, nextCol)) {
          continue;
        }

        const nextTile = game.tiles[nextRow]?.[nextCol];
        if (!nextTile) {
          continue;
        }

        const nextIncoming = oppositeDirection(outDirection);
        if (!isDirectionOpen(nextTile.kind, nextTile.orientation, nextIncoming)) {
          continue;
        }

        queue.push({
          row: nextRow,
          col: nextCol,
          inDir: nextIncoming
        });
      }
    }
  }

  const result = new Map<string, CrossChannelColors>();
  for (const [key, channels] of channelColorIdsByCell.entries()) {
    result.set(key, {
      vertical: resolveSingleColor(channels.vertical),
      horizontal: resolveSingleColor(channels.horizontal)
    });
  }
  return result;
}

function computeGridMetrics(
  width: number,
  height: number,
  gridWidth: number,
  gridHeight: number
): GridRenderMetrics {
  const padding = 22;
  const availableWidth = Math.max(120, width - padding * 2);
  const availableHeight = Math.max(120, height - padding * 2);
  const cellSize = Math.max(8, Math.min(availableWidth / gridWidth, availableHeight / gridHeight));
  const boardPixelWidth = cellSize * gridWidth;
  const boardPixelHeight = cellSize * gridHeight;

  return {
    originX: (width - boardPixelWidth) / 2,
    originY: (height - boardPixelHeight) / 2,
    cellSize,
    gridWidth,
    gridHeight
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
  const boardWidth = metrics.cellSize * metrics.gridWidth;
  const boardHeight = metrics.cellSize * metrics.gridHeight;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 1;

  for (let i = 0; i <= metrics.gridWidth; i += 1) {
    const offset = metrics.originX + i * metrics.cellSize;
    ctx.beginPath();
    ctx.moveTo(offset, metrics.originY);
    ctx.lineTo(offset, metrics.originY + boardHeight);
    ctx.stroke();
  }

  for (let i = 0; i <= metrics.gridHeight; i += 1) {
    const offset = metrics.originY + i * metrics.cellSize;
    ctx.beginPath();
    ctx.moveTo(metrics.originX, offset);
    ctx.lineTo(metrics.originX + boardWidth, offset);
    ctx.stroke();
  }
}

function drawEndpoints(
  ctx: CanvasRenderingContext2D,
  game: GameState,
  metrics: GridRenderMetrics,
  hiddenEndpointIds?: Set<string>
): void {
  const radius = metrics.cellSize * 0.16;

  for (const endpoint of game.endpointNodes) {
    if (hiddenEndpointIds?.has(endpoint.id)) {
      continue;
    }

    const center = cellCenter({ row: endpoint.row, col: endpoint.col }, metrics);
    const color = ENDPOINT_COLOR_PALETTE[endpoint.colorId % ENDPOINT_COLOR_PALETTE.length] ?? '#ffffff';

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

  if (kind === 'cross') {
    const gapRadius = cellSize * 0.18;
    for (const direction of ALL_DIRECTIONS) {
      const delta = directionToDelta(direction);
      ctx.beginPath();
      ctx.moveTo(delta.dc * gapRadius, delta.dr * gapRadius);
      ctx.lineTo(delta.dc * armLength, delta.dr * armLength);
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

function drawCrossSymbol(
  ctx: CanvasRenderingContext2D,
  center: CellCenter,
  cellSize: number,
  verticalColor: string,
  horizontalColor: string,
  alpha: number,
  scale: number
): void {
  const armLength = cellSize * 0.38;
  const lineWidth = cellSize * 0.21;
  const horizontalGapRadius = cellSize * 0.24;

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.scale(scale, scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = alpha;

  ctx.strokeStyle = verticalColor;
  ctx.beginPath();
  ctx.moveTo(0, -armLength);
  ctx.lineTo(0, armLength);
  ctx.stroke();

  ctx.strokeStyle = horizontalColor;
  ctx.beginPath();
  ctx.moveTo(-horizontalGapRadius, 0);
  ctx.lineTo(-armLength, 0);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(horizontalGapRadius, 0);
  ctx.lineTo(armLength, 0);
  ctx.stroke();

  ctx.restore();
}

function drawPlacedPipes(
  ctx: CanvasRenderingContext2D,
  game: GameState,
  metrics: GridRenderMetrics
): void {
  const connectedColors = resolveConnectedPipeColors(game);
  const connectedCrossChannels = resolveConnectedCrossChannelColors(game);

  for (let row = 0; row < game.gridHeight; row += 1) {
    for (let col = 0; col < game.gridWidth; col += 1) {
      const tile = game.tiles[row][col];
      if (!tile) {
        continue;
      }

      const center = cellCenter({ row, col }, metrics);
      const cellKey = toCellKey(row, col);
      const neutralColor = '#f4f7ff';

      if (tile.kind === 'cross') {
        const channels = connectedCrossChannels.get(cellKey);
        drawCrossSymbol(
          ctx,
          center,
          metrics.cellSize,
          channels?.vertical ?? neutralColor,
          channels?.horizontal ?? neutralColor,
          1,
          1
        );
        continue;
      }

      drawPipeSymbol(
        ctx,
        center,
        metrics.cellSize,
        tile.kind,
        tile.orientation,
        connectedColors.get(cellKey) ?? neutralColor,
        1,
        1
      );
    }
  }
}

function drawGhostPipes(
  ctx: CanvasRenderingContext2D,
  game: GameState,
  metrics: GridRenderMetrics
): void {
  if (!game.showGhostPipes || game.ghostPipes.length === 0) {
    return;
  }

  const ghostColor = '#f4f7ff';
  const ghostAlpha = 0.1;

  for (const ghost of game.ghostPipes) {
    if (!isInsideGrid(game.gridHeight, game.gridWidth, ghost.row, ghost.col)) {
      continue;
    }
    if (game.tiles[ghost.row][ghost.col] !== null) {
      continue;
    }

    const center = cellCenter({ row: ghost.row, col: ghost.col }, metrics);
    if (ghost.kind === 'cross') {
      drawCrossSymbol(
        ctx,
        center,
        metrics.cellSize,
        ghostColor,
        ghostColor,
        ghostAlpha,
        1
      );
      continue;
    }

    drawPipeSymbol(
      ctx,
      center,
      metrics.cellSize,
      ghost.kind,
      ghost.orientation,
      ghostColor,
      ghostAlpha,
      1
    );
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
  const metrics = computeGridMetrics(
    model.width,
    model.height,
    model.game.gridWidth,
    model.game.gridHeight
  );

  drawBackground(ctx, model.width, model.height);
  drawGrid(ctx, metrics);
  drawGhostPipes(ctx, model.game, metrics);
  drawHoverState(ctx, model.drag, metrics);
  drawInvalidPlacement(ctx, model.game, metrics);
  drawPlacedPipes(ctx, model.game, metrics);
  drawEndpoints(ctx, model.game, metrics, model.hiddenEndpointIds);

  return metrics;
}
