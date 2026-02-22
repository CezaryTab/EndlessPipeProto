import {
  ALL_DIRECTIONS,
  Direction,
  areEdgesConnected,
  directionToDelta,
  getPipeTopology,
  nextOrientation,
  oppositeDirection,
  isDirectionOpen,
  type DirectionBit,
  type Orientation,
  type PipeKind
} from './Pipe';
import {
  expandScenarioGroups,
  parseEndpointScenario,
  scenarioToLabel,
  type Cell,
  type EndpointGroup,
  type EndpointNode,
  type EndpointScenario,
  type PipeSpawnEnabled,
  type PlacedPipe,
  type TileGrid
} from './RouteSolver';

export const GRID_SIZE_MIN = 1;
export const GRID_SIZE_MAX = 9;
export const GRID_MIN_LONG_SIDE = 3;
export const DEFAULT_GRID_SIZE = 5;
export const DEFAULT_ENDPOINT_SCENARIO: EndpointScenario = [{ size: 2, groups: 2 }];
export const DEFAULT_ENDPOINT_SCENARIO_LABEL = scenarioToLabel(DEFAULT_ENDPOINT_SCENARIO);
export interface DifficultyTier {
  scoreThreshold: number;
  maxGridWidth: number;
  maxGridHeight: number;
  maxGroups: number;
  maxEndpointsPerGroup: number;
  groupEndpointCaps?: number[];
}

export const DEFAULT_DIFFICULTY_TIERS: DifficultyTier[] = [
  {
    scoreThreshold: 0,
    maxGridWidth: GRID_SIZE_MAX,
    maxGridHeight: GRID_SIZE_MAX,
    maxGroups: 9,
    maxEndpointsPerGroup: 9,
    groupEndpointCaps: Array.from({ length: 9 }, () => 9)
  }
];

export const DEFAULT_RAMP_DIFFICULTY_TIERS: DifficultyTier[] = [
  {
    scoreThreshold: 0,
    maxGridWidth: 3,
    maxGridHeight: 1,
    maxGroups: 1,
    maxEndpointsPerGroup: 2,
    groupEndpointCaps: [2]
  },
  {
    scoreThreshold: 5,
    maxGridWidth: 3,
    maxGridHeight: 2,
    maxGroups: 1,
    maxEndpointsPerGroup: 2,
    groupEndpointCaps: [2]
  },
  {
    scoreThreshold: 15,
    maxGridWidth: 3,
    maxGridHeight: 3,
    maxGroups: 1,
    maxEndpointsPerGroup: 2,
    groupEndpointCaps: [2]
  },
  {
    scoreThreshold: 30,
    maxGridWidth: 3,
    maxGridHeight: 4,
    maxGroups: 1,
    maxEndpointsPerGroup: 2,
    groupEndpointCaps: [2]
  },
  {
    scoreThreshold: 45,
    maxGridWidth: 4,
    maxGridHeight: 4,
    maxGroups: 2,
    maxEndpointsPerGroup: 2,
    groupEndpointCaps: [2, 2]
  },
  {
    scoreThreshold: 70,
    maxGridWidth: 4,
    maxGridHeight: 4,
    maxGroups: 2,
    maxEndpointsPerGroup: 3,
    groupEndpointCaps: [3, 2]
  },
  {
    scoreThreshold: 100,
    maxGridWidth: 4,
    maxGridHeight: 5,
    maxGroups: 2,
    maxEndpointsPerGroup: 3,
    groupEndpointCaps: [3, 2]
  },
  {
    scoreThreshold: 130,
    maxGridWidth: 5,
    maxGridHeight: 5,
    maxGroups: 2,
    maxEndpointsPerGroup: 3,
    groupEndpointCaps: [3, 3]
  },
  {
    scoreThreshold: 200,
    maxGridWidth: 5,
    maxGridHeight: 5,
    maxGroups: 3,
    maxEndpointsPerGroup: 3,
    groupEndpointCaps: [3, 3, 2]
  },
  {
    scoreThreshold: 250,
    maxGridWidth: 6,
    maxGridHeight: 6,
    maxGroups: 3,
    maxEndpointsPerGroup: 3,
    groupEndpointCaps: [3, 3, 2]
  }
];

export const DEFAULT_PIPE_SPAWN_ENABLED: PipeSpawnEnabled = {
  straight: true,
  elbow: true,
  tee: true,
  cross: true,
  doubleElbow: false
};
export const DEFAULT_ENERGY = 999;
export const DEFAULT_BOOSTERS = 20;

export const ENDPOINT_COLOR_PALETTE = [
  '#ff6d6d',
  '#5ca9ff',
  '#ffd35a',
  '#b98cff',
  '#42d58b',
  '#ffa65c',
  '#69e0ff'
] as const;

export interface OfferSpec {
  id: string;
  kind: PipeKind;
  orientation: Orientation;
  originalOrientation: Orientation;
  debugReason: string;
  debugScore: number;
}

export interface GhostPipe {
  row: number;
  col: number;
  kind: PipeKind;
  orientation: Orientation;
}

export interface GameLogEntry {
  id: number;
  timestamp: number;
  event: string;
  message: string;
  data?: unknown;
}

export interface GameState {
  gridSize: number;
  gridWidth: number;
  gridHeight: number;
  tiles: TileGrid;
  endpointNodes: EndpointNode[];
  endpointGroups: EndpointGroup[];
  endpointScenario: EndpointScenario;
  offers: OfferSpec[];
  ghostPipes: GhostPipe[];
  showGhostPipes: boolean;
  score: number;
  maxScoreReached: number;
  difficultyTiers: DifficultyTier[];
  appliedDifficultyTierIndex: number;
  energy: number;
  boosters: number;
  pipeSpawnEnabled: PipeSpawnEnabled;
  offerSeed: number;
  hoveredCell: Cell | null;
  invalidCell: Cell | null;
  logs: GameLogEntry[];
  logCursor: number;
}

export interface InitGameOptions {
  gridSize?: number;
  gridWidth?: number;
  gridHeight?: number;
  endpointScenario?: EndpointScenario;
  pipeSpawnEnabled?: Partial<PipeSpawnEnabled>;
  score?: number;
  maxScoreReached?: number;
  difficultyTiers?: DifficultyTier[];
  appliedDifficultyTierIndex?: number;
  energy?: number;
  boosters?: number;
  offerSeed?: number;
  rng?: () => number;
}

interface GeneratedEndpoints {
  endpointNodes: EndpointNode[];
  endpointGroups: EndpointGroup[];
}

interface TraverseState {
  row: number;
  col: number;
  inDir: DirectionBit;
  parentKey: string | null;
}

interface GroupCompletionAnalysis {
  groupId: string;
  cellsToClear: Cell[];
}

interface CompletedEndpointBurst {
  id: string;
  groupId: string;
  row: number;
  col: number;
  colorId: number;
}

interface CompletedPipeBurst {
  row: number;
  col: number;
  kind: PipeKind;
  orientation: Orientation;
}

interface CompletedGroupResult {
  state: GameState;
  completedGroupIds: string[];
  completedEndpointCount: number;
}

interface PlannedTransitionCell {
  row: number;
  col: number;
  inDir: DirectionBit;
  outDir: DirectionBit;
}

interface PairPathPlan {
  sourceId: string;
  targetId: string;
  addedCost: number;
  transitions: PlannedTransitionCell[];
}

type CellReservationMap = Map<string, Map<string, number>>;

const MAX_LOG_ENTRIES = 600;
const OFFER_ORIENTATIONS: Orientation[] = [0, 90, 180, 270];
const RANDOM_PIPE_ORDER: PipeKind[] = ['straight', 'elbow', 'tee', 'cross', 'doubleElbow'];
const PIPE_COMPLEXITY_WEIGHT: Record<PipeKind, number> = {
  straight: 0,
  elbow: 1,
  tee: 2,
  cross: 3,
  doubleElbow: 4
};

const SIMILAR_COLOR_PAIRS = new Set(['1|6', '2|5']);

function clampGridSize(size: number): number {
  return Math.max(GRID_SIZE_MIN, Math.min(GRID_SIZE_MAX, Math.round(size)));
}

function normalizeGridDimensions(
  gridWidthInput: number,
  gridHeightInput: number
): { gridWidth: number; gridHeight: number } {
  let gridWidth = clampGridSize(gridWidthInput);
  let gridHeight = clampGridSize(gridHeightInput);

  if (gridWidth < GRID_MIN_LONG_SIDE && gridHeight < GRID_MIN_LONG_SIDE) {
    if (gridWidth >= gridHeight) {
      gridWidth = GRID_MIN_LONG_SIDE;
    } else {
      gridHeight = GRID_MIN_LONG_SIDE;
    }
  }

  return { gridWidth, gridHeight };
}

function clampScenarioValue(value: number): number {
  return Math.max(1, Math.min(9, Math.round(value)));
}

function normalizeTierGroupEndpointCaps(tier: DifficultyTier): number[] {
  const rawGroupCaps = Array.isArray(tier.groupEndpointCaps)
    ? tier.groupEndpointCaps
    : [];
  const fallbackGroupCount = clampScenarioValue(tier.maxGroups ?? 1);
  const fallbackEndpointCap = clampScenarioValue(tier.maxEndpointsPerGroup ?? 2);
  const caps = rawGroupCaps
    .map((value) => clampScenarioValue(value))
    .slice(0, 9);

  if (caps.length === 0) {
    return Array.from({ length: fallbackGroupCount }, () => fallbackEndpointCap);
  }

  return caps;
}

function normalizeDifficultyTiers(input: DifficultyTier[] | undefined): DifficultyTier[] {
  const source = input && input.length > 0 ? input : DEFAULT_DIFFICULTY_TIERS;
  const normalized = source.map((tier, index) => {
    const scoreThreshold = Math.max(0, Math.round(tier.scoreThreshold ?? index * 10));
    const dimensions = normalizeGridDimensions(
      tier.maxGridWidth ?? GRID_MIN_LONG_SIDE,
      tier.maxGridHeight ?? 1
    );
    const groupEndpointCaps = normalizeTierGroupEndpointCaps(tier);
    const maxEndpointsPerGroup = groupEndpointCaps.reduce(
      (highest, value) => Math.max(highest, value),
      1
    );

    return {
      scoreThreshold,
      maxGridWidth: dimensions.gridWidth,
      maxGridHeight: dimensions.gridHeight,
      maxGroups: groupEndpointCaps.length,
      maxEndpointsPerGroup,
      groupEndpointCaps
    };
  });

  normalized.sort((first, second) => {
    if (first.scoreThreshold !== second.scoreThreshold) {
      return first.scoreThreshold - second.scoreThreshold;
    }
    if (first.maxGridWidth !== second.maxGridWidth) {
      return first.maxGridWidth - second.maxGridWidth;
    }
    if (first.maxGridHeight !== second.maxGridHeight) {
      return first.maxGridHeight - second.maxGridHeight;
    }
    if (first.maxGroups !== second.maxGroups) {
      return first.maxGroups - second.maxGroups;
    }
    return first.maxEndpointsPerGroup - second.maxEndpointsPerGroup;
  });

  if (normalized.length === 0) {
    return DEFAULT_DIFFICULTY_TIERS.map((tier) => ({ ...tier }));
  }

  normalized[0] = {
    ...normalized[0],
    scoreThreshold: 0
  };

  return normalized;
}

function summarizeDifficultyTiersForLog(tiers: DifficultyTier[]): string {
  return tiers
    .map((tier, index) => {
      const caps = normalizeTierGroupEndpointCaps(tier);
      return `T${index + 1}(score:${tier.scoreThreshold}, grid:${tier.maxGridWidth}x${tier.maxGridHeight}, groups:${caps.length}, caps:${caps.join('/')})`;
    })
    .join(' | ');
}

function areDifficultyTiersEqual(first: DifficultyTier[], second: DifficultyTier[]): boolean {
  if (first.length !== second.length) {
    return false;
  }

  for (let index = 0; index < first.length; index += 1) {
    const a = first[index];
    const b = second[index];
    if (!a || !b) {
      return false;
    }
    if (
      a.scoreThreshold !== b.scoreThreshold ||
      a.maxGridWidth !== b.maxGridWidth ||
      a.maxGridHeight !== b.maxGridHeight ||
      a.maxGroups !== b.maxGroups ||
      a.maxEndpointsPerGroup !== b.maxEndpointsPerGroup
    ) {
      return false;
    }
    const aCaps = normalizeTierGroupEndpointCaps(a);
    const bCaps = normalizeTierGroupEndpointCaps(b);
    if (aCaps.length !== bCaps.length) {
      return false;
    }
    for (let capIndex = 0; capIndex < aCaps.length; capIndex += 1) {
      if (aCaps[capIndex] !== bCaps[capIndex]) {
        return false;
      }
    }
  }

  return true;
}

function resolveUnlockedDifficultyTierIndex(
  difficultyTiers: DifficultyTier[],
  maxScoreReached: number
): number {
  let bestIndex = 0;
  for (let index = 0; index < difficultyTiers.length; index += 1) {
    const tier = difficultyTiers[index];
    if (!tier) {
      continue;
    }
    if (maxScoreReached < tier.scoreThreshold) {
      break;
    }
    bestIndex = index;
  }
  return bestIndex;
}

function fallbackTier(): DifficultyTier {
  return {
    scoreThreshold: 0,
    maxGridWidth: GRID_MIN_LONG_SIDE,
    maxGridHeight: 1,
    maxGroups: 1,
    maxEndpointsPerGroup: 2,
    groupEndpointCaps: [2]
  };
}

