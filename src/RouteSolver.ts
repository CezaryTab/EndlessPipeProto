import {
  ALL_DIRECTIONS,
  Direction,
  type DirectionBit,
  type Orientation,
  type PipeKind,
  areEdgesConnected,
  directionToDelta,
  isDirectionOpen,
  oppositeDirection
} from './Pipe';

export interface Cell {
  row: number;
  col: number;
}

export interface EndpointNode {
  id: string;
  row: number;
  col: number;
  groupId: string;
  colorId: number;
}

export interface EndpointGroup {
  id: string;
  colorId: number;
  nodeIds: string[];
}

export interface ScenarioTerm {
  size: number;
  groups: number;
}

export type EndpointScenario = ScenarioTerm[];

export interface PlacedPipe {
  kind: PipeKind;
  orientation: Orientation;
  originalOrientation: Orientation;
  groupId: string | null;
}

export type TileGrid = (PlacedPipe | null)[][];

export type RouteId = 'easy' | 'medium' | 'hard';
export type RouteHardnessById = Record<RouteId, number>;
export type PipeSpawnEnabled = Record<PipeKind, boolean>;

export interface RouteRequirement {
  cell: Cell;
  incoming: DirectionBit;
  outgoing: DirectionBit;
  kind: PipeKind;
  orientation: Orientation;
  groupId: string;
}

export interface Route {
  id: RouteId;
  groupId: string;
  colorId: number;
  fromNodeId: string;
  toNodeId: string;
  cells: Cell[];
  requirements: RouteRequirement[];
  length: number;
  turns: number;
  complexity: number;
}

export interface OfferSpec {
  id: string;
  kind: PipeKind;
  orientation: Orientation;
  originalOrientation: Orientation;
  requiredOrientation: Orientation;
  routeId: RouteId;
  groupId: string;
  colorId: number;
  targetCell: Cell;
  debugReason: string;
  debugScore: number;
}

export interface GroupConnectivityState {
  groupId: string;
  solved: boolean;
  connectedNodeIds: string[];
  componentNodeIds: string[][];
  componentCells: Cell[][];
  largestComponentNodeIds: string[];
  largestComponentCells: Cell[];
}

export interface ComputeRoutesInput {
  gridSize: number;
  tiles: TileGrid;
  endpointNodes: EndpointNode[];
  endpointGroups: EndpointGroup[];
  routePreviewDifficulties?: Partial<RouteHardnessById>;
  pipeSpawnEnabled?: Partial<PipeSpawnEnabled>;
  offerDifficulty?: number;
}

export interface DeriveOffersInput {
  tiles: TileGrid;
  endpointNodes: EndpointNode[];
  endpointGroups: EndpointGroup[];
  routes: Route[];
  offerDifficulty: number;
  pipeSpawnEnabled?: Partial<PipeSpawnEnabled>;
  seed?: number;
  avoidKindsByRoute?: Partial<Record<RouteId, PipeKind>>;
}

export interface DifficultyModel {
  d: number;
  reuseBonusMultiplier: number;
  placedPreferenceWeight: number;
  routeAlignmentWeight: number;
  progressWeight: number;
  complexityPenaltyScale: number;
  secondStepWeight: number;
}

interface EndpointAccess {
  cell: Cell;
  inDir: DirectionBit;
}

interface SearchProfile {
  straightCost: number;
  turnCost: number;
  overlapPenalty: number;
  linePenalty: number;
  placedPipeBonus: number;
}

interface SearchNode {
  row: number;
  col: number;
  inDir: DirectionBit;
  cost: number;
}

interface SearchResult {
  path: Cell[];
  cost: number;
}

interface CandidateRoute {
  groupId: string;
  colorId: number;
  fromNodeId: string;
  toNodeId: string;
  path: Cell[];
  turns: number;
  reusedCells: number;
  cost: number;
}

interface TacticalCandidate {
  groupId: string;
  colorId: number;
  routeId: RouteId;
  cell: Cell;
  kind: PipeKind;
  orientation: Orientation;
  score: number;
  solvesGroup: boolean;
  connectedNeighbors: number;
  progress: number;
  routeAlignment: number;
  reuseBonus: number;
  solveBonus: number;
  endpointGainBonus: number;
  difficultyPenalty: number;
  secondStepPotential: number;
  secondStepOptions: number;
  secondStepBonus: number;
}

interface RequirementCandidate {
  routeId: RouteId;
  route: Route;
  requirement: RouteRequirement;
  stepIndex: number;
  solvesGroup: boolean;
  connectedNeighbors: number;
  complexityScore: number;
}

interface SecondStepOption {
  cell: Cell;
  kind: PipeKind;
  orientation: Orientation;
  connectedNeighbors: number;
}

interface TraverseState {
  row: number;
  col: number;
  inDir: DirectionBit;
}

export const ROUTE_IDS: RouteId[] = ['easy', 'medium', 'hard'];

export const DEFAULT_ROUTE_PREVIEW_DIFFICULTIES: RouteHardnessById = {
  easy: 0,
  medium: 50,
  hard: 100
};

export const DEFAULT_PIPE_SPAWN_ENABLED: PipeSpawnEnabled = {
  straight: true,
  elbow: true,
  tee: true,
  cross: true,
  doubleElbow: true
};

const OFFER_KIND_COMPLEXITY_WEIGHT: Record<PipeKind, number> = {
  straight: 1,
  elbow: 1,
  doubleElbow: 2,
  tee: 3,
  cross: 4
};

const ROUTE_COMPLEXITY_EXTRA_WEIGHT: Record<PipeKind, number> = {
  straight: 0,
  elbow: 0,
  doubleElbow: 1,
  tee: 2,
  cross: 3
};

