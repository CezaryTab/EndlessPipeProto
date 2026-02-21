import { describe, expect, it } from 'vitest';
import {
  applyRouteFallbackChoice,
  createEmptyTiles,
  discardOffer,
  deriveRouteDifficultyWindow,
  initGame,
  placeOffer,
  refreshRoutes,
  rotateOffer,
  setEndpointScenario,
  setOfferDifficulty,
  setPipeSpawnEnabled,
  setRoutePreviewEnabled,
  type GameState
} from '../GameState';
import { deriveRealLaneWeights, type RouteId } from '../RouteSolver';

function fixedState(): GameState {
  return initGame({
    gridSize: 8,
    endpointScenario: [{ size: 2, groups: 1 }],
    offerDifficulty: 50,
    energy: 12,
    boosters: 3,
    rng: () => 0.41
  });
}

function findPlaceableCell(state: GameState): { row: number; col: number } {
  for (let row = 0; row < state.gridSize; row += 1) {
    for (let col = 0; col < state.gridSize; col += 1) {
      if (state.tiles[row][col] !== null) {
        continue;
      }
      if (state.endpointNodes.some((node) => node.row === row && node.col === col)) {
        continue;
      }
      return { row, col };
    }
  }
  return { row: 1, col: 1 };
}

describe('Game state reducers', () => {
  it('allows placement on empty cells and blocks overwrite', () => {
    const state = fixedState();
    const target = findPlaceableCell(state);

    const afterPlacement = placeOffer(state, 0, target);

    expect(afterPlacement.tiles[target.row][target.col]).not.toBeNull();
    expect(afterPlacement.energy).toBe(state.energy - 1);

    const overwriteAttempt = placeOffer(afterPlacement, 0, target);

    expect(overwriteAttempt.energy).toBe(afterPlacement.energy);
    expect(overwriteAttempt.invalidCell).toEqual(target);
  });

  it('rotation does nothing when no boosters remain', () => {
    const state = fixedState();
    const noBoosterState: GameState = {
      ...state,
      boosters: 0
    };

    const rotated = rotateOffer(noBoosterState, 0);
    expect(rotated.offers[0].orientation).toBe(noBoosterState.offers[0].orientation);
  });

  it('consumes booster only when placed orientation differs from original', () => {
    const state = fixedState();
    const targetA = findPlaceableCell(state);
    const targetB = findPlaceableCell({
      ...state,
      tiles: (() => {
        const grid = createEmptyTiles(state.gridSize);
        grid[targetA.row][targetA.col] = {
          kind: 'straight',
          orientation: 0,
          originalOrientation: 0,
          groupId: state.endpointGroups[0]?.id ?? 'group-1'
        };
        return grid;
      })()
    });

    const mismatched = {
      ...state,
      offers: [
        {
          ...state.offers[0],
          kind: 'straight' as const,
          orientation: 90 as const,
          originalOrientation: 0 as const
        },
        ...state.offers.slice(1)
      ]
    };

    const afterMismatch = placeOffer(mismatched, 0, targetA);
    expect(afterMismatch.boosters).toBe(state.boosters - 1);

    const aligned = {
      ...state,
      offers: [
        {
          ...state.offers[0],
          kind: 'straight' as const,
          orientation: 0 as const,
          originalOrientation: 0 as const
        },
        ...state.offers.slice(1)
      ]
    };

    const afterAligned = placeOffer(aligned, 0, targetB);
    expect(afterAligned.boosters).toBe(state.boosters);
  });

  it('charges energy for discard', () => {
    const state = fixedState();
    const afterDiscard = discardOffer(state, 0);
    expect(afterDiscard.energy).toBe(state.energy - 1);
  });

  it('updates offer difficulty knob', () => {
    const state = fixedState();

    const withDifficulty = setOfferDifficulty(state, 90);
    expect(withDifficulty.offerDifficulty).toBe(90);
  });

  it('derives a continuous route difficulty window from the slider', () => {
    expect(deriveRouteDifficultyWindow(0)).toEqual({ easy: 0, medium: 0, hard: 25 });
    expect(deriveRouteDifficultyWindow(50)).toEqual({ easy: 25, medium: 50, hard: 75 });
    expect(deriveRouteDifficultyWindow(100)).toEqual({ easy: 75, medium: 100, hard: 100 });
  });

  it('toggles route preview visibility', () => {
    const state = fixedState();
    const hidden = setRoutePreviewEnabled(state, false);
    expect(hidden.showRoutePreviews).toBe(false);

    const shown = setRoutePreviewEnabled(hidden, true);
    expect(shown.showRoutePreviews).toBe(true);
  });

  it('real-mode offers follow blended lane weights across difficulty values', () => {
    const state = fixedState();
    const thresholds = [0, 33, 50, 67, 100];

    for (const difficulty of thresholds) {
      const next = setOfferDifficulty(state, difficulty);
      const weights = deriveRealLaneWeights(difficulty);
      const expectedLane = (['easy', 'medium', 'hard'] as RouteId[]).reduce(
        (best, routeId) => (weights[routeId] > weights[best] ? routeId : best),
        'medium'
      );
      expect(next.offers).toHaveLength(1);
      expect(next.offers[0].routeId).toBe(expectedLane);
    }
  });

  it('respects pipe spawn toggles when generating offers', () => {
    const state = fixedState();
    const noTee = setPipeSpawnEnabled(state, 'tee', false);
    const noCross = setPipeSpawnEnabled(noTee, 'cross', false);

    expect(noCross.pipeSpawnEnabled.tee).toBe(false);
    expect(noCross.pipeSpawnEnabled.cross).toBe(false);
    expect(noCross.offers.every((offer) => offer.kind !== 'tee' && offer.kind !== 'cross')).toBe(true);
  });

  it('rebuilds endpoints according to scenario (2x2 => 2 groups of 2)', () => {
    const state = fixedState();
    const updated = setEndpointScenario(state, [{ size: 2, groups: 2 }]);

    expect(updated.endpointGroups.length).toBe(2);
    expect(updated.endpointGroups.every((group) => group.nodeIds.length === 2)).toBe(true);
  });

  it('records event logs and per-offer generation reasons', () => {
    const state = fixedState();

    expect(state.logs.length).toBeGreaterThan(0);
    expect(state.logs.some((entry) => entry.event === 'offer.generated')).toBe(true);
    expect(state.offers.every((offer) => offer.debugReason.length > 0)).toBe(true);
  });

  it('does not show no-route modal when a placement solves all groups', () => {
    const base = fixedState();
    const crafted: GameState = {
      ...base,
      gridSize: 4,
      tiles: createEmptyTiles(4),
      endpointNodes: [
        { id: 'group-1-node-1', row: 0, col: 1, groupId: 'group-1', colorId: 0 },
        { id: 'group-1-node-2', row: 1, col: 0, groupId: 'group-1', colorId: 0 }
      ],
      endpointGroups: [
        { id: 'group-1', colorId: 0, nodeIds: ['group-1-node-1', 'group-1-node-2'] }
      ],
      routes: [],
      offers: [
        {
          id: 'easy-group-1-1-1',
          kind: 'elbow',
          orientation: 270,
          originalOrientation: 270,
          requiredOrientation: 270,
          routeId: 'easy',
          groupId: 'group-1',
          colorId: 0,
          targetCell: { row: 1, col: 1 },
          debugReason: 'test-placement',
          debugScore: 100
        }
      ],
      energy: 10,
      boosters: 3,
      modal: null,
      pendingFlowPath: null,
      pendingFlowColor: null
    };

    const next = placeOffer(crafted, 0, { row: 1, col: 1 });

    expect(next.modal).toBeNull();
    expect(next.pendingFlowPath).not.toBeNull();
    expect(next.pendingFlowPath!.length).toBeGreaterThan(0);
    expect(next.logs.some((entry) => entry.event === 'routes.solved')).toBe(true);
  });

  it('opens blocked-board modal when an endpoint overlaps a placed pipe', () => {
    const state = fixedState();
    const overlapNode = state.endpointNodes[0];
    if (!overlapNode) {
      throw new Error('Expected at least one endpoint node');
    }
    const overlapGroupId = overlapNode?.groupId ?? 'group-1';
    const tiles = createEmptyTiles(state.gridSize);
    tiles[overlapNode.row][overlapNode.col] = {
      kind: 'straight',
      orientation: 0,
      originalOrientation: 0,
      groupId: overlapGroupId
    };

    const next = refreshRoutes({
      ...state,
      tiles
    });

    expect(next.modal?.type).toBe('blockedBoard');
    expect(next.offers).toHaveLength(0);
  });

  it('promotes misplaced border pipe on next endpoint respawn, not immediately', () => {
    const base = fixedState();
    const crafted: GameState = {
      ...base,
      gridSize: 4,
      tiles: createEmptyTiles(4),
      endpointNodes: [
        { id: 'group-1-node-1', row: 3, col: 0, groupId: 'group-1', colorId: 0 },
        { id: 'group-1-node-2', row: 3, col: 3, groupId: 'group-1', colorId: 0 }
      ],
      endpointGroups: [
        { id: 'group-1', colorId: 0, nodeIds: ['group-1-node-1', 'group-1-node-2'] }
      ],
      offers: [
        {
          id: 'medium-group-1-0-1',
          kind: 'straight',
          orientation: 0,
          originalOrientation: 0,
          requiredOrientation: 0,
          routeId: 'medium',
          groupId: 'group-1',
          colorId: 0,
          targetCell: { row: 0, col: 1 },
          debugReason: 'test-misplaced',
          debugScore: 100
        }
      ],
      offerDifficulty: 50,
      energy: 10,
      boosters: 3,
      modal: null,
      pendingFlowPath: null,
      pendingFlowColor: null,
      invalidCell: null
    };

    const placed = placeOffer(crafted, 0, { row: 0, col: 1 });
    expect(placed.tiles[0][1]).not.toBeNull();

    const respawned = applyRouteFallbackChoice(placed, 'respawnEndpoints', () => 0.17);
    expect(respawned.endpointNodes.some((node) => node.row === 0 && node.col === 1)).toBe(true);
    expect(respawned.logs.some((entry) => entry.event === 'endpoints.spawnFromMisplacedPipe')).toBe(true);
  });
});