function constrainGridToTier(
  gridWidthInput: number,
  gridHeightInput: number,
  tier: DifficultyTier
): { gridWidth: number; gridHeight: number } {
  const maxGridWidth = clampGridSize(tier.maxGridWidth);
  const maxGridHeight = clampGridSize(tier.maxGridHeight);

  let gridWidth = Math.max(1, Math.min(maxGridWidth, Math.round(gridWidthInput)));
  let gridHeight = Math.max(1, Math.min(maxGridHeight, Math.round(gridHeightInput)));

  if (gridWidth < GRID_MIN_LONG_SIDE && gridHeight < GRID_MIN_LONG_SIDE) {
    if (maxGridWidth >= GRID_MIN_LONG_SIDE && (gridWidth >= gridHeight || maxGridHeight < GRID_MIN_LONG_SIDE)) {
      gridWidth = GRID_MIN_LONG_SIDE;
    } else if (maxGridHeight >= GRID_MIN_LONG_SIDE) {
      gridHeight = GRID_MIN_LONG_SIDE;
    } else if (maxGridWidth >= maxGridHeight) {
      gridWidth = maxGridWidth;
    } else {
      gridHeight = maxGridHeight;
    }
  }

  return { gridWidth, gridHeight };
}

function groupSizesFromScenario(endpointScenario: EndpointScenario): number[] {
  return expandScenarioGroups(endpointScenario).map((size) => clampScenarioValue(size));
}

function scenarioFromGroupSizes(groupSizes: number[]): EndpointScenario {
  if (groupSizes.length === 0) {
    return [{ size: 2, groups: 1 }];
  }
  return groupSizes.map((size) => ({
    size: clampScenarioValue(size),
    groups: 1
  }));
}

function constrainScenarioToTier(endpointScenario: EndpointScenario, tier: DifficultyTier): EndpointScenario {
  const requestedGroupSizes = groupSizesFromScenario(endpointScenario);
  const groupCaps = normalizeTierGroupEndpointCaps(tier);
  const nextGroupSizes = requestedGroupSizes
    .slice(0, groupCaps.length)
    .map((size, index) => Math.min(size, groupCaps[index] ?? tier.maxEndpointsPerGroup));

  if (nextGroupSizes.length === 0) {
    nextGroupSizes.push(Math.min(2, groupCaps[0] ?? tier.maxEndpointsPerGroup));
  }

  return scenarioFromGroupSizes(nextGroupSizes);
}

function baseScenarioForTier(tier: DifficultyTier): EndpointScenario {
  const groupCaps = normalizeTierGroupEndpointCaps(tier);
  const groupSizes = groupCaps.map((cap, index) => (index === 0 ? Math.min(2, cap) : cap));
  return scenarioFromGroupSizes(groupSizes);
}

function maxScenarioForTier(tier: DifficultyTier): EndpointScenario {
  return scenarioFromGroupSizes(normalizeTierGroupEndpointCaps(tier));
}

function buildFallbackEndpointsFromScenario(
  gridHeight: number,
  gridWidth: number,
  endpointScenario: EndpointScenario,
  tiles: TileGrid | undefined
): GeneratedEndpoints | null {
  const groupSizes = expandScenarioGroups(endpointScenario);
  if (groupSizes.length === 0) {
    return null;
  }

  const requiredEndpoints = groupSizes.reduce((sum, size) => sum + size, 0);
  const candidates = allGridCells(gridHeight, gridWidth)
    .filter((cell) => !tiles || tiles[cell.row]?.[cell.col] === null)
    .sort((a, b) =>
      distanceToNearestBorder(a, gridHeight, gridWidth) - distanceToNearestBorder(b, gridHeight, gridWidth) ||
      a.row - b.row ||
      a.col - b.col
    );

  if (requiredEndpoints > candidates.length) {
    return null;
  }

  if (gridWidth === 3 && gridHeight === 2) {
    const forcedCells = buildThreeByTwoRowSplitCells(groupSizes, candidates, () => 0.5);
    if (forcedCells && forcedCells.length === requiredEndpoints) {
      const endpointNodes: EndpointNode[] = [];
      const endpointGroups: EndpointGroup[] = [];
      let forcedCursor = 0;

      for (let groupIndex = 0; groupIndex < groupSizes.length; groupIndex += 1) {
        const size = groupSizes[groupIndex]!;
        const groupId = `group-${groupIndex + 1}`;
        const colorId = groupIndex % ENDPOINT_COLOR_PALETTE.length;
        const nodeIds: string[] = [];

        for (let nodeIndex = 0; nodeIndex < size; nodeIndex += 1) {
          const cell = forcedCells[forcedCursor++];
          if (!cell) {
            return null;
          }

          const nodeId = `${groupId}-node-${nodeIndex + 1}`;
          nodeIds.push(nodeId);
          endpointNodes.push({
            id: nodeId,
            row: cell.row,
            col: cell.col,
            groupId,
            colorId
          });
        }

        endpointGroups.push({
          id: groupId,
          colorId,
          nodeIds
        });
      }

      return { endpointNodes, endpointGroups };
    }
  }

  const endpointNodes: EndpointNode[] = [];
  const endpointGroups: EndpointGroup[] = [];
  let cursor = 0;

  for (let groupIndex = 0; groupIndex < groupSizes.length; groupIndex += 1) {
    const size = groupSizes[groupIndex]!;
    const groupId = `group-${groupIndex + 1}`;
    const colorId = groupIndex % ENDPOINT_COLOR_PALETTE.length;
    const nodeIds: string[] = [];

    for (let nodeIndex = 0; nodeIndex < size; nodeIndex += 1) {
      const cell = candidates[cursor++];
      if (!cell) {
        return null;
      }

      const nodeId = `${groupId}-node-${nodeIndex + 1}`;
      nodeIds.push(nodeId);
      endpointNodes.push({
        id: nodeId,
        row: cell.row,
        col: cell.col,
        groupId,
        colorId
      });
    }

    endpointGroups.push({
      id: groupId,
      colorId,
      nodeIds
    });
  }

  return { endpointNodes, endpointGroups };
}

function appendGameLog(
  state: GameState,
  event: string,
  message: string,
  data?: unknown,
  emitConsole = true
): GameState {
  const nextId = state.logCursor + 1;
  const entry: GameLogEntry = {
    id: nextId,
    timestamp: Date.now(),
    event,
    message,
    data
  };

  const logs = [...state.logs, entry];
  const trimmedLogs = logs.length > MAX_LOG_ENTRIES
    ? logs.slice(logs.length - MAX_LOG_ENTRIES)
    : logs;

  if (emitConsole && typeof window !== 'undefined') {
    // eslint-disable-next-line no-console
    console.info(`[GameLog:${entry.id}] ${event} - ${message}`, data ?? '');
  }

  return {
    ...state,
    logs: trimmedLogs,
    logCursor: nextId
  };
}

function applyScoreDelta(
  state: GameState,
  delta: number,
  context: string,
  data?: unknown
): GameState {
  if (delta === 0) {
    return state;
  }

  const previous = state.score;
  const nextScore = Math.max(0, previous + delta);
  const appliedDelta = nextScore - previous;
  if (appliedDelta === 0) {
    return state;
  }

  const nextWithScore = appendGameLog(
    {
      ...state,
      score: nextScore
    },
    'score.changed',
    `${context}: ${appliedDelta > 0 ? '+' : ''}${appliedDelta} (score ${nextScore}).`,
    {
      requestedDelta: delta,
      appliedDelta,
      previousScore: previous,
      nextScore,
      ...((data as Record<string, unknown>) ?? {})
    }
  );

  return applyScoreUnlockProgress(nextWithScore);
}

function cloneTiles(tiles: TileGrid): TileGrid {
  return tiles.map((row) => row.slice());
}

function toCellKey(row: number, col: number): string {
  return `${row},${col}`;
}

function toTraverseKey(row: number, col: number, inDir: DirectionBit): string {
  return `${row},${col},${inDir}`;
}

export function createEmptyTiles(gridHeight: number, gridWidth = gridHeight): TileGrid {
  return Array.from({ length: gridHeight }, () => Array.from({ length: gridWidth }, () => null));
}

function normalizePipeSpawnEnabled(options: InitGameOptions): PipeSpawnEnabled {
  return {
    straight: options.pipeSpawnEnabled?.straight ?? DEFAULT_PIPE_SPAWN_ENABLED.straight,
    elbow: options.pipeSpawnEnabled?.elbow ?? DEFAULT_PIPE_SPAWN_ENABLED.elbow,
    tee: options.pipeSpawnEnabled?.tee ?? DEFAULT_PIPE_SPAWN_ENABLED.tee,
    cross: options.pipeSpawnEnabled?.cross ?? DEFAULT_PIPE_SPAWN_ENABLED.cross,
    doubleElbow: options.pipeSpawnEnabled?.doubleElbow ?? DEFAULT_PIPE_SPAWN_ENABLED.doubleElbow
  };
}

function normalizeScenario(input: EndpointScenario | undefined): EndpointScenario {
  if (!input || input.length === 0) {
    return DEFAULT_ENDPOINT_SCENARIO.map((term) => ({ ...term }));
  }

  const normalized: EndpointScenario = [];
  for (const term of input) {
    normalized.push({
      size: clampScenarioValue(term.size),
      groups: clampScenarioValue(term.groups)
    });
  }

  return normalized.length > 0
    ? normalized
    : DEFAULT_ENDPOINT_SCENARIO.map((term) => ({ ...term }));
}

function requiredEndpointCount(endpointScenario: EndpointScenario): number {
  return expandScenarioGroups(endpointScenario).reduce((sum, size) => sum + size, 0);
}

export function getUnlockedDifficultyTierIndex(state: Pick<GameState, 'difficultyTiers' | 'maxScoreReached'>): number {
  return resolveUnlockedDifficultyTierIndex(state.difficultyTiers, state.maxScoreReached);
}

export function getUnlockedDifficultyTier(state: Pick<GameState, 'difficultyTiers' | 'maxScoreReached'>): DifficultyTier {
  const tierIndex = getUnlockedDifficultyTierIndex(state);
  return state.difficultyTiers[tierIndex] ?? fallbackTier();
}

function applyScoreUnlockProgress(state: GameState): GameState {
  const nextMaxScoreReached = Math.max(state.maxScoreReached, state.score);
  if (nextMaxScoreReached === state.maxScoreReached) {
    return state;
  }

  const previousTierIndex = resolveUnlockedDifficultyTierIndex(state.difficultyTiers, state.maxScoreReached);
  const nextTierIndex = resolveUnlockedDifficultyTierIndex(state.difficultyTiers, nextMaxScoreReached);

  let nextState: GameState = {
    ...state,
    maxScoreReached: nextMaxScoreReached
  };

  if (nextTierIndex > previousTierIndex) {
    for (let tierIndex = previousTierIndex + 1; tierIndex <= nextTierIndex; tierIndex += 1) {
      const unlockedTier = state.difficultyTiers[tierIndex];
      if (!unlockedTier) {
        continue;
      }

      nextState = appendGameLog(
        nextState,
        'difficulty.unlocked',
        `Unlocked tier ${tierIndex + 1} at score ${unlockedTier.scoreThreshold}.`,
        {
          tierIndex,
          scoreThreshold: unlockedTier.scoreThreshold,
          maxGridWidth: unlockedTier.maxGridWidth,
          maxGridHeight: unlockedTier.maxGridHeight,
          maxGroups: unlockedTier.maxGroups,
          maxEndpointsPerGroup: unlockedTier.maxEndpointsPerGroup,
          groupEndpointCaps: normalizeTierGroupEndpointCaps(unlockedTier)
        }
      );
    }
  }

  return nextState;
}

function areColorsSimilar(first: number, second: number): boolean {
  const key = first < second ? `${first}|${second}` : `${second}|${first}`;
  return SIMILAR_COLOR_PAIRS.has(key);
}

function nextColorPool(rng: () => number, previousColorId?: number): number[] {
  const pool = Array.from({ length: ENDPOINT_COLOR_PALETTE.length }, (_, index) => index);
  const ordered: number[] = [];

  let priorColor = previousColorId ?? null;
  while (pool.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index];
      const similarityPenalty = priorColor !== null && areColorsSimilar(priorColor, candidate)
        ? 0.78
        : 0;
      const score = rng() - similarityPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    const chosen = pool.splice(bestIndex, 1)[0];
    ordered.push(chosen);
    priorColor = chosen;
  }

  return ordered;
}

function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function distanceToNearestBorder(cell: Cell, gridHeight: number, gridWidth: number): number {
  return Math.min(
    cell.row,
    cell.col,
    Math.max(0, gridHeight - 1 - cell.row),
    Math.max(0, gridWidth - 1 - cell.col)
  );
}

function borderPreferenceScore(cell: Cell, gridHeight: number, gridWidth: number): number {
  return 1 / (distanceToNearestBorder(cell, gridHeight, gridWidth) + 1);
}

function isCornerCell(cell: Cell, gridHeight: number, gridWidth: number): boolean {
  const onTopOrBottom = cell.row === 0 || cell.row === gridHeight - 1;
  const onLeftOrRight = cell.col === 0 || cell.col === gridWidth - 1;
  return onTopOrBottom && onLeftOrRight;
}

function parseCellKey(cellKey: string): Cell | null {
  const [rowRaw, colRaw] = cellKey.split(',');
  const row = Number(rowRaw);
  const col = Number(colRaw);
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    return null;
  }
  return { row, col };
}

function forEachAdjacentCell(
  cell: Cell,
  gridHeight: number,
  gridWidth: number,
  visit: (adjacent: Cell) => void
): void {
  for (const direction of ALL_DIRECTIONS) {
    const delta = directionToDelta(direction);
    const next = {
      row: cell.row + delta.dr,
      col: cell.col + delta.dc
    };
    if (!isInsideGrid(gridHeight, gridWidth, next)) {
      continue;
    }
    visit(next);
  }
}