const ROUTE_PROFILES: Record<RouteId, SearchProfile[]> = {
  easy: [
    {
      straightCost: 0,
      turnCost: 1,
      overlapPenalty: 0,
      linePenalty: 0.45,
      placedPipeBonus: 0.25
    },
    {
      straightCost: 0.05,
      turnCost: 1.35,
      overlapPenalty: 0,
      linePenalty: 0.58,
      placedPipeBonus: 0.28
    }
  ],
  medium: [
    {
      straightCost: 0.1,
      turnCost: 0.45,
      overlapPenalty: 1.5,
      linePenalty: 0.2,
      placedPipeBonus: 0.2
    },
    {
      straightCost: 0.16,
      turnCost: 0.28,
      overlapPenalty: 2,
      linePenalty: 0.14,
      placedPipeBonus: 0.22
    }
  ],
  hard: [
    {
      straightCost: 0.3,
      turnCost: 0.08,
      overlapPenalty: 3.4,
      linePenalty: 0.07,
      placedPipeBonus: 0.15
    },
    {
      straightCost: 0.42,
      turnCost: 0.02,
      overlapPenalty: 4.8,
      linePenalty: 0.02,
      placedPipeBonus: 0.16
    }
  ]
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp100(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function deriveDifficultyModel(offerDifficulty: number): DifficultyModel {
  const difficulty = clamp100(offerDifficulty);
  const d = difficulty / 100;
  const reuseBonusMultiplier = 2.8 - 2 * d;
  const placedPreferenceWeight = 0.4 + (1 - d) * reuseBonusMultiplier;
  const routeAlignmentWeight = 1 + d * 2.2;
  const progressWeight = 1 + d * 0.6;
  const complexityPenaltyScale = 0.8 + 0.8 * d;
  const secondStepWeight = 0.05 + d * 2.4;

  return {
    d,
    reuseBonusMultiplier,
    placedPreferenceWeight,
    routeAlignmentWeight,
    progressWeight,
    complexityPenaltyScale,
    secondStepWeight
  };
}

export function deriveRealLaneWeights(offerDifficulty: number): RouteHardnessById {
  const difficulty = clamp100(offerDifficulty);
  const easyRaw = 0.1 + Math.max(0, (50 - difficulty) / 50);
  const mediumRaw = 0.1 + Math.max(0, 1 - Math.abs(difficulty - 50) / 50);
  const hardRaw = 0.1 + Math.max(0, (difficulty - 50) / 50);
  const total = easyRaw + mediumRaw + hardRaw;
  return {
    easy: easyRaw / total,
    medium: mediumRaw / total,
    hard: hardRaw / total
  };
}

function seededRatio(seed: number, salt: number): number {
  const raw = Math.sin((seed + 1) * 12.9898 + (salt + 1) * 78.233) * 43758.5453;
  return raw - Math.floor(raw);
}

function deterministicRatio(cell: Cell, seed: number, salt: number): number {
  return seededRatio(seed + cell.row * 131 + cell.col * 197, salt);
}

export function cellKey(cell: Cell): string {
  return `${cell.row},${cell.col}`;
}

function isInsideGrid(size: number, cell: Cell): boolean {
  return cell.row >= 0 && cell.row < size && cell.col >= 0 && cell.col < size;
}

function stateKey(row: number, col: number, inDir: DirectionBit): string {
  return `${row},${col},${inDir}`;
}

function parseStateKey(key: string): TraverseState {
  const [rowText, colText, dirText] = key.split(',');
  return {
    row: Number(rowText),
    col: Number(colText),
    inDir: Number(dirText) as DirectionBit
  };
}

function directionBetween(from: Cell, to: Cell): DirectionBit {
  const dr = to.row - from.row;
  const dc = to.col - from.col;

  if (dr === -1 && dc === 0) {
    return Direction.N;
  }
  if (dr === 1 && dc === 0) {
    return Direction.S;
  }
  if (dr === 0 && dc === 1) {
    return Direction.E;
  }
  return Direction.W;
}

function moveCell(cell: Cell, direction: DirectionBit): Cell {
  const delta = directionToDelta(direction);
  return {
    row: cell.row + delta.dr,
    col: cell.col + delta.dc
  };
}

function distanceFromLine(point: Cell, start: Cell, end: Cell): number {
  const x0 = point.col;
  const y0 = point.row;
  const x1 = start.col;
  const y1 = start.row;
  const x2 = end.col;
  const y2 = end.row;

  const numerator = Math.abs(
    (y2 - y1) * x0 -
      (x2 - x1) * y0 +
      x2 * y1 -
      y2 * x1
  );
  const denominator = Math.sqrt((y2 - y1) ** 2 + (x2 - x1) ** 2);
  if (denominator === 0) {
    return 0;
  }
  return numerator / denominator;
}

function pathSignature(path: Cell[]): string {
  return path.map((cell) => `${cell.row}:${cell.col}`).join('|');
}

function uniquePathList(paths: Cell[][]): Cell[][] {
  const seen = new Set<string>();
  const result: Cell[][] = [];

  for (const path of paths) {
    const signature = pathSignature(path);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    result.push(path);
  }

  return result;
}

function nodeMapFromNodes(endpointNodes: EndpointNode[]): Map<string, EndpointNode> {
  const map = new Map<string, EndpointNode>();
  for (const node of endpointNodes) {
    map.set(node.id, node);
  }
  return map;
}

function nodeMapByCell(endpointNodes: EndpointNode[]): Map<string, EndpointNode> {
  const map = new Map<string, EndpointNode>();
  for (const node of endpointNodes) {
    map.set(cellKey(node), node);
  }
  return map;
}

function normalizePipeSpawnEnabled(
  pipeSpawnEnabled: Partial<PipeSpawnEnabled> | undefined
): PipeSpawnEnabled {
  return {
    straight: pipeSpawnEnabled?.straight ?? DEFAULT_PIPE_SPAWN_ENABLED.straight,
    elbow: pipeSpawnEnabled?.elbow ?? DEFAULT_PIPE_SPAWN_ENABLED.elbow,
    tee: pipeSpawnEnabled?.tee ?? DEFAULT_PIPE_SPAWN_ENABLED.tee,
    cross: pipeSpawnEnabled?.cross ?? DEFAULT_PIPE_SPAWN_ENABLED.cross,
    doubleElbow: pipeSpawnEnabled?.doubleElbow ?? DEFAULT_PIPE_SPAWN_ENABLED.doubleElbow
  };
}

function normalizeRouteDifficulties(
  routePreviewDifficulties: Partial<RouteHardnessById> | undefined
): RouteHardnessById {
  return {
    easy: clamp100(routePreviewDifficulties?.easy ?? DEFAULT_ROUTE_PREVIEW_DIFFICULTIES.easy),
    medium: clamp100(routePreviewDifficulties?.medium ?? DEFAULT_ROUTE_PREVIEW_DIFFICULTIES.medium),
    hard: clamp100(routePreviewDifficulties?.hard ?? DEFAULT_ROUTE_PREVIEW_DIFFICULTIES.hard)
  };
}

function endpointAccessCells(node: EndpointNode, gridSize: number): EndpointAccess[] {
  const accesses: EndpointAccess[] = [];
  const nodeCell = { row: node.row, col: node.col };

  for (const direction of ALL_DIRECTIONS) {
    const cell = moveCell(nodeCell, direction);
    if (!isInsideGrid(gridSize, cell)) {
      continue;
    }

    accesses.push({
      cell,
      inDir: oppositeDirection(direction)
    });
  }

  return accesses;
}

function canTraverseTile(tile: PlacedPipe | null, groupId: string, inDir: DirectionBit): boolean {
  if (!tile) {
    return true;
  }
  if (tile.groupId !== groupId) {
    return false;
  }
  return isDirectionOpen(tile.kind, tile.orientation, inDir);
}

function reconstructPath(finalKey: string, previous: Map<string, string | null>): Cell[] {
  const path: Cell[] = [];
  let cursor: string | null = finalKey;

  while (cursor !== null) {
    const parsed = parseStateKey(cursor);
    path.push({ row: parsed.row, col: parsed.col });
    cursor = previous.get(cursor) ?? null;
  }

  path.reverse();
  return path;
}

function computeTurns(path: Cell[]): number {
  if (path.length < 3) {
    return 0;
  }

  let turns = 0;
  for (let index = 1; index < path.length - 1; index += 1) {
    const inDirection = directionBetween(path[index - 1], path[index]);
    const outDirection = directionBetween(path[index], path[index + 1]);
    if (inDirection !== outDirection) {
      turns += 1;
    }
  }

  return turns;
}

function searchPath(
  gridSize: number,
  groupId: string,
  start: Cell,
  end: Cell,
  startIncoming: DirectionBit,
  endOutgoing: DirectionBit,
  tiles: TileGrid,
  blocked: Set<string>,
  avoid: Set<string>,
  profile: SearchProfile
): SearchResult | null {
  const open: SearchNode[] = [{ row: start.row, col: start.col, inDir: startIncoming, cost: 0 }];
  const distances = new Map<string, number>();
  const previous = new Map<string, string | null>();
  const startStateKey = stateKey(start.row, start.col, startIncoming);

  distances.set(startStateKey, 0);
  previous.set(startStateKey, null);

  while (open.length > 0) {
    open.sort((a, b) => {
      if (a.cost !== b.cost) {
        return a.cost - b.cost;
      }
      if (a.row !== b.row) {
        return a.row - b.row;
      }
      if (a.col !== b.col) {
        return a.col - b.col;
      }
      return a.inDir - b.inDir;
    });

    const current = open.shift()!;
    const currentKey = stateKey(current.row, current.col, current.inDir);
    const knownDistance = distances.get(currentKey);
    if (knownDistance === undefined || knownDistance < current.cost - 1e-6) {
      continue;
    }

    if (current.row === end.row && current.col === end.col) {
      const endTile = tiles[end.row]?.[end.col];
      if (
        !endTile ||
        (endTile.groupId === groupId &&
          isDirectionOpen(endTile.kind, endTile.orientation, current.inDir) &&
          isDirectionOpen(endTile.kind, endTile.orientation, endOutgoing) &&
          areEdgesConnected(endTile.kind, endTile.orientation, current.inDir, endOutgoing))
      ) {
        return {
          path: reconstructPath(currentKey, previous),
          cost: current.cost
        };
      }
    }

    const currentCell = { row: current.row, col: current.col };
    const currentTile = tiles[current.row]?.[current.col];

    for (const direction of ALL_DIRECTIONS) {
      if (direction === current.inDir) {
        continue;
      }

      if (
        currentTile &&
        (currentTile.groupId !== groupId ||
          !isDirectionOpen(currentTile.kind, currentTile.orientation, current.inDir) ||
          !isDirectionOpen(currentTile.kind, currentTile.orientation, direction) ||
          !areEdgesConnected(currentTile.kind, currentTile.orientation, current.inDir, direction))
      ) {
        continue;
      }

      const nextCell = moveCell(currentCell, direction);
      if (!isInsideGrid(gridSize, nextCell)) {
        continue;
      }

      const nextKeyCell = cellKey(nextCell);
      if (blocked.has(nextKeyCell) && !(nextCell.row === end.row && nextCell.col === end.col)) {
        continue;
      }

      const nextTile = tiles[nextCell.row]?.[nextCell.col];
      const nextIncoming = oppositeDirection(direction);

      if (!canTraverseTile(nextTile, groupId, nextIncoming)) {
        continue;
      }

      let stepCost = 1;
      const previousTravelDirection = oppositeDirection(current.inDir);
      stepCost += previousTravelDirection === direction ? profile.straightCost : profile.turnCost;
      if (avoid.has(nextKeyCell)) {
        stepCost += profile.overlapPenalty;
      }
      stepCost += profile.linePenalty * distanceFromLine(nextCell, start, end);
      if (nextTile && nextTile.groupId === groupId) {
        stepCost -= profile.placedPipeBonus;
      }
      stepCost = Math.max(0.05, stepCost);

      const nextCost = current.cost + stepCost;
      const nextStateKey = stateKey(nextCell.row, nextCell.col, nextIncoming);
      const prior = distances.get(nextStateKey);

      if (prior === undefined || nextCost < prior - 1e-6) {
        distances.set(nextStateKey, nextCost);
        previous.set(nextStateKey, currentKey);
        open.push({
          row: nextCell.row,
          col: nextCell.col,
          inDir: nextIncoming,
          cost: nextCost
        });
      }
    }
  }

  return null;
}

function searchBestPathBetweenNodes(
  gridSize: number,
  tiles: TileGrid,
  endpointNodes: Map<string, EndpointNode>,
  groupId: string,
  fromNodeId: string,
  toNodeId: string,
  blocked: Set<string>,
  avoid: Set<string>,
  profile: SearchProfile
): SearchResult | null {
  const fromNode = endpointNodes.get(fromNodeId);
  const toNode = endpointNodes.get(toNodeId);

  if (!fromNode || !toNode) {
    return null;
  }

  const startAccesses = endpointAccessCells(fromNode, gridSize);
  const endAccesses = endpointAccessCells(toNode, gridSize);
  const endCell = { row: toNode.row, col: toNode.col };

  let best: SearchResult | null = null;

  for (const startAccess of startAccesses) {
    const startCellKey = cellKey(startAccess.cell);
    if (blocked.has(startCellKey)) {
      continue;
    }

    const startTile = tiles[startAccess.cell.row]?.[startAccess.cell.col];
    if (
      startTile &&
      (startTile.groupId !== groupId ||
        !isDirectionOpen(startTile.kind, startTile.orientation, startAccess.inDir))
    ) {
      continue;
    }

    for (const endAccess of endAccesses) {
      const endCellKey = cellKey(endAccess.cell);
      if (blocked.has(endCellKey)) {
        continue;
      }

      const endOutgoing = directionBetween(endAccess.cell, endCell);
      const result = searchPath(
        gridSize,
        groupId,
        startAccess.cell,
        endAccess.cell,
        startAccess.inDir,
        endOutgoing,
        tiles,
        blocked,
        avoid,
        profile
      );

      if (!result) {
        continue;
      }

      if (
        !best ||
        result.cost < best.cost - 1e-6 ||
        (Math.abs(result.cost - best.cost) <= 1e-6 && result.path.length < best.path.length)
      ) {
        best = result;
      }
    }
  }

  return best;
}

function candidatePieces(
  incoming: DirectionBit,
  outgoing: DirectionBit,
  kinds: PipeKind[]
): Array<{ kind: PipeKind; orientation: Orientation }> {
  const candidates: Array<{ kind: PipeKind; orientation: Orientation }> = [];
  const orientations: Orientation[] = [0, 90, 180, 270];

  for (const kind of kinds) {
    for (const orientation of orientations) {
      if (
        isDirectionOpen(kind, orientation, incoming) &&
        isDirectionOpen(kind, orientation, outgoing) &&
        areEdgesConnected(kind, orientation, incoming, outgoing)
      ) {
        candidates.push({ kind, orientation });
      }
    }
  }

  return candidates;
}

function chooseRequirementPiece(
  incoming: DirectionBit,
  outgoing: DirectionBit,
  routeId: RouteId,
  routeDifficulty: number,
  pipeSpawnEnabled: PipeSpawnEnabled,
  cell: Cell,
  index: number
): { kind: PipeKind; orientation: Orientation } {
  const minimalKind: PipeKind = oppositeDirection(incoming) === outgoing ? 'straight' : 'elbow';
  const allKinds: PipeKind[] = ['straight', 'elbow', 'doubleElbow', 'tee', 'cross'];
  const enabledKinds = allKinds.filter((kind) => pipeSpawnEnabled[kind]);

  if (enabledKinds.length === 0) {
    return { kind: 'straight', orientation: 0 };
  }

  const minimal = pipeSpawnEnabled[minimalKind]
    ? candidatePieces(incoming, outgoing, [minimalKind])[0]
    : undefined;

  if (!minimal) {
    const fallback = candidatePieces(incoming, outgoing, enabledKinds)[0];
    if (fallback) {
      return fallback;
    }
    return { kind: enabledKinds[0], orientation: 0 };
  }

  const hardnessRatio = clamp01(routeDifficulty / 100);
  const complexRoll = deterministicRatio(cell, routeDifficulty + index * 17, 13);

  if (routeId === 'easy') {
    return minimal;
  }

  const doubleChance = 0.04 + hardnessRatio * 0.22;
  const teeChance = 0.004 + hardnessRatio * 0.03;
  const crossChance = 0.002 + hardnessRatio * 0.015;

  const preferences: PipeKind[] = [];
  if (pipeSpawnEnabled.doubleElbow && complexRoll < doubleChance) {
    preferences.push('doubleElbow');
  }

  const teeRoll = deterministicRatio(cell, routeDifficulty + index * 23, 41);
  if (pipeSpawnEnabled.tee && teeRoll < teeChance) {
    preferences.push('tee');
  }

  const crossRoll = deterministicRatio(cell, routeDifficulty + index * 29, 59);
  if (pipeSpawnEnabled.cross && crossRoll < crossChance) {
    preferences.push('cross');
  }

  for (const preferred of preferences) {
    if (preferred === minimalKind) {
      continue;
    }
    const candidate = candidatePieces(incoming, outgoing, [preferred])[0];
    if (candidate) {
      return candidate;
    }
  }

  return minimal;
}

function buildRouteRequirements(
  routeId: RouteId,
  path: Cell[],
  fromNode: EndpointNode,
  toNode: EndpointNode,
  routeDifficulty: number,
  pipeSpawnEnabled: PipeSpawnEnabled,
  tiles: TileGrid,
  groupId: string
): RouteRequirement[] | null {
  const requirements: RouteRequirement[] = [];
  const fromNodeCell = { row: fromNode.row, col: fromNode.col };
  const toNodeCell = { row: toNode.row, col: toNode.col };

  for (let index = 0; index < path.length; index += 1) {
    const cell = path[index];

    const incoming = index === 0
      ? oppositeDirection(directionBetween(fromNodeCell, cell))
      : oppositeDirection(directionBetween(path[index - 1], cell));

    const outgoing = index === path.length - 1
      ? directionBetween(cell, toNodeCell)
      : directionBetween(cell, path[index + 1]);

    const existing = tiles[cell.row]?.[cell.col];

    const piece = existing && existing.groupId === groupId
      ? {
          kind: existing.kind,
          orientation: existing.orientation
        }
      : chooseRequirementPiece(
          incoming,
          outgoing,
          routeId,
          routeDifficulty,
          pipeSpawnEnabled,
          cell,
          index
        );

    if (
      !isDirectionOpen(piece.kind, piece.orientation, incoming) ||
      !isDirectionOpen(piece.kind, piece.orientation, outgoing) ||
      !areEdgesConnected(piece.kind, piece.orientation, incoming, outgoing)
    ) {
      return null;
    }

    requirements.push({
      cell,
      incoming,
      outgoing,
      kind: piece.kind,
      orientation: piece.orientation,
      groupId
    });
  }

  return requirements;
}

function complexityForRequirements(requirements: RouteRequirement[]): number {
  const base = requirements.length;
  const extras = requirements.reduce((total, item) => total + ROUTE_COMPLEXITY_EXTRA_WEIGHT[item.kind], 0);
  return base + extras;
}

function laneBonusTurns(hardness: number): number {
  return Math.round((clamp100(hardness) / 100) * 14);
}

function mapNodeToComponent(components: string[][]): Map<string, number> {
  const map = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    component.forEach((nodeId) => map.set(nodeId, componentIndex));
  });
  return map;
}

