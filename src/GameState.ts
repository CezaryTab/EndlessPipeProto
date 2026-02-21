import {
  ALL_DIRECTIONS,
  directionToDelta,
  isDirectionOpen,
  nextOrientation,
  oppositeDirection,
  type Orientation,
  type PipeKind
} from './Pipe';
import {
  allGroupsSolved,
  collectSolvedGroupPaths,
  computeRoutes,
  deriveOffersTacticalFirst,
  deriveRealLaneWeights,
  expandScenarioGroups,
  mergeAndUniquePaths,
  parseEndpointScenario,
  scenarioToLabel,
  type Cell,
  type EndpointGroup,
  type EndpointNode,
  type EndpointScenario,
  type OfferSpec,
  type PipeSpawnEnabled,
  type PlacedPipe,
  type Route,
  type RouteHardnessById,
  type RouteId,
  type TileGrid
} from './RouteSolver';

export const GRID_SIZE_MIN = 3;
export const GRID_SIZE_MAX = 9;
export const DEFAULT_GRID_SIZE = 8;
export const DEFAULT_ROUTE_PREVIEW_DIFFICULTIES: RouteHardnessById = {
  easy: 0,
  medium: 50,
  hard: 100
};
export const DEFAULT_ENDPOINT_SCENARIO: EndpointScenario = [{ size: 2, groups: 1 }];
export const DEFAULT_ENDPOINT_SCENARIO_LABEL = scenarioToLabel(DEFAULT_ENDPOINT_SCENARIO);
export const DEFAULT_PIPE_SPAWN_ENABLED: PipeSpawnEnabled = {
  straight: true,
  elbow: true,
  tee: true,
  cross: true,
  doubleElbow: true
};
export const DEFAULT_ENERGY = 999;
export const DEFAULT_BOOSTERS = 6;
export const DEFAULT_OFFER_DIFFICULTY = 50;

export const ENDPOINT_COLOR_PALETTE = [
  '#ff6d6d',
  '#5ca9ff',
  '#ffd35a',
  '#b98cff',
  '#42d58b',
  '#ffa65c',
  '#69e0ff'
] as const;

export type RouteFallbackChoice = 'resetBoard' | 'respawnEndpoints';

export interface RouteFallbackModal {
  type: 'noRoutes' | 'blockedBoard';
  message: string;
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
  tiles: TileGrid;
  endpointNodes: EndpointNode[];
  endpointGroups: EndpointGroup[];
  endpointScenario: EndpointScenario;
  routes: Route[];
  offers: OfferSpec[];
  energy: number;
  boosters: number;
  pipeSpawnEnabled: PipeSpawnEnabled;
  offerDifficulty: number;
  showRoutePreviews: boolean;
  offerSeed: number;
  hoveredCell: Cell | null;
  invalidCell: Cell | null;
  pendingFlowPath: Cell[] | null;
  pendingFlowColor: string | null;
  modal: RouteFallbackModal | null;
  logs: GameLogEntry[];
  logCursor: number;
}

export interface InitGameOptions {
  gridSize?: number;
  endpointScenario?: EndpointScenario;
  pipeSpawnEnabled?: Partial<PipeSpawnEnabled>;
  offerDifficulty?: number;
  showRoutePreviews?: boolean;
  energy?: number;
  boosters?: number;
  offerSeed?: number;
  rng?: () => number;
}

interface GeneratedEndpoints {
  endpointNodes: EndpointNode[];
  endpointGroups: EndpointGroup[];
}

interface RouteResolution {
  endpointNodes: EndpointNode[];
  endpointGroups: EndpointGroup[];
  routes: Route[];
}

const MAX_LOG_ENTRIES = 600;

function clampGridSize(size: number): number {
  return Math.max(GRID_SIZE_MIN, Math.min(GRID_SIZE_MAX, Math.round(size)));
}

function clampKnob(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function deriveRouteDifficultyWindow(offerDifficulty: number): RouteHardnessById {
  const difficulty = clampKnob(offerDifficulty);
  return {
    easy: clampKnob(difficulty - 25),
    medium: difficulty,
    hard: clampKnob(difficulty + 25)
  };
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
    // Keep a plain-text console trail for external analysis.
    // eslint-disable-next-line no-console
    console.info(`[GameLog:${entry.id}] ${event} - ${message}`, data ?? '');
  }

  return {
    ...state,
    logs: trimmedLogs,
    logCursor: nextId
  };
}