function countAdjacentEndpoints(
  cell: Cell,
  endpointKeys: Set<string>,
  gridHeight: number,
  gridWidth: number
): number {
  let count = 0;
  forEachAdjacentCell(cell, gridHeight, gridWidth, (adjacent) => {
    if (endpointKeys.has(toCellKey(adjacent.row, adjacent.col))) {
      count += 1;
    }
  });
  return count;
}

function countOpenEndpointEntries(
  cell: Cell,
  endpointKeys: Set<string>,
  gridHeight: number,
  gridWidth: number
): number {
  let count = 0;
  forEachAdjacentCell(cell, gridHeight, gridWidth, (adjacent) => {
    if (!endpointKeys.has(toCellKey(adjacent.row, adjacent.col))) {
      count += 1;
    }
  });
  return count;
}

function canAddEndpointWithoutBlockingNeighbors(
  candidate: Cell,
  endpointKeys: Set<string>,
  gridHeight: number,
  gridWidth: number
): { allowed: boolean; candidateOpenEntries: number; minOpenEntriesAround: number } {
  const candidateKey = toCellKey(candidate.row, candidate.col);
  if (endpointKeys.has(candidateKey)) {
    return {
      allowed: false,
      candidateOpenEntries: 0,
      minOpenEntriesAround: 0
    };
  }

  const nextEndpointKeys = new Set(endpointKeys);
  nextEndpointKeys.add(candidateKey);

  const candidateOpenEntries = countOpenEndpointEntries(
    candidate,
    nextEndpointKeys,
    gridHeight,
    gridWidth
  );
  if (candidateOpenEntries <= 0) {
    return {
      allowed: false,
      candidateOpenEntries: 0,
      minOpenEntriesAround: 0
    };
  }

  if (
    isCornerCell(candidate, gridHeight, gridWidth) &&
    countAdjacentEndpoints(candidate, nextEndpointKeys, gridHeight, gridWidth) > 0
  ) {
    return {
      allowed: false,
      candidateOpenEntries: 0,
      minOpenEntriesAround: 0
    };
  }

  let minOpenEntriesAround = candidateOpenEntries;
  let blockedNeighborFound = false;
  forEachAdjacentCell(candidate, gridHeight, gridWidth, (adjacent) => {
    if (blockedNeighborFound) {
      return;
    }

    if (!nextEndpointKeys.has(toCellKey(adjacent.row, adjacent.col))) {
      return;
    }

    const neighborOpenEntries = countOpenEndpointEntries(
      adjacent,
      nextEndpointKeys,
      gridHeight,
      gridWidth
    );
    if (
      isCornerCell(adjacent, gridHeight, gridWidth) &&
      countAdjacentEndpoints(adjacent, nextEndpointKeys, gridHeight, gridWidth) > 0
    ) {
      blockedNeighborFound = true;
      return;
    }
    if (neighborOpenEntries <= 0) {
      blockedNeighborFound = true;
      return;
    }
    minOpenEntriesAround = Math.min(minOpenEntriesAround, neighborOpenEntries);
  });

  if (blockedNeighborFound) {
    return {
      allowed: false,
      candidateOpenEntries: 0,
      minOpenEntriesAround: 0
    };
  }

  return {
    allowed: true,
    candidateOpenEntries,
    minOpenEntriesAround
  };
}

function buildNonEndpointComponents(
  gridHeight: number,
  gridWidth: number,
  endpointKeys: Set<string>
): Map<string, number> {
  const componentByCell = new Map<string, number>();
  let nextComponentId = 1;

  for (let row = 0; row < gridHeight; row += 1) {
    for (let col = 0; col < gridWidth; col += 1) {
      const startKey = toCellKey(row, col);
      if (endpointKeys.has(startKey) || componentByCell.has(startKey)) {
        continue;
      }

      const queue: Cell[] = [{ row, col }];
      componentByCell.set(startKey, nextComponentId);

      while (queue.length > 0) {
        const current = queue.shift()!;
        forEachAdjacentCell(current, gridHeight, gridWidth, (adjacent) => {
          const adjacentKey = toCellKey(adjacent.row, adjacent.col);
          if (endpointKeys.has(adjacentKey) || componentByCell.has(adjacentKey)) {
            return;
          }
          componentByCell.set(adjacentKey, nextComponentId);
          queue.push(adjacent);
        });
      }

      nextComponentId += 1;
    }
  }

  return componentByCell;
}

function endpointEntryComponents(
  endpoint: Cell,
  componentByCell: Map<string, number>,
  endpointKeys: Set<string>,
  gridHeight: number,
  gridWidth: number
): Set<number> {
  const components = new Set<number>();
  forEachAdjacentCell(endpoint, gridHeight, gridWidth, (adjacent) => {
    const adjacentKey = toCellKey(adjacent.row, adjacent.col);
    if (endpointKeys.has(adjacentKey)) {
      return;
    }
    const componentId = componentByCell.get(adjacentKey);
    if (componentId !== undefined) {
      components.add(componentId);
    }
  });
  return components;
}

function hasComponentIntersection(a: Set<number>, b: Set<number>): boolean {
  if (a.size === 0 || b.size === 0) {
    return false;
  }

  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const value of small) {
    if (large.has(value)) {
      return true;
    }
  }
  return false;
}

interface EndpointLayoutAssessment {
  valid: boolean;
  blockedEndpointCount: number;
  disconnectedEndpointCount: number;
  adjacentNeighborCount: number;
  threeByTwoRowRuleViolations: number;
  score: number;
}

function assessEndpointLayout(
  cells: Cell[],
  groupSizes: number[],
  gridHeight: number,
  gridWidth: number
): EndpointLayoutAssessment {
  const endpointKeys = new Set(cells.map((cell) => toCellKey(cell.row, cell.col)));
  const componentByCell = buildNonEndpointComponents(gridHeight, gridWidth, endpointKeys);
  const endpointComponents = cells.map((cell) =>
    endpointEntryComponents(cell, componentByCell, endpointKeys, gridHeight, gridWidth)
  );

  let blockedEndpointCount = 0;
  let adjacentNeighborCount = 0;
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index]!;
    if (endpointComponents[index]!.size === 0) {
      blockedEndpointCount += 1;
    }
    adjacentNeighborCount += countAdjacentEndpoints(cell, endpointKeys, gridHeight, gridWidth);
  }

  let disconnectedEndpointCount = 0;
  let threeByTwoRowRuleViolations = 0;
  const enforceThreeByTwoRowSplit = gridWidth === 3 && gridHeight === 2;
  let cursor = 0;
  for (const size of groupSizes) {
    const groupStart = cursor;
    const groupEnd = Math.min(cells.length, groupStart + size);
    cursor = groupEnd;

    if (groupEnd - groupStart < 2) {
      continue;
    }

    if (enforceThreeByTwoRowSplit && size === 2 && groupEnd - groupStart === 2) {
      const first = cells[groupStart];
      const second = cells[groupStart + 1];
      if (first && second && first.row === second.row) {
        threeByTwoRowRuleViolations += 1;
      }
    }

    for (let index = groupStart; index < groupEnd; index += 1) {
      const sourceComponents = endpointComponents[index]!;
      let hasPartner = false;
      for (let target = groupStart; target < groupEnd; target += 1) {
        if (target === index) {
          continue;
        }
        if (hasComponentIntersection(sourceComponents, endpointComponents[target]!)) {
          hasPartner = true;
          break;
        }
      }
      if (!hasPartner) {
        disconnectedEndpointCount += 1;
      }
    }
  }

  // adjacentNeighborCount counts both directions; halve to represent actual adjacency pairs.
  const adjacentPairs = Math.floor(adjacentNeighborCount / 2);
  const score = (
    cells.length * 100 -
    blockedEndpointCount * 600 -
    disconnectedEndpointCount * 260 -
    adjacentPairs * 24 -
    threeByTwoRowRuleViolations * 320
  );

  return {
    valid: (
      blockedEndpointCount === 0 &&
      disconnectedEndpointCount === 0 &&
      threeByTwoRowRuleViolations === 0
    ),
    blockedEndpointCount,
    disconnectedEndpointCount,
    adjacentNeighborCount: adjacentPairs,
    threeByTwoRowRuleViolations,
    score
  };
}

function violatesThreeByTwoPairRowRule(
  cells: Cell[],
  groupSizes: number[],
  gridHeight: number,
  gridWidth: number
): boolean {
  if (!(gridWidth === 3 && gridHeight === 2)) {
    return false;
  }

  let cursor = 0;
  for (const size of groupSizes) {
    const groupStart = cursor;
    const groupEnd = Math.min(cells.length, groupStart + size);
    cursor = groupEnd;
    if (size !== 2 || groupEnd - groupStart !== 2) {
      continue;
    }

    const first = cells[groupStart];
    const second = cells[groupStart + 1];
    if (!first || !second || first.row === second.row) {
      return true;
    }
  }

  return false;
}

function shuffleCells(cells: Cell[], rng: () => number): Cell[] {
  const next = cells.slice();
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const temp = next[index];
    next[index] = next[swapIndex]!;
    next[swapIndex] = temp!;
  }
  return next;
}

function buildThreeByTwoRowSplitCells(
  groupSizes: number[],
  candidates: Cell[],
  rng: () => number
): Cell[] | null {
  const remaining = shuffleCells(candidates, rng);
  const selected: Cell[] = [];

  for (const size of groupSizes) {
    if (size === 2) {
      const firstRowZeroIndex = remaining.findIndex((cell) => cell.row === 0);
      if (firstRowZeroIndex < 0) {
        return null;
      }
      const rowZeroCell = remaining.splice(firstRowZeroIndex, 1)[0]!;
      const firstRowOneIndex = remaining.findIndex((cell) => cell.row === 1);
      if (firstRowOneIndex < 0) {
        return null;
      }
      const rowOneCell = remaining.splice(firstRowOneIndex, 1)[0]!;
      if (rng() < 0.5) {
        selected.push(rowZeroCell, rowOneCell);
      } else {
        selected.push(rowOneCell, rowZeroCell);
      }
      continue;
    }

    if (remaining.length < size) {
      return null;
    }

    selected.push(...remaining.splice(0, size));
  }

  return selected;
}

function pickDistinctCells(
  candidates: Cell[],
  count: number,
  rng: () => number,
  gridHeight: number,
  gridWidth: number,
  lockedEndpointKeys: Set<string> = new Set(),
  avoidEndpointKeys: Set<string> = new Set()
): Cell[] {
  const selected: Cell[] = [];

  if (count <= 0 || candidates.length === 0) {
    return selected;
  }

  const fixedCells: Cell[] = [];
  for (const key of lockedEndpointKeys) {
    const parsed = parseCellKey(key);
    if (parsed && isInsideGrid(gridHeight, gridWidth, parsed)) {
      fixedCells.push(parsed);
    }
  }
  const avoidCells: Cell[] = [];
  for (const key of avoidEndpointKeys) {
    const parsed = parseCellKey(key);
    if (parsed && isInsideGrid(gridHeight, gridWidth, parsed)) {
      avoidCells.push(parsed);
    }
  }

  const remaining = candidates.slice();
  const selectedEndpointKeys = new Set(lockedEndpointKeys);
  const spreadNormalizer = Math.max(1, (Math.max(gridHeight, gridWidth) - 1) * 2);

  while (selected.length < count && remaining.length > 0) {
    const candidateScores: Array<{ index: number; score: number }> = [];

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const accessCheck = canAddEndpointWithoutBlockingNeighbors(
        candidate,
        selectedEndpointKeys,
        gridHeight,
        gridWidth
      );
      if (!accessCheck.allowed) {
        continue;
      }

      const borderScore = borderPreferenceScore(candidate, gridHeight, gridWidth);
      const spreadTargets = selected.length > 0
        ? selected
        : fixedCells;
      const spreadScore = spreadTargets.length === 0
        ? 0
        : spreadTargets.reduce(
          (min, current) => Math.min(min, manhattan(candidate, current)),
          Infinity
        ) / spreadNormalizer;
      const adjacencyPenalty = countAdjacentEndpoints(
        candidate,
        selectedEndpointKeys,
        gridHeight,
        gridWidth
      );
      const cornerSafetyBonus = (
        isCornerCell(candidate, gridHeight, gridWidth) &&
        adjacencyPenalty === 0
      )
        ? 0.42
        : 0;
      const openEntryScore = accessCheck.candidateOpenEntries / 4;
      const resilienceScore = accessCheck.minOpenEntriesAround / 4;
      const candidateKey = toCellKey(candidate.row, candidate.col);
      const sameSpotPenalty = avoidEndpointKeys.has(candidateKey) ? 1.75 : 0;
      const avoidDistance = avoidCells.length === 0
        ? 4
        : avoidCells.reduce((min, avoidCell) => Math.min(min, manhattan(candidate, avoidCell)), Infinity);
      const avoidDistanceBonus = avoidCells.length === 0
        ? 0
        : Math.min(4, avoidDistance) / 4;
      const avoidProximityPenalty = avoidCells.length === 0
        ? 0
        : Math.max(0, 2 - avoidDistance) * 0.45;
      // Prefer near-border points while still allowing interior spawns and keeping groups spread apart.
      // Also strongly prefer cells with low endpoint adjacency and at least one safe pipe-entry lane.
      const score = (
        borderScore * 1.35 +
        spreadScore * 0.55 +
        openEntryScore * 1.2 +
        resilienceScore * 0.35 -
        adjacencyPenalty * 1.4 +
        cornerSafetyBonus +
        avoidDistanceBonus * 0.6 -
        avoidProximityPenalty -
        sameSpotPenalty +
        rng() * 0.35
      );

      candidateScores.push({ index, score });
    }

    if (candidateScores.length === 0) {
      break;
    }

    candidateScores.sort((a, b) => (b.score - a.score) || (a.index - b.index));
    const topWindow = candidateScores.slice(0, Math.min(3, candidateScores.length));
    const bestScore = topWindow[0]?.score ?? 0;
    let totalWeight = 0;
    const weighted = topWindow.map((candidate, rank) => {
      const scoreDelta = Math.max(0, bestScore - candidate.score);
      const weight = (1 / (rank + 1)) * Math.exp(-scoreDelta * 1.45);
      totalWeight += weight;
      return {
        index: candidate.index,
        weight
      };
    });

    let selectedIndex = weighted[0]?.index ?? -1;
    if (totalWeight > 0) {
      let threshold = rng() * totalWeight;
      for (const option of weighted) {
        threshold -= option.weight;
        if (threshold <= 0) {
          selectedIndex = option.index;
          break;
        }
      }
    }

    if (selectedIndex < 0) {
      break;
    }

    const chosen = remaining.splice(selectedIndex, 1)[0];
    selected.push(chosen);
    selectedEndpointKeys.add(toCellKey(chosen.row, chosen.col));
  }

  return selected;
}