function buildDisconnectedPairs(group: EndpointGroup, components: string[][]): Array<[string, string]> {
  const nodeToComponent = mapNodeToComponent(components);
  const pairs: Array<[string, string]> = [];

  for (let i = 0; i < group.nodeIds.length; i += 1) {
    for (let j = i + 1; j < group.nodeIds.length; j += 1) {
      const a = group.nodeIds[i];
      const b = group.nodeIds[j];
      if (nodeToComponent.get(a) === nodeToComponent.get(b)) {
        continue;
      }
      pairs.push([a, b]);
    }
  }

  return pairs;
}

function countReusedCells(path: Cell[], tiles: TileGrid, groupId: string): number {
  let reused = 0;
  for (const cell of path) {
    const tile = tiles[cell.row]?.[cell.col];
    if (tile && tile.groupId === groupId) {
      reused += 1;
    }
  }
  return reused;
}

function selectEasyCandidate(candidates: CandidateRoute[]): CandidateRoute | null {
  if (candidates.length === 0) {
    return null;
  }

  const unique = new Map<string, CandidateRoute>();
  for (const candidate of candidates) {
    const signature = `${candidate.groupId}:${candidate.fromNodeId}:${candidate.toNodeId}:${pathSignature(candidate.path)}`;
    if (!unique.has(signature)) {
      unique.set(signature, candidate);
    }
  }

  return [...unique.values()].sort((a, b) => {
    if (a.reusedCells !== b.reusedCells) {
      return b.reusedCells - a.reusedCells;
    }
    if (a.turns !== b.turns) {
      return a.turns - b.turns;
    }
    if (a.path.length !== b.path.length) {
      return a.path.length - b.path.length;
    }
    return a.cost - b.cost;
  })[0] ?? null;
}

function selectTargetTurnsCandidate(
  candidates: CandidateRoute[],
  targetTurns: number,
  targetNewCells: number,
  preferHighest = false
): CandidateRoute | null {
  if (candidates.length === 0) {
    return null;
  }

  const unique = new Map<string, CandidateRoute>();
  for (const candidate of candidates) {
    const signature = `${candidate.groupId}:${candidate.fromNodeId}:${candidate.toNodeId}:${pathSignature(candidate.path)}`;
    if (!unique.has(signature)) {
      unique.set(signature, candidate);
    }
  }

  const values = [...unique.values()];
  const maxReuse = values.reduce((max, candidate) => Math.max(max, candidate.reusedCells), 0);
  const reuseFloor = maxReuse;
  const pool = values.filter((candidate) => candidate.reusedCells >= reuseFloor);

  pool.sort((a, b) => {
    if (a.reusedCells !== b.reusedCells) {
      return b.reusedCells - a.reusedCells;
    }

    const newCellsA = a.path.length - a.reusedCells;
    const newCellsB = b.path.length - b.reusedCells;

    if (preferHighest) {
      if (a.turns !== b.turns) {
        return b.turns - a.turns;
      }
      if (newCellsA !== newCellsB) {
        return newCellsB - newCellsA;
      }
    }

    const distanceA = Math.abs(a.turns - targetTurns) * 1.1 + Math.abs(newCellsA - targetNewCells);
    const distanceB = Math.abs(b.turns - targetTurns) * 1.1 + Math.abs(newCellsB - targetNewCells);
    if (distanceA !== distanceB) {
      return distanceA - distanceB;
    }
    if (!preferHighest) {
      if (newCellsA !== newCellsB) {
        return newCellsA - newCellsB;
      }
      if (a.turns !== b.turns) {
        return a.turns - b.turns;
      }
    }

    if (a.path.length !== b.path.length) {
      return preferHighest
        ? b.path.length - a.path.length
        : a.path.length - b.path.length;
    }
    return a.cost - b.cost;
  });

  return pool[0] ?? null;
}

