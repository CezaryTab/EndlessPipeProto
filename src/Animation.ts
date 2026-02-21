import type { Cell } from './RouteSolver';

export type AnimationPhase = 'idle' | 'flow' | 'burst';

export interface AnimationState {
  phase: AnimationPhase;
  path: Cell[];
  elapsedMs: number;
  flowCellDurationMs: number;
  flowStaggerMs: number;
  burstDurationMs: number;
  color: string;
}

export interface CellAnimationState {
  flowProgress: number;
  burstProgress: number;
}

export interface TickResult {
  state: AnimationState;
  event: 'none' | 'cleanup';
  completedPath: Cell[];
}

export function createIdleAnimationState(): AnimationState {
  return {
    phase: 'idle',
    path: [],
    elapsedMs: 0,
    flowCellDurationMs: 220,
    flowStaggerMs: 120,
    burstDurationMs: 420,
    color: '#4ed4a8'
  };
}

export function startFlowAnimation(path: Cell[], color = '#4ed4a8'): AnimationState {
  return {
    phase: 'flow',
    path: path.slice(),
    elapsedMs: 0,
    flowCellDurationMs: 220,
    flowStaggerMs: 120,
    burstDurationMs: 420,
    color
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function tickAnimation(state: AnimationState, deltaMs: number): TickResult {
  if (state.phase === 'idle') {
    return {
      state,
      event: 'none',
      completedPath: []
    };
  }

  const elapsed = state.elapsedMs + Math.max(0, deltaMs);

  if (state.phase === 'flow') {
    const totalFlowDuration =
      (state.path.length - 1) * state.flowStaggerMs + state.flowCellDurationMs;

    if (elapsed >= totalFlowDuration) {
      return {
        state: {
          ...state,
          phase: 'burst',
          elapsedMs: 0
        },
        event: 'none',
        completedPath: []
      };
    }

    return {
      state: {
        ...state,
        elapsedMs: elapsed
      },
      event: 'none',
      completedPath: []
    };
  }

  // Burst phase
  if (elapsed >= state.burstDurationMs) {
    return {
      state: createIdleAnimationState(),
      event: 'cleanup',
      completedPath: state.path.slice()
    };
  }

  return {
    state: {
      ...state,
      elapsedMs: elapsed
    },
    event: 'none',
    completedPath: []
  };
}

export function getCellAnimationState(
  state: AnimationState,
  row: number,
  col: number
): CellAnimationState {
  const index = state.path.findIndex((cell) => cell.row === row && cell.col === col);
  if (index < 0) {
    return {
      flowProgress: 0,
      burstProgress: 0
    };
  }

  if (state.phase === 'flow') {
    const localElapsed = state.elapsedMs - index * state.flowStaggerMs;
    return {
      flowProgress: clamp01(localElapsed / state.flowCellDurationMs),
      burstProgress: 0
    };
  }

  if (state.phase === 'burst') {
    return {
      flowProgress: 1,
      burstProgress: clamp01(state.elapsedMs / state.burstDurationMs)
    };
  }

  return {
    flowProgress: 0,
    burstProgress: 0
  };
}