function allGridCells(gridHeight: number, gridWidth: number): Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < gridHeight; row += 1) {
    for (let col = 0; col < gridWidth; col += 1) {
      cells.push({ row, col });
    }
  }
  return cells;
}

function buildEndpointsFromScenario(
  gridHeight: number,
  gridWidth: number,
  endpointScenario: EndpointScenario,
  rng: () => number,
  tiles?: TileGrid
): GeneratedEndpoints | null {
  const groupSizes = expandScenarioGroups(endpointScenario);
  const requiredEndpoints = requiredEndpointCount(endpointScenario);

  const spawnCandidates = allGridCells(gridHeight, gridWidth).filter((cell) => {
    if (!tiles) {
      return true;
    }
    return tiles[cell.row]?.[cell.col] === null;
  });

  if (requiredEndpoints === 0 || requiredEndpoints > spawnCandidates.length) {
    return null;
  }

  const maxAttempts = Math.max(20, requiredEndpoints * 4);
  let cells: Cell[] = [];
  let bestCandidateCells: Cell[] | null = null;
  let bestAssessment: EndpointLayoutAssessment | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const attemptCells = pickDistinctCells(
      spawnCandidates,
      requiredEndpoints,
      rng,
      gridHeight,
      gridWidth
    );
    if (attemptCells.length < requiredEndpoints) {
      continue;
    }

    const assessment = assessEndpointLayout(attemptCells, groupSizes, gridHeight, gridWidth);
    if (
      !bestAssessment ||
      assessment.score > bestAssessment.score ||
      (assessment.score === bestAssessment.score &&
        assessment.adjacentNeighborCount < bestAssessment.adjacentNeighborCount)
    ) {
      bestAssessment = assessment;
      bestCandidateCells = attemptCells;
    }

    if (assessment.valid) {
      cells = attemptCells;
      break;
    }
  }

  if (cells.length < requiredEndpoints && bestCandidateCells) {
    cells = bestCandidateCells;
  }
  if (
    cells.length === requiredEndpoints &&
    violatesThreeByTwoPairRowRule(cells, groupSizes, gridHeight, gridWidth)
  ) {
    const forcedCells = buildThreeByTwoRowSplitCells(groupSizes, spawnCandidates, rng);
    if (forcedCells && forcedCells.length === requiredEndpoints) {
      cells = forcedCells;
    }
  }
  if (cells.length < requiredEndpoints) {
    return null;
  }

  const endpointNodes: EndpointNode[] = [];
  const endpointGroups: EndpointGroup[] = [];
  let lastAssignedColor: number | undefined;
  let colorPool = nextColorPool(rng, lastAssignedColor);

  let cursor = 0;
  for (let groupIndex = 0; groupIndex < groupSizes.length; groupIndex += 1) {
    const size = groupSizes[groupIndex];

    if (colorPool.length === 0) {
      colorPool = nextColorPool(rng, lastAssignedColor);
    }

    const colorId = colorPool.shift() ?? 0;
    lastAssignedColor = colorId;
    const groupId = `group-${groupIndex + 1}`;
    const nodeIds: string[] = [];

    for (let nodeIndex = 0; nodeIndex < size; nodeIndex += 1) {
      const cell = cells[cursor];
      cursor += 1;
      const nodeId = `${groupId}-node-${nodeIndex + 1}`;

      endpointNodes.push({
        id: nodeId,
        row: cell.row,
        col: cell.col,
        groupId,
        colorId
      });
      nodeIds.push(nodeId);
    }

    endpointGroups.push({
      id: groupId,
      colorId,
      nodeIds
    });
  }

  return {
    endpointNodes,
    endpointGroups
  };
}

function seededRatio(seed: number, salt: number): number {
  const raw = Math.sin((seed + 1) * 12.9898 + (salt + 1) * 78.233) * 43758.5453;
  return raw - Math.floor(raw);
}

function createSeededRng(seed: number): () => number {
  let cursor = 0;
  return () => {
    const value = seededRatio(seed, cursor);
    cursor += 1;
    return value;
  };
}

function bitCount(mask: number): number {
  let count = 0;
  let value = mask;
  while (value > 0) {
    count += value & 1;
    value >>= 1;
  }
  return count;
}

function maskToDirections(mask: number): DirectionBit[] {
  return ALL_DIRECTIONS.filter((direction) => (mask & direction) !== 0);
}

function isOppositeLineMask(mask: number): boolean {
  return mask === (Direction.N | Direction.S) || mask === (Direction.E | Direction.W);
}

function canMasksShareAsCross(existingMask: number, nextMask: number, crossEnabled: boolean): boolean {
  if (!crossEnabled) {
    return false;
  }
  if (!isOppositeLineMask(existingMask) || !isOppositeLineMask(nextMask)) {
    return false;
  }
  const verticalPair = existingMask === (Direction.N | Direction.S)
    ? existingMask
    : nextMask;
  const horizontalPair = existingMask === (Direction.E | Direction.W)
    ? existingMask
    : nextMask;
  return verticalPair === (Direction.N | Direction.S) && horizontalPair === (Direction.E | Direction.W);
}

function enabledKinds(pipeSpawnEnabled: PipeSpawnEnabled): PipeKind[] {
  return RANDOM_PIPE_ORDER.filter((kind) => pipeSpawnEnabled[kind]);
}

function hasEnabledTransition(
  inDir: DirectionBit,
  outDir: DirectionBit,
  pipeSpawnEnabled: PipeSpawnEnabled
): boolean {
  for (const kind of enabledKinds(pipeSpawnEnabled)) {
    const orientations: Orientation[] = kind === 'cross' ? [0] : OFFER_ORIENTATIONS;
    for (const orientation of orientations) {
      if (areEdgesConnected(kind, orientation, inDir, outDir)) {
        return true;
      }
    }
  }
  return false;
}

function chooseGhostPipeForMask(mask: number, pipeSpawnEnabled: PipeSpawnEnabled): {
  kind: PipeKind;
  orientation: Orientation;
} | null {
  const requiredDirections = maskToDirections(mask);
  if (requiredDirections.length < 2) {
    return null;
  }

  let best:
    | {
      kind: PipeKind;
      orientation: Orientation;
      extraOpenBits: number;
      complexity: number;
    }
    | null = null;

  for (const kind of enabledKinds(pipeSpawnEnabled)) {
    const orientations: Orientation[] = kind === 'cross' ? [0] : OFFER_ORIENTATIONS;
    for (const orientation of orientations) {
      let canRepresent = true;
      for (const direction of requiredDirections) {
        if (!isDirectionOpen(kind, orientation, direction)) {
          canRepresent = false;
          break;
        }
      }
      if (!canRepresent) {
        continue;
      }

      // For two-direction requirements, ensure the chosen pipe actually connects those edges.
      if (
        requiredDirections.length === 2 &&
        !areEdgesConnected(kind, orientation, requiredDirections[0], requiredDirections[1])
      ) {
        continue;
      }

      if (requiredDirections.length > 2) {
        for (let index = 0; index < requiredDirections.length; index += 1) {
          for (let offset = index + 1; offset < requiredDirections.length; offset += 1) {
            if (!areEdgesConnected(kind, orientation, requiredDirections[index], requiredDirections[offset])) {
              canRepresent = false;
              break;
            }
          }
          if (!canRepresent) {
            break;
          }
        }
        if (!canRepresent) {
          continue;
        }
      }

      const topologyMask = getPipeTopology(kind, orientation).mask;
      const extraOpenBits = bitCount(topologyMask & ~mask);
      const candidate = {
        kind,
        orientation,
        extraOpenBits,
        complexity: PIPE_COMPLEXITY_WEIGHT[kind]
      };

      if (
        !best ||
        candidate.extraOpenBits < best.extraOpenBits ||
        (candidate.extraOpenBits === best.extraOpenBits && candidate.complexity < best.complexity) ||
        (candidate.extraOpenBits === best.extraOpenBits &&
          candidate.complexity === best.complexity &&
          candidate.kind < best.kind)
      ) {
        best = candidate;
      }
    }
  }

  if (!best) {
    return null;
  }

  return {
    kind: best.kind,
    orientation: best.orientation
  };
}

function cloneReservations(source: CellReservationMap): CellReservationMap {
  const cloned: CellReservationMap = new Map();
  for (const [key, value] of source.entries()) {
    cloned.set(key, new Map(value));
  }
  return cloned;
}

function canEnterSearchCell(
  state: GameState,
  endpointByCell: Map<string, EndpointNode>,
  reservations: CellReservationMap,
  groupId: string,
  row: number,
  col: number,
  inDir: DirectionBit
): boolean {
  if (!isInsideGrid(state.gridHeight, state.gridWidth, { row, col })) {
    return false;
  }

  const endpoint = endpointByCell.get(toCellKey(row, col));
  if (endpoint) {
    return false;
  }

  const tile = state.tiles[row][col];
  if (tile) {
    return isDirectionOpen(tile.kind, tile.orientation, inDir);
  }

  const reservationsForCell = reservations.get(toCellKey(row, col));
  if (reservationsForCell?.has(groupId)) {
    return false;
  }

  return true;
}

function canTraverseSearchTransition(
  state: GameState,
  reservations: CellReservationMap,
  groupId: string,
  row: number,
  col: number,
  inDir: DirectionBit,
  outDir: DirectionBit
): boolean {
  if (inDir === outDir) {
    return false;
  }

  const tile = state.tiles[row][col];
  if (tile) {
    return areEdgesConnected(tile.kind, tile.orientation, inDir, outDir);
  }

  if (!hasEnabledTransition(inDir, outDir, state.pipeSpawnEnabled)) {
    return false;
  }

  const cellKey = toCellKey(row, col);
  const reservationsForCell = reservations.get(cellKey);
  if (!reservationsForCell || reservationsForCell.size === 0) {
    return true;
  }

  if (reservationsForCell.has(groupId)) {
    return false;
  }

  if (reservationsForCell.size > 1) {
    return false;
  }

  const otherMask = reservationsForCell.values().next().value as number;
  return canMasksShareAsCross(otherMask, inDir | outDir, state.pipeSpawnEnabled.cross);
}

function entryCostForSearchCell(
  state: GameState,
  reservations: CellReservationMap,
  row: number,
  col: number
): number {
  if (state.tiles[row][col] !== null) {
    return 0;
  }
  return reservations.has(toCellKey(row, col)) ? 0 : 1;
}

function reconstructPairPathPlan(
  state: GameState,
  reservations: CellReservationMap,
  stateByKey: Map<string, { row: number; col: number; inDir: DirectionBit }>,
  parentByKey: Map<string, string | null>,
  goalStateKey: string,
  goalOutDir: DirectionBit
): PlannedTransitionCell[] | null {
  const states: Array<{ row: number; col: number; inDir: DirectionBit }> = [];
  let current: string | null = goalStateKey;

  while (current) {
    const stateInfo = stateByKey.get(current);
    if (!stateInfo) {
      break;
    }
    states.push(stateInfo);
    current = parentByKey.get(current) ?? null;
  }

  states.reverse();
  if (states.length === 0) {
    return null;
  }

  const transitions: PlannedTransitionCell[] = [];
  const seenEmptyKeys = new Set<string>();
  for (let index = 0; index < states.length; index += 1) {
    const currentState = states[index];
    const nextState = states[index + 1];
    const outDir = nextState
      ? (() => {
        const dr = nextState.row - currentState.row;
        const dc = nextState.col - currentState.col;
        if (dr === -1 && dc === 0) {
          return Direction.N;
        }
        if (dr === 1 && dc === 0) {
          return Direction.S;
        }
        if (dr === 0 && dc === -1) {
          return Direction.W;
        }
        return Direction.E;
      })()
      : goalOutDir;

    const cellKey = toCellKey(currentState.row, currentState.col);
    if (state.tiles[currentState.row][currentState.col] === null && !reservations.has(cellKey)) {
      if (seenEmptyKeys.has(cellKey)) {
        return null;
      }
      seenEmptyKeys.add(cellKey);
    }

    transitions.push({
      row: currentState.row,
      col: currentState.col,
      inDir: currentState.inDir,
      outDir
    });
  }

  return transitions;
}