function collectRouteCandidates(
  routeId: RouteId,
  routeDifficulty: number,
  gridSize: number,
  tiles: TileGrid,
  endpointNodes: Map<string, EndpointNode>,
  endpointGroups: EndpointGroup[],
  connectivity: Map<string, GroupConnectivityState>,
  blocked: Set<string>,
  difficultyModel: DifficultyModel,
  avoidSet: Set<string>
): CandidateRoute[] {
  const reusePathMultiplier = 0.75 + (1 - difficultyModel.d) * 3.5;
  const profiles = ROUTE_PROFILES[routeId].map((profile) => ({
    ...profile,
    placedPipeBonus: profile.placedPipeBonus * difficultyModel.reuseBonusMultiplier * reusePathMultiplier
  }));

  const candidates: CandidateRoute[] = [];

  for (const group of endpointGroups) {
    const connectivityState = connectivity.get(group.id);
    if (!connectivityState || connectivityState.solved) {
      continue;
    }

    const pairs = buildDisconnectedPairs(group, connectivityState.componentNodeIds);
    if (pairs.length === 0) {
      continue;
    }

    for (const [fromNodeId, toNodeId] of pairs) {
      for (const profile of profiles) {
        const result = searchBestPathBetweenNodes(
          gridSize,
          tiles,
          endpointNodes,
          group.id,
          fromNodeId,
          toNodeId,
          blocked,
          avoidSet,
          profile
        );

        if (!result || result.path.length === 0) {
          continue;
        }

        candidates.push({
          groupId: group.id,
          colorId: group.colorId,
          fromNodeId,
          toNodeId,
          path: result.path,
          turns: computeTurns(result.path),
          reusedCells: countReusedCells(result.path, tiles, group.id),
          cost: result.cost
        });
      }
    }
  }

  if (routeId === 'easy') {
    return candidates;
  }

  const bonusTurns = laneBonusTurns(routeDifficulty);
  const extraCandidates: CandidateRoute[] = [];

  for (const candidate of candidates) {
    if (candidate.turns >= bonusTurns) {
      extraCandidates.push(candidate);
    }
  }

  return candidates.concat(extraCandidates);
}

export function getGroupConnectivityState(
  tiles: TileGrid,
  endpointNodes: EndpointNode[],
  group: EndpointGroup
): GroupConnectivityState {
  const gridSize = tiles.length;
  const nodeById = nodeMapFromNodes(endpointNodes);
  const groupNodes = group.nodeIds
    .map((nodeId) => nodeById.get(nodeId))
    .filter((node): node is EndpointNode => Boolean(node));
  const groupNodeByCell = new Map<string, EndpointNode>();
  for (const node of groupNodes) {
    groupNodeByCell.set(cellKey(node), node);
  }

  function traverseFromNode(startNode: EndpointNode): { reachedNodeIds: Set<string>; visitedCells: Set<string> } {
    const queue: TraverseState[] = [];
    const visited = new Set<string>();
    const reachedNodeIds = new Set<string>([startNode.id]);
    const visitedCells = new Set<string>();

    for (const access of endpointAccessCells(startNode, gridSize)) {
      const tile = tiles[access.cell.row]?.[access.cell.col];
      if (!tile || tile.groupId !== group.id) {
        continue;
      }
      if (!isDirectionOpen(tile.kind, tile.orientation, access.inDir)) {
        continue;
      }
      queue.push({ row: access.cell.row, col: access.cell.col, inDir: access.inDir });
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentStateKey = stateKey(current.row, current.col, current.inDir);
      if (visited.has(currentStateKey)) {
        continue;
      }
      visited.add(currentStateKey);
      visitedCells.add(cellKey({ row: current.row, col: current.col }));

      const pipe = tiles[current.row]?.[current.col];
      if (!pipe || pipe.groupId !== group.id) {
        continue;
      }

      for (const outDirection of ALL_DIRECTIONS) {
        if (outDirection === current.inDir) {
          continue;
        }

        if (!isDirectionOpen(pipe.kind, pipe.orientation, outDirection)) {
          continue;
        }

        if (!areEdgesConnected(pipe.kind, pipe.orientation, current.inDir, outDirection)) {
          continue;
        }

        const neighbor = moveCell({ row: current.row, col: current.col }, outDirection);
        if (!isInsideGrid(gridSize, neighbor)) {
          continue;
        }

        const nodeAtNeighbor = groupNodeByCell.get(cellKey(neighbor));
        if (nodeAtNeighbor) {
          reachedNodeIds.add(nodeAtNeighbor.id);
          continue;
        }

        const neighborPipe = tiles[neighbor.row]?.[neighbor.col];
        if (!neighborPipe || neighborPipe.groupId !== group.id) {
          continue;
        }

        const nextInDir = oppositeDirection(outDirection);
        if (!isDirectionOpen(neighborPipe.kind, neighborPipe.orientation, nextInDir)) {
          continue;
        }

        queue.push({
          row: neighbor.row,
          col: neighbor.col,
          inDir: nextInDir
        });
      }
    }

    return {
      reachedNodeIds,
      visitedCells
    };
  }

  const unvisited = new Set(groupNodes.map((node) => node.id));
  const componentNodeIds: string[][] = [];
  const componentCells: Cell[][] = [];

  while (unvisited.size > 0) {
    const firstId = unvisited.values().next().value as string;
    const firstNode = nodeById.get(firstId);
    if (!firstNode) {
      unvisited.delete(firstId);
      continue;
    }

    const traversed = traverseFromNode(firstNode);
    const component = [...traversed.reachedNodeIds].filter((nodeId) => unvisited.has(nodeId));

    if (component.length === 0) {
      component.push(firstNode.id);
    }

    component.forEach((nodeId) => unvisited.delete(nodeId));

    componentNodeIds.push(component);
    componentCells.push(
      [...traversed.visitedCells].map((key) => {
        const [rowText, colText] = key.split(',');
        return { row: Number(rowText), col: Number(colText) };
      })
    );
  }

  if (componentNodeIds.length === 0) {
    componentNodeIds.push([]);
    componentCells.push([]);
  }

  let largestIndex = 0;
  for (let index = 1; index < componentNodeIds.length; index += 1) {
    const currentSize = componentNodeIds[index].length;
    const largestSize = componentNodeIds[largestIndex].length;
    if (currentSize > largestSize) {
      largestIndex = index;
    }
  }

  const largestComponentNodeIds = componentNodeIds[largestIndex] ?? [];
  const largestComponentCells = componentCells[largestIndex] ?? [];

  return {
    groupId: group.id,
    solved: largestComponentNodeIds.length === group.nodeIds.length && group.nodeIds.length > 0,
    connectedNodeIds: largestComponentNodeIds,
    componentNodeIds,
    componentCells,
    largestComponentNodeIds,
    largestComponentCells
  };
}

export function isGroupSolved(
  tiles: TileGrid,
  endpointNodes: EndpointNode[],
  group: EndpointGroup
): boolean {
  return getGroupConnectivityState(tiles, endpointNodes, group).solved;
}

export function findConnectedPathForGroup(
  tiles: TileGrid,
  endpointNodes: EndpointNode[],
  group: EndpointGroup
): Cell[] {
  const state = getGroupConnectivityState(tiles, endpointNodes, group);
  if (!state.solved) {
    return [];
  }
  return state.largestComponentCells;
}

function buildBlockedEndpointSet(endpointNodes: EndpointNode[]): Set<string> {
  const blocked = new Set<string>();
  endpointNodes.forEach((node) => blocked.add(cellKey(node)));
  return blocked;
}

export function computeRoutes(input: ComputeRoutesInput): Route[] {
  const {
    gridSize,
    tiles,
    endpointNodes,
    endpointGroups,
    routePreviewDifficulties,
    pipeSpawnEnabled,
    offerDifficulty = DEFAULT_ROUTE_PREVIEW_DIFFICULTIES.medium
  } = input;

  const difficulties = normalizeRouteDifficulties(routePreviewDifficulties);
  const spawnEnabled = normalizePipeSpawnEnabled(pipeSpawnEnabled);
  const difficultyModel = deriveDifficultyModel(offerDifficulty);
  const nodeById = nodeMapFromNodes(endpointNodes);
  const blocked = buildBlockedEndpointSet(endpointNodes);

  const connectivity = new Map<string, GroupConnectivityState>();
  endpointGroups.forEach((group) => {
    connectivity.set(group.id, getGroupConnectivityState(tiles, endpointNodes, group));
  });

  const easyCandidates = collectRouteCandidates(
    'easy',
    difficulties.easy,
    gridSize,
    tiles,
    nodeById,
    endpointGroups,
    connectivity,
    blocked,
    difficultyModel,
    new Set<string>()
  );

  const easySelection = selectEasyCandidate(easyCandidates);
  if (!easySelection) {
    return [];
  }

  const easySet = new Set<string>();
  for (const cell of easySelection.path) {
    const tile = tiles[cell.row]?.[cell.col];
    const isReusedSameGroup = Boolean(tile && tile.groupId === easySelection.groupId);
    if (!isReusedSameGroup) {
      easySet.add(cellKey(cell));
    }
  }
  if (easySelection.path.length > 0) {
    easySet.delete(cellKey(easySelection.path[0]));
    easySet.delete(cellKey(easySelection.path[easySelection.path.length - 1]));
  }

  const mediumCandidates = collectRouteCandidates(
    'medium',
    difficulties.medium,
    gridSize,
    tiles,
    nodeById,
    endpointGroups,
    connectivity,
    blocked,
    difficultyModel,
    easySet
  );

  const hardCandidates = collectRouteCandidates(
    'hard',
    difficulties.hard,
    gridSize,
    tiles,
    nodeById,
    endpointGroups,
    connectivity,
    blocked,
    difficultyModel,
    easySet
  );

  const baseTurns = easySelection.turns;
  const baseNewCells = Math.max(0, easySelection.path.length - easySelection.reusedCells);
  const mediumTarget = baseTurns + laneBonusTurns(difficulties.medium);
  const hardTarget = baseTurns + laneBonusTurns(difficulties.hard);
  const mediumTargetNewCells = baseNewCells + Math.round((clamp100(difficulties.medium) / 100) * 8);
  const hardTargetNewCells = baseNewCells + Math.round((clamp100(difficulties.hard) / 100) * 12);

  const mediumSelection =
    selectTargetTurnsCandidate(mediumCandidates, mediumTarget, mediumTargetNewCells, false) ??
    easySelection;

  const hardSelection =
    selectTargetTurnsCandidate(hardCandidates, hardTarget, hardTargetNewCells, true) ??
    mediumSelection;

  const selectedByLane: Record<RouteId, CandidateRoute> = {
    easy: easySelection,
    medium: mediumSelection,
    hard: hardSelection
  };

  const routes: Route[] = [];

  for (const routeId of ROUTE_IDS) {
    const selected = selectedByLane[routeId];
    const fromNode = nodeById.get(selected.fromNodeId);
    const toNode = nodeById.get(selected.toNodeId);
    if (!fromNode || !toNode) {
      continue;
    }

    const requirements = buildRouteRequirements(
      routeId,
      selected.path,
      fromNode,
      toNode,
      difficulties[routeId],
      spawnEnabled,
      tiles,
      selected.groupId
    );

    if (!requirements) {
      continue;
    }

    routes.push({
      id: routeId,
      groupId: selected.groupId,
      colorId: selected.colorId,
      fromNodeId: selected.fromNodeId,
      toNodeId: selected.toNodeId,
      cells: selected.path,
      requirements,
      length: selected.path.length,
      turns: computeTurns(selected.path),
      complexity: complexityForRequirements(requirements)
    });
  }

  return routes;
}