function appendOfferGenerationLogs(state: GameState, offers: OfferSpec[], context: string): GameState {
  let next = state;

  for (const offer of offers) {
    const reasonPreview = offer.debugReason.length > 140
      ? `${offer.debugReason.slice(0, 140)}...`
      : offer.debugReason;
    next = appendGameLog(
      next,
      'offer.generated',
      `${context} | ${offer.routeId.toUpperCase()} ${offer.kind} @ (${offer.targetCell.row},${offer.targetCell.col}) | ${reasonPreview}`,
      {
        groupId: offer.groupId,
        orientation: offer.orientation,
        requiredOrientation: offer.requiredOrientation,
        score: offer.debugScore,
        reason: offer.debugReason
      }
    );
  }

  return next;
}

function cloneTiles(tiles: TileGrid): TileGrid {
  return tiles.map((row) => row.slice());
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
    const size = Math.max(1, Math.min(9, Math.round(term.size)));
    const groups = Math.max(1, Math.min(9, Math.round(term.groups)));
    normalized.push({ size, groups });
  }

  if (normalized.length === 0) {
    return DEFAULT_ENDPOINT_SCENARIO.map((term) => ({ ...term }));
  }

  return normalized;
}

export function createEmptyTiles(gridSize: number): TileGrid {
  return Array.from({ length: gridSize }, () => Array.from({ length: gridSize }, () => null));
}

function randomIndex(length: number, rng: () => number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(length - 1, Math.floor(rng() * length)));
}

function nextColorPool(rng: () => number): number[] {
  const pool = Array.from({ length: ENDPOINT_COLOR_PALETTE.length }, (_, index) => index);
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, rng);
    const temp = pool[index];
    pool[index] = pool[swapIndex];
    pool[swapIndex] = temp;
  }
  return pool;
}

function borderCells(gridSize: number): Cell[] {
  const cells: Cell[] = [];

  for (let col = 0; col < gridSize; col += 1) {
    cells.push({ row: 0, col });
    if (gridSize > 1) {
      cells.push({ row: gridSize - 1, col });
    }
  }

  for (let row = 1; row < gridSize - 1; row += 1) {
    cells.push({ row, col: 0 });
    if (gridSize > 1) {
      cells.push({ row, col: gridSize - 1 });
    }
  }

  return cells;
}

function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

