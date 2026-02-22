export const Direction = {
  N: 1,
  E: 2,
  S: 4,
  W: 8
} as const;

export type DirectionBit = (typeof Direction)[keyof typeof Direction];

export type Orientation = 0 | 90 | 180 | 270;

export type PipeKind = 'straight' | 'elbow' | 'tee' | 'cross' | 'doubleElbow';

export type EdgePair = readonly [DirectionBit, DirectionBit];

export interface PipeDef {
  kind: PipeKind;
  originalOrientation: Orientation;
  orientation: Orientation;
}

export interface PipeTopology {
  mask: number;
  pairs: EdgePair[];
}

export const ALL_DIRECTIONS: DirectionBit[] = [
  Direction.N,
  Direction.E,
  Direction.S,
  Direction.W
];

const DIRECTION_INDEX: Record<DirectionBit, number> = {
  [Direction.N]: 0,
  [Direction.E]: 1,
  [Direction.S]: 2,
  [Direction.W]: 3
};

const DIRECTION_FROM_INDEX: DirectionBit[] = [
  Direction.N,
  Direction.E,
  Direction.S,
  Direction.W
];

const BASE_MASKS: Record<PipeKind, number> = {
  straight: Direction.N | Direction.S,
  elbow: Direction.N | Direction.E,
  tee: Direction.N | Direction.E | Direction.W,
  cross: Direction.N | Direction.E | Direction.S | Direction.W,
  // Overpass: four openings, two independent elbow channels.
  doubleElbow: Direction.N | Direction.E | Direction.S | Direction.W
};

const BASE_PAIRS: Record<PipeKind, EdgePair[]> = {
  straight: [[Direction.N, Direction.S]],
  elbow: [[Direction.N, Direction.E]],
  tee: [
    [Direction.N, Direction.E],
    [Direction.N, Direction.W],
    [Direction.E, Direction.W]
  ],
  // Overpass: two independent channels.
  cross: [
    [Direction.N, Direction.S],
    [Direction.E, Direction.W]
  ],
  doubleElbow: [
    [Direction.N, Direction.E],
    [Direction.S, Direction.W]
  ]
};

export function normalizeOrientation(value: number): Orientation {
  const normalized = ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  if (normalized === 0 || normalized === 90 || normalized === 180 || normalized === 270) {
    return normalized;
  }
  return 0;
}

export function nextOrientation(orientation: Orientation): Orientation {
  return normalizeOrientation(orientation + 90);
}

export function rotateDirection(direction: DirectionBit, orientation: Orientation): DirectionBit {
  const steps = orientation / 90;
  const index = DIRECTION_INDEX[direction];
  const rotatedIndex = (index + steps) % 4;
  return DIRECTION_FROM_INDEX[rotatedIndex];
}

export function oppositeDirection(direction: DirectionBit): DirectionBit {
  return rotateDirection(direction, 180);
}

export function rotateMask(mask: number, orientation: Orientation): number {
  let rotated = 0;
  for (const direction of ALL_DIRECTIONS) {
    if ((mask & direction) !== 0) {
      rotated |= rotateDirection(direction, orientation);
    }
  }
  return rotated;
}

export function rotatePairs(pairs: EdgePair[], orientation: Orientation): EdgePair[] {
  return pairs.map(([a, b]) => [
    rotateDirection(a, orientation),
    rotateDirection(b, orientation)
  ]);
}

export function getPipeTopology(kind: PipeKind, orientation: Orientation): PipeTopology {
  return {
    mask: rotateMask(BASE_MASKS[kind], orientation),
    pairs: rotatePairs(BASE_PAIRS[kind], orientation)
  };
}

export function isDirectionOpen(kind: PipeKind, orientation: Orientation, direction: DirectionBit): boolean {
  return (getPipeTopology(kind, orientation).mask & direction) !== 0;
}

export function areEdgesConnected(
  kind: PipeKind,
  orientation: Orientation,
  from: DirectionBit,
  to: DirectionBit
): boolean {
  if (from === to) {
    return false;
  }

  const topology = getPipeTopology(kind, orientation);

  if ((topology.mask & from) === 0 || (topology.mask & to) === 0) {
    return false;
  }

  const adjacency = new Map<DirectionBit, DirectionBit[]>();

  for (const direction of ALL_DIRECTIONS) {
    adjacency.set(direction, []);
  }

  for (const [a, b] of topology.pairs) {
    adjacency.get(a)!.push(b);
    adjacency.get(b)!.push(a);
  }

  const stack: DirectionBit[] = [from];
  const visited = new Set<DirectionBit>();

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === to) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const neighbors = adjacency.get(current)!;
    for (const next of neighbors) {
      if (!visited.has(next)) {
        stack.push(next);
      }
    }
  }

  return false;
}

export function directionToDelta(direction: DirectionBit): { dr: number; dc: number } {
  switch (direction) {
    case Direction.N:
      return { dr: -1, dc: 0 };
    case Direction.E:
      return { dr: 0, dc: 1 };
    case Direction.S:
      return { dr: 1, dc: 0 };
    case Direction.W:
      return { dr: 0, dc: -1 };
    default:
      return { dr: 0, dc: 0 };
  }
}

export function orientationToRadians(orientation: Orientation): number {
  return (orientation * Math.PI) / 180;
}