function fallbackOffer(
  routeId: RouteId,
  group: EndpointGroup | undefined,
  pipeSpawnEnabled: PipeSpawnEnabled,
  seed: number
): OfferSpec {
  const enabledKind = (['straight', 'elbow', 'doubleElbow', 'tee', 'cross'] as PipeKind[]).find(
    (kind) => pipeSpawnEnabled[kind]
  ) ?? 'straight';

  const colorId = group?.colorId ?? 0;
  const groupId = group?.id ?? 'group-0';

  return {
    id: `${routeId}-fallback-${seed}`,
    kind: enabledKind,
    orientation: 0,
    originalOrientation: 0,
    requiredOrientation: 0,
    routeId,
    groupId,
    colorId,
    targetCell: { row: -1, col: -1 },
    debugReason: `Fallback offer used for ${routeId}; no tactical or route requirement candidate was available.`,
    debugScore: 0
  };
}

function scoreComplexity(kind: PipeKind): number {
  return OFFER_KIND_COMPLEXITY_WEIGHT[kind];
}

function evaluateCandidate(
  candidate: TacticalCandidate,
  difficultyModel: DifficultyModel,
  _seed: number
): number {
  const complexityPenalty = scoreComplexity(candidate.kind) * difficultyModel.complexityPenaltyScale * 4;
  return candidate.score - complexityPenalty;
}

function enumerateFrontierByGroup(
  tiles: TileGrid,
  endpointNodes: EndpointNode[],
  endpointGroups: EndpointGroup[]
): Map<string, Map<string, Set<DirectionBit>>> {
  const gridSize = tiles.length;
  const nodeById = nodeMapFromNodes(endpointNodes);
  const frontierByGroup = new Map<string, Map<string, Set<DirectionBit>>>();

  function addFrontier(groupId: string, cell: Cell, requiredIncoming: DirectionBit): void {
    if (!isInsideGrid(gridSize, cell)) {
      return;
    }
    if (tiles[cell.row]?.[cell.col] !== null) {
      return;
    }

    const groupFrontier = frontierByGroup.get(groupId) ?? new Map<string, Set<DirectionBit>>();
    const key = cellKey(cell);
    const set = groupFrontier.get(key) ?? new Set<DirectionBit>();
    set.add(requiredIncoming);
    groupFrontier.set(key, set);
    frontierByGroup.set(groupId, groupFrontier);
  }

  for (const group of endpointGroups) {
    const groupNodes = group.nodeIds
      .map((nodeId) => nodeById.get(nodeId))
      .filter((node): node is EndpointNode => Boolean(node));

    for (const node of groupNodes) {
      const nodeCell = { row: node.row, col: node.col };
      for (const direction of ALL_DIRECTIONS) {
        const cell = moveCell(nodeCell, direction);
        addFrontier(group.id, cell, oppositeDirection(direction));
      }
    }

    for (let row = 0; row < gridSize; row += 1) {
      for (let col = 0; col < gridSize; col += 1) {
        const tile = tiles[row][col];
        if (!tile || tile.groupId !== group.id) {
          continue;
        }

        const fromCell = { row, col };
        for (const direction of ALL_DIRECTIONS) {
          if (!isDirectionOpen(tile.kind, tile.orientation, direction)) {
            continue;
          }
          const nextCell = moveCell(fromCell, direction);
          addFrontier(group.id, nextCell, oppositeDirection(direction));
        }
      }
    }
  }

  return frontierByGroup;
}

function cloneTiles(tiles: TileGrid): TileGrid {
  return tiles.map((row) => row.slice());
}

function countConnectedNeighbors(
  tiles: TileGrid,
  endpointNodesByCell: Map<string, EndpointNode>,
  groupId: string,
  cell: Cell,
  kind: PipeKind,
  orientation: Orientation
): number {
  let connections = 0;

  for (const direction of ALL_DIRECTIONS) {
    if (!isDirectionOpen(kind, orientation, direction)) {
      continue;
    }

    const neighbor = moveCell(cell, direction);
    const neighborKey = cellKey(neighbor);
    const endpoint = endpointNodesByCell.get(neighborKey);

    if (endpoint && endpoint.groupId === groupId) {
      connections += 1;
      continue;
    }

    const neighborTile = tiles[neighbor.row]?.[neighbor.col];
    if (!neighborTile || neighborTile.groupId !== groupId) {
      continue;
    }

    const incoming = oppositeDirection(direction);
    if (!isDirectionOpen(neighborTile.kind, neighborTile.orientation, incoming)) {
      continue;
    }

    let neighborConnectsBack = false;
    for (const neighborOut of ALL_DIRECTIONS) {
      if (neighborOut === incoming) {
        continue;
      }

      if (
        isDirectionOpen(neighborTile.kind, neighborTile.orientation, neighborOut) &&
        areEdgesConnected(neighborTile.kind, neighborTile.orientation, incoming, neighborOut)
      ) {
        neighborConnectsBack = true;
        break;
      }
    }

    if (neighborConnectsBack) {
      connections += 1;
    }
  }

  return connections;
}

function computeRouteAlignmentScore(
  requirement: RouteRequirement | undefined,
  kind: PipeKind,
  orientation: Orientation
): number {
  if (!requirement) {
    return 0;
  }

  let routeAlignment = 0;
  if (requirement.kind === kind) {
    routeAlignment += 90;
  }
  if (requirement.orientation === orientation) {
    routeAlignment += 110;
  }
  if (
    isDirectionOpen(kind, orientation, requirement.incoming) &&
    isDirectionOpen(kind, orientation, requirement.outgoing) &&
    areEdgesConnected(kind, orientation, requirement.incoming, requirement.outgoing)
  ) {
    routeAlignment += 140;
  }
  return routeAlignment;
}

function buildSecondStepOptions(
  tiles: TileGrid,
  endpointNodes: EndpointNode[],
  group: EndpointGroup,
  endpointNodesByCell: Map<string, EndpointNode>,
  allowedKinds: PipeKind[]
): SecondStepOption[] {
  const frontier = enumerateFrontierByGroup(tiles, endpointNodes, [group]).get(group.id);
  if (!frontier) {
    return [];
  }

  const options: SecondStepOption[] = [];
  for (const [key, requiredIncomingSet] of frontier.entries()) {
    const [rowText, colText] = key.split(',');
    const cell = { row: Number(rowText), col: Number(colText) };

    for (const kind of allowedKinds) {
      for (const orientation of [0, 90, 180, 270] as Orientation[]) {
        const requiredIncomingMatches = [...requiredIncomingSet].some((incoming) =>
          isDirectionOpen(kind, orientation, incoming)
        );
        if (!requiredIncomingMatches) {
          continue;
        }

        const connectedNeighbors = countConnectedNeighbors(
          tiles,
          endpointNodesByCell,
          group.id,
          cell,
          kind,
          orientation
        );
        if (connectedNeighbors === 0) {
          continue;
        }

        options.push({
          cell,
          kind,
          orientation,
          connectedNeighbors
        });
      }
    }
  }

  return options;
}

function estimateSecondStepPotential(
  options: SecondStepOption[],
  requirementMap: Map<string, RouteRequirement> | undefined
): { bestScore: number; optionCount: number } {
  let bestScore = 0;
  let optionCount = 0;

  for (const option of options) {
    const requirement = requirementMap?.get(cellKey(option.cell));
    const routeAlignment = computeRouteAlignmentScore(requirement, option.kind, option.orientation);
    const optionScore =
      option.connectedNeighbors * 26 +
      routeAlignment * 1.1 -
      scoreComplexity(option.kind) * 9;

    if (optionScore > 0) {
      optionCount += 1;
    }
    if (optionScore > bestScore) {
      bestScore = optionScore;
    }
  }

  return {
    bestScore,
    optionCount
  };
}

function isStrategicallyRelevantCandidate(candidate: TacticalCandidate): boolean {
  return (
    candidate.solvesGroup ||
    candidate.progress > 0 ||
    candidate.routeAlignment >= 140 ||
    candidate.secondStepPotential > 0
  );
}

