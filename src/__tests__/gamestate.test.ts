import { describe, expect, it } from 'vitest';
import {
  addGridHeight,
  addGridWidth,
  createEmptyTiles,
  discardAllOffers,
  getUnlockedDifficultyTier,
  initGame,
  placeOffer,
  resetScore,
  rotateOffer,
  rotateAllOffers,
  setDifficultyTiers,
  setEndpointScenario,
  setGridDimensions,
  setGridSize,
  setShowGhostPipes,
  setPipeSpawnEnabled,
  type GameState
} from '../GameState';
import type { DifficultyTier, OfferSpec } from '../GameState';

function fixedState(): GameState {
  return initGame({
    gridSize: 5,
    endpointScenario: [{ size: 2, groups: 2 }],
    energy: 12,
    boosters: 3,
    offerSeed: 7,
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

function makeOffer(kind: OfferSpec['kind'], orientation: OfferSpec['orientation']): OfferSpec {
  return {
    id: `manual-${kind}-${orientation}`,
    kind,
    orientation,
    originalOrientation: orientation,
    debugReason: 'manual test offer',
    debugScore: 0
  };
}

function makeSeededRng(seed: number): () => number {
  let state = (seed + 1) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function endpointKey(row: number, col: number): string {
  return `${row},${col}`;
}

function adjacentCells(row: number, col: number, gridSize: number): Array<{ row: number; col: number }> {
  const deltas = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 }
  ];

  const cells: Array<{ row: number; col: number }> = [];
  for (const delta of deltas) {
    const next = { row: row + delta.dr, col: col + delta.dc };
    if (next.row < 0 || next.row >= gridSize || next.col < 0 || next.col >= gridSize) {
      continue;
    }
    cells.push(next);
  }
  return cells;
}

function openEntryCount(
  row: number,
  col: number,
  gridSize: number,
  endpointKeys: Set<string>
): number {
  return adjacentCells(row, col, gridSize).filter(
    (cell) => !endpointKeys.has(endpointKey(cell.row, cell.col))
  ).length;
}

function adjacentEndpointCount(
  row: number,
  col: number,
  gridSize: number,
  endpointKeys: Set<string>
): number {
  return adjacentCells(row, col, gridSize).filter(
    (cell) => endpointKeys.has(endpointKey(cell.row, cell.col))
  ).length;
}

function distanceToBorder(row: number, col: number, gridSize: number): number {
  return Math.min(row, col, gridSize - 1 - row, gridSize - 1 - col);
}

function areSimilarGroupColors(a: number, b: number): boolean {
  const first = Math.min(a, b);
  const second = Math.max(a, b);
  return (first === 1 && second === 6) || (first === 2 && second === 5);
}

function endpointHasPotentialSameGroupPartner(
  row: number,
  col: number,
  groupCells: Array<{ row: number; col: number }>,
  gridSize: number,
  endpointKeys: Set<string>
): boolean {
  const targetKeys = new Set(
    groupCells
      .filter((cell) => cell.row !== row || cell.col !== col)
      .map((cell) => endpointKey(cell.row, cell.col))
  );
  if (targetKeys.size === 0) {
    return false;
  }

  const queue = adjacentCells(row, col, gridSize).filter(
    (cell) => !endpointKeys.has(endpointKey(cell.row, cell.col))
  );
  const visited = new Set(queue.map((cell) => endpointKey(cell.row, cell.col)));

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacentCells(current.row, current.col, gridSize)) {
      const nextKey = endpointKey(next.row, next.col);
      if (endpointKeys.has(nextKey)) {
        if (targetKeys.has(nextKey)) {
          return true;
        }
        continue;
      }

      if (visited.has(nextKey)) {
        continue;
      }
      visited.add(nextKey);
      queue.push(next);
    }
  }

  return false;
}

function findCompletedGroupsPayload(state: GameState): {
  groupIds?: string[];
  completedEndpoints?: Array<{ id: string; groupId: string; row: number; col: number; colorId: number }>;
  clearedPipeCount?: number;
} | null {
  const completionEntry = [...state.logs]
    .reverse()
    .find((entry) => entry.event === 'groups.completed');
  if (!completionEntry) {
    return null;
  }
  return completionEntry.data as {
    groupIds?: string[];
    completedEndpoints?: Array<{ id: string; groupId: string; row: number; col: number; colorId: number }>;
    clearedPipeCount?: number;
  };
}