function findBestPairPathPlan(
  state: GameState,
  reservations: CellReservationMap,
  groupId: string,
  source: EndpointNode,
  target: EndpointNode,
  endpointByCell: Map<string, EndpointNode>
): PairPathPlan | null {
  const queue: Array<{ key: string; row: number; col: number; inDir: DirectionBit; cost: number }> = [];
  const stateByKey = new Map<string, { row: number; col: number; inDir: DirectionBit }>();
  const parentByKey = new Map<string, string | null>();
  const distByKey = new Map<string, number>();

  const pushQueue = (entry: { key: string; row: number; col: number; inDir: DirectionBit; cost: number }) => {
    queue.push(entry);
    queue.sort((a, b) => (a.cost - b.cost) || a.key.localeCompare(b.key));
  };

  for (const direction of ALL_DIRECTIONS) {
    const delta = directionToDelta(direction);
    const row = source.row + delta.dr;
    const col = source.col + delta.dc;
    if (!isInsideGrid(state.gridHeight, state.gridWidth, { row, col })) {
      continue;
    }

    const neighborEndpoint = endpointByCell.get(toCellKey(row, col));
    if (neighborEndpoint) {
      continue;
    }

    const inDir = oppositeDirection(direction);
    if (!canEnterSearchCell(state, endpointByCell, reservations, groupId, row, col, inDir)) {
      continue;
    }

    const key = toTraverseKey(row, col, inDir);
    const cost = entryCostForSearchCell(state, reservations, row, col);
    const existingCost = distByKey.get(key);
    if (existingCost !== undefined && existingCost <= cost) {
      continue;
    }

    stateByKey.set(key, { row, col, inDir });
    parentByKey.set(key, null);
    distByKey.set(key, cost);
    pushQueue({ key, row, col, inDir, cost });
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const knownCost = distByKey.get(current.key);
    if (knownCost === undefined || knownCost !== current.cost) {
      continue;
    }

    for (const outDir of ALL_DIRECTIONS) {
      if (!canTraverseSearchTransition(
        state,
        reservations,
        groupId,
        current.row,
        current.col,
        current.inDir,
        outDir
      )) {
        continue;
      }

      const delta = directionToDelta(outDir);
      const nextRow = current.row + delta.dr;
      const nextCol = current.col + delta.dc;
      if (!isInsideGrid(state.gridHeight, state.gridWidth, { row: nextRow, col: nextCol })) {
        continue;
      }

      const endpointAtNext = endpointByCell.get(toCellKey(nextRow, nextCol));
      if (endpointAtNext) {
        if (endpointAtNext.id === target.id) {
          const transitions = reconstructPairPathPlan(
            state,
            reservations,
            stateByKey,
            parentByKey,
            current.key,
            outDir
          );
          if (!transitions || transitions.length === 0) {
            return null;
          }

          return {
            sourceId: source.id,
            targetId: target.id,
            addedCost: current.cost,
            transitions
          };
        }
        continue;
      }

      const nextInDir = oppositeDirection(outDir);
      if (!canEnterSearchCell(state, endpointByCell, reservations, groupId, nextRow, nextCol, nextInDir)) {
        continue;
      }

      const nextKey = toTraverseKey(nextRow, nextCol, nextInDir);
      const nextCost = current.cost + entryCostForSearchCell(state, reservations, nextRow, nextCol);
      const previous = distByKey.get(nextKey);
      if (previous !== undefined && previous <= nextCost) {
        continue;
      }

      distByKey.set(nextKey, nextCost);
      stateByKey.set(nextKey, { row: nextRow, col: nextCol, inDir: nextInDir });
      parentByKey.set(nextKey, current.key);
      pushQueue({ key: nextKey, row: nextRow, col: nextCol, inDir: nextInDir, cost: nextCost });
    }
  }

  return null;
}

function applyPairPathToReservations(
  state: GameState,
  reservations: CellReservationMap,
  groupId: string,
  plan: PairPathPlan
): void {
  for (const transition of plan.transitions) {
    if (state.tiles[transition.row][transition.col] !== null) {
      continue;
    }

    const cellKey = toCellKey(transition.row, transition.col);
    const mask = transition.inDir | transition.outDir;
    const reservationsForCell = reservations.get(cellKey) ?? new Map<string, number>();
    reservationsForCell.set(groupId, mask);
    reservations.set(cellKey, reservationsForCell);
  }
}

function planGroupReservations(
  state: GameState,
  reservations: CellReservationMap,
  group: EndpointGroup,
  endpointById: Map<string, EndpointNode>,
  endpointByCell: Map<string, EndpointNode>
): { coveredCount: number; solved: boolean } {
  const endpoints: EndpointNode[] = [];
  for (const nodeId of group.nodeIds) {
    const endpoint = endpointById.get(nodeId);
    if (endpoint) {
      endpoints.push(endpoint);
    }
  }

  if (endpoints.length < 2) {
    return { coveredCount: 0, solved: false };
  }

  const covered = new Set<string>();
  const uncovered = new Set(endpoints.map((endpoint) => endpoint.id));

  for (let step = 0; step < endpoints.length * 2; step += 1) {
    let bestPlan: PairPathPlan | null = null;
    let bestCoverage = -1;

    for (let first = 0; first < endpoints.length; first += 1) {
      for (let second = first + 1; second < endpoints.length; second += 1) {
        const a = endpoints[first];
        const b = endpoints[second];
        const coverageGain = (uncovered.has(a.id) ? 1 : 0) + (uncovered.has(b.id) ? 1 : 0);
        if (coverageGain <= 0) {
          continue;
        }

        const pairPlan = findBestPairPathPlan(state, reservations, group.id, a, b, endpointByCell);
        if (!pairPlan) {
          continue;
        }

        if (
          !bestPlan ||
          coverageGain > bestCoverage ||
          (coverageGain === bestCoverage && pairPlan.addedCost < bestPlan.addedCost) ||
          (coverageGain === bestCoverage &&
            pairPlan.addedCost === bestPlan.addedCost &&
            pairPlan.transitions.length < bestPlan.transitions.length) ||
          (coverageGain === bestCoverage &&
            pairPlan.addedCost === bestPlan.addedCost &&
            pairPlan.transitions.length === bestPlan.transitions.length &&
            `${pairPlan.sourceId}|${pairPlan.targetId}` < `${bestPlan.sourceId}|${bestPlan.targetId}`)
        ) {
          bestPlan = pairPlan;
          bestCoverage = coverageGain;
        }
      }
    }

    if (!bestPlan) {
      break;
    }

    applyPairPathToReservations(state, reservations, group.id, bestPlan);
    covered.add(bestPlan.sourceId);
    covered.add(bestPlan.targetId);
    uncovered.delete(bestPlan.sourceId);
    uncovered.delete(bestPlan.targetId);

    if (uncovered.size === 0) {
      break;
    }
  }

  return {
    coveredCount: covered.size,
    solved: covered.size === endpoints.length
  };
}

function buildGhostPipesFromReservations(
  state: GameState,
  reservations: CellReservationMap
): GhostPipe[] {
  const ghosts: GhostPipe[] = [];

  for (const [cellKey, reservationsForCell] of reservations.entries()) {
    const [rowValue, colValue] = cellKey.split(',');
    const row = Number(rowValue);
    const col = Number(colValue);
    if (!Number.isInteger(row) || !Number.isInteger(col)) {
      continue;
    }
    if (!isInsideGrid(state.gridHeight, state.gridWidth, { row, col })) {
      continue;
    }
    if (state.tiles[row][col] !== null) {
      continue;
    }

    if (reservationsForCell.size === 1) {
      const mask = reservationsForCell.values().next().value as number;
      const selection = chooseGhostPipeForMask(mask, state.pipeSpawnEnabled);
      if (!selection) {
        continue;
      }
      ghosts.push({
        row,
        col,
        kind: selection.kind,
        orientation: selection.orientation
      });
      continue;
    }

    if (reservationsForCell.size === 2 && state.pipeSpawnEnabled.cross) {
      ghosts.push({
        row,
        col,
        kind: 'cross',
        orientation: 0
      });
    }
  }

  ghosts.sort((a, b) =>
    (a.row - b.row) ||
    (a.col - b.col) ||
    a.kind.localeCompare(b.kind) ||
    (a.orientation - b.orientation)
  );

  return ghosts;
}

function computeGhostPlan(state: GameState): GhostPipe[] {
  if (state.endpointGroups.length === 0 || state.endpointNodes.length === 0) {
    return [];
  }

  const endpointById = new Map<string, EndpointNode>();
  const endpointByCell = new Map<string, EndpointNode>();
  for (const endpoint of state.endpointNodes) {
    endpointById.set(endpoint.id, endpoint);
    endpointByCell.set(toCellKey(endpoint.row, endpoint.col), endpoint);
  }

  const candidateGroups = state.endpointGroups.filter((group) => group.nodeIds.length >= 2);
  if (candidateGroups.length === 0) {
    return [];
  }

  const orders: EndpointGroup[][] = [
    candidateGroups,
    [...candidateGroups].reverse()
  ];

  let bestReservations: CellReservationMap | null = null;
  let bestSolvedGroups = -1;
  let bestCoveredEndpoints = -1;
  let bestCellCount = Number.POSITIVE_INFINITY;

  for (const order of orders) {
    const reservations: CellReservationMap = new Map();
    let solvedGroups = 0;
    let coveredEndpoints = 0;

    for (const group of order) {
      const groupPlan = planGroupReservations(state, reservations, group, endpointById, endpointByCell);
      coveredEndpoints += groupPlan.coveredCount;
      if (groupPlan.solved) {
        solvedGroups += 1;
      }
    }

    const cellCount = reservations.size;
    if (
      !bestReservations ||
      solvedGroups > bestSolvedGroups ||
      (solvedGroups === bestSolvedGroups && coveredEndpoints > bestCoveredEndpoints) ||
      (solvedGroups === bestSolvedGroups && coveredEndpoints === bestCoveredEndpoints && cellCount < bestCellCount)
    ) {
      bestReservations = cloneReservations(reservations);
      bestSolvedGroups = solvedGroups;
      bestCoveredEndpoints = coveredEndpoints;
      bestCellCount = cellCount;
    }
  }

  if (!bestReservations) {
    return [];
  }

  return buildGhostPipesFromReservations(state, bestReservations);
}

interface OfferSelectionOptions {
  avoidOffer?: {
    kind: PipeKind;
    orientation: Orientation;
  } | null;
}

function isSameOfferSignature(
  offer: { kind: PipeKind; orientation: Orientation },
  target: { kind: PipeKind; orientation: Orientation } | null | undefined
): boolean {
  if (!target) {
    return false;
  }
  return offer.kind === target.kind && offer.orientation === target.orientation;
}

function buildOfferVariants(pipeSpawnEnabled: PipeSpawnEnabled): Array<{
  kind: PipeKind;
  orientation: Orientation;
}> {
  const enabledKinds = RANDOM_PIPE_ORDER.filter((kind) => pipeSpawnEnabled[kind]);
  const kinds: PipeKind[] = enabledKinds.length > 0 ? enabledKinds : ['straight'];
  const variants: Array<{ kind: PipeKind; orientation: Orientation }> = [];

  for (const kind of kinds) {
    if (kind === 'cross') {
      variants.push({ kind, orientation: 0 });
      continue;
    }

    for (const orientation of OFFER_ORIENTATIONS) {
      variants.push({ kind, orientation });
    }
  }

  return variants;
}

function chooseRandomOffer(
  pipeSpawnEnabled: PipeSpawnEnabled,
  seed: number,
  avoidOffer: OfferSelectionOptions['avoidOffer'] = null
): OfferSpec {
  const variants = buildOfferVariants(pipeSpawnEnabled);
  const filteredVariants = variants.filter((variant) => !isSameOfferSignature(variant, avoidOffer));
  const pool = filteredVariants.length > 0 ? filteredVariants : variants;

  const index = Math.max(
    0,
    Math.min(pool.length - 1, Math.floor(seededRatio(seed, 17) * pool.length))
  );
  const selected = pool[index] ?? { kind: 'straight', orientation: 0 };
  const kind = selected.kind;
  const orientation = selected.orientation;

  return {
    id: `offer-${seed}-${kind}-${orientation}`,
    kind,
    orientation,
    originalOrientation: orientation,
    debugReason: `Random sandbox offer (seed=${seed}; kind=${kind}; orientation=${orientation}).`,
    debugScore: 0
  };
}

function chooseOfferFromGhostPlan(
  state: GameState,
  ghostPipes: GhostPipe[],
  options: OfferSelectionOptions = {}
): {
  offer: OfferSpec;
  source: 'ghost' | 'random';
} {
  const avoidOffer = options.avoidOffer ?? null;

  if (ghostPipes.length > 0) {
    let selectableGhosts = ghostPipes;
    if (avoidOffer) {
      if (ghostPipes.length <= 1) {
        return {
          offer: chooseRandomOffer(state.pipeSpawnEnabled, state.offerSeed, avoidOffer),
          source: 'random'
        };
      }

      const distinctGhosts = ghostPipes.filter((ghost) => !isSameOfferSignature(ghost, avoidOffer));
      if (distinctGhosts.length > 0) {
        selectableGhosts = distinctGhosts;
      } else {
        return {
          offer: chooseRandomOffer(state.pipeSpawnEnabled, state.offerSeed, avoidOffer),
          source: 'random'
        };
      }
    }

    const index = Math.max(
      0,
      Math.min(
        selectableGhosts.length - 1,
        Math.floor(seededRatio(state.offerSeed, 17) * selectableGhosts.length)
      )
    );
    const chosen = selectableGhosts[index];
    return {
      offer: {
        id: `offer-${state.offerSeed}-ghost-${chosen.row}-${chosen.col}-${chosen.kind}-${chosen.orientation}`,
        kind: chosen.kind,
        orientation: chosen.orientation,
        originalOrientation: chosen.orientation,
        debugReason: `Ghost-plan offer from (${chosen.row},${chosen.col}).`,
        debugScore: 100
      },
      source: 'ghost'
    };
  }

  return {
    offer: chooseRandomOffer(state.pipeSpawnEnabled, state.offerSeed, avoidOffer),
    source: 'random'
  };
}