function compareCandidates(
  a: TacticalCandidate,
  b: TacticalCandidate,
  difficultyModel: DifficultyModel,
  seed: number
): number {
  const scoreDelta = evaluateCandidate(b, difficultyModel, seed) - evaluateCandidate(a, difficultyModel, seed);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  const tieBreakA = seededRatio(seed + a.cell.row * 17 + a.cell.col * 29, 7);
  const tieBreakB = seededRatio(seed + b.cell.row * 17 + b.cell.col * 29, 7);
  if (tieBreakA !== tieBreakB) {
    return tieBreakB - tieBreakA;
  }

  if (a.routeAlignment !== b.routeAlignment) {
    return b.routeAlignment - a.routeAlignment;
  }

  if (a.progress !== b.progress) {
    return b.progress - a.progress;
  }

  return scoreComplexity(a.kind) - scoreComplexity(b.kind);
}

function pickLaneCandidate(
  candidates: TacticalCandidate[],
  difficultyModel: DifficultyModel,
  seed: number
): TacticalCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  const relevantCandidates = candidates.filter(isStrategicallyRelevantCandidate);
  const pool = relevantCandidates.length > 0 ? relevantCandidates : candidates;
  const sorted = pool
    .slice()
    .sort((a, b) => compareCandidates(a, b, difficultyModel, seed));
  return sorted[0] ?? null;
}

function buildOfferFromCandidate(
  candidate: TacticalCandidate,
  routeId: RouteId,
  difficultyModel: DifficultyModel,
  seed: number
): OfferSpec {
  const originalOrientation = candidate.orientation;
  const evaluatedScore = evaluateCandidate(candidate, difficultyModel, seed);
  const debugReason =
    `lane=${routeId}; group=${candidate.groupId}; cell=(${candidate.cell.row},${candidate.cell.col}); ` +
    `kind=${candidate.kind}; orientation=${candidate.orientation}; neighbors=${candidate.connectedNeighbors}; ` +
    `progress=${candidate.progress}; routeAlign=${Math.round(candidate.routeAlignment)}; ` +
    `reuse=${Math.round(candidate.reuseBonus)}; solveBonus=${Math.round(candidate.solveBonus)}; ` +
    `endpointGain=${Math.round(candidate.endpointGainBonus)}; difficultyPenalty=${Math.round(candidate.difficultyPenalty)}; ` +
    `secondStep=${Math.round(candidate.secondStepPotential)}; secondStepBonus=${Math.round(candidate.secondStepBonus)}; secondStepOptions=${candidate.secondStepOptions}; ` +
    `rawScore=${candidate.score.toFixed(2)}; evalScore=${evaluatedScore.toFixed(2)}; relevant=${isStrategicallyRelevantCandidate(candidate)}`;

  return {
    id: `${routeId}-${candidate.groupId}-${candidate.cell.row}-${candidate.cell.col}-${seed}`,
    kind: candidate.kind,
    orientation: originalOrientation,
    originalOrientation,
    requiredOrientation: candidate.orientation,
    routeId,
    groupId: candidate.groupId,
    colorId: candidate.colorId,
    targetCell: candidate.cell,
    debugReason,
    debugScore: evaluatedScore
  };
}

function filterAllowedKinds(pipeSpawnEnabled: PipeSpawnEnabled): PipeKind[] {
  return (['straight', 'elbow', 'doubleElbow', 'tee', 'cross'] as PipeKind[]).filter(
    (kind) => pipeSpawnEnabled[kind]
  );
}

function computeTacticalCandidates(
  input: DeriveOffersInput,
  connectivityByGroup: Map<string, GroupConnectivityState>,
  difficultyModel: DifficultyModel
): TacticalCandidate[] {
  const {
    tiles,
    endpointNodes,
    endpointGroups,
    routes,
    pipeSpawnEnabled
  } = input;

  const spawnEnabled = normalizePipeSpawnEnabled(pipeSpawnEnabled);
  const allowedKinds = filterAllowedKinds(spawnEnabled);
  const frontierByGroup = enumerateFrontierByGroup(tiles, endpointNodes, endpointGroups);
  const endpointNodesByCell = nodeMapByCell(endpointNodes);
  const routeById = new Map<RouteId, Route>();
  routes.forEach((route) => routeById.set(route.id, route));

  const candidates: TacticalCandidate[] = [];

  for (const group of endpointGroups) {
    const frontier = frontierByGroup.get(group.id);
    const beforeState = connectivityByGroup.get(group.id);

    if (!frontier || !beforeState) {
      continue;
    }

    const beforeConnected = beforeState.largestComponentNodeIds.length;
    const routeAlignmentByLane = new Map<RouteId, Map<string, RouteRequirement>>();

    for (const routeId of ROUTE_IDS) {
      const route = routeById.get(routeId);
      if (!route || route.groupId !== group.id) {
        continue;
      }

      const requirementMap = new Map<string, RouteRequirement>();
      route.requirements.forEach((requirement) => {
        if (tiles[requirement.cell.row]?.[requirement.cell.col] === null) {
          requirementMap.set(cellKey(requirement.cell), requirement);
        }
      });
      routeAlignmentByLane.set(routeId, requirementMap);
    }

    for (const [key, requiredIncomingSet] of frontier.entries()) {
      const [rowText, colText] = key.split(',');
      const cell = { row: Number(rowText), col: Number(colText) };

      for (const kind of allowedKinds) {
        for (const orientation of [0, 90, 180, 270] as Orientation[]) {
          const requiredIncomingMatches = [...requiredIncomingSet].some((incoming) =>
            isDirectionOpen(kind, orientation, incoming)
          );
          if (!requiredIncomingMatches) {
            continue;
          }

          const connectedNeighbors = countConnectedNeighbors(
            tiles,
            endpointNodesByCell,
            group.id,
            cell,
            kind,
            orientation
          );

          if (connectedNeighbors === 0) {
            continue;
          }

          const nextTiles = cloneTiles(tiles);
          nextTiles[cell.row][cell.col] = {
            kind,
            orientation,
            originalOrientation: orientation,
            groupId: group.id
          };

          const afterState = getGroupConnectivityState(nextTiles, endpointNodes, group);
          const afterConnected = afterState.largestComponentNodeIds.length;
          const solvesGroup = afterState.solved;
          const progress = afterConnected - beforeConnected;

          const placedPreferenceWeight = difficultyModel.placedPreferenceWeight;
          const routeAlignmentWeight = difficultyModel.routeAlignmentWeight;
          const progressWeight = difficultyModel.progressWeight;
          const reuseBonus = connectedNeighbors * 24 * placedPreferenceWeight;
          const solveBonus = solvesGroup ? 1800 : 0;
          const endpointGainBonus = progress * 320 * progressWeight;
          const secondStepOptions = buildSecondStepOptions(
            nextTiles,
            endpointNodes,
            group,
            endpointNodesByCell,
            allowedKinds
          );

          for (const routeId of ROUTE_IDS) {
            const routeRequirementMap = routeAlignmentByLane.get(routeId);
            const requirement = routeRequirementMap?.get(key);
            const routeAlignment = computeRouteAlignmentScore(requirement, kind, orientation);
            const secondStepEstimate = estimateSecondStepPotential(secondStepOptions, routeRequirementMap);
            const secondStepPotential = secondStepEstimate.bestScore;
            const secondStepBonus = secondStepPotential * difficultyModel.secondStepWeight;

            const difficultyPenalty = scoreComplexity(kind) * difficultyModel.complexityPenaltyScale * 10;

            candidates.push({
              groupId: group.id,
              colorId: group.colorId,
              routeId,
              cell,
              kind,
              orientation,
              solvesGroup,
              connectedNeighbors,
              progress,
              routeAlignment,
              reuseBonus,
              solveBonus,
              endpointGainBonus,
              difficultyPenalty,
              secondStepPotential,
              secondStepOptions: secondStepEstimate.optionCount,
              secondStepBonus,
              score:
                solveBonus +
                endpointGainBonus +
                reuseBonus +
                routeAlignment * routeAlignmentWeight -
                difficultyPenalty +
                secondStepBonus
            });
          }
        }
      }
    }
  }

  return candidates;
}

function requirementFallbackCandidate(
  route: Route,
  tiles: TileGrid,
  pipeSpawnEnabled: PipeSpawnEnabled,
  avoidKind: PipeKind | undefined
): TacticalCandidate | null {
  const requirement = route.requirements.find((item) => {
    if (tiles[item.cell.row]?.[item.cell.col] !== null) {
      return false;
    }

    if (!pipeSpawnEnabled[item.kind]) {
      return false;
    }

    if (!avoidKind) {
      return true;
    }

    return item.kind !== avoidKind;
  });

  if (!requirement) {
    return null;
  }

  return {
    groupId: route.groupId,
    colorId: route.colorId,
    routeId: route.id,
    cell: requirement.cell,
    kind: requirement.kind,
    orientation: requirement.orientation,
    score: 1,
    solvesGroup: false,
    connectedNeighbors: 0,
    progress: 0,
    routeAlignment: 0,
    reuseBonus: 0,
    solveBonus: 0,
    endpointGainBonus: 0,
    difficultyPenalty: 0,
    secondStepPotential: 0,
    secondStepOptions: 0,
    secondStepBonus: 0
  };
}

function isRequirementSatisfied(requirement: RouteRequirement, tiles: TileGrid): boolean {
  const tile = tiles[requirement.cell.row]?.[requirement.cell.col];
  if (!tile) {
    return false;
  }
  return (
    tile.groupId === requirement.groupId &&
    tile.kind === requirement.kind &&
    tile.orientation === requirement.orientation
  );
}

function nextUnmetRequirementIndex(route: Route, tiles: TileGrid): number {
  for (let index = 0; index < route.requirements.length; index += 1) {
    if (!isRequirementSatisfied(route.requirements[index], tiles)) {
      return index;
    }
  }
  return route.requirements.length;
}

