import { describe, expect, it } from 'vitest';
import { ENDPOINT_COLOR_PALETTE, createEmptyTiles, initGame, type GameState } from '../GameState';
import {
  ALL_DIRECTIONS,
  areEdgesConnected,
  directionToDelta,
  isDirectionOpen,
  type Orientation,
  type PipeKind
} from '../Pipe';
import {
  renderFrame,
  resolveConnectedCrossChannelColors,
  resolveConnectedPipeColors
} from '../Renderer';

const ORIENTATIONS: Orientation[] = [0, 90, 180, 270];
const PIPE_KINDS: PipeKind[] = ['straight', 'elbow', 'tee', 'cross', 'doubleElbow'];

function createMockContext(): CanvasRenderingContext2D {
  const gradient = {
    addColorStop: () => undefined
  };

  return {
    createLinearGradient: () => gradient,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
    fill: () => undefined,
    arc: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    scale: () => undefined,
    setLineDash: () => undefined
  } as unknown as CanvasRenderingContext2D;
}

function createCountingContext(): { ctx: CanvasRenderingContext2D; getStrokeCount: () => number } {
  let strokeCount = 0;
  const gradient = {
    addColorStop: () => undefined
  };

  const ctx = {
    createLinearGradient: () => gradient,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => {
      strokeCount += 1;
    },
    fill: () => undefined,
    arc: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    scale: () => undefined,
    setLineDash: () => undefined
  } as unknown as CanvasRenderingContext2D;

  return {
    ctx,
    getStrokeCount: () => strokeCount
  };
}

function createSandboxGame(gridSize = 5): GameState {
  const base = initGame({ gridSize, offerSeed: 1, rng: () => 0.5 });
  return {
    ...base,
    gridSize,
    tiles: createEmptyTiles(gridSize),
    endpointNodes: [],
    endpointGroups: []
  };
}

function toKey(row: number, col: number): string {
  return `${row},${col}`;
}