function withResolvedPlanOffer(
  state: GameState,
  context: string,
  options: OfferSelectionOptions = {}
): GameState {
  const ghostPipes = computeGhostPlan(state);
  const { offer, source } = chooseOfferFromGhostPlan(state, ghostPipes, options);
  let next = {
    ...state,
    ghostPipes,
    offers: [offer]
  };

  next = appendGameLog(
    next,
    'offer.generated',
    `${context}: ${offer.kind} (${offer.orientation}°) from ${source === 'ghost' ? 'ghost plan' : 'random fallback'}.`,
    {
      kind: offer.kind,
      orientation: offer.orientation,
      seed: state.offerSeed,
      source,
      ghostCount: ghostPipes.length
    }
  );

  return next;
}

function isInsideGrid(gridHeight: number, gridWidth: number, cell: Cell): boolean {
  return cell.row >= 0 && cell.row < gridHeight && cell.col >= 0 && cell.col < gridWidth;
}

function isEndpointCell(endpointNodes: EndpointNode[], cell: Cell): boolean {
  return endpointNodes.some((node) => node.row === cell.row && node.col === cell.col);
}

function canUseBoosterForOffer(state: GameState, offer: OfferSpec): boolean {
  const needsBooster = offer.kind !== 'cross' && offer.orientation !== offer.originalOrientation;
  if (!needsBooster) {
    return true;
  }
  return state.boosters > 0;
}

function tracePathCellsFromState(
  stateByKey: Map<string, TraverseState>,
  endKey: string
): Cell[] {
  const reversed: Cell[] = [];
  let currentKey: string | null = endKey;

  while (currentKey) {
    const state = stateByKey.get(currentKey);
    if (!state) {
      break;
    }

    reversed.push({
      row: state.row,
      col: state.col
    });
    currentKey = state.parentKey;
  }

  return reversed.reverse();
}

function findEndpointConnections(
  state: GameState,
  source: EndpointNode,
  endpointByCell: Map<string, EndpointNode>
): Map<string, Cell[]> {
  const queue: TraverseState[] = [];
  const visited = new Set<string>();
  const stateByKey = new Map<string, TraverseState>();
  const connectedPaths = new Map<string, Cell[]>();

  for (const direction of ALL_DIRECTIONS) {
    const delta = directionToDelta(direction);
    const nextRow = source.row + delta.dr;
    const nextCol = source.col + delta.dc;
    if (nextRow < 0 || nextRow >= state.gridHeight || nextCol < 0 || nextCol >= state.gridWidth) {
      continue;
    }

    const neighbor = state.tiles[nextRow]?.[nextCol];
    if (!neighbor) {
      continue;
    }

    const incoming = oppositeDirection(direction);
    if (!isDirectionOpen(neighbor.kind, neighbor.orientation, incoming)) {
      continue;
    }

    const key = toTraverseKey(nextRow, nextCol, incoming);
    if (stateByKey.has(key)) {
      continue;
    }

    const startState: TraverseState = {
      row: nextRow,
      col: nextCol,
      inDir: incoming,
      parentKey: null
    };
    stateByKey.set(key, startState);
    queue.push(startState);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentKey = toTraverseKey(current.row, current.col, current.inDir);
    if (visited.has(currentKey)) {
      continue;
    }
    visited.add(currentKey);

    const tile = state.tiles[current.row]?.[current.col];
    if (!tile) {
      continue;
    }

    if (!isDirectionOpen(tile.kind, tile.orientation, current.inDir)) {
      continue;
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
      if (nextRow < 0 || nextRow >= state.gridHeight || nextCol < 0 || nextCol >= state.gridWidth) {
        continue;
      }

      const endpoint = endpointByCell.get(toCellKey(nextRow, nextCol));
      if (endpoint) {
        if (endpoint.groupId === source.groupId && endpoint.id !== source.id) {
          const path = tracePathCellsFromState(stateByKey, currentKey);
          const existing = connectedPaths.get(endpoint.id);
          if (!existing || path.length < existing.length) {
            connectedPaths.set(endpoint.id, path);
          }
        }
        continue;
      }

      const nextTile = state.tiles[nextRow]?.[nextCol];
      if (!nextTile) {
        continue;
      }

      const incoming = oppositeDirection(outDirection);
      if (!isDirectionOpen(nextTile.kind, nextTile.orientation, incoming)) {
        continue;
      }

      const nextKey = toTraverseKey(nextRow, nextCol, incoming);
      if (stateByKey.has(nextKey)) {
        continue;
      }

      const nextState: TraverseState = {
        row: nextRow,
        col: nextCol,
        inDir: incoming,
        parentKey: currentKey
      };
      stateByKey.set(nextKey, nextState);
      queue.push(nextState);
    }
  }

  return connectedPaths;
}

function analyzeCompletedGroup(
  state: GameState,
  group: EndpointGroup,
  endpointById: Map<string, EndpointNode>,
  endpointByCell: Map<string, EndpointNode>
): GroupCompletionAnalysis | null {
  if (group.nodeIds.length < 2) {
    return null;
  }

  const nodes: EndpointNode[] = [];
  for (const nodeId of group.nodeIds) {
    const node = endpointById.get(nodeId);
    if (!node) {
      return null;
    }
    nodes.push(node);
  }

  const connectionsBySource = new Map<string, Map<string, Cell[]>>();
  for (const endpoint of nodes) {
    const connections = findEndpointConnections(state, endpoint, endpointByCell);
    if (connections.size === 0) {
      return null;
    }
    connectionsBySource.set(endpoint.id, connections);
  }

  interface Edge {
    key: string;
    aId: string;
    bId: string;
    path: Cell[];
  }

  const edgeByKey = new Map<string, Edge>();
  for (const [sourceId, targets] of connectionsBySource.entries()) {
    for (const [targetId, path] of targets.entries()) {
      const [aId, bId] = sourceId < targetId
        ? [sourceId, targetId]
        : [targetId, sourceId];
      const key = `${aId}|${bId}`;
      const existing = edgeByKey.get(key);
      if (!existing || path.length < existing.path.length) {
        edgeByKey.set(key, {
          key,
          aId,
          bId,
          path
        });
      }
    }
  }

  const edges = Array.from(edgeByKey.values());
  if (edges.length === 0) {
    return null;
  }

  const uncovered = new Set(nodes.map((node) => node.id));
  const selectedPaths: Cell[][] = [];

  while (uncovered.size > 0) {
    let best: Edge | null = null;
    let bestCoverage = -1;

    for (const edge of edges) {
      const coverage = (uncovered.has(edge.aId) ? 1 : 0) + (uncovered.has(edge.bId) ? 1 : 0);
      if (coverage <= 0) {
        continue;
      }

      if (
        !best ||
        coverage > bestCoverage ||
        (coverage === bestCoverage && edge.path.length < best.path.length) ||
        (coverage === bestCoverage && edge.path.length === best.path.length && edge.key < best.key)
      ) {
        best = edge;
        bestCoverage = coverage;
      }
    }

    if (!best) {
      return null;
    }

    selectedPaths.push(best.path);
    uncovered.delete(best.aId);
    uncovered.delete(best.bId);
  }

  const uniqueCells = new Map<string, Cell>();
  for (const path of selectedPaths) {
    for (const cell of path) {
      uniqueCells.set(toCellKey(cell.row, cell.col), cell);
    }
  }

  return {
    groupId: group.id,
    cellsToClear: Array.from(uniqueCells.values())
  };
}

function collectCompletedGroups(state: GameState): GroupCompletionAnalysis[] {
  const endpointById = new Map<string, EndpointNode>();
  const endpointByCell = new Map<string, EndpointNode>();

  for (const endpoint of state.endpointNodes) {
    endpointById.set(endpoint.id, endpoint);
    endpointByCell.set(toCellKey(endpoint.row, endpoint.col), endpoint);
  }

  const completed: GroupCompletionAnalysis[] = [];
  for (const group of state.endpointGroups) {
    const result = analyzeCompletedGroup(state, group, endpointById, endpointByCell);
    if (result) {
      completed.push(result);
    }
  }

  return completed;
}

function respawnCompletedGroupEndpoints(
  state: GameState,
  completedGroupIds: string[],
  tiles: TileGrid,
  rng: () => number
): EndpointNode[] {
  const enforceThreeByTwoRowSplit = state.gridWidth === 3 && state.gridHeight === 2;
  const completedSet = new Set(completedGroupIds);
  const nodeById = new Map<string, EndpointNode>();
  const occupiedEndpointCells = new Set<string>();

  for (const endpoint of state.endpointNodes) {
    if (completedSet.has(endpoint.groupId)) {
      continue;
    }
    nodeById.set(endpoint.id, endpoint);
    occupiedEndpointCells.add(toCellKey(endpoint.row, endpoint.col));
  }

  for (const group of state.endpointGroups) {
    if (!completedSet.has(group.id)) {
      continue;
    }

    const allCandidates = allGridCells(state.gridHeight, state.gridWidth).filter((cell) =>
      !occupiedEndpointCells.has(toCellKey(cell.row, cell.col))
    );
    const emptyCandidates = allCandidates.filter((cell) => tiles[cell.row][cell.col] === null);
    const preferredCandidates = emptyCandidates.length >= group.nodeIds.length
      ? emptyCandidates
      : allCandidates;
    const previousGroupKeys = new Set(
      group.nodeIds
        .map((nodeId) => state.endpointNodes.find((endpoint) => endpoint.id === nodeId))
        .filter((endpoint): endpoint is EndpointNode => Boolean(endpoint))
        .map((endpoint) => toCellKey(endpoint.row, endpoint.col))
    );
    const preferredWithoutPrevious = preferredCandidates.filter(
      (cell) => !previousGroupKeys.has(toCellKey(cell.row, cell.col))
    );
    const spawnCandidates = preferredWithoutPrevious.length >= group.nodeIds.length
      ? preferredWithoutPrevious
      : preferredCandidates;

    const requiresDifferentRows = enforceThreeByTwoRowSplit && group.nodeIds.length === 2;
    const isSelectionValid = (cells: Cell[]): boolean => (
      cells.length === group.nodeIds.length &&
      (!requiresDifferentRows || cells[0]!.row !== cells[1]!.row)
    );

    const tryPick = (
      candidates: Cell[],
      lockKeys: Set<string>,
      avoidKeys?: Set<string>
    ): Cell[] => {
      const attempts = requiresDifferentRows ? 12 : 1;
      let best: Cell[] = [];
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const picked = pickDistinctCells(
          candidates,
          group.nodeIds.length,
          rng,
          state.gridHeight,
          state.gridWidth,
          lockKeys,
          avoidKeys
        );
        if (isSelectionValid(picked)) {
          return picked;
        }
        if (picked.length > best.length) {
          best = picked;
        }
      }
      return best;
    };

    let selected = tryPick(spawnCandidates, occupiedEndpointCells, previousGroupKeys);
    if (!isSelectionValid(selected) && spawnCandidates !== preferredCandidates) {
      selected = tryPick(preferredCandidates, occupiedEndpointCells, previousGroupKeys);
    }
    if (!isSelectionValid(selected)) {
      selected = tryPick(preferredCandidates, occupiedEndpointCells);
    }
    if (selected.length < group.nodeIds.length) {
      // Defensive fallback: keep previous endpoint positions if respawn cannot allocate.
      for (const nodeId of group.nodeIds) {
        const existing = state.endpointNodes.find((node) => node.id === nodeId);
        if (!existing) {
          continue;
        }
        nodeById.set(nodeId, existing);
        occupiedEndpointCells.add(toCellKey(existing.row, existing.col));
      }
      continue;
    }

    for (let index = 0; index < group.nodeIds.length; index += 1) {
      const nodeId = group.nodeIds[index];
      const cell = selected[index]!;
      occupiedEndpointCells.add(toCellKey(cell.row, cell.col));

      // Endpoints always reserve their cell.
      tiles[cell.row][cell.col] = null;

      nodeById.set(nodeId, {
        id: nodeId,
        row: cell.row,
        col: cell.col,
        groupId: group.id,
        colorId: group.colorId
      });
    }
  }

  const orderedNodes: EndpointNode[] = [];
  for (const group of state.endpointGroups) {
    for (const nodeId of group.nodeIds) {
      const node = nodeById.get(nodeId);
      if (node) {
        orderedNodes.push(node);
      }
    }
  }

  return orderedNodes;
}

function applyCompletedGroups(state: GameState): CompletedGroupResult {
  const completedGroups = collectCompletedGroups(state);
  if (completedGroups.length === 0) {
    return {
      state,
      completedGroupIds: [],
      completedEndpointCount: 0
    };
  }

  const completedGroupIds = completedGroups.map((group) => group.groupId);
  const completedEndpointBursts: CompletedEndpointBurst[] = state.endpointNodes
    .filter((endpoint) => completedGroupIds.includes(endpoint.groupId))
    .map((endpoint) => ({
      id: endpoint.id,
      groupId: endpoint.groupId,
      row: endpoint.row,
      col: endpoint.col,
      colorId: endpoint.colorId
    }));

  const uniqueCells = new Map<string, Cell>();
  for (const group of completedGroups) {
    for (const cell of group.cellsToClear) {
      uniqueCells.set(toCellKey(cell.row, cell.col), cell);
    }
  }

  const completedPipeBursts: CompletedPipeBurst[] = [];
  for (const cell of uniqueCells.values()) {
    const tile = state.tiles[cell.row]?.[cell.col];
    if (!tile) {
      continue;
    }

    completedPipeBursts.push({
      row: cell.row,
      col: cell.col,
      kind: tile.kind,
      orientation: tile.orientation
    });
  }

  const nextTiles = cloneTiles(state.tiles);
  for (const cell of uniqueCells.values()) {
    nextTiles[cell.row][cell.col] = null;
  }

  const respawnRng = createSeededRng(state.offerSeed * 17 + completedGroupIds.length * 97);
  const nextEndpointNodes = respawnCompletedGroupEndpoints(
    state,
    completedGroupIds,
    nextTiles,
    respawnRng
  );

  let next: GameState = {
    ...state,
    tiles: nextTiles,
    endpointNodes: nextEndpointNodes
  };

  next = appendGameLog(
    next,
    'groups.completed',
    `Completed group${completedGroupIds.length > 1 ? 's' : ''}: ${completedGroupIds.join(', ')}.`,
    {
      groupIds: completedGroupIds,
      clearedPipeCount: uniqueCells.size,
      completedEndpoints: completedEndpointBursts,
      completedPipes: completedPipeBursts
    }
  );

  next = appendGameLog(
    next,
    'endpoints.respawned',
    `Respawned endpoints for ${completedGroupIds.length} completed group${completedGroupIds.length > 1 ? 's' : ''}.`,
    {
      groupIds: completedGroupIds
    }
  );

  return {
    state: next,
    completedGroupIds,
    completedEndpointCount: completedEndpointBursts.length
  };
}