function compareRequirementCandidates(
  a: RequirementCandidate,
  b: RequirementCandidate,
  routeId: RouteId,
  nextUnmetIndex: number
): number {
  if (a.solvesGroup !== b.solvesGroup) {
    return a.solvesGroup ? -1 : 1;
  }

  if (a.connectedNeighbors !== b.connectedNeighbors) {
    return b.connectedNeighbors - a.connectedNeighbors;
  }

  const stepDistanceA = Math.max(0, a.stepIndex - nextUnmetIndex);
  const stepDistanceB = Math.max(0, b.stepIndex - nextUnmetIndex);
  if (stepDistanceA !== stepDistanceB) {
    return stepDistanceA - stepDistanceB;
  }

  if (a.stepIndex !== b.stepIndex) {
    return a.stepIndex - b.stepIndex;
  }

  if (routeId === 'easy' && a.complexityScore !== b.complexityScore) {
    return a.complexityScore - b.complexityScore;
  }

  if (routeId === 'hard' && a.complexityScore !== b.complexityScore) {
    return b.complexityScore - a.complexityScore;
  }

  if (routeId === 'medium') {
    const distanceA = Math.abs(a.complexityScore - 2);
    const distanceB = Math.abs(b.complexityScore - 2);
    if (distanceA !== distanceB) {
      return distanceA - distanceB;
    }
  }

  if (a.requirement.cell.row !== b.requirement.cell.row) {
    return a.requirement.cell.row - b.requirement.cell.row;
  }
  if (a.requirement.cell.col !== b.requirement.cell.col) {
    return a.requirement.cell.col - b.requirement.cell.col;
  }
  return 0;
}

function requirementCandidateBaseScore(
  candidate: RequirementCandidate,
  routeId: RouteId,
  nextUnmetIndex: number
): number {
  const stepDistance = Math.max(0, candidate.stepIndex - nextUnmetIndex);
  const solveScore = candidate.solvesGroup ? 10000 : 0;
  const reuseScore = candidate.connectedNeighbors * 320;
  const sequenceScore = Math.max(0, 400 - stepDistance * 70 - candidate.stepIndex * 3);
  const complexityBias = routeId === 'easy'
    ? -candidate.complexityScore * 35
    : routeId === 'hard'
      ? candidate.complexityScore * 35
      : -Math.abs(candidate.complexityScore - 2) * 25;
  return solveScore + reuseScore + sequenceScore + complexityBias;
}

function buildOfferFromRequirementCandidate(
  candidate: RequirementCandidate,
  laneWeight: number,
  nextUnmetIndex: number,
  seed: number
): OfferSpec {
  const baseScore = requirementCandidateBaseScore(candidate, candidate.routeId, nextUnmetIndex);
  const weightedScore = baseScore * Math.max(0.05, laneWeight);
  const requirement = candidate.requirement;
  const debugReason =
    `lane=${candidate.routeId}; source=requirement; group=${candidate.route.groupId}; ` +
    `cell=(${requirement.cell.row},${requirement.cell.col}); kind=${requirement.kind}; orientation=${requirement.orientation}; ` +
    `step=${candidate.stepIndex}; nextStep=${nextUnmetIndex}; neighbors=${candidate.connectedNeighbors}; ` +
    `solves=${candidate.solvesGroup}; laneWeight=${laneWeight.toFixed(3)}; baseScore=${Math.round(baseScore)}; ` +
    `weightedScore=${Math.round(weightedScore)}`;
  return {
    id: `${candidate.routeId}-${candidate.route.groupId}-${requirement.cell.row}-${requirement.cell.col}-${seed}`,
    kind: requirement.kind,
    orientation: requirement.orientation,
    originalOrientation: requirement.orientation,
    requiredOrientation: requirement.orientation,
    routeId: candidate.routeId,
    groupId: candidate.route.groupId,
    colorId: candidate.route.colorId,
    targetCell: requirement.cell,
    debugReason,
    debugScore: weightedScore
  };
}

function collectRequirementCandidatesForRoute(
  route: Route,
  tiles: TileGrid,
  endpointNodes: EndpointNode[],
  endpointGroupsById: Map<string, EndpointGroup>,
  endpointNodesByCell: Map<string, EndpointNode>,
  pipeSpawnEnabled: PipeSpawnEnabled,
  avoidKind: PipeKind | undefined
): RequirementCandidate[] {
  const group = endpointGroupsById.get(route.groupId);
  if (!group) {
    return [];
  }

  const candidates: RequirementCandidate[] = [];
  for (let index = 0; index < route.requirements.length; index += 1) {
    const requirement = route.requirements[index];
    const current = tiles[requirement.cell.row]?.[requirement.cell.col];

    if (isRequirementSatisfied(requirement, tiles)) {
      continue;
    }

    if (current !== null) {
      continue;
    }

    if (!pipeSpawnEnabled[requirement.kind]) {
      continue;
    }

    if (avoidKind && avoidKind === requirement.kind) {
      continue;
    }

    const connectedNeighbors = countConnectedNeighbors(
      tiles,
      endpointNodesByCell,
      route.groupId,
      requirement.cell,
      requirement.kind,
      requirement.orientation
    );

    const nextTiles = cloneTiles(tiles);
    nextTiles[requirement.cell.row][requirement.cell.col] = {
      kind: requirement.kind,
      orientation: requirement.orientation,
      originalOrientation: requirement.orientation,
      groupId: route.groupId
    };

    const solvesGroup = getGroupConnectivityState(nextTiles, endpointNodes, group).solved;

    candidates.push({
      routeId: route.id,
      route,
      requirement,
      stepIndex: index,
      solvesGroup,
      connectedNeighbors,
      complexityScore: scoreComplexity(requirement.kind)
    });
  }

  return candidates;
}

function pickRequirementCandidate(
  routeId: RouteId,
  candidates: RequirementCandidate[],
  nextUnmetIndex: number
): RequirementCandidate | null {
  if (candidates.length === 0) {
    return null;
  }
  return candidates
    .slice()
    .sort((a, b) => compareRequirementCandidates(a, b, routeId, nextUnmetIndex))[0] ?? null;
}

export function deriveOffersTacticalFirst(input: DeriveOffersInput): OfferSpec[] {
  const {
    tiles,
    endpointNodes,
    endpointGroups,
    routes,
    offerDifficulty,
    pipeSpawnEnabled,
    seed = 0,
    avoidKindsByRoute = {}
  } = input;

  const spawnEnabled = normalizePipeSpawnEnabled(pipeSpawnEnabled);
  const difficultyModel = deriveDifficultyModel(offerDifficulty);
  const laneWeights = deriveRealLaneWeights(offerDifficulty);
  const routeById = new Map<RouteId, Route>();
  routes.forEach((route) => routeById.set(route.id, route));
  const endpointGroupsById = new Map<string, EndpointGroup>();
  endpointGroups.forEach((group) => endpointGroupsById.set(group.id, group));
  const endpointNodesByCell = nodeMapByCell(endpointNodes);

  const connectivityByGroup = new Map<string, GroupConnectivityState>();
  endpointGroups.forEach((group) => {
    connectivityByGroup.set(group.id, getGroupConnectivityState(tiles, endpointNodes, group));
  });

  const tacticalCandidates = computeTacticalCandidates(input, connectivityByGroup, difficultyModel);
  const tacticalCandidatesByLane = new Map<RouteId, TacticalCandidate[]>();
  const requirementCandidatesByLane = new Map<RouteId, RequirementCandidate[]>();
  const nextUnmetByLane = new Map<RouteId, number>();

  for (const routeId of ROUTE_IDS) {
    const route = routeById.get(routeId);
    if (!route) {
      tacticalCandidatesByLane.set(routeId, []);
      requirementCandidatesByLane.set(routeId, []);
      nextUnmetByLane.set(routeId, 0);
      continue;
    }

    const laneCandidates = tacticalCandidates.filter((candidate) => candidate.routeId === routeId);
    const blockedKind = avoidKindsByRoute[routeId];

    const filtered = blockedKind
      ? laneCandidates.filter((candidate) => candidate.kind !== blockedKind)
      : laneCandidates;

    tacticalCandidatesByLane.set(routeId, filtered);
    requirementCandidatesByLane.set(
      routeId,
      collectRequirementCandidatesForRoute(
        route,
        tiles,
        endpointNodes,
        endpointGroupsById,
        endpointNodesByCell,
        spawnEnabled,
        blockedKind
      )
    );
    nextUnmetByLane.set(routeId, nextUnmetRequirementIndex(route, tiles));
  }

  function candidateToOffer(routeId: RouteId, candidate: TacticalCandidate | null, localSeed: number): OfferSpec {
    if (!candidate) {
      const route = routeById.get(routeId);
      const group = route
        ? endpointGroups.find((item) => item.id === route.groupId)
        : endpointGroups[0];
      return fallbackOffer(routeId, group, spawnEnabled, localSeed);
    }
    return buildOfferFromCandidate(candidate, routeId, difficultyModel, localSeed);
  }

  function laneCandidate(routeId: RouteId): {
    source: 'requirement' | 'tactical' | 'none';
    requirement: RequirementCandidate | null;
    tactical: TacticalCandidate | null;
  } {
    const requirementCandidates = requirementCandidatesByLane.get(routeId) ?? [];
    const nextUnmet = nextUnmetByLane.get(routeId) ?? 0;
    const pickedRequirement = pickRequirementCandidate(routeId, requirementCandidates, nextUnmet);
    if (pickedRequirement) {
      return {
        source: 'requirement',
        requirement: pickedRequirement,
        tactical: null
      };
    }

    const route = routeById.get(routeId);
    const pickedTactical = pickLaneCandidate(
      tacticalCandidatesByLane.get(routeId) ?? [],
      difficultyModel,
      seed + ROUTE_IDS.indexOf(routeId) * 13
    ) ?? (
      route
        ? requirementFallbackCandidate(route, tiles, spawnEnabled, avoidKindsByRoute[routeId])
        : null
    );

    return {
      source: pickedTactical ? 'tactical' : 'none',
      requirement: null,
      tactical: pickedTactical
    };
  }

  const lanePicks = ROUTE_IDS.map((routeId) => {
    const picked = laneCandidate(routeId);
    const nextUnmet = nextUnmetByLane.get(routeId) ?? 0;
    if (picked.requirement) {
      const baseScore = requirementCandidateBaseScore(picked.requirement, routeId, nextUnmet);
      return {
        routeId,
        picked,
        nextUnmet,
        weightedScore: baseScore * laneWeights[routeId]
      };
    }
    return {
      routeId,
      picked,
      nextUnmet,
      weightedScore: picked.tactical ? picked.tactical.score * laneWeights[routeId] : Number.NEGATIVE_INFINITY
    };
  });

  const completionLane = lanePicks
    .filter((entry) => entry.picked.requirement?.solvesGroup)
    .sort((a, b) => b.weightedScore - a.weightedScore)[0];

  const selected = completionLane
    ?? lanePicks.slice().sort((a, b) => b.weightedScore - a.weightedScore)[0];

  if (!selected) {
    const route = routeById.get('medium');
    const group = route
      ? endpointGroups.find((item) => item.id === route.groupId)
      : endpointGroups[0];
    return [fallbackOffer('medium', group, spawnEnabled, seed + 1)];
  }

  if (selected.picked.requirement) {
    return [
      buildOfferFromRequirementCandidate(
        selected.picked.requirement,
        laneWeights[selected.routeId],
        selected.nextUnmet,
        seed + 1
      )
    ];
  }

  return [candidateToOffer(selected.routeId, selected.picked.tactical, seed + 1)];
}