function pickDistinctCells(candidates: Cell[], count: number, rng: () => number): Cell[] {
  const selected: Cell[] = [];

  if (count <= 0 || candidates.length === 0) {
    return selected;
  }

  const remaining = candidates.slice();
  selected.push(remaining.splice(randomIndex(remaining.length, rng), 1)[0]);

  while (selected.length < count && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const minDistance = selected.reduce((min, current) => Math.min(min, manhattan(candidate, current)), Infinity);
      const jitter = rng() * 0.25;
      const score = minDistance + jitter;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  return selected;
}

function requiredEndpointCount(endpointScenario: EndpointScenario): number {
  return expandScenarioGroups(endpointScenario).reduce((sum, size) => sum + size, 0);
}

function countFreeBorderCells(gridSize: number, tiles: TileGrid): number {
  return borderCells(gridSize).filter((cell) => tiles[cell.row]?.[cell.col] === null).length;
}

function hasEndpointOverlap(endpointNodes: EndpointNode[], tiles: TileGrid): boolean {
  return endpointNodes.some((node) => tiles[node.row]?.[node.col] !== null);
}

function buildEndpointsFromScenario(
  gridSize: number,
  endpointScenario: EndpointScenario,
  rng: () => number,
  tiles?: TileGrid,
  preferredCells: Cell[] = []
): GeneratedEndpoints | null {
  const groupSizes = expandScenarioGroups(endpointScenario);
  const requiredEndpoints = requiredEndpointCount(endpointScenario);
  const borderCandidates = borderCells(gridSize).filter((cell) => {
    if (!tiles) {
      return true;
    }
    return tiles[cell.row]?.[cell.col] === null;
  });
  const borderCandidateKeys = new Set(borderCandidates.map((cell) => toCellKey(cell)));
  const preferredKeys = new Set<string>();
  const preferredCandidates = preferredCells.filter((cell) => {
    const key = toCellKey(cell);
    if (!borderCandidateKeys.has(key) || preferredKeys.has(key)) {
      return false;
    }
    preferredKeys.add(key);
    return true;
  });
  const borderCandidateCount = borderCandidates.length;

  if (requiredEndpoints === 0 || requiredEndpoints > borderCandidateCount) {
    return null;
  }

  const preferredSelectionCount = Math.min(requiredEndpoints, preferredCandidates.length);
  const preferredSelection = pickDistinctCells(preferredCandidates, preferredSelectionCount, rng);
  const selectedKeys = new Set(preferredSelection.map((cell) => toCellKey(cell)));
  const remainingCandidates = borderCandidates.filter((cell) => !selectedKeys.has(toCellKey(cell)));
  const remainingSelection = pickDistinctCells(
    remainingCandidates,
    requiredEndpoints - preferredSelection.length,
    rng
  );
  const cells = [...preferredSelection, ...remainingSelection];
  if (cells.length < requiredEndpoints) {
    return null;
  }

  const endpointNodes: EndpointNode[] = [];
  const endpointGroups: EndpointGroup[] = [];
  let colorPool = nextColorPool(rng);

  let cursor = 0;
  for (let groupIndex = 0; groupIndex < groupSizes.length; groupIndex += 1) {
    const size = groupSizes[groupIndex];
    if (colorPool.length === 0) {
      colorPool = nextColorPool(rng);
    }
    const colorId = colorPool.pop() ?? 0;
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

function makeFallbackOffers(
  endpointGroups: EndpointGroup[],
  pipeSpawnEnabled: PipeSpawnEnabled,
  offerDifficulty: number,
  seed: number
): OfferSpec[] {
  const enabledKind = (['straight', 'elbow', 'doubleElbow', 'tee', 'cross'] as PipeKind[]).find(
    (kind) => pipeSpawnEnabled[kind]
  ) ?? 'straight';
  const group = endpointGroups[0] ?? {
    id: 'group-1',
    colorId: 0,
    nodeIds: []
  };

  const realLaneWeights = deriveRealLaneWeights(offerDifficulty);
  const laneOrder: RouteId[] = [(['easy', 'medium', 'hard'] as RouteId[]).reduce(
    (best, routeId) => (realLaneWeights[routeId] > realLaneWeights[best] ? routeId : best),
    'medium'
  )];

  return laneOrder.map((routeId, index) => ({
    id: `${routeId}-fallback-${seed}-${index}`,
    kind: enabledKind,
    orientation: 0,
    originalOrientation: 0,
    requiredOrientation: 0,
    routeId,
    groupId: group.id,
    colorId: group.colorId,
    targetCell: { row: -1, col: -1 },
    debugReason: `Fallback offer used for ${routeId}; solver had no tactical candidate.`,
    debugScore: 0
  }));
}

function withResolvedRoutes(
  state: GameState,
  routes: Route[],
  avoidKindsByRoute: Partial<Record<RouteId, PipeKind>> = {}
): GameState {
  if (hasEndpointOverlap(state.endpointNodes, state.tiles)) {
    return appendGameLog({
      ...state,
      routes: [],
      offers: [],
      modal: {
        type: 'blockedBoard',
        message: 'No moves possible: an endpoint overlaps a placed pipe. Clear the board to continue.'
      }
    }, 'endpoints.overlap', 'Detected endpoint overlap with placed pipe; forcing board reset flow.', {
      endpointCount: state.endpointNodes.length
    });
  }

  if (routes.length === 0) {
    const solved = allGroupsSolved(state.tiles, state.endpointNodes, state.endpointGroups);
    if (solved) {
      const solvedState: GameState = {
        ...state,
        routes: [],
        modal: null
      };
      return appendGameLog(
        solvedState,
        'routes.solved',
        'All endpoint groups are solved; skipped no-route modal while flow/burst resolves.',
        {
          groupCount: state.endpointGroups.length
        }
      );
    }

    const fallbackOffers = makeFallbackOffers(
      state.endpointGroups,
      state.pipeSpawnEnabled,
      state.offerDifficulty,
      state.offerSeed
    );

    let next: GameState = {
      ...state,
      routes: [],
      offers: fallbackOffers,
      modal: {
        type: 'noRoutes',
        message: 'No valid routes available. Choose fallback to continue.'
      }
    };

    next = appendGameLog(
      next,
      'routes.none',
      'No valid routes available; generated fallback offers and opened recovery modal.',
      {
        offerCount: fallbackOffers.length
      }
    );

    return appendOfferGenerationLogs(next, fallbackOffers, 'Fallback');
  }

  const offers = deriveOffersTacticalFirst({
    tiles: state.tiles,
    endpointNodes: state.endpointNodes,
    endpointGroups: state.endpointGroups,
    routes,
    offerDifficulty: state.offerDifficulty,
    pipeSpawnEnabled: state.pipeSpawnEnabled,
    seed: state.offerSeed,
    avoidKindsByRoute
  });

  let next: GameState = {
    ...state,
    routes,
    offers,
    modal: null
  };

  next = appendGameLog(
    next,
    'routes.refreshed',
    `Computed ${routes.length} routes and generated ${offers.length} offers.`,
    {
      routes: routes.map((route) => ({
        id: route.id,
        groupId: route.groupId,
        length: route.length,
        turns: route.turns,
        complexity: route.complexity
      }))
    }
  );

  return appendOfferGenerationLogs(next, offers, 'Routes refreshed');
}

function findSolvableRouteSet(
  tiles: TileGrid,
  gridSize: number,
  endpointScenario: EndpointScenario,
  pipeSpawnEnabled: PipeSpawnEnabled,
  offerDifficulty: number,
  rng: () => number,
  preferredSpawnCells: Cell[] = []
): RouteResolution | null {
  for (let attempt = 0; attempt < 350; attempt += 1) {
    const generated = buildEndpointsFromScenario(gridSize, endpointScenario, rng, tiles, preferredSpawnCells);
    if (!generated) {
      return null;
    }

    const routes = computeRoutes({
      gridSize,
      tiles,
      endpointNodes: generated.endpointNodes,
      endpointGroups: generated.endpointGroups,
      routePreviewDifficulties: deriveRouteDifficultyWindow(offerDifficulty),
      pipeSpawnEnabled,
      offerDifficulty
    });

    if (routes.length > 0) {
      return {
        endpointNodes: generated.endpointNodes,
        endpointGroups: generated.endpointGroups,
        routes
      };
    }
  }

  return null;
}

function isInsideGrid(gridSize: number, cell: Cell): boolean {
  return cell.row >= 0 && cell.row < gridSize && cell.col >= 0 && cell.col < gridSize;
}

function isEndpointCell(endpointNodes: EndpointNode[], cell: Cell): boolean {
  return endpointNodes.some((node) => node.row === cell.row && node.col === cell.col);
}

function isBorderCell(gridSize: number, cell: Cell): boolean {
  return cell.row === 0 || cell.col === 0 || cell.row === gridSize - 1 || cell.col === gridSize - 1;
}

function toCellKey(cell: Cell): string {
  return `${cell.row},${cell.col}`;
}

function endpointMapByCell(endpointNodes: EndpointNode[]): Map<string, EndpointNode> {
  const map = new Map<string, EndpointNode>();
  for (const endpoint of endpointNodes) {
    map.set(toCellKey(endpoint), endpoint);
  }
  return map;
}

function countPotentialConnectionsForPlacedPipe(
  gridSize: number,
  tiles: TileGrid,
  endpointNodes: EndpointNode[],
  pipe: PlacedPipe,
  cell: Cell
): number {
  if (!pipe.groupId) {
    return 0;
  }

  const endpointByCell = endpointMapByCell(endpointNodes);
  let potential = 0;

  for (const direction of ALL_DIRECTIONS) {
    if (!isDirectionOpen(pipe.kind, pipe.orientation, direction)) {
      continue;
    }

    const delta = directionToDelta(direction);
    const neighbor = { row: cell.row + delta.dr, col: cell.col + delta.dc };
    if (!isInsideGrid(gridSize, neighbor)) {
      continue;
    }

    const endpoint = endpointByCell.get(toCellKey(neighbor));
    if (endpoint?.groupId === pipe.groupId) {
      potential += 1;
      continue;
    }

    const neighborTile = tiles[neighbor.row]?.[neighbor.col];
    if (!neighborTile) {
      potential += 1;
      continue;
    }

    if (neighborTile.groupId !== pipe.groupId) {
      continue;
    }

    const incoming = oppositeDirection(direction);
    if (isDirectionOpen(neighborTile.kind, neighborTile.orientation, incoming)) {
      potential += 1;
    }
  }

  return potential;
}

function collectMisplacedBorderSpawnCells(
  state: GameState,
  tiles: TileGrid
): Cell[] {
  const candidates: Cell[] = [];
  for (const cell of borderCells(state.gridSize)) {
    if (isEndpointCell(state.endpointNodes, cell)) {
      continue;
    }

    const tile = tiles[cell.row]?.[cell.col];
    if (!tile || !tile.groupId || !isBorderCell(state.gridSize, cell)) {
      continue;
    }

    const potentialConnections = countPotentialConnectionsForPlacedPipe(
      state.gridSize,
      tiles,
      state.endpointNodes,
      tile,
      cell
    );
    if (potentialConnections < 2) {
      candidates.push(cell);
    }
  }

  return candidates;
}

export function initGame(options: InitGameOptions = {}): GameState {
  const gridSize = clampGridSize(options.gridSize ?? DEFAULT_GRID_SIZE);
  const endpointScenario = normalizeScenario(options.endpointScenario);
  const pipeSpawnEnabled = normalizePipeSpawnEnabled(options);
  const offerDifficulty = clampKnob(options.offerDifficulty ?? DEFAULT_OFFER_DIFFICULTY);
  const showRoutePreviews = options.showRoutePreviews ?? true;
  const energy = options.energy ?? DEFAULT_ENERGY;
  const boosters = options.boosters ?? DEFAULT_BOOSTERS;
  const offerSeed = options.offerSeed ?? 0;
  const rng = options.rng ?? Math.random;

  const tiles = createEmptyTiles(gridSize);
  const resolved = findSolvableRouteSet(
    tiles,
    gridSize,
    endpointScenario,
    pipeSpawnEnabled,
    offerDifficulty,
    rng
  );

  const fallbackEndpoints = buildEndpointsFromScenario(gridSize, endpointScenario, rng) ?? {
    endpointNodes: [
      { id: 'group-1-node-1', row: 0, col: 1, groupId: 'group-1', colorId: 0 },
      { id: 'group-1-node-2', row: gridSize - 1, col: Math.max(0, gridSize - 2), groupId: 'group-1', colorId: 0 }
    ],
    endpointGroups: [{ id: 'group-1', colorId: 0, nodeIds: ['group-1-node-1', 'group-1-node-2'] }]
  };

  const baseState: GameState = {
    gridSize,
    tiles,
    endpointNodes: resolved?.endpointNodes ?? fallbackEndpoints.endpointNodes,
    endpointGroups: resolved?.endpointGroups ?? fallbackEndpoints.endpointGroups,
    endpointScenario,
    routes: resolved?.routes ?? [],
    offers: [],
    energy,
    boosters,
    pipeSpawnEnabled,
    offerDifficulty,
    showRoutePreviews,
    offerSeed,
    hoveredCell: null,
    invalidCell: null,
    pendingFlowPath: null,
    pendingFlowColor: null,
    modal: null,
    logs: [],
    logCursor: 0
  };

  const initialized = appendGameLog(
    baseState,
    'game.init',
    'Initialized game state.',
    {
      gridSize,
      scenario: scenarioToLabel(endpointScenario),
      offerDifficulty,
      pipeSpawnEnabled
    }
  );
  const withRoutes = withResolvedRoutes(initialized, initialized.routes);

  if (resolved) {
    return withRoutes;
  }

  return appendGameLog({
    ...withRoutes,
    modal: {
      type: 'noRoutes',
      message: 'Could not generate solvable endpoints. Try reset or change scenario.'
    }
  }, 'game.init.unsolved', 'Initial endpoint generation did not produce solvable routes.', {
    scenario: scenarioToLabel(endpointScenario),
    gridSize
  });
}

function refreshRoutesInternal(
  state: GameState,
  avoidKindsByRoute: Partial<Record<RouteId, PipeKind>> = {}
): GameState {
  const routes = computeRoutes({
    gridSize: state.gridSize,
    tiles: state.tiles,
    endpointNodes: state.endpointNodes,
    endpointGroups: state.endpointGroups,
    routePreviewDifficulties: deriveRouteDifficultyWindow(state.offerDifficulty),
    pipeSpawnEnabled: state.pipeSpawnEnabled,
    offerDifficulty: state.offerDifficulty
  });

  return withResolvedRoutes(state, routes, avoidKindsByRoute);
}

export function refreshRoutes(state: GameState): GameState {
  return refreshRoutesInternal(state);
}

export function setGridSize(state: GameState, gridSize: number): GameState {
  const next = initGame({
    gridSize,
    endpointScenario: state.endpointScenario,
    pipeSpawnEnabled: state.pipeSpawnEnabled,
    offerDifficulty: state.offerDifficulty,
    showRoutePreviews: state.showRoutePreviews,
    energy: DEFAULT_ENERGY,
    boosters: DEFAULT_BOOSTERS,
    offerSeed: state.offerSeed + 1
  });

  return appendGameLog(next, 'config.gridSize', `Grid size changed to ${next.gridSize}.`, {
    previous: state.gridSize,
    next: next.gridSize
  });
}

export function setEndpointScenario(state: GameState, endpointScenario: EndpointScenario): GameState {
  const next = initGame({
    gridSize: state.gridSize,
    endpointScenario,
    pipeSpawnEnabled: state.pipeSpawnEnabled,
    offerDifficulty: state.offerDifficulty,
    showRoutePreviews: state.showRoutePreviews,
    energy: DEFAULT_ENERGY,
    boosters: DEFAULT_BOOSTERS,
    offerSeed: state.offerSeed + 1
  });

  return appendGameLog(
    next,
    'config.endpointScenario',
    `Endpoint scenario changed to ${scenarioToLabel(next.endpointScenario)}.`,
    {
      previous: scenarioToLabel(state.endpointScenario),
      next: scenarioToLabel(next.endpointScenario)
    }
  );
}

export function setOfferDifficulty(state: GameState, value: number): GameState {
  const nextValue = clampKnob(value);
  const refreshed = refreshRoutesInternal({
    ...state,
    offerDifficulty: nextValue,
    invalidCell: null,
    pendingFlowPath: null,
    pendingFlowColor: null
  });

  return appendGameLog(
    refreshed,
    'config.offerDifficulty',
    `Offer difficulty changed to ${nextValue}.`,
    {
      previous: state.offerDifficulty,
      next: nextValue
    }
  );
}

export function setPipeSpawnEnabled(state: GameState, kind: PipeKind, enabled: boolean): GameState {
  const refreshed = refreshRoutesInternal({
    ...state,
    pipeSpawnEnabled: {
      ...state.pipeSpawnEnabled,
      [kind]: enabled
    },
    invalidCell: null,
    pendingFlowPath: null,
    pendingFlowColor: null
  });

  return appendGameLog(
    refreshed,
    'config.pipeSpawnEnabled',
    `${kind} spawn set to ${enabled}.`,
    {
      kind,
      previous: state.pipeSpawnEnabled[kind],
      next: enabled
    }
  );
}

export function setRoutePreviewEnabled(state: GameState, enabled: boolean): GameState {
  return appendGameLog({
    ...state,
    showRoutePreviews: enabled
  }, 'config.routePreview', `Route preview visibility set to ${enabled}.`);
}

export function setHoveredCell(state: GameState, cell: Cell | null): GameState {
  return {
    ...state,
    hoveredCell: cell
  };
}

function canUseBoosterForOffer(state: GameState, offer: OfferSpec): boolean {
  const needsBooster = offer.orientation !== offer.originalOrientation;
  if (!needsBooster) {
    return true;
  }
  return state.boosters > 0;
}

export function canPlaceOffer(
  state: GameState,
  offer: OfferSpec | undefined,
  cell: Cell
): { valid: boolean; reason?: string } {
  if (!offer) {
    return { valid: false, reason: 'No offered pipe available.' };
  }

  if (!isInsideGrid(state.gridSize, cell)) {
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

export function rotateOffer(state: GameState, offerIndex: number): GameState {
  const offer = state.offers[offerIndex];
  if (!offer) {
    return appendGameLog(state, 'offer.rotate.skipped', `Rotate offer ${offerIndex} skipped: no offer at index.`);
  }
  if (state.boosters <= 0) {
    return appendGameLog(state, 'offer.rotate.skipped', `Rotate offer ${offerIndex} blocked: no boosters left.`);
  }

  const offers = state.offers.slice();
  offers[offerIndex] = {
    ...offer,
    orientation: nextOrientation(offer.orientation)
  };

  return appendGameLog({
    ...state,
    offers,
    invalidCell: null
  }, 'offer.rotate', `Rotated offer ${offerIndex} (${offer.kind}) to ${offers[offerIndex].orientation}°.`);
}

export function rotateAllOffers(state: GameState): GameState {
  if (state.offers.length === 0) {
    return appendGameLog(state, 'offer.rotateAll.skipped', 'Rotate all skipped: no offers available.');
  }
  if (state.boosters <= 0) {
    return appendGameLog(state, 'offer.rotateAll.skipped', 'Rotate all blocked: no boosters left.');
  }

  const offers = state.offers.map((offer) => ({
    ...offer,
    orientation: nextOrientation(offer.orientation)
  }));

  return appendGameLog({
    ...state,
    offers,
    invalidCell: null
  }, 'offer.rotateAll', `Rotated all ${offers.length} offers by 90°.`, {
    boosters: state.boosters
  });
}

function applySolvedState(nextState: GameState): GameState {
  if (!allGroupsSolved(nextState.tiles, nextState.endpointNodes, nextState.endpointGroups)) {
    return nextState;
  }

  const solvedGroups = collectSolvedGroupPaths(nextState.tiles, nextState.endpointNodes, nextState.endpointGroups);
  const mergedPath = mergeAndUniquePaths(solvedGroups.map((group) => group.cells));

  if (mergedPath.length === 0) {
    return nextState;
  }

  const firstSolved = solvedGroups[0];
  const color = ENDPOINT_COLOR_PALETTE[firstSolved.colorId % ENDPOINT_COLOR_PALETTE.length] ?? '#4ed4a8';

  return appendGameLog({
    ...nextState,
    pendingFlowPath: mergedPath,
    pendingFlowColor: color
  }, 'groups.solved', `All groups connected. Queued flow animation for ${mergedPath.length} tiles.`, {
    solvedGroups: solvedGroups.map((group) => group.groupId),
    color
  });
}

function applySuccessfulPlacement(
  state: GameState,
  offerIndex: number,
  cell: Cell
): GameState {
  const offer = state.offers[offerIndex];
  const boosterCost = offer.orientation !== offer.originalOrientation ? 1 : 0;

  const nextTiles = cloneTiles(state.tiles);
  const placedPipe: PlacedPipe = {
    kind: offer.kind,
    orientation: offer.orientation,
    originalOrientation: offer.originalOrientation,
    groupId: offer.groupId
  };
  nextTiles[cell.row][cell.col] = placedPipe;

  let nextState: GameState = {
    ...state,
    tiles: nextTiles,
    energy: Math.max(0, state.energy - 1),
    boosters: Math.max(0, state.boosters - boosterCost),
    offerSeed: state.offerSeed + 1,
    invalidCell: null,
    pendingFlowPath: null,
    pendingFlowColor: null
  };

  nextState = appendGameLog(
    nextState,
    'offer.placed',
    `Placed ${offer.kind} from ${offer.routeId.toUpperCase()} at (${cell.row},${cell.col}).`,
    {
      groupId: offer.groupId,
      orientation: offer.orientation,
      originalOrientation: offer.originalOrientation,
      boosterCost,
      energyAfter: nextState.energy,
      boostersAfter: nextState.boosters
    }
  );

  nextState = refreshRoutesInternal(nextState);
  nextState = applySolvedState(nextState);

  return nextState;
}

export function placeOffer(state: GameState, offerIndex: number, cell: Cell): GameState {
  const offer = state.offers[offerIndex];
  const canPlace = canPlaceOffer(state, offer, cell);

  if (!canPlace.valid) {
    return appendGameLog({
      ...state,
      invalidCell: cell
    }, 'offer.place.invalid', `Invalid placement at (${cell.row},${cell.col}).`, {
      offerIndex,
      reason: canPlace.reason
    });
  }

  return applySuccessfulPlacement(state, offerIndex, cell);
}

export function discardOffer(state: GameState, offerIndex: number): GameState {
  const offer = state.offers[offerIndex];
  if (!offer) {
    return appendGameLog(state, 'offer.discard.skipped', `Discard offer ${offerIndex} skipped: no offer at index.`);
  }
  if (state.energy <= 0) {
    return appendGameLog(state, 'offer.discard.skipped', 'Discard blocked: no energy remaining.');
  }

  const next = {
    ...state,
    energy: Math.max(0, state.energy - 1),
    offerSeed: state.offerSeed + 1,
    invalidCell: null
  };

  const refreshed = refreshRoutesInternal(next, {
    [offer.routeId]: offer.kind
  });

  return appendGameLog(
    refreshed,
    'offer.discard',
    `Discarded offer ${offerIndex} (${offer.kind}) from ${offer.routeId.toUpperCase()}.`,
    {
      offerIndex,
      routeId: offer.routeId,
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

  const avoidKindsByRoute: Partial<Record<RouteId, PipeKind>> = {};
  for (const offer of state.offers) {
    avoidKindsByRoute[offer.routeId] = offer.kind;
  }

  const discardedKinds = state.offers.map((offer) => `${offer.routeId}:${offer.kind}`);
  const next = {
    ...state,
    energy: Math.max(0, state.energy - 1),
    offerSeed: state.offerSeed + 1,
    invalidCell: null
  };

  const refreshed = refreshRoutesInternal(next, avoidKindsByRoute);

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

function regenerateEndpoints(
  state: GameState,
  tiles: TileGrid,
  rng: () => number
): GameState {
  const preferredSpawnCells = collectMisplacedBorderSpawnCells(state, tiles);
  const preparedTiles = cloneTiles(tiles);
  for (const cell of preferredSpawnCells) {
    preparedTiles[cell.row][cell.col] = null;
  }

  const resolved = findSolvableRouteSet(
    preparedTiles,
    state.gridSize,
    state.endpointScenario,
    state.pipeSpawnEnabled,
    state.offerDifficulty,
    rng,
    preferredSpawnCells
  );

  if (!resolved) {
    const blockedBoard = requiredEndpointCount(state.endpointScenario) > countFreeBorderCells(state.gridSize, preparedTiles);
    return appendGameLog({
      ...state,
      tiles: preparedTiles,
      routes: [],
      offers: blockedBoard
        ? []
        : makeFallbackOffers(
            state.endpointGroups,
            state.pipeSpawnEnabled,
            state.offerDifficulty,
            state.offerSeed
          ),
      modal: {
        type: blockedBoard ? 'blockedBoard' : 'noRoutes',
        message: blockedBoard
          ? 'No moves possible: endpoints cannot spawn without overlapping pipes. Clear the board to continue.'
          : 'No solvable routes found. Try resetting board or changing scenario.'
      },
      pendingFlowPath: null,
      pendingFlowColor: null,
      invalidCell: null,
      hoveredCell: null
    }, blockedBoard ? 'endpoints.regenerate.blocked' : 'endpoints.regenerate.failed', blockedBoard
      ? 'Endpoint regeneration blocked by occupied border cells.'
      : 'Endpoint regeneration failed to find solvable routes.', {
      scenario: scenarioToLabel(state.endpointScenario),
      gridSize: state.gridSize,
      requiredEndpoints: requiredEndpointCount(state.endpointScenario),
      freeBorderCells: countFreeBorderCells(state.gridSize, preparedTiles)
    });
  }

  let refreshed = withResolvedRoutes(
    {
      ...state,
      tiles: preparedTiles,
      endpointNodes: resolved.endpointNodes,
      endpointGroups: resolved.endpointGroups,
      routes: resolved.routes,
      pendingFlowPath: null,
      pendingFlowColor: null,
      invalidCell: null,
      hoveredCell: null,
      modal: null
    },
    resolved.routes
  );

  if (preferredSpawnCells.length > 0) {
    const preferredKeys = new Set(preferredSpawnCells.map((cell) => toCellKey(cell)));
    const promotedCount = resolved.endpointNodes.filter((node) => preferredKeys.has(toCellKey(node))).length;
    refreshed = appendGameLog(
      refreshed,
      'endpoints.spawnFromMisplacedPipe',
      `Preferred ${preferredSpawnCells.length} misplaced pipe cells for endpoint respawn; spawned ${promotedCount}.`,
      {
        preferred: preferredSpawnCells.length,
        spawned: promotedCount
      }
    );
  }

  return appendGameLog(
    refreshed,
    'endpoints.regenerate',
    'Endpoints regenerated and solvable routes recomputed.',
    {
      endpointCount: resolved.endpointNodes.length,
      groupCount: resolved.endpointGroups.length,
      routeCount: resolved.routes.length
    }
  );
}

export function applyRouteFallbackChoice(
  state: GameState,
  choice: RouteFallbackChoice,
  rng: () => number = Math.random
): GameState {
  if (choice === 'resetBoard') {
    const next = regenerateEndpoints(
      {
        ...state,
        offerSeed: state.offerSeed + 1
      },
      createEmptyTiles(state.gridSize),
      rng
    );

    return appendGameLog(next, 'fallback.resetBoard', 'Applied fallback action: reset board.');
  }

  const next = regenerateEndpoints(
    {
      ...state,
      offerSeed: state.offerSeed + 1
    },
    cloneTiles(state.tiles),
    rng
  );

  return appendGameLog(next, 'fallback.respawnEndpoints', 'Applied fallback action: respawn endpoints.');
}

export function consumePendingFlow(state: GameState): GameState {
  if (!state.pendingFlowPath) {
    return state;
  }

  return appendGameLog({
    ...state,
    pendingFlowPath: null,
    pendingFlowColor: null
  }, 'animation.flow.start', 'Flow animation started for solved path.', {
    pathLength: state.pendingFlowPath.length
  });
}

export function clearConnectedPathAfterBurst(
  state: GameState,
  path: Cell[],
  rng: () => number = Math.random
): GameState {
  if (path.length === 0) {
    return state;
  }

  const nextTiles = cloneTiles(state.tiles);

  for (const cell of path) {
    if (!isInsideGrid(state.gridSize, cell)) {
      continue;
    }

    if (isEndpointCell(state.endpointNodes, cell)) {
      continue;
    }

    nextTiles[cell.row][cell.col] = null;
  }

  const next = regenerateEndpoints(
    {
      ...state,
      offerSeed: state.offerSeed + 1,
      pendingFlowPath: null,
      pendingFlowColor: null
    },
    nextTiles,
    rng
  );

  return appendGameLog(next, 'animation.burst.cleanup', 'Burst cleanup removed solved path and regenerated endpoints.', {
    clearedTiles: path.length
  });
}

export function setOfferOrientation(
  state: GameState,
  offerIndex: number,
  orientation: Orientation
): GameState {
  const offer = state.offers[offerIndex];
  if (!offer) {
    return appendGameLog(state, 'offer.setOrientation.skipped', `Set orientation skipped: no offer at index ${offerIndex}.`);
  }

  const offers = state.offers.slice();
  offers[offerIndex] = {
    ...offer,
    orientation
  };

  return appendGameLog({
    ...state,
    offers
  }, 'offer.setOrientation', `Offer ${offerIndex} orientation set to ${orientation}°.`);
}

export function parseScenarioFromLabel(input: string): EndpointScenario {
  return normalizeScenario(parseEndpointScenario(input));
}