describe('Renderer sandbox frame', () => {
  it('renders without route preview dependencies', () => {
    const game = initGame({ gridSize: 5, offerSeed: 3, rng: () => 0.5 });
    const ctx = createMockContext();

    const metrics = renderFrame(ctx, {
      game,
      drag: {
        active: false,
        hoveredCell: null,
        isValidHover: false,
        offer: null
      },
      width: 640,
      height: 640
    });

    expect(metrics.gridWidth).toBe(5);
    expect(metrics.gridHeight).toBe(5);
    expect(metrics.cellSize).toBeGreaterThan(0);
  });

  it('draws ghost pipes only when preview is enabled and cell is empty', () => {
    const baseGame = createSandboxGame(5);
    const ghost = { row: 2, col: 2, kind: 'straight' as const, orientation: 0 as const };

    const hiddenGame: GameState = {
      ...baseGame,
      showGhostPipes: false,
      ghostPipes: [ghost]
    };
    const hiddenContext = createCountingContext();
    renderFrame(hiddenContext.ctx, {
      game: hiddenGame,
      drag: {
        active: false,
        hoveredCell: null,
        isValidHover: false,
        offer: null
      },
      width: 640,
      height: 640
    });
    const hiddenStrokes = hiddenContext.getStrokeCount();

    const visibleGame: GameState = {
      ...hiddenGame,
      showGhostPipes: true
    };
    const visibleContext = createCountingContext();
    renderFrame(visibleContext.ctx, {
      game: visibleGame,
      drag: {
        active: false,
        hoveredCell: null,
        isValidHover: false,
        offer: null
      },
      width: 640,
      height: 640
    });
    const visibleStrokes = visibleContext.getStrokeCount();
    expect(visibleStrokes).toBeGreaterThan(hiddenStrokes);

    const occupiedGame: GameState = {
      ...visibleGame,
      tiles: (() => {
        const tiles = createEmptyTiles(5);
        tiles[2][2] = { kind: 'cross', orientation: 0, originalOrientation: 0 };
        return tiles;
      })()
    };
    const occupiedVisibleContext = createCountingContext();
    renderFrame(occupiedVisibleContext.ctx, {
      game: occupiedGame,
      drag: {
        active: false,
        hoveredCell: null,
        isValidHover: false,
        offer: null
      },
      width: 640,
      height: 640
    });
    const occupiedVisibleStrokes = occupiedVisibleContext.getStrokeCount();

    const occupiedHiddenContext = createCountingContext();
    renderFrame(occupiedHiddenContext.ctx, {
      game: {
        ...occupiedGame,
        showGhostPipes: false
      },
      drag: {
        active: false,
        hoveredCell: null,
        isValidHover: false,
        offer: null
      },
      width: 640,
      height: 640
    });
    const occupiedHiddenStrokes = occupiedHiddenContext.getStrokeCount();
    expect(occupiedVisibleStrokes).toBe(occupiedHiddenStrokes);
  });

  it('matches connectivity matrix for every kind/orientation/in-out combination', () => {
    const centerRow = 2;
    const centerCol = 2;
    const endpointColor = ENDPOINT_COLOR_PALETTE[0];
    let caseCount = 0;

    for (const kind of PIPE_KINDS) {
      for (const orientation of ORIENTATIONS) {
        for (const incoming of ALL_DIRECTIONS) {
          for (const outgoing of ALL_DIRECTIONS) {
            if (incoming === outgoing) {
              continue;
            }
            caseCount += 1;

            const incomingDelta = directionToDelta(incoming);
            const outgoingDelta = directionToDelta(outgoing);
            const endpointRow = centerRow + incomingDelta.dr;
            const endpointCol = centerCol + incomingDelta.dc;
            const neighborRow = centerRow + outgoingDelta.dr;
            const neighborCol = centerCol + outgoingDelta.dc;
            const context = `${kind}@${orientation} in=${incoming} out=${outgoing}`;

            const game = createSandboxGame(5);
            game.endpointNodes = [
              { id: 'g1-a', row: endpointRow, col: endpointCol, groupId: 'g1', colorId: 0 }
            ];
            game.endpointGroups = [{ id: 'g1', colorId: 0, nodeIds: ['g1-a'] }];
            game.tiles[centerRow][centerCol] = { kind, orientation, originalOrientation: orientation };
            game.tiles[neighborRow][neighborCol] = {
              kind: 'cross',
              orientation: 0,
              originalOrientation: 0
            };

            const entryOpen = isDirectionOpen(kind, orientation, incoming);
            const outOpen = isDirectionOpen(kind, orientation, outgoing);
            const edgeConnected = areEdgesConnected(kind, orientation, incoming, outgoing);

            const colors = resolveConnectedPipeColors(game);
            const centerKey = toKey(centerRow, centerCol);
            const neighborKey = toKey(neighborRow, neighborCol);

            expect(colors.get(centerKey), `${context} center`).toBe(entryOpen ? endpointColor : undefined);
            expect(colors.get(neighborKey), `${context} neighbor`).toBe(
              entryOpen && outOpen && edgeConnected ? endpointColor : undefined
            );
          }
        }
      }
    }

    expect(caseCount).toBe(240);
  });

  it('colors endpoint-adjacent tiles only when the endpoint-facing side is open', () => {
    const centerRow = 2;
    const centerCol = 2;
    let caseCount = 0;

    for (const kind of PIPE_KINDS) {
      for (const orientation of ORIENTATIONS) {
        for (const incoming of ALL_DIRECTIONS) {
          caseCount += 1;
          const incomingDelta = directionToDelta(incoming);
          const endpointRow = centerRow + incomingDelta.dr;
          const endpointCol = centerCol + incomingDelta.dc;
          const context = `${kind}@${orientation} incoming=${incoming}`;

          const game = createSandboxGame(5);
          game.endpointNodes = [
            { id: 'g1-a', row: endpointRow, col: endpointCol, groupId: 'g1', colorId: 0 }
          ];
          game.endpointGroups = [{ id: 'g1', colorId: 0, nodeIds: ['g1-a'] }];
          game.tiles[centerRow][centerCol] = { kind, orientation, originalOrientation: orientation };

          const colors = resolveConnectedPipeColors(game);
          expect(colors.has(toKey(centerRow, centerCol)), context).toBe(
            isDirectionOpen(kind, orientation, incoming)
          );
        }
      }
    }

    expect(caseCount).toBe(80);
  });

  it('keeps pipe color neutral when reached by multiple endpoint colors', () => {
    const game = createSandboxGame(5);
    game.endpointNodes = [
      { id: 'g1-a', row: 1, col: 2, groupId: 'g1', colorId: 0 },
      { id: 'g2-a', row: 3, col: 2, groupId: 'g2', colorId: 1 }
    ];
    game.endpointGroups = [
      { id: 'g1', colorId: 0, nodeIds: ['g1-a'] },
      { id: 'g2', colorId: 1, nodeIds: ['g2-a'] }
    ];
    game.tiles[2][2] = { kind: 'straight', orientation: 0, originalOrientation: 0 };

    const colors = resolveConnectedPipeColors(game);
    expect(colors.has('2,2')).toBe(false);
  });

  it('colors cross channels for every vertical/horizontal adjacency combination', () => {
    const axisStates = ['none', 'correct', 'wrong'] as const;
    let caseCount = 0;

    for (const verticalState of axisStates) {
      for (const horizontalState of axisStates) {
        caseCount += 1;
        const game = createSandboxGame(5);
        game.endpointNodes = [
          { id: 'g1-a', row: 0, col: 2, groupId: 'g1', colorId: 0 },
          { id: 'g1-b', row: 4, col: 2, groupId: 'g1', colorId: 0 },
          { id: 'g2-a', row: 2, col: 0, groupId: 'g2', colorId: 1 },
          { id: 'g2-b', row: 2, col: 4, groupId: 'g2', colorId: 1 }
        ];
        game.endpointGroups = [
          { id: 'g1', colorId: 0, nodeIds: ['g1-a', 'g1-b'] },
          { id: 'g2', colorId: 1, nodeIds: ['g2-a', 'g2-b'] }
        ];

        game.tiles[2][2] = { kind: 'cross', orientation: 0, originalOrientation: 0 };

        if (verticalState !== 'none') {
          const orientation = verticalState === 'correct' ? 0 : 90;
          game.tiles[1][2] = { kind: 'straight', orientation, originalOrientation: orientation };
          game.tiles[3][2] = { kind: 'straight', orientation, originalOrientation: orientation };
        }

        if (horizontalState !== 'none') {
          const orientation = horizontalState === 'correct' ? 90 : 0;
          game.tiles[2][1] = { kind: 'straight', orientation, originalOrientation: orientation };
          game.tiles[2][3] = { kind: 'straight', orientation, originalOrientation: orientation };
        }

        const channels = resolveConnectedCrossChannelColors(game).get('2,2');
        const context = `vertical=${verticalState} horizontal=${horizontalState}`;
        expect(channels?.vertical ?? null, `${context} vertical`).toBe(
          verticalState === 'correct' ? ENDPOINT_COLOR_PALETTE[0] : null
        );
        expect(channels?.horizontal ?? null, `${context} horizontal`).toBe(
          horizontalState === 'correct' ? ENDPOINT_COLOR_PALETTE[1] : null
        );
      }
    }

    expect(caseCount).toBe(9);
  });

  it('keeps cross channel neutral when multiple groups enter the same channel', () => {
    const game = createSandboxGame(5);
    game.endpointNodes = [
      { id: 'g1-a', row: 0, col: 2, groupId: 'g1', colorId: 0 },
      { id: 'g2-a', row: 4, col: 2, groupId: 'g2', colorId: 1 }
    ];
    game.endpointGroups = [
      { id: 'g1', colorId: 0, nodeIds: ['g1-a'] },
      { id: 'g2', colorId: 1, nodeIds: ['g2-a'] }
    ];
    game.tiles[1][2] = { kind: 'straight', orientation: 0, originalOrientation: 0 };
    game.tiles[2][2] = { kind: 'cross', orientation: 0, originalOrientation: 0 };
    game.tiles[3][2] = { kind: 'straight', orientation: 0, originalOrientation: 0 };

    const channels = resolveConnectedCrossChannelColors(game);
    const center = channels.get('2,2');
    expect(center).toBeDefined();
    expect(center?.vertical).toBeNull();
    expect(center?.horizontal).toBeNull();
  });
});