describe('Game state sandbox reducers', () => {
  it('initGame creates exactly one random offer', () => {
    const state = fixedState();
    expect(state.offers).toHaveLength(1);
    expect(state.offers[0]?.id).toContain('offer-');
    expect(state.score).toBe(0);
  });

  it('endpoint generation avoids blocked entries and corner lockups', () => {
    for (let seed = 0; seed < 220; seed += 1) {
      const state = initGame({
        gridSize: 5,
        endpointScenario: [{ size: 2, groups: 2 }],
        offerSeed: seed,
        rng: makeSeededRng(seed)
      });

      const endpointKeys = new Set(state.endpointNodes.map((node) => endpointKey(node.row, node.col)));
      for (const endpoint of state.endpointNodes) {
        const openEntries = openEntryCount(endpoint.row, endpoint.col, state.gridSize, endpointKeys);
        expect(openEntries, `seed=${seed} endpoint=${endpoint.id}`).toBeGreaterThan(0);

        const isCorner = (
          (endpoint.row === 0 || endpoint.row === state.gridSize - 1) &&
          (endpoint.col === 0 || endpoint.col === state.gridSize - 1)
        );
        if (isCorner) {
          const neighbors = adjacentEndpointCount(endpoint.row, endpoint.col, state.gridSize, endpointKeys);
          expect(neighbors, `seed=${seed} corner=${endpoint.id}`).toBe(0);
        }
      }
    }
  });

  it('endpoint generation can use corner cells when they are safe', () => {
    let cornersObserved = 0;

    for (let seed = 0; seed < 180; seed += 1) {
      const state = initGame({
        gridSize: 5,
        endpointScenario: [{ size: 2, groups: 2 }],
        offerSeed: 2000 + seed,
        rng: makeSeededRng(12000 + seed)
      });

      cornersObserved += state.endpointNodes.filter((endpoint) =>
        (endpoint.row === 0 || endpoint.row === state.gridSize - 1) &&
        (endpoint.col === 0 || endpoint.col === state.gridSize - 1)
      ).length;
    }

    expect(cornersObserved).toBeGreaterThan(0);
  });

  it('on 3x2 grid, every 2-endpoint group spawns across different rows', () => {
    for (let seed = 0; seed < 120; seed += 1) {
      const state = initGame({
        gridWidth: 3,
        gridHeight: 2,
        endpointScenario: [{ size: 2, groups: 2 }],
        offerSeed: 3000 + seed,
        rng: makeSeededRng(15000 + seed)
      });

      for (const group of state.endpointGroups) {
        if (group.nodeIds.length !== 2) {
          continue;
        }
        const first = state.endpointNodes.find((node) => node.id === group.nodeIds[0]);
        const second = state.endpointNodes.find((node) => node.id === group.nodeIds[1]);
        expect(first, `seed=${seed} group=${group.id} first endpoint`).toBeDefined();
        expect(second, `seed=${seed} group=${group.id} second endpoint`).toBeDefined();
        if (!first || !second) {
          continue;
        }
        expect(first.row, `seed=${seed} group=${group.id}`).not.toBe(second.row);
      }
    }
  });

  it('endpoint generation keeps same-group partner reachability on empty board', () => {
    for (let seed = 0; seed < 160; seed += 1) {
      const state = initGame({
        gridSize: 7,
        endpointScenario: [{ size: 3, groups: 2 }, { size: 2, groups: 1 }],
        offerSeed: seed,
        rng: makeSeededRng(seed + 1000)
      });

      const endpointById = new Map(state.endpointNodes.map((node) => [node.id, node]));
      const endpointKeys = new Set(state.endpointNodes.map((node) => endpointKey(node.row, node.col)));

      for (const group of state.endpointGroups) {
        if (group.nodeIds.length < 2) {
          continue;
        }
        const groupCells = group.nodeIds
          .map((nodeId) => endpointById.get(nodeId))
          .filter((node): node is NonNullable<typeof node> => Boolean(node))
          .map((node) => ({ row: node.row, col: node.col }));

        expect(groupCells.length, `seed=${seed} group=${group.id}`).toBe(group.nodeIds.length);

        for (const nodeId of group.nodeIds) {
          const node = endpointById.get(nodeId);
          expect(node, `seed=${seed} missing=${nodeId}`).toBeDefined();
          if (!node) {
            continue;
          }

          expect(
            endpointHasPotentialSameGroupPartner(
              node.row,
              node.col,
              groupCells,
              state.gridSize,
              endpointKeys
            ),
            `seed=${seed} group=${group.id} endpoint=${node.id}`
          ).toBe(true);
        }
      }
    }
  });

  it('endpoint generation produces varied layouts across seeds', () => {
    const uniqueLayouts = new Set<string>();

    for (let seed = 0; seed < 24; seed += 1) {
      const state = initGame({
        gridSize: 5,
        endpointScenario: [{ size: 2, groups: 2 }],
        offerSeed: seed,
        rng: makeSeededRng(4000 + seed)
      });

      const key = state.endpointNodes
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((node) => `${node.id}@${node.row},${node.col}`)
        .join('|');
      uniqueLayouts.add(key);
    }

    expect(uniqueLayouts.size).toBeGreaterThanOrEqual(10);
  });

  it('endpoint generation stays border-biased and avoids center-heavy placement', () => {
    let totalDistance = 0;
    let endpointCount = 0;

    for (let seed = 0; seed < 80; seed += 1) {
      const state = initGame({
        gridSize: 5,
        endpointScenario: [{ size: 2, groups: 2 }],
        offerSeed: 100 + seed,
        rng: makeSeededRng(7000 + seed)
      });

      for (const node of state.endpointNodes) {
        totalDistance += distanceToBorder(node.row, node.col, state.gridSize);
        endpointCount += 1;
      }
    }

    const averageDistanceToBorder = totalDistance / Math.max(1, endpointCount);
    expect(averageDistanceToBorder).toBeLessThanOrEqual(0.95);
  });

  it('group color assignment reduces similar adjacent color pairs', () => {
    let totalAdjacentPairs = 0;
    let similarAdjacentPairs = 0;

    for (let seed = 0; seed < 240; seed += 1) {
      const state = initGame({
        gridSize: 7,
        endpointScenario: [{ size: 2, groups: 6 }],
        offerSeed: seed,
        rng: makeSeededRng(9000 + seed)
      });

      for (let index = 0; index < state.endpointGroups.length - 1; index += 1) {
        totalAdjacentPairs += 1;
        const leftColor = state.endpointGroups[index]?.colorId ?? 0;
        const rightColor = state.endpointGroups[index + 1]?.colorId ?? 0;
        if (areSimilarGroupColors(leftColor, rightColor)) {
          similarAdjacentPairs += 1;
        }
      }
    }

    const ratio = similarAdjacentPairs / Math.max(1, totalAdjacentPairs);
    expect(ratio).toBeLessThanOrEqual(0.12);
  });

  it('ghost preview defaults off and can be toggled', () => {
    const state = fixedState();
    expect(state.showGhostPipes).toBe(false);

    const enabled = setShowGhostPipes(state, true);
    expect(enabled.showGhostPipes).toBe(true);

    const disabled = setShowGhostPipes(enabled, false);
    expect(disabled.showGhostPipes).toBe(false);
  });

  it('offers are sourced from ghost plan when a solvable plan exists', () => {
    const base = initGame({
      gridSize: 5,
      endpointScenario: [{ size: 2, groups: 2 }],
      energy: 20,
      boosters: 3,
      offerSeed: 300,
      rng: () => 0.2
    });

    const state: GameState = {
      ...base,
      tiles: createEmptyTiles(5),
      endpointNodes: [
        { id: 'g1-a', row: 0, col: 0, groupId: 'g1', colorId: 0 },
        { id: 'g1-b', row: 0, col: 4, groupId: 'g1', colorId: 0 },
        { id: 'g2-a', row: 4, col: 0, groupId: 'g2', colorId: 1 },
        { id: 'g2-b', row: 4, col: 4, groupId: 'g2', colorId: 1 }
      ],
      endpointGroups: [
        { id: 'g1', colorId: 0, nodeIds: ['g1-a', 'g1-b'] },
        { id: 'g2', colorId: 1, nodeIds: ['g2-a', 'g2-b'] }
      ],
      offers: [makeOffer('straight', 0)]
    };

    const afterPlacement = placeOffer(state, 0, { row: 2, col: 2 });
    expect(afterPlacement.ghostPipes.length).toBeGreaterThan(0);
    expect(afterPlacement.offers[0]?.id).toContain('-ghost-');
    expect(
      afterPlacement.ghostPipes.some(
        (ghost) =>
          ghost.kind === afterPlacement.offers[0]?.kind &&
          ghost.orientation === afterPlacement.offers[0]?.orientation
      )
    ).toBe(true);
  });

  it('placement score rewards ghost-track placement and penalizes off-track placement', () => {
    const base = initGame({
      gridSize: 5,
      endpointScenario: [{ size: 2, groups: 1 }],
      energy: 20,
      boosters: 3,
      offerSeed: 500,
      rng: () => 0.2
    });

    const templateState: GameState = {
      ...base,
      score: 5,
      tiles: createEmptyTiles(5),
      endpointNodes: [
        { id: 'g1-a', row: 0, col: 0, groupId: 'g1', colorId: 0 },
        { id: 'g1-b', row: 4, col: 4, groupId: 'g1', colorId: 0 }
      ],
      endpointGroups: [{ id: 'g1', colorId: 0, nodeIds: ['g1-a', 'g1-b'] }],
      offers: [makeOffer('straight', 0)],
      ghostPipes: [{ row: 2, col: 2, kind: 'straight', orientation: 0 }]
    };

    const onTrack = placeOffer(templateState, 0, { row: 2, col: 2 });
    expect(onTrack.score).toBe(7);

    const offTrack = placeOffer(templateState, 0, { row: 2, col: 1 });
    expect(offTrack.score).toBe(2);

    const clamped = placeOffer({ ...templateState, score: 1 }, 0, { row: 1, col: 2 });
    expect(clamped.score).toBe(0);
  });

  it('placement score applies rotate booster penalty when booster is consumed', () => {
    const base = initGame({
      gridSize: 5,
      endpointScenario: [{ size: 2, groups: 1 }],
      energy: 20,
      boosters: 3,
      offerSeed: 520,
      rng: () => 0.2
    });

    const state: GameState = {
      ...base,
      score: 10,
      tiles: createEmptyTiles(5),
      endpointNodes: [
        { id: 'g1-a', row: 0, col: 0, groupId: 'g1', colorId: 0 },
        { id: 'g1-b', row: 4, col: 4, groupId: 'g1', colorId: 0 }
      ],
      endpointGroups: [{ id: 'g1', colorId: 0, nodeIds: ['g1-a', 'g1-b'] }],
      offers: [makeOffer('straight', 0)],
      ghostPipes: []
    };

    const rotated = rotateOffer(state, 0);
    expect(rotated.offers[0]?.orientation).toBe(90);

    const placed = placeOffer(rotated, 0, { row: 2, col: 2 });
    // -3 off-track and -4 rotate-booster usage.
    expect(placed.score).toBe(3);
  });

  it('placement score on boards <= 3x3 does not penalize off-track placements', () => {
    const base = initGame({
      gridWidth: 3,
      gridHeight: 3,
      endpointScenario: [{ size: 2, groups: 1 }],
      energy: 20,
      boosters: 3,
      offerSeed: 521,
      rng: () => 0.2
    });

    const templateState: GameState = {
      ...base,
      score: 5,
      tiles: createEmptyTiles(3),
      endpointNodes: [
        { id: 'g1-a', row: 0, col: 0, groupId: 'g1', colorId: 0 },
        { id: 'g1-b', row: 2, col: 2, groupId: 'g1', colorId: 0 }
      ],
      endpointGroups: [{ id: 'g1', colorId: 0, nodeIds: ['g1-a', 'g1-b'] }],
      offers: [makeOffer('straight', 0)],
      ghostPipes: [{ row: 1, col: 1, kind: 'straight', orientation: 0 }]
    };

    const onTrack = placeOffer(templateState, 0, { row: 1, col: 1 });
    expect(onTrack.score).toBe(7);

    const offTrack = placeOffer(templateState, 0, { row: 1, col: 0 });
    expect(offTrack.score).toBe(5);
  });

  it('placement score on boards <= 3x3 does not apply rotate penalty on placement', () => {
    const base = initGame({
      gridWidth: 3,
      gridHeight: 3,
      endpointScenario: [{ size: 2, groups: 1 }],
      energy: 20,
      boosters: 3,
      offerSeed: 522,
      rng: () => 0.2
    });

    const state: GameState = {
      ...base,
      score: 10,
      tiles: createEmptyTiles(3),
      endpointNodes: [
        { id: 'g1-a', row: 0, col: 0, groupId: 'g1', colorId: 0 },
        { id: 'g1-b', row: 2, col: 2, groupId: 'g1', colorId: 0 }
      ],
      endpointGroups: [{ id: 'g1', colorId: 0, nodeIds: ['g1-a', 'g1-b'] }],
      offers: [makeOffer('straight', 0)],
      ghostPipes: []
    };

    const rotated = rotateOffer(state, 0);
    expect(rotated.offers[0]?.orientation).toBe(90);

    const placed = placeOffer(rotated, 0, { row: 1, col: 1 });
    expect(placed.score).toBe(10);
  });

  it('keeps ghost planning active for routable groups when another group is blocked', () => {
    const base = initGame({
      gridSize: 5,
      endpointScenario: [{ size: 2, groups: 2 }],
      energy: 20,
      boosters: 3,
      offerSeed: 340,
      rng: () => 0.2
    });

    const state: GameState = {
      ...base,
      tiles: createEmptyTiles(5),
      endpointNodes: [
        { id: 'g1-a', row: 0, col: 0, groupId: 'g1', colorId: 0 },
        { id: 'g1-b', row: 0, col: 4, groupId: 'g1', colorId: 0 },
        { id: 'g2-a', row: 4, col: 1, groupId: 'g2', colorId: 1 },
        { id: 'g2-b', row: 4, col: 3, groupId: 'g2', colorId: 1 }
      ],
      endpointGroups: [
        { id: 'g1', colorId: 0, nodeIds: ['g1-a', 'g1-b'] },
        { id: 'g2', colorId: 1, nodeIds: ['g2-a', 'g2-b'] }
      ],
      offers: [makeOffer('straight', 0)]
    };

    // Block all entry points around g1-a so group g1 is unroutable.
    state.tiles[0][1] = { kind: 'straight', orientation: 0, originalOrientation: 0 };
    state.tiles[1][0] = { kind: 'straight', orientation: 90, originalOrientation: 90 };

    const afterPlacement = placeOffer(state, 0, { row: 2, col: 2 });

    expect(afterPlacement.ghostPipes.length).toBeGreaterThan(0);
    expect(afterPlacement.offers[0]?.id).toContain('-ghost-');
  });

  it('falls back to random offers when no ghost-plan pipe can be represented', () => {
    let state = initGame({
      gridSize: 5,
      endpointScenario: [{ size: 2, groups: 1 }],
      energy: 20,
      boosters: 3,
      offerSeed: 450,
      rng: () => 0.2
    });

    state = setPipeSpawnEnabled(state, 'straight', false);
    state = setPipeSpawnEnabled(state, 'elbow', false);
    state = setPipeSpawnEnabled(state, 'tee', false);
    state = setPipeSpawnEnabled(state, 'cross', false);
    state = setPipeSpawnEnabled(state, 'doubleElbow', false);

    expect(state.ghostPipes).toHaveLength(0);
    expect(state.offers[0]?.id).not.toContain('-ghost-');
    expect(state.offers[0]?.kind).toBe('straight');
  });

  it('offer kind respects spawn toggles', () => {
    const state = fixedState();
    const straightOnly = setPipeSpawnEnabled(setPipeSpawnEnabled(setPipeSpawnEnabled(state, 'elbow', false), 'tee', false), 'cross', false);

    for (let index = 0; index < 20; index += 1) {
      expect(straightOnly.offers[0]?.kind).toBe('straight');
    }
  });

  it('placeOffer consumes energy and blocks overwrite/endpoint placement', () => {
    const state = fixedState();
    const target = { row: 2, col: 2 };

    const placed = placeOffer(state, 0, target);
    expect(placed.energy).toBe(state.energy - 1);
    expect(placed.tiles[target.row][target.col]).not.toBeNull();

    const overwrite = placeOffer(placed, 0, target);
    expect(overwrite.invalidCell).toEqual(target);
    expect(overwrite.energy).toBe(placed.energy);

    const endpoint = placed.endpointNodes[0]!;
    const endpointAttempt = placeOffer(placed, 0, { row: endpoint.row, col: endpoint.col });
    expect(endpointAttempt.invalidCell).toEqual({ row: endpoint.row, col: endpoint.col });
  });

  it('completes one group independently in 2x2 and keeps the other group intact', () => {
    const base = initGame({
      gridSize: 5,
      endpointScenario: [{ size: 2, groups: 2 }],
      energy: 15,
      boosters: 3,
      offerSeed: 9,
      rng: () => 0.2
    });

    const state: GameState = {
      ...base,
      tiles: createEmptyTiles(5),
      endpointNodes: [
        { id: 'g1-a', row: 0, col: 1, groupId: 'g1', colorId: 0 },
        { id: 'g1-b', row: 2, col: 1, groupId: 'g1', colorId: 0 },
        { id: 'g2-a', row: 0, col: 3, groupId: 'g2', colorId: 1 },
        { id: 'g2-b', row: 2, col: 3, groupId: 'g2', colorId: 1 }
      ],
      endpointGroups: [
        { id: 'g1', colorId: 0, nodeIds: ['g1-a', 'g1-b'] },
        { id: 'g2', colorId: 1, nodeIds: ['g2-a', 'g2-b'] }
      ],
      offers: [makeOffer('straight', 0)]
    };

    state.tiles[1][3] = { kind: 'straight', orientation: 90, originalOrientation: 90 };

    const after = placeOffer(state, 0, { row: 1, col: 1 });

    expect(after.energy).toBe(state.energy - 1);
    expect(after.tiles[1][1]).toBeNull();
    expect(after.tiles[1][3]).not.toBeNull();

    const groupTwoA = after.endpointNodes.find((node) => node.id === 'g2-a');
    const groupTwoB = after.endpointNodes.find((node) => node.id === 'g2-b');
    expect(groupTwoA?.row).toBe(0);
    expect(groupTwoA?.col).toBe(3);
    expect(groupTwoB?.row).toBe(2);
    expect(groupTwoB?.col).toBe(3);

    const oldGroupOnePositions = new Set(['0,1', '2,1']);
    const newGroupOneCells = after.endpointNodes
      .filter((node) => node.groupId === 'g1')
      .map((node) => `${node.row},${node.col}`);
    expect(newGroupOneCells.every((cell) => !oldGroupOnePositions.has(cell))).toBe(true);

    const endpointKeys = new Set(after.endpointNodes.map((node) => endpointKey(node.row, node.col)));
    for (const endpoint of after.endpointNodes) {
      expect(openEntryCount(endpoint.row, endpoint.col, after.gridSize, endpointKeys)).toBeGreaterThan(0);
    }

    expect(after.logs.some((entry) => entry.event === 'groups.completed')).toBe(true);
    expect(after.logs.some((entry) => entry.event === 'endpoints.respawned')).toBe(true);
  });

  it('can complete two groups at the same time with one placement', () => {
    const base = initGame({
      gridSize: 5,
      endpointScenario: [{ size: 2, groups: 2 }],
      energy: 15,
      boosters: 3,
      offerSeed: 21,
      rng: () => 0.2
    });

    const state: GameState = {
      ...base,
      tiles: createEmptyTiles(5),
      endpointNodes: [
        { id: 'g1-a', row: 2, col: 0, groupId: 'g1', colorId: 0 },
        { id: 'g1-b', row: 2, col: 4, groupId: 'g1', colorId: 0 },
        { id: 'g2-a', row: 0, col: 2, groupId: 'g2', colorId: 1 },
        { id: 'g2-b', row: 4, col: 2, groupId: 'g2', colorId: 1 }
      ],
      endpointGroups: [
        { id: 'g1', colorId: 0, nodeIds: ['g1-a', 'g1-b'] },
        { id: 'g2', colorId: 1, nodeIds: ['g2-a', 'g2-b'] }
      ],
      offers: [makeOffer('cross', 0)]
    };

    state.tiles[2][1] = { kind: 'straight', orientation: 90, originalOrientation: 90 };
    state.tiles[2][3] = { kind: 'straight', orientation: 90, originalOrientation: 90 };
    state.tiles[1][2] = { kind: 'straight', orientation: 0, originalOrientation: 0 };
    state.tiles[3][2] = { kind: 'straight', orientation: 0, originalOrientation: 0 };

    const after = placeOffer(state, 0, { row: 2, col: 2 });

    expect(after.tiles[2][2]).toBeNull();
    expect(after.tiles[2][1]).toBeNull();
    expect(after.tiles[2][3]).toBeNull();
    expect(after.tiles[1][2]).toBeNull();
    expect(after.tiles[3][2]).toBeNull();

    const completionLog = after.logs.find((entry) => entry.event === 'groups.completed');
    expect(completionLog).toBeDefined();
    const payload = completionLog?.data as { groupIds?: string[] } | undefined;
    expect(payload?.groupIds?.length).toBe(2);
    expect(new Set(payload?.groupIds)).toEqual(new Set(['g1', 'g2']));
    expect(after.score).toBe(19);
  });

  it('for groups larger than two, each endpoint only needs one same-group connection', () => {
    const base = initGame({
      gridSize: 5,
      endpointScenario: [{ size: 4, groups: 1 }],
      energy: 20,
      boosters: 3,
      offerSeed: 40,
      rng: () => 0.2
    });

    const state: GameState = {
      ...base,
      tiles: createEmptyTiles(5),
      endpointNodes: [
        { id: 'g1-a', row: 0, col: 1, groupId: 'g1', colorId: 0 },
        { id: 'g1-b', row: 0, col: 3, groupId: 'g1', colorId: 0 },
        { id: 'g1-c', row: 4, col: 1, groupId: 'g1', colorId: 0 },
        { id: 'g1-d', row: 4, col: 3, groupId: 'g1', colorId: 0 }
      ],
      endpointGroups: [
        { id: 'g1', colorId: 0, nodeIds: ['g1-a', 'g1-b', 'g1-c', 'g1-d'] }
      ],
      offers: [makeOffer('straight', 90)]
    };

    const afterTopPair = placeOffer(state, 0, { row: 0, col: 2 });
    expect(afterTopPair.tiles[0][2]).not.toBeNull();
    expect(afterTopPair.logs.some((entry) => entry.event === 'groups.completed')).toBe(false);

    const afterBottomPair = placeOffer(
      {
        ...afterTopPair,
        offers: [makeOffer('straight', 90)]
      },
      0,
      { row: 4, col: 2 }
    );

    expect(afterBottomPair.tiles[0][2]).toBeNull();
    expect(afterBottomPair.tiles[4][2]).toBeNull();
    expect(afterBottomPair.logs.some((entry) => entry.event === 'groups.completed')).toBe(true);
  });

  it('completion flow works for scenario 2x2 (all groups solved and respawned)', () => {
    const base = initGame({
      gridSize: 5,
      endpointScenario: [{ size: 2, groups: 2 }],
      energy: 30,
      boosters: 3,
      offerSeed: 60,
      rng: () => 0.2
    });

    const state: GameState = {
      ...base,
      tiles: createEmptyTiles(5),
      endpointNodes: [
        { id: 'g1-a', row: 0, col: 1, groupId: 'g1', colorId: 0 },
        { id: 'g1-b', row: 0, col: 3, groupId: 'g1', colorId: 0 },
        { id: 'g2-a', row: 4, col: 1, groupId: 'g2', colorId: 1 },
        { id: 'g2-b', row: 4, col: 3, groupId: 'g2', colorId: 1 }
      ],
      endpointGroups: [
        { id: 'g1', colorId: 0, nodeIds: ['g1-a', 'g1-b'] },
        { id: 'g2', colorId: 1, nodeIds: ['g2-a', 'g2-b'] }
      ],
      offers: [makeOffer('straight', 0)]
    };

    state.tiles[0][2] = { kind: 'straight', orientation: 90, originalOrientation: 90 };
    state.tiles[4][2] = { kind: 'straight', orientation: 90, originalOrientation: 90 };

    const beforeIds = new Set(state.endpointNodes.map((node) => node.id));
    const after = placeOffer(state, 0, { row: 2, col: 2 });
    const payload = findCompletedGroupsPayload(after);

    expect(new Set(payload?.groupIds ?? [])).toEqual(new Set(['g1', 'g2']));
    expect(payload?.completedEndpoints?.length).toBe(4);
    expect(after.tiles[0][2]).toBeNull();
    expect(after.tiles[4][2]).toBeNull();
    expect(after.tiles[2][2]).not.toBeNull();
    expect(after.endpointNodes.length).toBe(4);
    expect(new Set(after.endpointNodes.map((node) => node.id))).toEqual(beforeIds);
  });

  it('completion flow works for scenario 3x3 (all groups solved and respawned)', () => {
    const base = initGame({
      gridSize: 7,
      endpointScenario: [{ size: 3, groups: 3 }],
      energy: 30,
      boosters: 3,
      offerSeed: 90,
      rng: () => 0.2
    });

    const state: GameState = {
      ...base,
      tiles: createEmptyTiles(7),
      endpointNodes: [
        { id: 'g1-a', row: 0, col: 1, groupId: 'g1', colorId: 0 },
        { id: 'g1-b', row: 0, col: 3, groupId: 'g1', colorId: 0 },
        { id: 'g1-c', row: 0, col: 5, groupId: 'g1', colorId: 0 },
        { id: 'g2-a', row: 6, col: 1, groupId: 'g2', colorId: 1 },
        { id: 'g2-b', row: 6, col: 3, groupId: 'g2', colorId: 1 },
        { id: 'g2-c', row: 6, col: 5, groupId: 'g2', colorId: 1 },
        { id: 'g3-a', row: 1, col: 0, groupId: 'g3', colorId: 2 },
        { id: 'g3-b', row: 3, col: 0, groupId: 'g3', colorId: 2 },
        { id: 'g3-c', row: 5, col: 0, groupId: 'g3', colorId: 2 }
      ],
      endpointGroups: [
        { id: 'g1', colorId: 0, nodeIds: ['g1-a', 'g1-b', 'g1-c'] },
        { id: 'g2', colorId: 1, nodeIds: ['g2-a', 'g2-b', 'g2-c'] },
        { id: 'g3', colorId: 2, nodeIds: ['g3-a', 'g3-b', 'g3-c'] }
      ],
      offers: [makeOffer('straight', 0)]
    };

    state.tiles[0][2] = { kind: 'straight', orientation: 90, originalOrientation: 90 };
    state.tiles[0][4] = { kind: 'straight', orientation: 90, originalOrientation: 90 };
    state.tiles[6][2] = { kind: 'straight', orientation: 90, originalOrientation: 90 };
    state.tiles[6][4] = { kind: 'straight', orientation: 90, originalOrientation: 90 };
    state.tiles[2][0] = { kind: 'straight', orientation: 0, originalOrientation: 0 };
    state.tiles[4][0] = { kind: 'straight', orientation: 0, originalOrientation: 0 };

    const beforeIds = new Set(state.endpointNodes.map((node) => node.id));
    const after = placeOffer(state, 0, { row: 3, col: 3 });
    const payload = findCompletedGroupsPayload(after);

    expect(new Set(payload?.groupIds ?? [])).toEqual(new Set(['g1', 'g2', 'g3']));
    expect(payload?.completedEndpoints?.length).toBe(9);
    expect(after.tiles[0][2]).toBeNull();
    expect(after.tiles[0][4]).toBeNull();
    expect(after.tiles[6][2]).toBeNull();
    expect(after.tiles[6][4]).toBeNull();
    expect(after.tiles[2][0]).toBeNull();
    expect(after.tiles[4][0]).toBeNull();
    expect(after.tiles[3][3]).not.toBeNull();
    expect(after.endpointNodes.length).toBe(9);
    expect(new Set(after.endpointNodes.map((node) => node.id))).toEqual(beforeIds);
  });

  it('completion flow works for mixed scenario (one 2-endpoint group + one 3-endpoint group)', () => {
    const base = initGame({
      gridSize: 7,
      endpointScenario: [{ size: 2, groups: 1 }, { size: 3, groups: 1 }],
      energy: 30,
      boosters: 3,
      offerSeed: 120,
      rng: () => 0.2
    });

    const state: GameState = {
      ...base,
      tiles: createEmptyTiles(7),
      endpointNodes: [
        { id: 'g1-a', row: 0, col: 1, groupId: 'g1', colorId: 0 },
        { id: 'g1-b', row: 0, col: 3, groupId: 'g1', colorId: 0 },
        { id: 'g2-a', row: 6, col: 1, groupId: 'g2', colorId: 1 },
        { id: 'g2-b', row: 6, col: 3, groupId: 'g2', colorId: 1 },
        { id: 'g2-c', row: 6, col: 5, groupId: 'g2', colorId: 1 }
      ],
      endpointGroups: [
        { id: 'g1', colorId: 0, nodeIds: ['g1-a', 'g1-b'] },
        { id: 'g2', colorId: 1, nodeIds: ['g2-a', 'g2-b', 'g2-c'] }
      ],
      offers: [makeOffer('straight', 0)]
    };

    state.tiles[0][2] = { kind: 'straight', orientation: 90, originalOrientation: 90 };
    state.tiles[6][2] = { kind: 'straight', orientation: 90, originalOrientation: 90 };
    state.tiles[6][4] = { kind: 'straight', orientation: 90, originalOrientation: 90 };

    const beforeIds = new Set(state.endpointNodes.map((node) => node.id));
    const after = placeOffer(state, 0, { row: 3, col: 3 });
    const payload = findCompletedGroupsPayload(after);

    expect(new Set(payload?.groupIds ?? [])).toEqual(new Set(['g1', 'g2']));
    expect(payload?.completedEndpoints?.length).toBe(5);
    expect(after.tiles[0][2]).toBeNull();
    expect(after.tiles[6][2]).toBeNull();
    expect(after.tiles[6][4]).toBeNull();
    expect(after.tiles[3][3]).not.toBeNull();
    expect(after.endpointNodes.length).toBe(5);
    expect(new Set(after.endpointNodes.map((node) => node.id))).toEqual(beforeIds);
  });

  it('rotateAllOffers and discardAllOffers keep resource constraints', () => {
    const state = fixedState();
    const original = state.offers[0]!;

    const rotated = rotateAllOffers(state);
    expect(rotated.offers[0]?.orientation).not.toBe(original.orientation);

    const noBoosters = rotateAllOffers({ ...state, boosters: 0 });
    expect(noBoosters.offers[0]?.orientation).toBe(original.orientation);

    const discarded = discardAllOffers(state);
    expect(discarded.energy).toBe(state.energy - 1);
    expect(discarded.offers).toHaveLength(1);
    expect(discarded.score).toBe(0);

    const noEnergy = discardAllOffers({ ...state, energy: 0 });
    expect(noEnergy.energy).toBe(0);
    expect(noEnergy.offers[0]?.id).toBe(state.offers[0]?.id);
  });

  it('discard regenerates a different ghost offer when alternatives exist', () => {
    const base = initGame({
      gridSize: 5,
      endpointScenario: [{ size: 2, groups: 1 }],
      energy: 10,
      boosters: 2,
      offerSeed: 700,
      rng: () => 0.2
    });

    const state: GameState = {
      ...base,
      tiles: createEmptyTiles(5),
      endpointNodes: [
        { id: 'g1-a', row: 0, col: 0, groupId: 'g1', colorId: 0 },
        { id: 'g1-b', row: 0, col: 3, groupId: 'g1', colorId: 0 }
      ],
      endpointGroups: [{ id: 'g1', colorId: 0, nodeIds: ['g1-a', 'g1-b'] }],
      offers: [makeOffer('straight', 90)]
    };
    // Block direct top-row route to force a path with mixed pipe types.
    state.tiles[0][1] = { kind: 'straight', orientation: 0, originalOrientation: 0 };
    state.tiles[0][2] = { kind: 'straight', orientation: 0, originalOrientation: 0 };

    const discarded = discardAllOffers(state);
    const nextOffer = discarded.offers[0]!;
    expect(nextOffer.id).toContain('-ghost-');
    expect(
      nextOffer.kind !== state.offers[0]!.kind ||
      nextOffer.orientation !== state.offers[0]!.orientation
    ).toBe(true);
  });

  it('discard can fall back to random when only one ghost offer remains', () => {
    const base = initGame({
      gridSize: 3,
      endpointScenario: [{ size: 2, groups: 1 }],
      energy: 10,
      boosters: 2,
      offerSeed: 760,
      rng: () => 0.2
    });

    const state: GameState = {
      ...base,
      tiles: createEmptyTiles(3),
      endpointNodes: [
        { id: 'g1-a', row: 1, col: 0, groupId: 'g1', colorId: 0 },
        { id: 'g1-b', row: 1, col: 2, groupId: 'g1', colorId: 0 }
      ],
      endpointGroups: [{ id: 'g1', colorId: 0, nodeIds: ['g1-a', 'g1-b'] }],
      offers: [makeOffer('straight', 90)]
    };

    const discarded = discardAllOffers(state);
    const nextOffer = discarded.offers[0]!;
    expect(nextOffer.id).not.toContain('-ghost-');
    expect(
      nextOffer.kind !== state.offers[0]!.kind ||
      nextOffer.orientation !== state.offers[0]!.orientation
    ).toBe(true);
  });

  it('resetScore sets score to zero without changing board state', () => {
    const state = {
      ...fixedState(),
      score: 42
    };

    const reset = resetScore(state);
    expect(reset.score).toBe(0);
    expect(reset.gridSize).toBe(state.gridSize);
    expect(reset.endpointNodes).toEqual(state.endpointNodes);
  });

  it('cross rotation does not consume boosters or change orientation', () => {
    const base = initGame({
      gridSize: 5,
      endpointScenario: [{ size: 2, groups: 1 }],
      energy: 10,
      boosters: 0,
      offerSeed: 200,
      rng: () => 0.2
    });

    const state: GameState = {
      ...base,
      tiles: createEmptyTiles(5),
      endpointNodes: [
        { id: 'g1-a', row: 0, col: 1, groupId: 'g1', colorId: 0 },
        { id: 'g1-b', row: 4, col: 3, groupId: 'g1', colorId: 0 }
      ],
      endpointGroups: [{ id: 'g1', colorId: 0, nodeIds: ['g1-a', 'g1-b'] }],
      offers: [makeOffer('cross', 0)]
    };

    const rotatedSingle = rotateOffer(state, 0);
    expect(rotatedSingle.offers[0]?.orientation).toBe(0);
    expect(rotatedSingle.boosters).toBe(0);

    const rotatedAll = rotateAllOffers(state);
    expect(rotatedAll.offers[0]?.orientation).toBe(0);
    expect(rotatedAll.boosters).toBe(0);

    const placed = placeOffer(rotatedAll, 0, { row: 2, col: 2 });
    expect(placed.tiles[2][2]).not.toBeNull();
    expect(placed.boosters).toBe(0);
  });

  it('setGridSize and setEndpointScenario regenerate endpoints and clear tiles', () => {
    const state = fixedState();
    const target = findPlaceableCell(state);
    const withTile = {
      ...state,
      tiles: (() => {
        const tiles = createEmptyTiles(state.gridSize);
        tiles[target.row][target.col] = {
          kind: 'straight',
          orientation: 0,
          originalOrientation: 0
        };
        return tiles;
      })()
    };

    const resized = setGridSize(withTile, 6);
    expect(resized.gridSize).toBe(6);
    expect(resized.tiles.flat().every((cell) => cell === null)).toBe(true);

    const reScenario = setEndpointScenario(withTile, [{ size: 3, groups: 1 }, { size: 2, groups: 1 }]);
    expect(reScenario.endpointGroups.length).toBe(2);
    expect(reScenario.endpointGroups[0]?.nodeIds.length).toBe(3);
    expect(reScenario.endpointGroups[1]?.nodeIds.length).toBe(2);
    expect(reScenario.tiles.flat().every((cell) => cell === null)).toBe(true);
  });

  it('normalizes minimum grid shape to at least 1x3 or 3x1', () => {
    const tiny = initGame({
      gridSize: 1,
      endpointScenario: [{ size: 2, groups: 1 }],
      offerSeed: 10,
      rng: () => 0.3
    });
    expect(Math.min(tiny.gridWidth, tiny.gridHeight)).toBe(1);
    expect(Math.max(tiny.gridWidth, tiny.gridHeight)).toBeGreaterThanOrEqual(3);

    const explicitTiny = initGame({
      gridWidth: 1,
      gridHeight: 1,
      endpointScenario: [{ size: 2, groups: 1 }],
      offerSeed: 11,
      rng: () => 0.4
    });
    expect(Math.min(explicitTiny.gridWidth, explicitTiny.gridHeight)).toBe(1);
    expect(Math.max(explicitTiny.gridWidth, explicitTiny.gridHeight)).toBeGreaterThanOrEqual(3);

    const resized = setGridSize(fixedState(), 1);
    expect(Math.min(resized.gridWidth, resized.gridHeight)).toBe(1);
    expect(Math.max(resized.gridWidth, resized.gridHeight)).toBeGreaterThanOrEqual(3);
  });

  it('addGridWidth expands board to the right during gameplay', () => {
    const base = fixedState();
    const state: GameState = {
      ...base,
      tiles: createEmptyTiles(base.gridHeight, base.gridWidth)
    };
    state.tiles[2][2] = { kind: 'straight', orientation: 90, originalOrientation: 90 };

    const expanded = addGridWidth(state);

    expect(expanded.gridWidth).toBe(state.gridWidth + 1);
    expect(expanded.gridHeight).toBe(state.gridHeight);
    expect(expanded.tiles.length).toBe(state.gridHeight);
    expect(expanded.tiles[0]?.length).toBe(state.gridWidth + 1);
    expect(expanded.tiles[2][2]).toEqual(state.tiles[2][2]);
    expect(expanded.tiles[2][state.gridWidth]).toBeNull();
  });

  it('addGridHeight expands board at top and shifts existing board content down', () => {
    const base = fixedState();
    const state: GameState = {
      ...base,
      tiles: createEmptyTiles(base.gridHeight, base.gridWidth),
      endpointNodes: [
        { id: 'g1-a', row: 1, col: 1, groupId: 'g1', colorId: 0 },
        { id: 'g1-b', row: 3, col: 3, groupId: 'g1', colorId: 0 }
      ],
      endpointGroups: [{ id: 'g1', colorId: 0, nodeIds: ['g1-a', 'g1-b'] }]
    };
    state.tiles[2][2] = { kind: 'elbow', orientation: 0, originalOrientation: 0 };

    const expanded = addGridHeight(state);

    expect(expanded.gridHeight).toBe(state.gridHeight + 1);
    expect(expanded.gridWidth).toBe(state.gridWidth);
    expect(expanded.tiles.length).toBe(state.gridHeight + 1);
    expect(expanded.tiles[0].every((cell) => cell === null)).toBe(true);
    expect(expanded.tiles[3][2]).toEqual(state.tiles[2][2]);
    expect(expanded.endpointNodes.find((node) => node.id === 'g1-a')?.row).toBe(2);
    expect(expanded.endpointNodes.find((node) => node.id === 'g1-b')?.row).toBe(4);
  });

  it('setGridDimensions respects unlocked grid caps from difficulty tiers', () => {
    const tiers: DifficultyTier[] = [
      { scoreThreshold: 0, maxGridWidth: 3, maxGridHeight: 1, maxGroups: 1, maxEndpointsPerGroup: 2 },
      { scoreThreshold: 20, maxGridWidth: 4, maxGridHeight: 4, maxGroups: 2, maxEndpointsPerGroup: 3 }
    ];
    const state = initGame({
      difficultyTiers: tiers,
      maxScoreReached: 0,
      score: 0,
      gridWidth: 3,
      gridHeight: 1,
      endpointScenario: [{ size: 2, groups: 1 }],
      offerSeed: 44,
      rng: () => 0.2
    });

    const resized = setGridDimensions(state, 9, 9);
    expect(resized.gridWidth).toBe(3);
    expect(resized.gridHeight).toBe(1);
  });

  it('setEndpointScenario clamps groups and endpoints to unlocked tier limits', () => {
    const tiers: DifficultyTier[] = [
      { scoreThreshold: 0, maxGridWidth: 3, maxGridHeight: 1, maxGroups: 1, maxEndpointsPerGroup: 2 },
      { scoreThreshold: 20, maxGridWidth: 4, maxGridHeight: 4, maxGroups: 2, maxEndpointsPerGroup: 3 }
    ];
    const state = initGame({
      difficultyTiers: tiers,
      maxScoreReached: 0,
      score: 0,
      gridWidth: 3,
      gridHeight: 1,
      endpointScenario: [{ size: 2, groups: 1 }],
      offerSeed: 45,
      rng: () => 0.3
    });

    const next = setEndpointScenario(state, [{ size: 5, groups: 3 }]);
    expect(next.endpointGroups.length).toBe(1);
    expect(next.endpointGroups[0]?.nodeIds.length).toBe(2);
    expect(next.endpointScenario).toEqual([{ size: 2, groups: 1 }]);
  });

  it('setEndpointScenario keeps two groups of two when requested and grid can hold them', () => {
    const state = initGame({
      gridWidth: 4,
      gridHeight: 4,
      endpointScenario: [{ size: 2, groups: 1 }],
      offerSeed: 146,
      rng: () => 0.22
    });

    const next = setEndpointScenario(state, [{ size: 2, groups: 2 }]);
    expect(next.endpointGroups.length).toBe(2);
    expect(next.endpointGroups.every((group) => group.nodeIds.length === 2)).toBe(true);
    expect(next.endpointNodes.length).toBe(4);
    expect(next.endpointScenario).toEqual([{ size: 2, groups: 1 }, { size: 2, groups: 1 }]);
  });

  it('setEndpointScenario honors per-group endpoint caps from difficulty tiers', () => {
    const tiers: DifficultyTier[] = [
      {
        scoreThreshold: 0,
        maxGridWidth: 4,
        maxGridHeight: 4,
        maxGroups: 2,
        maxEndpointsPerGroup: 3,
        groupEndpointCaps: [3, 2]
      }
    ];
    const state = initGame({
      difficultyTiers: tiers,
      maxScoreReached: 0,
      score: 0,
      gridWidth: 4,
      gridHeight: 4,
      endpointScenario: [{ size: 2, groups: 1 }],
      offerSeed: 145,
      rng: () => 0.3
    });

    const next = setEndpointScenario(state, [{ size: 4, groups: 2 }]);
    expect(next.endpointGroups.length).toBe(2);
    expect(next.endpointGroups[0]?.nodeIds.length).toBe(3);
    expect(next.endpointGroups[1]?.nodeIds.length).toBe(2);
    expect(next.endpointScenario).toEqual([{ size: 3, groups: 1 }, { size: 2, groups: 1 }]);
  });

  it('resetScore keeps unlocked difficulty tier based on max score reached', () => {
    const tiers: DifficultyTier[] = [
      { scoreThreshold: 0, maxGridWidth: 3, maxGridHeight: 1, maxGroups: 1, maxEndpointsPerGroup: 2 },
      { scoreThreshold: 10, maxGridWidth: 3, maxGridHeight: 2, maxGroups: 1, maxEndpointsPerGroup: 2 },
      { scoreThreshold: 30, maxGridWidth: 4, maxGridHeight: 4, maxGroups: 2, maxEndpointsPerGroup: 2 }
    ];
    const state = initGame({
      difficultyTiers: tiers,
      maxScoreReached: 35,
      score: 35,
      gridWidth: 4,
      gridHeight: 4,
      endpointScenario: [{ size: 2, groups: 2 }],
      offerSeed: 46,
      rng: () => 0.5
    });
    const before = getUnlockedDifficultyTier(state);
    expect(before.maxGridWidth).toBe(4);
    expect(before.maxGridHeight).toBe(4);

    const reset = resetScore(state);
    const after = getUnlockedDifficultyTier(reset);
    expect(reset.score).toBe(0);
    expect(reset.maxScoreReached).toBe(35);
    expect(after.maxGridWidth).toBe(4);
    expect(after.maxGridHeight).toBe(4);
  });

  it('setDifficultyTiers re-evaluates unlocked tier and clamps current setup', () => {
    const baseTiers: DifficultyTier[] = [
      { scoreThreshold: 0, maxGridWidth: 9, maxGridHeight: 9, maxGroups: 9, maxEndpointsPerGroup: 9 }
    ];
    const state = initGame({
      difficultyTiers: baseTiers,
      maxScoreReached: 50,
      score: 50,
      gridWidth: 6,
      gridHeight: 6,
      endpointScenario: [{ size: 4, groups: 3 }],
      offerSeed: 47,
      rng: () => 0.4
    });

    const nextTiers: DifficultyTier[] = [
      { scoreThreshold: 0, maxGridWidth: 3, maxGridHeight: 1, maxGroups: 1, maxEndpointsPerGroup: 2 },
      { scoreThreshold: 45, maxGridWidth: 4, maxGridHeight: 4, maxGroups: 2, maxEndpointsPerGroup: 2 }
    ];
    const next = setDifficultyTiers(state, nextTiers);

    expect(next.maxScoreReached).toBe(50);
    expect(next.gridWidth).toBeLessThanOrEqual(4);
    expect(next.gridHeight).toBeLessThanOrEqual(4);
    expect(next.endpointGroups.length).toBeLessThanOrEqual(2);
    expect(next.endpointGroups.every((group) => group.nodeIds.length <= 2)).toBe(true);
  });

  it('setDifficultyTiers syncs active unlocked tier setup to board groups', () => {
    const state = initGame({
      difficultyTiers: [
        { scoreThreshold: 0, maxGridWidth: 4, maxGridHeight: 4, maxGroups: 1, maxEndpointsPerGroup: 2, groupEndpointCaps: [2] }
      ],
      maxScoreReached: 0,
      score: 0,
      gridWidth: 4,
      gridHeight: 4,
      endpointScenario: [{ size: 2, groups: 1 }],
      offerSeed: 148,
      rng: () => 0.3
    });

    const next = setDifficultyTiers(state, [
      { scoreThreshold: 0, maxGridWidth: 4, maxGridHeight: 4, maxGroups: 2, maxEndpointsPerGroup: 2, groupEndpointCaps: [2, 2] }
    ]);

    expect(next.endpointGroups.length).toBe(2);
    expect(next.endpointGroups.every((group) => group.nodeIds.length === 2)).toBe(true);
    expect(next.endpointNodes.length).toBe(4);
  });

  it('applies newly unlocked tier on next completion before next endpoint wave', () => {
    const tiers: DifficultyTier[] = [
      { scoreThreshold: 0, maxGridWidth: 3, maxGridHeight: 1, maxGroups: 1, maxEndpointsPerGroup: 2 },
      { scoreThreshold: 3, maxGridWidth: 4, maxGridHeight: 4, maxGroups: 2, maxEndpointsPerGroup: 2 }
    ];

    const base = initGame({
      difficultyTiers: tiers,
      gridWidth: 3,
      gridHeight: 1,
      endpointScenario: [{ size: 2, groups: 1 }],
      maxScoreReached: 0,
      score: 0,
      offerSeed: 88,
      rng: () => 0.2
    });

    const state: GameState = {
      ...base,
      tiles: createEmptyTiles(1, 3),
      endpointNodes: [
        { id: 'group-1-node-1', row: 0, col: 0, groupId: 'group-1', colorId: 0 },
        { id: 'group-1-node-2', row: 0, col: 2, groupId: 'group-1', colorId: 0 }
      ],
      endpointGroups: [{ id: 'group-1', colorId: 0, nodeIds: ['group-1-node-1', 'group-1-node-2'] }],
      endpointScenario: [{ size: 2, groups: 1 }],
      offers: [makeOffer('straight', 90)]
    };

    const next = placeOffer(state, 0, { row: 0, col: 1 });
    expect(next.maxScoreReached).toBeGreaterThanOrEqual(3);
    expect(next.appliedDifficultyTierIndex).toBe(1);
    expect(next.gridWidth).toBe(4);
    expect(next.gridHeight).toBe(4);
    expect(next.endpointGroups.length).toBe(2);
    expect(next.endpointGroups.every((group) => group.nodeIds.length === 2)).toBe(true);
  });

  it('on 3x2 grid, respawn after completion keeps 2-endpoint group across rows', () => {
    const base = initGame({
      gridWidth: 3,
      gridHeight: 2,
      endpointScenario: [{ size: 2, groups: 1 }],
      offerSeed: 901,
      rng: () => 0.3
    });

    const state: GameState = {
      ...base,
      tiles: createEmptyTiles(2, 3),
      endpointNodes: [
        { id: 'group-1-node-1', row: 0, col: 0, groupId: 'group-1', colorId: 0 },
        { id: 'group-1-node-2', row: 0, col: 2, groupId: 'group-1', colorId: 0 }
      ],
      endpointGroups: [{ id: 'group-1', colorId: 0, nodeIds: ['group-1-node-1', 'group-1-node-2'] }],
      endpointScenario: [{ size: 2, groups: 1 }],
      offers: [makeOffer('straight', 90)]
    };

    const next = placeOffer(state, 0, { row: 0, col: 1 });
    const group = next.endpointGroups[0];
    expect(group?.nodeIds.length).toBe(2);
    const first = next.endpointNodes.find((node) => node.id === group?.nodeIds[0]);
    const second = next.endpointNodes.find((node) => node.id === group?.nodeIds[1]);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first && second) {
      expect(first.row).not.toBe(second.row);
    }
  });

  it('state no longer includes route-recovery/modal fields', () => {
    const state = fixedState() as unknown as Record<string, unknown>;
    expect('modal' in state).toBe(false);
    expect('routes' in state).toBe(false);
    expect('pendingFlowPath' in state).toBe(false);
  });
});