function applyPendingUnlockTierAfterCompletion(
  state: GameState,
  completedGroupIds: string[]
): GameState {
  if (completedGroupIds.length === 0) {
    return state;
  }

  const unlockedTierIndex = getUnlockedDifficultyTierIndex(state);
  if (unlockedTierIndex <= state.appliedDifficultyTierIndex) {
    return state;
  }

  const unlockedTier = state.difficultyTiers[unlockedTierIndex] ?? fallbackTier();
  const nextDimensions = constrainGridToTier(
    unlockedTier.maxGridWidth,
    unlockedTier.maxGridHeight,
    unlockedTier
  );
  const endpointScenario = maxScenarioForTier(unlockedTier);
  const tiles = createEmptyTiles(nextDimensions.gridHeight, nextDimensions.gridWidth);
  const rng = createSeededRng(state.offerSeed * 131 + unlockedTierIndex * 977 + completedGroupIds.length * 17);
  const generated = buildEndpointsFromScenario(
    nextDimensions.gridHeight,
    nextDimensions.gridWidth,
    endpointScenario,
    rng,
    tiles
  ) ?? {
    endpointNodes: [
      { id: 'group-1-node-1', row: 0, col: 0, groupId: 'group-1', colorId: 0 },
      {
        id: 'group-1-node-2',
        row: Math.max(0, nextDimensions.gridHeight - 1),
        col: Math.max(0, nextDimensions.gridWidth - 1),
        groupId: 'group-1',
        colorId: 0
      }
    ],
    endpointGroups: [{ id: 'group-1', colorId: 0, nodeIds: ['group-1-node-1', 'group-1-node-2'] }]
  };

  let next: GameState = {
    ...state,
    gridWidth: nextDimensions.gridWidth,
    gridHeight: nextDimensions.gridHeight,
    gridSize: Math.max(nextDimensions.gridWidth, nextDimensions.gridHeight),
    tiles,
    endpointScenario,
    endpointGroups: generated.endpointGroups,
    endpointNodes: generated.endpointNodes,
    hoveredCell: null,
    invalidCell: null,
    ghostPipes: [],
    appliedDifficultyTierIndex: unlockedTierIndex
  };

  next = appendGameLog(
    next,
    'difficulty.applied',
    `Applied unlocked tier ${unlockedTierIndex + 1} for next spawn.`,
    {
      tierIndex: unlockedTierIndex,
      scoreThreshold: unlockedTier.scoreThreshold,
      gridWidth: next.gridWidth,
      gridHeight: next.gridHeight,
      scenario: scenarioToLabel(endpointScenario),
      triggeredByCompletedGroups: completedGroupIds
    }
  );

  return next;
}

export function initGame(options: InitGameOptions = {}): GameState {
  const difficultyTiers = normalizeDifficultyTiers(options.difficultyTiers);
  const score = Math.max(0, Math.round(options.score ?? 0));
  const maxScoreReached = Math.max(
    Math.max(0, Math.round(options.maxScoreReached ?? score)),
    score
  );
  const unlockedTierIndex = resolveUnlockedDifficultyTierIndex(difficultyTiers, maxScoreReached);
  const unlockedTier = difficultyTiers[unlockedTierIndex] ?? fallbackTier();
  const appliedDifficultyTierIndex = Math.max(
    0,
    Math.min(
      unlockedTierIndex,
      Math.round(options.appliedDifficultyTierIndex ?? unlockedTierIndex)
    )
  );

  const baseSize = clampGridSize(options.gridSize ?? DEFAULT_GRID_SIZE);
  const fallbackWidth = options.gridSize === undefined ? unlockedTier.maxGridWidth : baseSize;
  const fallbackHeight = options.gridSize === undefined ? unlockedTier.maxGridHeight : baseSize;
  const normalizedDimensions = normalizeGridDimensions(
    options.gridWidth ?? fallbackWidth,
    options.gridHeight ?? fallbackHeight
  );
  const gridWidth = normalizedDimensions.gridWidth;
  const gridHeight = normalizedDimensions.gridHeight;
  const gridSize = Math.max(gridWidth, gridHeight);
  const endpointScenario = normalizeScenario(options.endpointScenario ?? baseScenarioForTier(unlockedTier));
  const pipeSpawnEnabled = normalizePipeSpawnEnabled(options);
  const energy = options.energy ?? DEFAULT_ENERGY;
  const boosters = options.boosters ?? DEFAULT_BOOSTERS;
  const offerSeed = options.offerSeed ?? 0;
  const rng = options.rng ?? Math.random;

  const tiles = createEmptyTiles(gridHeight, gridWidth);

  const generated = (
    buildEndpointsFromScenario(gridHeight, gridWidth, endpointScenario, rng, tiles) ??
    buildFallbackEndpointsFromScenario(gridHeight, gridWidth, endpointScenario, tiles)
  ) ?? {
    endpointNodes: [
      { id: 'group-1-node-1', row: 0, col: 1, groupId: 'group-1', colorId: 0 },
      {
        id: 'group-1-node-2',
        row: gridHeight - 1,
        col: Math.max(0, gridWidth - 2),
        groupId: 'group-1',
        colorId: 0
      }
    ],
    endpointGroups: [{ id: 'group-1', colorId: 0, nodeIds: ['group-1-node-1', 'group-1-node-2'] }]
  };

  const baseState: GameState = {
    gridSize,
    gridWidth,
    gridHeight,
    tiles,
    endpointNodes: generated.endpointNodes,
    endpointGroups: generated.endpointGroups,
    endpointScenario,
    offers: [],
    ghostPipes: [],
    showGhostPipes: false,
    score,
    maxScoreReached,
    difficultyTiers,
    appliedDifficultyTierIndex,
    energy,
    boosters,
    pipeSpawnEnabled,
    offerSeed,
    hoveredCell: null,
    invalidCell: null,
    logs: [],
    logCursor: 0
  };

  let state = appendGameLog(
    baseState,
    'game.init',
    'Initialized sandbox game state.',
    {
      gridWidth,
      gridHeight,
      scenario: scenarioToLabel(endpointScenario),
      endpointCount: generated.endpointNodes.length,
      unlockedTierIndex,
      appliedDifficultyTierIndex,
      maxScoreReached,
      pipeSpawnEnabled
    }
  );

  state = withResolvedPlanOffer(state, 'Initial offer');

  const gridCapacity = gridWidth * gridHeight;
  if (requiredEndpointCount(endpointScenario) > gridCapacity) {
    state = appendGameLog(
      state,
      'endpoints.capacity.warn',
      'Requested endpoint scenario exceeds grid capacity; fallback endpoints were used.',
      {
        required: requiredEndpointCount(endpointScenario),
        capacity: gridCapacity
      }
    );
  }

  return state;
}

export function setGridSize(state: GameState, gridSize: number): GameState {
  const clamped = clampGridSize(gridSize);
  const next = initGame({
    gridSize: clamped,
    gridWidth: clamped,
    gridHeight: clamped,
    endpointScenario: state.endpointScenario,
    pipeSpawnEnabled: state.pipeSpawnEnabled,
    score: state.score,
    maxScoreReached: state.maxScoreReached,
    difficultyTiers: state.difficultyTiers,
    appliedDifficultyTierIndex: state.appliedDifficultyTierIndex,
    energy: DEFAULT_ENERGY,
    boosters: DEFAULT_BOOSTERS,
    offerSeed: state.offerSeed + 1
  });
  const nextWithPreferences: GameState = {
    ...next,
    showGhostPipes: state.showGhostPipes
  };

  return appendGameLog(
    nextWithPreferences,
    'config.gridSize',
    `Grid size changed to ${next.gridWidth} x ${next.gridHeight}.`,
    {
      previousWidth: state.gridWidth,
      previousHeight: state.gridHeight,
      nextWidth: next.gridWidth,
      nextHeight: next.gridHeight
    }
  );
}

export function setGridDimensions(
  state: GameState,
  gridWidthInput: number,
  gridHeightInput: number
): GameState {
  const unlockedTier = getUnlockedDifficultyTier(state);
  const constrainedDimensions = constrainGridToTier(gridWidthInput, gridHeightInput, unlockedTier);
  const constrainedScenario = constrainScenarioToTier(state.endpointScenario, unlockedTier);

  const dimensionsUnchanged =
    constrainedDimensions.gridWidth === state.gridWidth &&
    constrainedDimensions.gridHeight === state.gridHeight;
  const scenarioUnchanged = scenarioToLabel(constrainedScenario) === scenarioToLabel(state.endpointScenario);

  if (dimensionsUnchanged && scenarioUnchanged) {
    return state;
  }

  const next = initGame({
    gridWidth: constrainedDimensions.gridWidth,
    gridHeight: constrainedDimensions.gridHeight,
    endpointScenario: constrainedScenario,
    pipeSpawnEnabled: state.pipeSpawnEnabled,
    score: state.score,
    maxScoreReached: state.maxScoreReached,
    difficultyTiers: state.difficultyTiers,
    appliedDifficultyTierIndex: state.appliedDifficultyTierIndex,
    energy: DEFAULT_ENERGY,
    boosters: DEFAULT_BOOSTERS,
    offerSeed: state.offerSeed + 1
  });
  const nextWithPreferences: GameState = {
    ...next,
    showGhostPipes: state.showGhostPipes
  };

  return appendGameLog(
    nextWithPreferences,
    'config.gridDimensions',
    `Grid size changed to ${next.gridWidth} x ${next.gridHeight}.`,
    {
      previousWidth: state.gridWidth,
      previousHeight: state.gridHeight,
      nextWidth: next.gridWidth,
      nextHeight: next.gridHeight,
      unlockedMaxWidth: unlockedTier.maxGridWidth,
      unlockedMaxHeight: unlockedTier.maxGridHeight
    }
  );
}

export function setDifficultyTiers(state: GameState, difficultyTiers: DifficultyTier[]): GameState {
  const normalizedTiers = normalizeDifficultyTiers(difficultyTiers);
  const previousUnlockedTierIndex = resolveUnlockedDifficultyTierIndex(
    state.difficultyTiers,
    state.maxScoreReached
  );
  const nextUnlockedTierIndex = resolveUnlockedDifficultyTierIndex(normalizedTiers, state.maxScoreReached);
  const unlockedTier = normalizedTiers[nextUnlockedTierIndex] ?? fallbackTier();
  const shouldSyncUnlockedTierToBoard = state.appliedDifficultyTierIndex === nextUnlockedTierIndex;
  const constrainedDimensions = shouldSyncUnlockedTierToBoard
    ? constrainGridToTier(unlockedTier.maxGridWidth, unlockedTier.maxGridHeight, unlockedTier)
    : constrainGridToTier(state.gridWidth, state.gridHeight, unlockedTier);
  const constrainedScenario = shouldSyncUnlockedTierToBoard
    ? maxScenarioForTier(unlockedTier)
    : constrainScenarioToTier(state.endpointScenario, unlockedTier);
  const tiersChanged = !areDifficultyTiersEqual(state.difficultyTiers, normalizedTiers);
  const dimensionsChanged =
    constrainedDimensions.gridWidth !== state.gridWidth ||
    constrainedDimensions.gridHeight !== state.gridHeight;
  const scenarioChanged = scenarioToLabel(constrainedScenario) !== scenarioToLabel(state.endpointScenario);

  if (!tiersChanged && !dimensionsChanged && !scenarioChanged) {
    return state;
  }

  const next = initGame({
    gridWidth: constrainedDimensions.gridWidth,
    gridHeight: constrainedDimensions.gridHeight,
    endpointScenario: constrainedScenario,
    pipeSpawnEnabled: state.pipeSpawnEnabled,
    score: state.score,
    maxScoreReached: state.maxScoreReached,
    difficultyTiers: normalizedTiers,
    appliedDifficultyTierIndex: Math.min(state.appliedDifficultyTierIndex, nextUnlockedTierIndex),
    energy: DEFAULT_ENERGY,
    boosters: DEFAULT_BOOSTERS,
    offerSeed: state.offerSeed + 1
  });
  const nextWithPreferences: GameState = {
    ...next,
    showGhostPipes: state.showGhostPipes
  };
  const configSummary = summarizeDifficultyTiersForLog(normalizedTiers);

  return appendGameLog(
    nextWithPreferences,
    'config.difficultyTiers',
    `Difficulty ramp updated. Tier ${nextUnlockedTierIndex + 1} is currently unlocked. Config: ${configSummary}`,
    {
      tiers: normalizedTiers,
      configSummary,
      previousUnlockedTierIndex,
      nextUnlockedTierIndex,
      previousScenario: scenarioToLabel(state.endpointScenario),
      nextScenario: scenarioToLabel(next.endpointScenario),
      previousWidth: state.gridWidth,
      previousHeight: state.gridHeight,
      nextWidth: next.gridWidth,
      nextHeight: next.gridHeight
    }
  );
}

