import { describe, expect, it } from 'vitest';
import {
  collectSolvedGroupPaths,
  computeRoutes,
  deriveDifficultyModel,
  deriveOffersTacticalFirst,
  deriveRealLaneWeights,
  expandScenarioGroups,
  getGroupConnectivityState,
  isGroupSolved,
  parseEndpointScenario,
  type EndpointGroup,
  type EndpointNode,
  type TileGrid
} from '../RouteSolver';

function emptyGrid(size: number): TileGrid {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

function groupSetup(nodes: EndpointNode[]): EndpointGroup[] {
  const byGroup = new Map<string, EndpointNode[]>();
  for (const node of nodes) {
    const list = byGroup.get(node.groupId) ?? [];
    list.push(node);
    byGroup.set(node.groupId, list);
  }

  return [...byGroup.entries()].map(([groupId, groupNodes]) => ({
    id: groupId,
    colorId: groupNodes[0]?.colorId ?? 0,
    nodeIds: groupNodes.map((node) => node.id)
  }));
}

function clamp100(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function difficultyWindow(offerDifficulty: number): { easy: number; medium: number; hard: number } {
  const difficulty = clamp100(offerDifficulty);
  return {
    easy: clamp100(difficulty - 25),
    medium: difficulty,
    hard: clamp100(difficulty + 25)
  };
}

function deterministicRatio(seed: number, salt: number): number {
  const raw = Math.sin((seed + 1) * 12.9898 + (salt + 1) * 78.233) * 43758.5453;
  return raw - Math.floor(raw);
}

function borderCell(gridSize: number, seed: number, salt: number): { row: number; col: number } {
  const side = Math.floor(deterministicRatio(seed, salt) * 4);
  const position = Math.floor(deterministicRatio(seed, salt + 11) * gridSize);
  if (side === 0) {
    return { row: 0, col: position };
  }
  if (side === 1) {
    return { row: gridSize - 1, col: position };
  }
  if (side === 2) {
    return { row: position, col: 0 };
  }
  return { row: position, col: gridSize - 1 };
}

describe('Route solver (endpoint groups)', () => {
  it('treats endpoints as omnidirectional terminals', () => {
    const nodes: EndpointNode[] = [
      { id: 'a', row: 2, col: 0, groupId: 'g1', colorId: 0 },
      { id: 'b', row: 1, col: 4, groupId: 'g1', colorId: 0 }
    ];
    const groups = groupSetup(nodes);
    const tiles = emptyGrid(5);

    tiles[1][0] = { kind: 'elbow', orientation: 90, originalOrientation: 90, groupId: 'g1' };
    tiles[1][1] = { kind: 'straight', orientation: 90, originalOrientation: 90, groupId: 'g1' };
    tiles[1][2] = { kind: 'straight', orientation: 90, originalOrientation: 90, groupId: 'g1' };
    tiles[1][3] = { kind: 'straight', orientation: 90, originalOrientation: 90, groupId: 'g1' };

    expect(isGroupSolved(tiles, nodes, groups[0])).toBe(true);
  });

  it('requires all endpoints in a 3x1 group to be connected simultaneously', () => {
    const nodes: EndpointNode[] = [
      { id: 'a', row: 0, col: 1, groupId: 'g1', colorId: 0 },
      { id: 'b', row: 4, col: 1, groupId: 'g1', colorId: 0 },
      { id: 'c', row: 2, col: 4, groupId: 'g1', colorId: 0 }
    ];
    const groups = groupSetup(nodes);

    const partial = emptyGrid(5);
    partial[1][1] = { kind: 'straight', orientation: 0, originalOrientation: 0, groupId: 'g1' };
    partial[2][1] = { kind: 'straight', orientation: 0, originalOrientation: 0, groupId: 'g1' };
    partial[3][1] = { kind: 'straight', orientation: 0, originalOrientation: 0, groupId: 'g1' };

    expect(isGroupSolved(partial, nodes, groups[0])).toBe(false);

    const full = emptyGrid(5);
    full[1][1] = { kind: 'straight', orientation: 0, originalOrientation: 0, groupId: 'g1' };
    full[2][1] = { kind: 'tee', orientation: 90, originalOrientation: 90, groupId: 'g1' };
    full[3][1] = { kind: 'straight', orientation: 0, originalOrientation: 0, groupId: 'g1' };
    full[2][2] = { kind: 'straight', orientation: 90, originalOrientation: 90, groupId: 'g1' };
    full[2][3] = { kind: 'straight', orientation: 90, originalOrientation: 90, groupId: 'g1' };

    expect(isGroupSolved(full, nodes, groups[0])).toBe(true);

    const state = getGroupConnectivityState(full, nodes, groups[0]);
    expect(state.connectedNodeIds.length).toBe(3);
  });

  it('parses mixed scenarios like 2x2 + 1x3', () => {
    const parsed = parseEndpointScenario('2x2 + 1x3');
    expect(expandScenarioGroups(parsed)).toEqual([2, 2, 3]);
  });

  it('prevents routes from reusing pipe cells owned by another group', () => {
    const nodes: EndpointNode[] = [
      { id: 'a1', row: 0, col: 1, groupId: 'g1', colorId: 0 },
      { id: 'a2', row: 4, col: 1, groupId: 'g1', colorId: 0 },
      { id: 'b1', row: 0, col: 3, groupId: 'g2', colorId: 1 },
      { id: 'b2', row: 4, col: 3, groupId: 'g2', colorId: 1 }
    ];
    const groups = groupSetup(nodes);
    const tiles = emptyGrid(5);

    tiles[2][1] = { kind: 'straight', orientation: 0, originalOrientation: 0, groupId: 'g2' };

    const routes = computeRoutes({
      gridSize: 5,
      tiles,
      endpointNodes: nodes,
      endpointGroups: groups,
      routePreviewDifficulties: {
        easy: 0,
        medium: 50,
        hard: 100
      }
    });

    const routeForGroup1 = routes.find((route) => route.groupId === 'g1');
    expect(routeForGroup1).toBeDefined();
    expect(routeForGroup1!.cells.some((cell) => cell.row === 2 && cell.col === 1)).toBe(false);
  });

  it('offers immediate completion piece when one-step solve exists', () => {
    const nodes: EndpointNode[] = [
      { id: 'a', row: 0, col: 1, groupId: 'g1', colorId: 0 },
      { id: 'b', row: 1, col: 0, groupId: 'g1', colorId: 0 }
    ];
    const groups = groupSetup(nodes);
    const tiles = emptyGrid(4);

    const routes = computeRoutes({
      gridSize: 4,
      tiles,
      endpointNodes: nodes,
      endpointGroups: groups,
      routePreviewDifficulties: {
        easy: 0,
        medium: 50,
        hard: 100
      },
      pipeSpawnEnabled: {
        straight: true,
        elbow: true,
        doubleElbow: false,
        tee: false,
        cross: false
      }
    });

    const offers = deriveOffersTacticalFirst({
      tiles,
      endpointNodes: nodes,
      endpointGroups: groups,
      routes,
      offerDifficulty: 20,
      pipeSpawnEnabled: {
        straight: true,
        elbow: true,
        doubleElbow: false,
        tee: false,
        cross: false
      }
    });

    expect(
      offers.some(
        (offer) =>
          offer.kind === 'elbow' &&
          offer.targetCell.row === 1 &&
          offer.targetCell.col === 1
      )
    ).toBe(true);
  });

  it('at difficulty 0 offers a correctly rotated immediate solve in real mode', () => {
    const nodes: EndpointNode[] = [
      { id: 'a', row: 0, col: 1, groupId: 'g1', colorId: 0 },
      { id: 'b', row: 1, col: 0, groupId: 'g1', colorId: 0 }
    ];
    const groups = groupSetup(nodes);
    const tiles = emptyGrid(4);

    const routes = computeRoutes({
      gridSize: 4,
      tiles,
      endpointNodes: nodes,
      endpointGroups: groups,
      routePreviewDifficulties: {
        easy: 0,
        medium: 50,
        hard: 100
      },
      pipeSpawnEnabled: {
        straight: true,
        elbow: true,
        doubleElbow: false,
        tee: false,
        cross: false
      },
      offerDifficulty: 0
    });

    const offers = deriveOffersTacticalFirst({
      tiles,
      endpointNodes: nodes,
      endpointGroups: groups,
      routes,
      offerDifficulty: 0,
      pipeSpawnEnabled: {
        straight: true,
        elbow: true,
        doubleElbow: false,
        tee: false,
        cross: false
      },
      seed: 9
    });

    expect(offers).toHaveLength(1);
    expect(offers[0].kind).toBe('elbow');
    expect(offers[0].targetCell).toEqual({ row: 1, col: 1 });
    expect(offers[0].orientation).toBe(offers[0].requiredOrientation);
  });

  it('always generates a single offer candidate', () => {
    const nodes: EndpointNode[] = [
      { id: 'a', row: 0, col: 2, groupId: 'g1', colorId: 0 },
      { id: 'b', row: 5, col: 3, groupId: 'g1', colorId: 0 }
    ];
    const groups = groupSetup(nodes);
    const tiles = emptyGrid(6);

    const routes = computeRoutes({
      gridSize: 6,
      tiles,
      endpointNodes: nodes,
      endpointGroups: groups
    });

    const offers = deriveOffersTacticalFirst({
      tiles,
      endpointNodes: nodes,
      endpointGroups: groups,
      routes,
      offerDifficulty: 50
    });

    expect(offers).toHaveLength(1);
  });

  it('real mode lane blend tracks difficulty across easy/medium/hard', () => {
    const nodes: EndpointNode[] = [
      { id: 'a', row: 0, col: 2, groupId: 'g1', colorId: 0 },
      { id: 'b', row: 6, col: 4, groupId: 'g1', colorId: 0 }
    ];
    const groups = groupSetup(nodes);
    const tiles = emptyGrid(7);
    const difficulties = [0, 50, 100];

    for (const difficulty of difficulties) {
      const routes = computeRoutes({
        gridSize: 7,
        tiles,
        endpointNodes: nodes,
        endpointGroups: groups,
        routePreviewDifficulties: difficultyWindow(difficulty),
        offerDifficulty: difficulty
      });
      const offers = deriveOffersTacticalFirst({
        tiles,
        endpointNodes: nodes,
        endpointGroups: groups,
        routes,
        offerDifficulty: difficulty,
        seed: 11
      });
      expect(offers).toHaveLength(1);
      if (difficulty === 0) {
        expect(offers[0].routeId).toBe('easy');
      }
      if (difficulty === 50) {
        expect(offers[0].routeId).toBe('medium');
      }
      if (difficulty === 100) {
        expect(offers[0].routeId).toBe('hard');
      }
    }
  });

  it('exposes deterministic real-lane weights centered on medium', () => {
    const low = deriveRealLaneWeights(0);
    const mid = deriveRealLaneWeights(50);
    const high = deriveRealLaneWeights(100);

    expect(low.easy).toBeGreaterThan(low.medium);
    expect(low.easy).toBeGreaterThan(low.hard);

    expect(mid.medium).toBeGreaterThan(mid.easy);
    expect(mid.medium).toBeGreaterThan(mid.hard);

    expect(high.hard).toBeGreaterThan(high.medium);
    expect(high.hard).toBeGreaterThan(high.easy);
  });

  it('offers are sourced from unmet route requirements', () => {
    const nodes: EndpointNode[] = [
      { id: 'a', row: 0, col: 2, groupId: 'g1', colorId: 0 },
      { id: 'b', row: 6, col: 4, groupId: 'g1', colorId: 0 }
    ];
    const groups = groupSetup(nodes);
    const tiles = emptyGrid(7);
    const routes = computeRoutes({
      gridSize: 7,
      tiles,
      endpointNodes: nodes,
      endpointGroups: groups,
      routePreviewDifficulties: difficultyWindow(50),
      offerDifficulty: 50
    });

    const offers = deriveOffersTacticalFirst({
      tiles,
      endpointNodes: nodes,
      endpointGroups: groups,
      routes,
      offerDifficulty: 50,
      seed: 7
    });

    expect(offers).toHaveLength(1);
    for (const offer of offers) {
      const route = routes.find((item) => item.id === offer.routeId);
      expect(route).toBeDefined();
      const requirement = route!.requirements.find(
        (item) => item.cell.row === offer.targetCell.row && item.cell.col === offer.targetCell.col
      );
      expect(requirement).toBeDefined();
      expect(offer.kind).toBe(requirement!.kind);
      expect(offer.requiredOrientation).toBe(requirement!.orientation);
      expect(offer.debugReason).toContain('source=requirement');
    }
  });

  it('easy route prioritizes already placed group pipes when alternatives exist', () => {
    const nodes: EndpointNode[] = [
      { id: 'start', row: 2, col: 0, groupId: 'g1', colorId: 0 },
      { id: 'end', row: 0, col: 3, groupId: 'g1', colorId: 0 }
    ];
    const groups = groupSetup(nodes);
    const tiles = emptyGrid(4);

    // Matches the in-game scenario where the existing elbow should be reused.
    tiles[1][1] = { kind: 'elbow', orientation: 270, originalOrientation: 270, groupId: 'g1' };

    const routes = computeRoutes({
      gridSize: 4,
      tiles,
      endpointNodes: nodes,
      endpointGroups: groups,
      routePreviewDifficulties: {
        easy: 0,
        medium: 50,
        hard: 100
      },
      offerDifficulty: 0,
      pipeSpawnEnabled: {
        straight: true,
        elbow: true,
        doubleElbow: false,
        tee: false,
        cross: false
      }
    });

    const easyRoute = routes.find((route) => route.id === 'easy');
    expect(easyRoute).toBeDefined();
    expect(easyRoute!.cells.some((cell) => cell.row === 1 && cell.col === 1)).toBe(true);
  });

  it('route selection keeps reuse present across lane variants when same-group pipes exist', () => {
    const nodes: EndpointNode[] = [
      { id: 'a', row: 0, col: 2, groupId: 'g1', colorId: 0 },
      { id: 'b', row: 5, col: 2, groupId: 'g1', colorId: 0 }
    ];
    const groups = groupSetup(nodes);
    const tiles = emptyGrid(6);
    tiles[2][2] = { kind: 'straight', orientation: 0, originalOrientation: 0, groupId: 'g1' };

    const routes = computeRoutes({
      gridSize: 6,
      tiles,
      endpointNodes: nodes,
      endpointGroups: groups,
      routePreviewDifficulties: difficultyWindow(75),
      offerDifficulty: 75
    });

    const reusedCounts = (['easy', 'medium', 'hard'] as const).map((routeId) => {
      const laneRoute = routes.find((route) => route.id === routeId);
      expect(laneRoute).toBeDefined();
      return laneRoute!.cells.some((cell) => cell.row === 2 && cell.col === 2) ? 1 : 0;
    });
    expect(reusedCounts.filter((value) => value === 1).length).toBeGreaterThanOrEqual(2);
  });

  it('collectSolvedGroupPaths excludes side branches not required between endpoints', () => {
    const nodes: EndpointNode[] = [
      { id: 'a', row: 1, col: 0, groupId: 'g1', colorId: 0 },
      { id: 'b', row: 1, col: 4, groupId: 'g1', colorId: 0 }
    ];
    const groups = groupSetup(nodes);
    const tiles = emptyGrid(5);

    tiles[1][1] = { kind: 'straight', orientation: 90, originalOrientation: 90, groupId: 'g1' };
    tiles[1][2] = { kind: 'cross', orientation: 0, originalOrientation: 0, groupId: 'g1' };
    tiles[1][3] = { kind: 'straight', orientation: 90, originalOrientation: 90, groupId: 'g1' };
    // Side branch connected to the middle but not needed to connect endpoints.
    tiles[2][2] = { kind: 'straight', orientation: 0, originalOrientation: 0, groupId: 'g1' };

    const solvedPaths = collectSolvedGroupPaths(tiles, nodes, groups);
    expect(solvedPaths).toHaveLength(1);

    const keptCells = new Set(solvedPaths[0].cells.map((cell) => `${cell.row},${cell.col}`));
    expect(keptCells.has('1,1')).toBe(true);
    expect(keptCells.has('1,2')).toBe(true);
    expect(keptCells.has('1,3')).toBe(true);
    expect(keptCells.has('2,2')).toBe(false);
  });

  it('does not inject random orientation mismatch at any difficulty', () => {
    const nodes: EndpointNode[] = [
      { id: 'a', row: 0, col: 2, groupId: 'g1', colorId: 0 },
      { id: 'b', row: 6, col: 4, groupId: 'g1', colorId: 0 }
    ];
    const groups = groupSetup(nodes);
    const tiles = emptyGrid(7);

    const routes = computeRoutes({
      gridSize: 7,
      tiles,
      endpointNodes: nodes,
      endpointGroups: groups
    });

    const difficulties = [0, 25, 50, 75, 100];
    const runs = 120;

    for (const difficulty of difficulties) {
      for (let seed = 0; seed < runs; seed += 1) {
        const offers = deriveOffersTacticalFirst({
          tiles,
          endpointNodes: nodes,
          endpointGroups: groups,
          routes,
          offerDifficulty: difficulty,
          seed
        });

        expect(offers.every((offer) => offer.orientation === offer.requiredOrientation)).toBe(true);
      }
    }
  });

  it('medium route turns trend upward as difficulty increases', () => {
    const gridSize = 8;
    const difficulties = [0, 25, 50, 75, 100];
    const turnsByDifficulty = new Map<number, number[]>();
    difficulties.forEach((difficulty) => turnsByDifficulty.set(difficulty, []));

    for (let seed = 0; seed < 45; seed += 1) {
      const first = borderCell(gridSize, seed, 3);
      let second = borderCell(gridSize, seed, 19);
      if (first.row === second.row && first.col === second.col) {
        second = borderCell(gridSize, seed + 1, 29);
      }

      const nodes: EndpointNode[] = [
        { id: `a-${seed}`, row: first.row, col: first.col, groupId: 'g1', colorId: 0 },
        { id: `b-${seed}`, row: second.row, col: second.col, groupId: 'g1', colorId: 0 }
      ];
      const groups = groupSetup(nodes);
      const tiles = emptyGrid(gridSize);

      for (const difficulty of difficulties) {
        const routes = computeRoutes({
          gridSize,
          tiles,
          endpointNodes: nodes,
          endpointGroups: groups,
          routePreviewDifficulties: difficultyWindow(difficulty),
          offerDifficulty: difficulty
        });

        const medium = routes.find((route) => route.id === 'medium');
        if (medium) {
          turnsByDifficulty.get(difficulty)!.push(medium.turns);
        }
      }
    }

    const averages = difficulties.map((difficulty) => {
      const values = turnsByDifficulty.get(difficulty) ?? [];
      return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    });

    for (let index = 1; index < averages.length; index += 1) {
      expect(averages[index]).toBeGreaterThanOrEqual(averages[index - 1] - 0.01);
    }
  });

  it('maintains requirement-sourced offers across difficulties', () => {
    const nodes: EndpointNode[] = [
      { id: 'a', row: 0, col: 2, groupId: 'g1', colorId: 0 },
      { id: 'b', row: 6, col: 4, groupId: 'g1', colorId: 0 }
    ];
    const groups = groupSetup(nodes);
    const tiles = emptyGrid(7);
    const difficulties = [0, 25, 50, 75, 100];
    const runs = 80;

    let relevantOffers = 0;
    let totalOffers = 0;

    for (const difficulty of difficulties) {
      const routes = computeRoutes({
        gridSize: 7,
        tiles,
        endpointNodes: nodes,
        endpointGroups: groups,
        routePreviewDifficulties: difficultyWindow(difficulty),
        offerDifficulty: difficulty
      });

      for (let seed = 0; seed < runs; seed += 1) {
        const offers = deriveOffersTacticalFirst({
          tiles,
          endpointNodes: nodes,
          endpointGroups: groups,
          routes,
          offerDifficulty: difficulty,
          seed
        });

        for (const offer of offers) {
          if (offer.debugReason.includes('source=requirement')) {
            relevantOffers += 1;
          }
          totalOffers += 1;
        }
      }
    }

    expect(relevantOffers / Math.max(1, totalOffers)).toBeGreaterThanOrEqual(0.95);
  });

  it('real mode difficulty shifts lane preference from easy toward hard', () => {
    const nodes: EndpointNode[] = [
      { id: 'a', row: 0, col: 2, groupId: 'g1', colorId: 0 },
      { id: 'b', row: 6, col: 4, groupId: 'g1', colorId: 0 }
    ];
    const groups = groupSetup(nodes);
    const tiles = emptyGrid(7);

    const lowRoutes = computeRoutes({
      gridSize: 7,
      tiles,
      endpointNodes: nodes,
      endpointGroups: groups,
      routePreviewDifficulties: difficultyWindow(10),
      offerDifficulty: 10
    });
    const highRoutes = computeRoutes({
      gridSize: 7,
      tiles,
      endpointNodes: nodes,
      endpointGroups: groups,
      routePreviewDifficulties: difficultyWindow(90),
      offerDifficulty: 90
    });

    const low = deriveOffersTacticalFirst({
      tiles,
      endpointNodes: nodes,
      endpointGroups: groups,
      routes: lowRoutes,
      offerDifficulty: 10,
      seed: 31
    });
    const high = deriveOffersTacticalFirst({
      tiles,
      endpointNodes: nodes,
      endpointGroups: groups,
      routes: highRoutes,
      offerDifficulty: 90,
      seed: 31
    });

    const laneOrder: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
    expect(laneOrder[high[0].routeId]).toBeGreaterThanOrEqual(laneOrder[low[0].routeId]);
  });

  it('difficulty model is monotonic for reuse and complexity pressure', () => {
    const easy = deriveDifficultyModel(0);
    const medium = deriveDifficultyModel(50);
    const hard = deriveDifficultyModel(100);

    expect(easy.reuseBonusMultiplier).toBeGreaterThan(medium.reuseBonusMultiplier);
    expect(medium.reuseBonusMultiplier).toBeGreaterThan(hard.reuseBonusMultiplier);

    expect(easy.placedPreferenceWeight).toBeGreaterThan(medium.placedPreferenceWeight);
    expect(medium.placedPreferenceWeight).toBeGreaterThan(hard.placedPreferenceWeight);

    expect(easy.routeAlignmentWeight).toBeLessThan(medium.routeAlignmentWeight);
    expect(medium.routeAlignmentWeight).toBeLessThan(hard.routeAlignmentWeight);

    expect(easy.progressWeight).toBeLessThan(medium.progressWeight);
    expect(medium.progressWeight).toBeLessThan(hard.progressWeight);

    expect(easy.complexityPenaltyScale).toBeLessThan(medium.complexityPenaltyScale);
    expect(medium.complexityPenaltyScale).toBeLessThan(hard.complexityPenaltyScale);

    expect(easy.secondStepWeight).toBeLessThan(medium.secondStepWeight);
    expect(medium.secondStepWeight).toBeLessThan(hard.secondStepWeight);
  });
});