function endpointNodeGraphKey(nodeId: string): string {
  return `E:${nodeId}`;
}

function portGraphKey(cell: Cell, incoming: DirectionBit): string {
  return `P:${cell.row},${cell.col},${incoming}`;
}

function parsePortGraphKey(key: string): { row: number; col: number; incoming: DirectionBit } | null {
  if (!key.startsWith('P:')) {
    return null;
  }
  const payload = key.slice(2);
  const [rowText, colText, incomingText] = payload.split(',');
  if (rowText === undefined || colText === undefined || incomingText === undefined) {
    return null;
  }
  return {
    row: Number(rowText),
    col: Number(colText),
    incoming: Number(incomingText) as DirectionBit
  };
}

function addGraphEdge(graph: Map<string, Set<string>>, from: string, to: string): void {
  const fromSet = graph.get(from) ?? new Set<string>();
  fromSet.add(to);
  graph.set(from, fromSet);

  const toSet = graph.get(to) ?? new Set<string>();
  toSet.add(from);
  graph.set(to, toSet);
}

function shortestGraphPath(graph: Map<string, Set<string>>, from: string, to: string): string[] {
  if (from === to) {
    return [from];
  }

  const queue: string[] = [from];
  const visited = new Set<string>([from]);
  const prev = new Map<string, string | null>();
  prev.set(from, null);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = graph.get(current);
    if (!neighbors) {
      continue;
    }

    for (const next of neighbors) {
      if (visited.has(next)) {
        continue;
      }
      visited.add(next);
      prev.set(next, current);
      if (next === to) {
        const path: string[] = [to];
        let cursor: string | null = current;
        while (cursor !== null) {
          path.push(cursor);
          cursor = prev.get(cursor) ?? null;
        }
        path.reverse();
        return path;
      }
      queue.push(next);
    }
  }

  return [];
}

function extractSolvedGroupPathCells(
  tiles: TileGrid,
  endpointNodes: EndpointNode[],
  group: EndpointGroup
): Cell[] {
  const nodeById = nodeMapFromNodes(endpointNodes);
  const groupNodes = group.nodeIds
    .map((nodeId) => nodeById.get(nodeId))
    .filter((node): node is EndpointNode => Boolean(node));

  if (groupNodes.length < 2) {
    return [];
  }

  const endpointByCell = new Map<string, EndpointNode>();
  for (const node of groupNodes) {
    endpointByCell.set(cellKey(node), node);
  }

  const graph = new Map<string, Set<string>>();

  for (const node of groupNodes) {
    graph.set(endpointNodeGraphKey(node.id), new Set<string>());
  }

  const gridSize = tiles.length;
  for (let row = 0; row < gridSize; row += 1) {
    for (let col = 0; col < gridSize; col += 1) {
      const tile = tiles[row]?.[col];
      if (!tile || tile.groupId !== group.id) {
        continue;
      }

      const cell = { row, col };
      const openDirections = ALL_DIRECTIONS.filter((direction) => isDirectionOpen(tile.kind, tile.orientation, direction));

      for (const incoming of openDirections) {
        const fromPort = portGraphKey(cell, incoming);
        if (!graph.has(fromPort)) {
          graph.set(fromPort, new Set<string>());
        }
      }

      for (let i = 0; i < openDirections.length; i += 1) {
        for (let j = i + 1; j < openDirections.length; j += 1) {
          const inA = openDirections[i];
          const inB = openDirections[j];
          if (!areEdgesConnected(tile.kind, tile.orientation, inA, inB)) {
            continue;
          }
          addGraphEdge(graph, portGraphKey(cell, inA), portGraphKey(cell, inB));
        }
      }

      for (const outDirection of openDirections) {
        const fromPort = portGraphKey(cell, outDirection);
        const neighbor = moveCell(cell, outDirection);
        if (!isInsideGrid(gridSize, neighbor)) {
          continue;
        }

        const endpoint = endpointByCell.get(cellKey(neighbor));
        if (endpoint) {
          addGraphEdge(graph, fromPort, endpointNodeGraphKey(endpoint.id));
        }

        const neighborTile = tiles[neighbor.row]?.[neighbor.col];
        const incomingToNeighbor = oppositeDirection(outDirection);
        if (
          neighborTile &&
          neighborTile.groupId === group.id &&
          isDirectionOpen(neighborTile.kind, neighborTile.orientation, incomingToNeighbor)
        ) {
          addGraphEdge(graph, fromPort, portGraphKey(neighbor, incomingToNeighbor));
        }
      }
    }
  }

  const rootEndpointKey = endpointNodeGraphKey(groupNodes[0].id);
  const selected = new Map<string, Cell>();

  for (let index = 1; index < groupNodes.length; index += 1) {
    const targetEndpointKey = endpointNodeGraphKey(groupNodes[index].id);
    const path = shortestGraphPath(graph, rootEndpointKey, targetEndpointKey);

    for (const key of path) {
      const parsedPort = parsePortGraphKey(key);
      if (!parsedPort) {
        continue;
      }
      const cell = { row: parsedPort.row, col: parsedPort.col };
      selected.set(cellKey(cell), cell);
    }
  }

  return [...selected.values()];
}

export function collectSolvedGroupPaths(
  tiles: TileGrid,
  endpointNodes: EndpointNode[],
  endpointGroups: EndpointGroup[]
): { groupId: string; colorId: number; cells: Cell[] }[] {
  const result: { groupId: string; colorId: number; cells: Cell[] }[] = [];
  for (const group of endpointGroups) {
    const state = getGroupConnectivityState(tiles, endpointNodes, group);
    if (!state.solved) {
      continue;
    }
    const betweenEndpoints = extractSolvedGroupPathCells(tiles, endpointNodes, group);
    result.push({
      groupId: group.id,
      colorId: group.colorId,
      cells: betweenEndpoints.length > 0 ? betweenEndpoints : state.largestComponentCells
    });
  }
  return result;
}

export function allGroupsSolved(
  tiles: TileGrid,
  endpointNodes: EndpointNode[],
  endpointGroups: EndpointGroup[]
): boolean {
  if (endpointGroups.length === 0) {
    return false;
  }

  for (const group of endpointGroups) {
    if (!isGroupSolved(tiles, endpointNodes, group)) {
      return false;
    }
  }

  return true;
}

export function parseEndpointScenario(input: string): EndpointScenario {
  const trimmed = input.trim();
  if (!trimmed) {
    return [{ size: 2, groups: 1 }];
  }

  const terms: EndpointScenario = [];
  const parts = trimmed.split('+').map((part) => part.trim()).filter(Boolean);

  for (const part of parts) {
    const match = part.match(/^(\d+)\s*x\s*(\d+)$/i);
    if (!match) {
      continue;
    }

    let size = Number(match[1]);
    let groups = Number(match[2]);

    // Compatibility: allow shorthand 1x3 as one group of 3 endpoints.
    if (size === 1 && groups > 1) {
      size = groups;
      groups = 1;
    }

    size = Math.max(1, Math.min(9, Math.round(size)));
    groups = Math.max(1, Math.min(9, Math.round(groups)));

    terms.push({ size, groups });
  }

  if (terms.length === 0) {
    return [{ size: 2, groups: 1 }];
  }

  return terms;
}

export function scenarioToLabel(scenario: EndpointScenario): string {
  return scenario.map((term) => `${term.size}x${term.groups}`).join(' + ');
}

export function expandScenarioGroups(scenario: EndpointScenario): number[] {
  const sizes: number[] = [];
  for (const term of scenario) {
    for (let index = 0; index < term.groups; index += 1) {
      sizes.push(term.size);
    }
  }
  return sizes;
}

export function mergeAndUniquePaths(paths: Cell[][]): Cell[] {
  const dedup = new Map<string, Cell>();
  for (const path of uniquePathList(paths)) {
    for (const cell of path) {
      dedup.set(cellKey(cell), cell);
    }
  }
  return [...dedup.values()];
}