export function addGridWidth(state: GameState): GameState {
  if (state.gridWidth >= GRID_SIZE_MAX) {
    return appendGameLog(state, 'config.gridWidth.skipped', 'Cannot increase width: max reached.', {
      max: GRID_SIZE_MAX
    });
  }

  const nextWidth = state.gridWidth + 1;
  const nextTiles = state.tiles.map((row) => [...row, null]);

  let next: GameState = {
    ...state,
    gridWidth: nextWidth,
    gridSize: Math.max(state.gridHeight, nextWidth),
    tiles: nextTiles,
    invalidCell: null
  };
  next = withResolvedPlanOffer(next, 'Offer after grid width increase');

  return appendGameLog(
    next,
    'config.gridWidth',
    `Grid width increased to ${next.gridWidth}.`,
    {
      previousWidth: state.gridWidth,
      nextWidth: next.gridWidth
    }
  );
}

export function addGridHeight(state: GameState): GameState {
  if (state.gridHeight >= GRID_SIZE_MAX) {
    return appendGameLog(state, 'config.gridHeight.skipped', 'Cannot increase height: max reached.', {
      max: GRID_SIZE_MAX
    });
  }

  const nextHeight = state.gridHeight + 1;
  const newTopRow = Array.from({ length: state.gridWidth }, () => null);
  const nextTiles = [newTopRow, ...state.tiles.map((row) => row.slice())];

  let next: GameState = {
    ...state,
    gridHeight: nextHeight,
    gridSize: Math.max(nextHeight, state.gridWidth),
    tiles: nextTiles,
    endpointNodes: state.endpointNodes.map((endpoint) => ({
      ...endpoint,
      row: endpoint.row + 1
    })),
    ghostPipes: state.ghostPipes.map((ghost) => ({
      ...ghost,
      row: ghost.row + 1
    })),
    hoveredCell: state.hoveredCell
      ? {
        row: state.hoveredCell.row + 1,
        col: state.hoveredCell.col
      }
      : null,
    invalidCell: state.invalidCell
      ? {
        row: state.invalidCell.row + 1,
        col: state.invalidCell.col
      }
      : null
  };
  next = withResolvedPlanOffer(next, 'Offer after grid height increase');

  return appendGameLog(
    next,
    'config.gridHeight',
    `Grid height increased to ${next.gridHeight}.`,
    {
      previousHeight: state.gridHeight,
      nextHeight: next.gridHeight
    }
  );
}

export function setEndpointScenario(state: GameState, endpointScenario: EndpointScenario): GameState {
  const unlockedTier = getUnlockedDifficultyTier(state);
  const constrainedScenario = constrainScenarioToTier(normalizeScenario(endpointScenario), unlockedTier);
  const next = initGame({
    gridWidth: state.gridWidth,
    gridHeight: state.gridHeight,
    endpointScenario: constrainedScenario,
    pipeSpawnEnabled: state.pipeSpawnEnabled,
    score: state.score,
    maxScoreReached: state.maxScoreReached,
    difficultyTiers: state.difficultyTiers,
    appliedDifficultyTierIndex: state.appliedDifficultyTierIndex,
    energy: DEFAULT_ENERGY,
    boosters: DEFAULT_BOOSTERS,
    offerSeed: state.offerSeed + 1
  });
  const nextWithPreferences: GameState = {
    ...next,
    showGhostPipes: state.showGhostPipes
  };

  return appendGameLog(
    nextWithPreferences,
    'config.endpointScenario',
    `Endpoint scenario changed to ${scenarioToLabel(next.endpointScenario)}.`,
    {
      requested: scenarioToLabel(endpointScenario),
      previous: scenarioToLabel(state.endpointScenario),
      next: scenarioToLabel(next.endpointScenario)
    }
  );
}

export function setShowGhostPipes(state: GameState, enabled: boolean): GameState {
  if (state.showGhostPipes === enabled) {
    return state;
  }

  return {
    ...state,
    showGhostPipes: enabled
  };
}

export function resetScore(state: GameState): GameState {
  if (state.score === 0) {
    return state;
  }

  return appendGameLog(
    {
      ...state,
      score: 0
    },
    'score.reset',
    'Score reset to 0.',
    {
      previousScore: state.score
    }
  );
}

export function setPipeSpawnEnabled(state: GameState, kind: PipeKind, enabled: boolean): GameState {
  const nextSeed = state.offerSeed + 1;
  let next: GameState = {
    ...state,
    pipeSpawnEnabled: {
      ...state.pipeSpawnEnabled,
      [kind]: enabled
    },
    offerSeed: nextSeed,
    invalidCell: null
  };

  next = withResolvedPlanOffer(next, 'Spawn toggles changed');

  return appendGameLog(
    next,
    'config.pipeSpawnEnabled',
    `${kind} spawn set to ${enabled}.`,
    {
      kind,
      previous: state.pipeSpawnEnabled[kind],
      next: enabled
    }
  );
}

export function setHoveredCell(state: GameState, cell: Cell | null): GameState {
  return {
    ...state,
    hoveredCell: cell
  };
}

export function canPlaceOffer(
  state: GameState,
  offer: OfferSpec | undefined,
  cell: Cell
): { valid: boolean; reason?: string } {
  if (!offer) {
    return { valid: false, reason: 'No offered pipe available.' };
  }

  if (!isInsideGrid(state.gridHeight, state.gridWidth, cell)) {
    return { valid: false, reason: 'Drop target is outside the grid.' };
  }

  if (state.energy <= 0) {
    return { valid: false, reason: 'Not enough energy.' };
  }

  if (isEndpointCell(state.endpointNodes, cell)) {
    return { valid: false, reason: 'Endpoint cells are reserved.' };
  }

  if (state.tiles[cell.row][cell.col] !== null) {
    return { valid: false, reason: 'Cell already occupied.' };
  }

  if (!canUseBoosterForOffer(state, offer)) {
    return { valid: false, reason: 'Rotation requires at least one booster.' };
  }

  return { valid: true };
}

function isPlacementOnGhostTrack(state: GameState, offer: OfferSpec, cell: Cell): boolean {
  return state.ghostPipes.some(
    (ghost) =>
      ghost.row === cell.row &&
      ghost.col === cell.col &&
      ghost.kind === offer.kind &&
      ghost.orientation === offer.orientation
  );
}

function applySuccessfulPlacement(
  state: GameState,
  offerIndex: number,
  cell: Cell
): GameState {
  const offer = state.offers[offerIndex]!;
  const boosterCost = offer.kind !== 'cross' && offer.orientation !== offer.originalOrientation ? 1 : 0;
  const isOnGhostTrack = isPlacementOnGhostTrack(state, offer, cell);
  const isSmallBoard = state.gridWidth <= 3 && state.gridHeight <= 3;
  const nextTiles = cloneTiles(state.tiles);

  const placedPipe: PlacedPipe = {
    kind: offer.kind,
    orientation: offer.orientation,
    originalOrientation: offer.originalOrientation
  };
  nextTiles[cell.row][cell.col] = placedPipe;

  let next: GameState = {
    ...state,
    tiles: nextTiles,
    energy: Math.max(0, state.energy - 1),
    boosters: Math.max(0, state.boosters - boosterCost),
    offerSeed: state.offerSeed + 1,
    invalidCell: null
  };

  next = appendGameLog(
    next,
    'offer.placed',
    `Placed ${offer.kind} at (${cell.row},${cell.col}).`,
    {
      kind: offer.kind,
      orientation: offer.orientation,
      originalOrientation: offer.originalOrientation,
      boosterCost,
      energyAfter: next.energy,
      boostersAfter: next.boosters
    }
  );

  const completion = applyCompletedGroups(next);
  next = completion.state;

  const scoreDeltaForTrack = isOnGhostTrack ? 2 : (isSmallBoard ? 0 : -3);
  const scoreDeltaForRotate = boosterCost > 0 ? (isSmallBoard ? 0 : -4 * boosterCost) : 0;
  const scoreDeltaForCompletions = completion.completedEndpointCount * 3;
  const scoreDeltaForMultiGroup = completion.completedGroupIds.length >= 2 ? 10 : 0;
  const totalScoreDelta =
    scoreDeltaForTrack + scoreDeltaForRotate + scoreDeltaForCompletions + scoreDeltaForMultiGroup;

  next = applyScoreDelta(
    next,
    totalScoreDelta,
    'Placement scoring',
    {
      onGhostTrack: isOnGhostTrack,
      trackDelta: scoreDeltaForTrack,
      rotateDelta: scoreDeltaForRotate,
      completionDelta: scoreDeltaForCompletions,
      multiGroupBonus: scoreDeltaForMultiGroup,
      completedGroups: completion.completedGroupIds,
      completedEndpoints: completion.completedEndpointCount,
      offerKind: offer.kind,
      offerOrientation: offer.orientation,
      row: cell.row,
      col: cell.col
    }
  );

  next = applyPendingUnlockTierAfterCompletion(next, completion.completedGroupIds);

  return withResolvedPlanOffer(next, 'Offer after placement');
}

export function placeOffer(state: GameState, offerIndex: number, cell: Cell): GameState {
  const offer = state.offers[offerIndex];
  const canPlace = canPlaceOffer(state, offer, cell);

  if (!canPlace.valid) {
    return appendGameLog(
      {
        ...state,
        invalidCell: cell
      },
      'offer.place.invalid',
      `Invalid placement at (${cell.row},${cell.col}).`,
      {
        offerIndex,
        reason: canPlace.reason
      }
    );
  }

  return applySuccessfulPlacement(state, offerIndex, cell);
}

export function rotateOffer(state: GameState, offerIndex: number): GameState {
  const offer = state.offers[offerIndex];
  if (!offer) {
    return appendGameLog(state, 'offer.rotate.skipped', `Rotate offer ${offerIndex} skipped: no offer at index.`);
  }
  if (offer.kind !== 'cross' && state.boosters <= 0) {
    return appendGameLog(state, 'offer.rotate.skipped', `Rotate offer ${offerIndex} blocked: no boosters left.`);
  }

  const offers = state.offers.slice();
  offers[offerIndex] = {
    ...offer,
    orientation: offer.kind === 'cross' ? offer.orientation : nextOrientation(offer.orientation)
  };

  return appendGameLog(
    {
      ...state,
      offers,
      invalidCell: null
    },
    'offer.rotate',
    `Rotated offer ${offerIndex} (${offer.kind}) to ${offers[offerIndex].orientation}°.`
  );
}

export function rotateAllOffers(state: GameState): GameState {
  if (state.offers.length === 0) {
    return appendGameLog(state, 'offer.rotateAll.skipped', 'Rotate all skipped: no offers available.');
  }
  const hasBoosterCostRotation = state.offers.some((offer) => offer.kind !== 'cross');
  if (hasBoosterCostRotation && state.boosters <= 0) {
    return appendGameLog(state, 'offer.rotateAll.skipped', 'Rotate all blocked: no boosters left.');
  }

  const offers = state.offers.map((offer) => ({
    ...offer,
    orientation: offer.kind === 'cross' ? offer.orientation : nextOrientation(offer.orientation)
  }));

  return appendGameLog(
    {
      ...state,
      offers,
      invalidCell: null
    },
    'offer.rotateAll',
    `Rotated all ${offers.length} offers by 90°.`,
    {
      boosters: state.boosters
    }
  );
}

export function discardOffer(state: GameState, offerIndex: number): GameState {
  const offer = state.offers[offerIndex];
  if (!offer) {
    return appendGameLog(state, 'offer.discard.skipped', `Discard offer ${offerIndex} skipped: no offer at index.`);
  }
  if (state.energy <= 0) {
    return appendGameLog(state, 'offer.discard.skipped', 'Discard blocked: no energy remaining.');
  }

  const next: GameState = {
    ...state,
    energy: Math.max(0, state.energy - 1),
    offerSeed: state.offerSeed + 1,
    invalidCell: null
  };

  let refreshed = withResolvedPlanOffer(next, 'Offer after discard', {
    avoidOffer: {
      kind: offer.kind,
      orientation: offer.orientation
    }
  });
  refreshed = applyScoreDelta(refreshed, -6, 'Discard penalty', {
    mode: 'single',
    offerIndex
  });

  return appendGameLog(
    refreshed,
    'offer.discard',
    `Discarded offer ${offerIndex} (${offer.kind}).`,
    {
      offerIndex,
      kind: offer.kind,
      energyAfter: refreshed.energy
    }
  );
}

export function discardAllOffers(state: GameState): GameState {
  if (state.offers.length === 0) {
    return appendGameLog(state, 'offer.discardAll.skipped', 'Discard all skipped: no offers available.');
  }
  if (state.energy <= 0) {
    return appendGameLog(state, 'offer.discardAll.skipped', 'Discard all blocked: no energy remaining.');
  }

  const discardedKinds = state.offers.map((offer) => offer.kind);
  const next: GameState = {
    ...state,
    energy: Math.max(0, state.energy - 1),
    offerSeed: state.offerSeed + 1,
    invalidCell: null
  };

  const previousOffer = state.offers[0] ?? null;
  let refreshed = withResolvedPlanOffer(next, 'Offer after discard all', {
    avoidOffer: previousOffer
      ? {
        kind: previousOffer.kind,
        orientation: previousOffer.orientation
      }
      : null
  });
  refreshed = applyScoreDelta(refreshed, -6, 'Discard penalty', {
    mode: 'all',
    discardedCount: state.offers.length
  });

  return appendGameLog(
    refreshed,
    'offer.discardAll',
    `Discarded all ${state.offers.length} offers and regenerated.`,
    {
      discardedKinds,
      energyAfter: refreshed.energy
    }
  );
}

export function parseScenarioFromLabel(input: string): EndpointScenario {
  return normalizeScenario(parseEndpointScenario(input));
}
