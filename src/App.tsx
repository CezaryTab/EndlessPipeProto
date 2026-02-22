import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addGridHeight,
  addGridWidth,
  ENDPOINT_COLOR_PALETTE,
  DEFAULT_BOOSTERS,
  DEFAULT_DIFFICULTY_TIERS,
  DEFAULT_ENERGY,
  DEFAULT_RAMP_DIFFICULTY_TIERS,
  GRID_SIZE_MIN,
  canPlaceOffer,
  discardAllOffers,
  getUnlockedDifficultyTier,
  getUnlockedDifficultyTierIndex,
  initGame,
  placeOffer,
  rotateAllOffers,
  setDifficultyTiers,
  setEndpointScenario,
  resetScore,
  setShowGhostPipes,
  setHoveredCell,
  setPipeSpawnEnabled,
  type DifficultyTier,
  type GameState
} from './GameState';
import {
  createInputController,
  type GridMetrics as InputGridMetrics,
  type InputController,
  type PointerPoint
} from './Input';
import { renderFrame, type DragRenderState, type GridRenderMetrics } from './Renderer';
import {
  ALL_DIRECTIONS,
  directionToDelta,
  getPipeTopology,
  type Orientation,
  type PipeKind
} from './Pipe';
import type { Cell, EndpointScenario } from './RouteSolver';

interface DragState {
  active: boolean;
  offerIndex: number | null;
  pointerClient: PointerPoint | null;
  hoveredCell: Cell | null;
}

interface CompletedEndpointBurstLog {
  id: string;
  groupId: string;
  row: number;
  col: number;
  colorId: number;
}

interface CompletedPipeBurstLog {
  row: number;
  col: number;
  kind: PipeKind;
  orientation: Orientation;
}

interface GroupCompletedLogData {
  groupIds?: string[];
  completedEndpoints?: CompletedEndpointBurstLog[];
  completedPipes?: CompletedPipeBurstLog[];
}

interface ConfettiPiece {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  size: number;
  color: string;
  rotate: number;
  durationMs: number;
}

interface PipeExitPiece {
  id: number;
  x: number;
  y: number;
  size: number;
  kind: PipeKind;
  orientation: Orientation;
  color: string;
}

interface EndpointTransitionPiece {
  id: number;
  endpointId: string;
  x: number;
  y: number;
  size: number;
  color: string;
  mode: 'exit' | 'enter';
}

function createInitialDragState(): DragState {
  return {
    active: false,
    offerIndex: null,
    pointerClient: null,
    hoveredCell: null
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scenarioToGroupSizes(endpointScenario: EndpointScenario): number[] {
  const sizes: number[] = [];
  for (const term of endpointScenario) {
    const size = clamp(Math.round(term.size), 1, 9);
    const groups = clamp(Math.round(term.groups), 1, 9);
    for (let index = 0; index < groups; index += 1) {
      sizes.push(size);
    }
  }
  return sizes.length > 0 ? sizes : [2];
}

function clampGroupSizesToCaps(groupSizes: number[], caps: number[]): number[] {
  const usableCaps = caps.length > 0 ? caps : [2];
  const clamped = groupSizes
    .slice(0, usableCaps.length)
    .map((size, index) => {
      const endpointCap = usableCaps[index] ?? usableCaps[usableCaps.length - 1] ?? 2;
      return clamp(Number.isFinite(size) ? Math.round(size) : 1, 1, endpointCap);
    });

  if (clamped.length === 0) {
    clamped.push(Math.min(2, usableCaps[0] ?? 2));
  }

  return clamped;
}

function seededRatio(seed: number): number {
  const raw = Math.sin((seed + 1) * 12.9898 + 78.233) * 43758.5453;
  return raw - Math.floor(raw);
}

const PIPE_KIND_ORDER: PipeKind[] = ['straight', 'elbow', 'tee', 'cross'];
const DIFFICULTY_TIERS_STORAGE_KEY = 'endless-pipe.difficultyTiers.v1';
const GRID_EXPAND_ENDPOINT_RESPAWN_DELAY_MS = 280;
const PIPE_KIND_LABEL: Record<PipeKind, string> = {
  straight: 'Straight',
  elbow: 'Elbow',
  doubleElbow: 'Double Elbow (X)',
  tee: 'T',
  cross: 'Cross'
};
function cloneDifficultyTiers(tiers: DifficultyTier[]): DifficultyTier[] {
  return tiers.map((tier) => ({
    ...tier,
    groupEndpointCaps: Array.isArray(tier.groupEndpointCaps)
      ? [...tier.groupEndpointCaps]
      : undefined
  }));
}

function sanitizeTierValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return clamp(Math.round(value), min, max);
}

function fallbackDifficultyTier(): DifficultyTier {
  return DEFAULT_DIFFICULTY_TIERS[0] ?? {
    scoreThreshold: 0,
    maxGridWidth: 3,
    maxGridHeight: 1,
    maxGroups: 1,
    maxEndpointsPerGroup: 2,
    groupEndpointCaps: [2]
  };
}

function baseScenarioForTier(tier: DifficultyTier): EndpointScenario {
  const caps = normalizeTierGroupCaps(tier);
  return caps.map((size, index) => ({ size: index === 0 ? Math.min(2, size) : size, groups: 1 }));
}

function normalizeTierGroupCaps(tier: DifficultyTier): number[] {
  const fallbackGroups = sanitizeTierValue(tier.maxGroups, 1, 9);
  const fallbackEndpoints = sanitizeTierValue(tier.maxEndpointsPerGroup, 1, 9);
  const rawCaps = Array.isArray(tier.groupEndpointCaps) ? tier.groupEndpointCaps : [];
  const caps = rawCaps
    .map((cap) => sanitizeTierValue(cap, 1, 9))
    .slice(0, 9);

  if (caps.length === 0) {
    return Array.from({ length: fallbackGroups }, () => fallbackEndpoints);
  }

  return caps;
}

function normalizeDifficultyTierInput(tier: DifficultyTier): DifficultyTier {
  const scoreThreshold = sanitizeTierValue(tier.scoreThreshold, 0, 9999);
  const maxGridWidth = sanitizeTierValue(tier.maxGridWidth, GRID_SIZE_MIN, 9);
  const maxGridHeight = sanitizeTierValue(tier.maxGridHeight, GRID_SIZE_MIN, 9);
  const groupEndpointCaps = normalizeTierGroupCaps(tier);
  const maxGroups = groupEndpointCaps.length;
  const maxEndpointsPerGroup = groupEndpointCaps.reduce((highest, cap) => Math.max(highest, cap), 1);

  return {
    scoreThreshold,
    maxGridWidth,
    maxGridHeight,
    maxGroups,
    maxEndpointsPerGroup,
    groupEndpointCaps
  };
}

function areDifficultyTierDraftsEqual(first: DifficultyTier[], second: DifficultyTier[]): boolean {
  if (first.length !== second.length) {
    return false;
  }

  for (let index = 0; index < first.length; index += 1) {
    const a = normalizeDifficultyTierInput(first[index]!);
    const b = normalizeDifficultyTierInput(second[index]!);
    if (
      a.scoreThreshold !== b.scoreThreshold ||
      a.maxGridWidth !== b.maxGridWidth ||
      a.maxGridHeight !== b.maxGridHeight
    ) {
      return false;
    }

    const aCaps = normalizeTierGroupCaps(a);
    const bCaps = normalizeTierGroupCaps(b);
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

function scoreDraftsFromTiers(tiers: DifficultyTier[]): string[] {
  return tiers.map((tier) => String(normalizeDifficultyTierInput(tier).scoreThreshold));
}

function loadPersistedDifficultyTiers(): DifficultyTier[] | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(DIFFICULTY_TIERS_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }

    return parsed.map((tier) => normalizeDifficultyTierInput(tier as DifficultyTier));
  } catch {
    return null;
  }
}

function persistDifficultyTiers(tiers: DifficultyTier[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  const normalized = tiers.map((tier) => normalizeDifficultyTierInput(tier));
  window.localStorage.setItem(DIFFICULTY_TIERS_STORAGE_KEY, JSON.stringify(normalized));
}

function PipeShapePreview(props: {
  kind: PipeKind;
  orientation: Orientation;
  color: string;
  className?: string;
}): JSX.Element {
  const { kind, orientation, className, color } = props;
  const topology = getPipeTopology(kind, orientation);
  const size = 70;
  const center = size / 2;
  const arm = 23;
  const crossGapHalf = 12;

  return (
    <svg className={className} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <rect x={1} y={1} width={size - 2} height={size - 2} rx={16} fill="rgba(255, 255, 255, 0.05)" />
      {kind === 'doubleElbow' &&
        topology.pairs.map(([from, to], index) => {
          const fromDelta = directionToDelta(from);
          const toDelta = directionToDelta(to);
          const cornerRadius = 12;
          const cornerX = center + (fromDelta.dc + toDelta.dc) * cornerRadius;
          const cornerY = center + (fromDelta.dr + toDelta.dr) * cornerRadius;
          const fromX = center + fromDelta.dc * arm;
          const fromY = center + fromDelta.dr * arm;
          const toX = center + toDelta.dc * arm;
          const toY = center + toDelta.dr * arm;

          return (
            <polyline
              key={`${from}-${to}-${index}`}
              points={`${fromX},${fromY} ${cornerX},${cornerY} ${toX},${toY}`}
              fill="none"
              stroke={color}
              strokeWidth={10}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      {kind === 'cross' &&
        <>
          <line
            x1={center}
            y1={center - arm}
            x2={center}
            y2={center + arm}
            stroke={color}
            strokeWidth={10}
            strokeLinecap="round"
          />
          <line
            x1={center - arm}
            y1={center}
            x2={center - crossGapHalf}
            y2={center}
            stroke={color}
            strokeWidth={10}
            strokeLinecap="round"
          />
          <line
            x1={center + crossGapHalf}
            y1={center}
            x2={center + arm}
            y2={center}
            stroke={color}
            strokeWidth={10}
            strokeLinecap="round"
          />
        </>}
      {kind !== 'doubleElbow' && kind !== 'cross' &&
        ALL_DIRECTIONS.map((direction) => {
          if ((topology.mask & direction) === 0) {
            return null;
          }

          const delta = directionToDelta(direction);
          return (
            <line
              key={direction}
              x1={center}
              y1={center}
              x2={center + delta.dc * arm}
              y2={center + delta.dr * arm}
              stroke={color}
              strokeWidth={10}
              strokeLinecap="round"
            />
          );
        })}
      {kind !== 'doubleElbow' && kind !== 'cross' && <circle cx={center} cy={center} r={7} fill={color} />}
    </svg>
  );
}

function PipeGlyph(props: {
  kind: PipeKind;
  orientation: Orientation;
  color: string;
  className?: string;
}): JSX.Element {
  const { kind, orientation, className, color } = props;
  const topology = getPipeTopology(kind, orientation);
  const size = 84;
  const center = size / 2;
  const arm = 29;
  const stroke = 10;
  const crossGapHalf = 16;

  return (
    <svg className={className} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {kind === 'doubleElbow' &&
        topology.pairs.map(([from, to], index) => {
          const fromDelta = directionToDelta(from);
          const toDelta = directionToDelta(to);
          const cornerRadius = 16;
          const cornerX = center + (fromDelta.dc + toDelta.dc) * cornerRadius;
          const cornerY = center + (fromDelta.dr + toDelta.dr) * cornerRadius;
          const fromX = center + fromDelta.dc * arm;
          const fromY = center + fromDelta.dr * arm;
          const toX = center + toDelta.dc * arm;
          const toY = center + toDelta.dr * arm;

          return (
            <polyline
              key={`${from}-${to}-${index}`}
              points={`${fromX},${fromY} ${cornerX},${cornerY} ${toX},${toY}`}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      {kind === 'cross' &&
        <>
          <line
            x1={center}
            y1={center - arm}
            x2={center}
            y2={center + arm}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          <line
            x1={center - arm}
            y1={center}
            x2={center - crossGapHalf}
            y2={center}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
          <line
            x1={center + crossGapHalf}
            y1={center}
            x2={center + arm}
            y2={center}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
          />
        </>}
      {kind !== 'doubleElbow' && kind !== 'cross' &&
        ALL_DIRECTIONS.map((direction) => {
          if ((topology.mask & direction) === 0) {
            return null;
          }

          const delta = directionToDelta(direction);
          return (
            <line
              key={direction}
              x1={center}
              y1={center}
              x2={center + delta.dc * arm}
              y2={center + delta.dr * arm}
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
            />
          );
        })}
      {kind !== 'doubleElbow' && kind !== 'cross' && <circle cx={center} cy={center} r={7} fill={color} />}
    </svg>
  );
}

function RotateIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="action-icon" aria-hidden="true">
      <path
        d="M20 11a8 8 0 1 1-2.34-5.66"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <polyline
        points="20 4 20 11 13 11"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DiscardIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="action-icon" aria-hidden="true">
      <path d="M3 6h18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
      <path
        d="M8 6V4h8v2m-9 0 1 13h8l1-13"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 10v6m4-6v6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function GearIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className="settings-gear-icon" aria-hidden="true">
      <path
        d="M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
      />
      <path
        d="M19.4 13.5a7.8 7.8 0 0 0 0-3l2-1.2-2-3.4-2.3.9a7.9 7.9 0 0 0-2.5-1.5L14.2 3h-4.1l-.4 2.3a7.9 7.9 0 0 0-2.5 1.5L4.9 6l-2 3.4 2 1.2a7.8 7.8 0 0 0 0 3l-2 1.2 2 3.4 2.3-.9a7.9 7.9 0 0 0 2.5 1.5l.4 2.3h4.1l.4-2.3a7.9 7.9 0 0 0 2.5-1.5l2.3.9 2-3.4-2-1.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function App(): JSX.Element {
  const [game, setGame] = useState<GameState>(() => {
    const persistedDifficultyTiers = loadPersistedDifficultyTiers();
    const difficultyTiers = cloneDifficultyTiers(persistedDifficultyTiers ?? DEFAULT_RAMP_DIFFICULTY_TIERS);
    const baseTier = difficultyTiers[0] ?? fallbackDifficultyTier();
    return initGame({
      difficultyTiers,
      gridWidth: baseTier.maxGridWidth,
      gridHeight: baseTier.maxGridHeight,
      endpointScenario: baseScenarioForTier(baseTier),
      score: 0,
      maxScoreReached: 0
    });
  });
  const [drag, setDrag] = useState<DragState>(createInitialDragState);
  const [canvasSize, setCanvasSize] = useState({ width: 640, height: 640 });
  const [groupSizesInput, setGroupSizesInput] = useState<number[]>(() => scenarioToGroupSizes(game.endpointScenario));
  const [confettiPieces, setConfettiPieces] = useState<ConfettiPiece[]>([]);
  const [pipeExitPieces, setPipeExitPieces] = useState<PipeExitPiece[]>([]);
  const [endpointTransitionPieces, setEndpointTransitionPieces] = useState<EndpointTransitionPiece[]>([]);
  const [hiddenEndpointIds, setHiddenEndpointIds] = useState<Set<string>>(() => new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const gridMetricsRef = useRef<GridRenderMetrics>({
    originX: 0,
    originY: 0,
    cellSize: 0,
    gridWidth: game.gridWidth,
    gridHeight: game.gridHeight
  });
  const inputControllerRef = useRef<InputController | null>(null);
  const dragOfferRef = useRef<number | null>(null);
  const animationIdRef = useRef<number>(0);
  const processedLogIdRef = useRef<number>(0);
  const expandRespawnTimerRef = useRef<number | null>(null);

  const activeOffer = useMemo(() => {
    if (drag.offerIndex === null) {
      return null;
    }
    return game.offers[drag.offerIndex] ?? null;
  }, [drag.offerIndex, game.offers]);

  const hoverValidity = useMemo(() => {
    if (!drag.active || !drag.hoveredCell || !activeOffer) {
      return false;
    }
    return canPlaceOffer(game, activeOffer, drag.hoveredCell).valid;
  }, [drag.active, drag.hoveredCell, activeOffer, game]);

  const unlockedTierIndex = useMemo(() => getUnlockedDifficultyTierIndex(game), [game]);
  const unlockedTier = useMemo(() => getUnlockedDifficultyTier(game), [game]);
  const unlockedTierGroupCaps = useMemo(() => normalizeTierGroupCaps(unlockedTier), [unlockedTier]);
  const [difficultyTierDrafts, setDifficultyTierDrafts] = useState<DifficultyTier[]>(() =>
    game.difficultyTiers.map((tier) => normalizeDifficultyTierInput(tier))
  );
  const [difficultyTierScoreDrafts, setDifficultyTierScoreDrafts] = useState<string[]>(() =>
    scoreDraftsFromTiers(game.difficultyTiers)
  );
  const [difficultyTierDraftDirty, setDifficultyTierDraftDirty] = useState(false);

  useEffect(() => {
    setGroupSizesInput(scenarioToGroupSizes(game.endpointScenario));
  }, [game.endpointScenario]);

  useEffect(() => {
    if (difficultyTierDraftDirty) {
      return;
    }

    const nextDrafts = game.difficultyTiers.map((tier) => normalizeDifficultyTierInput(tier));
    setDifficultyTierDrafts((current) => {
      if (areDifficultyTierDraftsEqual(current, nextDrafts)) {
        return current;
      }
      return nextDrafts;
    });
    setDifficultyTierScoreDrafts((current) => {
      const nextScoreDrafts = scoreDraftsFromTiers(nextDrafts);
      if (
        current.length === nextScoreDrafts.length &&
        current.every((value, index) => value === nextScoreDrafts[index])
      ) {
        return current;
      }
      return nextScoreDrafts;
    });
  }, [game.difficultyTiers, difficultyTierDraftDirty]);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [settingsOpen]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = canvasWrapRef.current;
    if (!canvas || !wrapper) {
      return;
    }

    const resize = () => {
      const width = wrapper.clientWidth;
      const height = wrapper.clientHeight;
      setCanvasSize({ width, height });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.floor(canvasSize.width * dpr);
    const nextHeight = Math.floor(canvasSize.height * dpr);
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const dragRenderModel: DragRenderState = {
      active: drag.active,
      hoveredCell: drag.hoveredCell,
      isValidHover: hoverValidity,
      offer: activeOffer
        ? {
            kind: activeOffer.kind,
            orientation: activeOffer.orientation
          }
        : null
    };

    const metrics = renderFrame(context, {
      game,
      drag: dragRenderModel,
      hiddenEndpointIds,
      width: canvasSize.width,
      height: canvasSize.height
    });

    gridMetricsRef.current = metrics;
  }, [game, drag, hoverValidity, activeOffer, canvasSize, hiddenEndpointIds]);

  useEffect(() => {
    const controller = createInputController({
      getGridMetrics: (): InputGridMetrics => {
        const canvas = canvasRef.current;
        const rect = canvas?.getBoundingClientRect();
        const metrics = gridMetricsRef.current;

        return {
          originX: (rect?.left ?? 0) + metrics.originX,
          originY: (rect?.top ?? 0) + metrics.originY,
          cellSize: metrics.cellSize,
          gridWidth: metrics.gridWidth,
          gridHeight: metrics.gridHeight
        };
      },
      onDragStart: (point) => {
        setDrag((current) => ({
          ...current,
          active: true,
          pointerClient: point
        }));
      },
      onDragMove: (point) => {
        setDrag((current) => ({
          ...current,
          pointerClient: point
        }));
      },
      onHoverCell: (cell) => {
        setDrag((current) => ({
          ...current,
          hoveredCell: cell
        }));
        setGame((state) => setHoveredCell(state, cell));
      },
      onDrop: (cell) => {
        const offerIndex = dragOfferRef.current;

        if (offerIndex !== null && cell) {
          setGame((state) => placeOffer(state, offerIndex, cell));
        }

        dragOfferRef.current = null;
        setDrag(createInitialDragState());
        setGame((state) => setHoveredCell(state, null));
      },
      onCancel: () => {
        dragOfferRef.current = null;
        setDrag(createInitialDragState());
        setGame((state) => setHoveredCell(state, null));
      }
    });

    inputControllerRef.current = controller;

    return () => {
      controller.dispose();
      inputControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (game.logs.length === 0) {
      return;
    }

    const lastLogId = game.logs[game.logs.length - 1]?.id ?? processedLogIdRef.current;
    if (lastLogId < processedLogIdRef.current) {
      processedLogIdRef.current = 0;
    }
    if (lastLogId <= processedLogIdRef.current) {
      return;
    }

    const completionLogs = game.logs.filter(
      (entry) => entry.id > processedLogIdRef.current && entry.event === 'groups.completed'
    );
    processedLogIdRef.current = lastLogId;

    if (completionLogs.length === 0) {
      return;
    }

    const metrics = gridMetricsRef.current;
    if (metrics.cellSize <= 0) {
      return;
    }

    const nextConfettiPieces: ConfettiPiece[] = [];
    const nextPipeExitPieces: PipeExitPiece[] = [];
    const nextEndpointPieces: EndpointTransitionPiece[] = [];
    const nextHiddenEndpointIds = new Set<string>();

    const nextAnimationId = (): number => {
      const id = animationIdRef.current;
      animationIdRef.current += 1;
      return id;
    };

    for (const entry of completionLogs) {
      const payload = (entry.data ?? {}) as GroupCompletedLogData;
      const completedEndpoints = Array.isArray(payload.completedEndpoints)
        ? payload.completedEndpoints
        : [];
      const completedPipes = Array.isArray(payload.completedPipes)
        ? payload.completedPipes
        : [];
      const groupIds = Array.isArray(payload.groupIds)
        ? payload.groupIds
        : Array.from(new Set(completedEndpoints.map((endpoint) => endpoint.groupId)));
      const groupSet = new Set(groupIds);

      const respawnedEndpoints = game.endpointNodes.filter((endpoint) => groupSet.has(endpoint.groupId));

      for (const pipe of completedPipes) {
        nextPipeExitPieces.push({
          id: nextAnimationId(),
          x: metrics.originX + (pipe.col + 0.5) * metrics.cellSize,
          y: metrics.originY + (pipe.row + 0.5) * metrics.cellSize,
          size: Math.max(20, metrics.cellSize * 0.9),
          kind: pipe.kind,
          orientation: pipe.orientation,
          color: '#f4f7ff'
        });
      }

      completedEndpoints.forEach((endpoint, endpointIndex) => {
        const centerX = metrics.originX + (endpoint.col + 0.5) * metrics.cellSize;
        const centerY = metrics.originY + (endpoint.row + 0.5) * metrics.cellSize;
        const color = ENDPOINT_COLOR_PALETTE[endpoint.colorId % ENDPOINT_COLOR_PALETTE.length] ?? '#ffffff';

        nextEndpointPieces.push({
          id: nextAnimationId(),
          endpointId: endpoint.id,
          x: centerX,
          y: centerY,
          size: Math.max(8, metrics.cellSize * 0.32),
          color,
          mode: 'exit'
        });

        const particlesPerEndpoint = 12;

        for (let index = 0; index < particlesPerEndpoint; index += 1) {
          const id = nextAnimationId();

          const seedBase = entry.id * 997 + endpointIndex * 41 + index * 7;
          const angle = seededRatio(seedBase + 3) * Math.PI * 2;
          const radius = metrics.cellSize * (0.24 + seededRatio(seedBase + 7) * 0.64);
          const lift = metrics.cellSize * (0.2 + seededRatio(seedBase + 11) * 0.5);
          const dx = Math.cos(angle) * radius;
          const dy = Math.sin(angle) * radius - lift;
          const rotate = (seededRatio(seedBase + 13) * 2 - 1) * 320;
          const size = 4 + Math.floor(seededRatio(seedBase + 17) * 4);
          const durationMs = 620 + Math.floor(seededRatio(seedBase + 19) * 380);

          nextConfettiPieces.push({
            id,
            x: centerX,
            y: centerY,
            dx,
            dy,
            size,
            color,
            rotate,
            durationMs
          });
        }
      });

      for (const endpoint of respawnedEndpoints) {
        const color = ENDPOINT_COLOR_PALETTE[endpoint.colorId % ENDPOINT_COLOR_PALETTE.length] ?? '#ffffff';
        nextEndpointPieces.push({
          id: nextAnimationId(),
          endpointId: endpoint.id,
          x: metrics.originX + (endpoint.col + 0.5) * metrics.cellSize,
          y: metrics.originY + (endpoint.row + 0.5) * metrics.cellSize,
          size: Math.max(8, metrics.cellSize * 0.32),
          color,
          mode: 'enter'
        });
        nextHiddenEndpointIds.add(endpoint.id);
      }
    }

    if (nextConfettiPieces.length > 0) {
      setConfettiPieces((current) => [...current, ...nextConfettiPieces]);
    }
    if (nextPipeExitPieces.length > 0) {
      setPipeExitPieces((current) => [...current, ...nextPipeExitPieces]);
    }
    if (nextEndpointPieces.length > 0) {
      setEndpointTransitionPieces((current) => [...current, ...nextEndpointPieces]);
    }
    if (nextHiddenEndpointIds.size > 0) {
      setHiddenEndpointIds((current) => {
        const next = new Set(current);
        for (const endpointId of nextHiddenEndpointIds) {
          next.add(endpointId);
        }
        return next;
      });
    }
  }, [game.logs, game.endpointNodes]);

  const startDragFromOffer = (offerIndex: number, event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    const offer = game.offers[offerIndex];
    if (!offer) {
      return;
    }

    dragOfferRef.current = offerIndex;
    setDrag((current) => ({
      ...current,
      active: true,
      offerIndex,
      pointerClient: { x: event.clientX, y: event.clientY },
      hoveredCell: null
    }));

    inputControllerRef.current?.beginDrag({
      x: event.clientX,
      y: event.clientY
    });
  };

  const clearTransientInteraction = () => {
    if (expandRespawnTimerRef.current !== null) {
      window.clearTimeout(expandRespawnTimerRef.current);
      expandRespawnTimerRef.current = null;
    }
    setDrag(createInitialDragState());
    dragOfferRef.current = null;
    setConfettiPieces([]);
    setPipeExitPieces([]);
    setEndpointTransitionPieces([]);
    setHiddenEndpointIds(new Set());
    processedLogIdRef.current = 0;
  };

  useEffect(() => {
    return () => {
      if (expandRespawnTimerRef.current !== null) {
        window.clearTimeout(expandRespawnTimerRef.current);
        expandRespawnTimerRef.current = null;
      }
    };
  }, []);

  const handleRotateAll = () => {
    setGame((state) => rotateAllOffers(state));
  };

  const handleDiscardAll = () => {
    setGame((state) => discardAllOffers(state));
  };

  const applyManualGridOverride = (nextWidth: number, nextHeight: number) => {
    clearTransientInteraction();
    setGame((state) =>
      ({
        ...initGame({
          gridWidth: clamp(nextWidth, GRID_SIZE_MIN, 9),
          gridHeight: clamp(nextHeight, GRID_SIZE_MIN, 9),
          endpointScenario: state.endpointScenario,
          pipeSpawnEnabled: state.pipeSpawnEnabled,
          score: state.score,
          maxScoreReached: state.maxScoreReached,
          difficultyTiers: state.difficultyTiers,
          appliedDifficultyTierIndex: state.appliedDifficultyTierIndex,
          energy: DEFAULT_ENERGY,
          boosters: DEFAULT_BOOSTERS,
          offerSeed: state.offerSeed + 1
        }),
        showGhostPipes: state.showGhostPipes,
        score: state.score
      })
    );
  };

  const scheduleEndpointRespawnAfterExpand = () => {
    if (expandRespawnTimerRef.current !== null) {
      window.clearTimeout(expandRespawnTimerRef.current);
      expandRespawnTimerRef.current = null;
    }

    expandRespawnTimerRef.current = window.setTimeout(() => {
      setGame((state) =>
        ({
          ...initGame({
            gridWidth: state.gridWidth,
            gridHeight: state.gridHeight,
            endpointScenario: state.endpointScenario,
            pipeSpawnEnabled: state.pipeSpawnEnabled,
            score: state.score,
            maxScoreReached: state.maxScoreReached,
            difficultyTiers: state.difficultyTiers,
            appliedDifficultyTierIndex: state.appliedDifficultyTierIndex,
            energy: DEFAULT_ENERGY,
            boosters: DEFAULT_BOOSTERS,
            offerSeed: state.offerSeed + 1
          }),
          showGhostPipes: state.showGhostPipes,
          score: state.score
        })
      );
      expandRespawnTimerRef.current = null;
    }, GRID_EXPAND_ENDPOINT_RESPAWN_DELAY_MS);
  };

  const handleManualAddWidth = () => {
    clearTransientInteraction();
    setGame((state) => addGridWidth(state));
    scheduleEndpointRespawnAfterExpand();
  };

  const handleManualRemoveWidth = () => {
    applyManualGridOverride(game.gridWidth - 1, game.gridHeight);
  };

  const handleManualAddHeight = () => {
    clearTransientInteraction();
    setGame((state) => addGridHeight(state));
    scheduleEndpointRespawnAfterExpand();
  };

  const handleManualRemoveHeight = () => {
    applyManualGridOverride(game.gridWidth, game.gridHeight - 1);
  };

  const handleGroupSizeInput = (index: number, value: number) => {
    const cap = unlockedTierGroupCaps[index] ?? unlockedTierGroupCaps[unlockedTierGroupCaps.length - 1] ?? 9;
    const nextSize = Number.isFinite(value) ? clamp(value, 1, cap) : 1;
    setGroupSizesInput((current) =>
      current.map((size, currentIndex) => (currentIndex === index ? nextSize : size))
    );
  };

  const handleAddGroup = () => {
    setGroupSizesInput((current) => {
      if (current.length >= unlockedTierGroupCaps.length) {
        return current;
      }
      const fallback = current[current.length - 1] ?? 2;
      const nextIndex = current.length;
      const cap = unlockedTierGroupCaps[nextIndex] ?? unlockedTierGroupCaps[unlockedTierGroupCaps.length - 1] ?? 2;
      return [...current, Math.min(fallback, cap)];
    });
  };

  const handleRemoveGroup = (index: number) => {
    setGroupSizesInput((current) => {
      if (current.length <= 1) {
        return current;
      }
      return current.filter((_, currentIndex) => currentIndex !== index);
    });
  };

  const handleScenarioApply = () => {
    clearTransientInteraction();
    const normalized = clampGroupSizesToCaps(groupSizesInput, unlockedTierGroupCaps);
    setGame((state) =>
      setEndpointScenario(
        state,
        normalized.map((size) => ({ size, groups: 1 }))
      )
    );
  };

  const updateDifficultyTierDrafts = (updater: (tiers: DifficultyTier[]) => DifficultyTier[]) => {
    setDifficultyTierDrafts((current) => {
      const normalizedCurrent = current.map((tier) => normalizeDifficultyTierInput(tier));
      return updater(normalizedCurrent).map((tier) => normalizeDifficultyTierInput(tier));
    });
    setDifficultyTierDraftDirty(true);
  };

  const handleDifficultyTierScoreChange = (index: number, rawValue: string) => {
    setDifficultyTierScoreDrafts((current) => {
      const next = [...current];
      if (index < 0 || index >= next.length) {
        return next;
      }
      next[index] = rawValue;
      return next;
    });
    setDifficultyTierDraftDirty(true);
  };

  const handleDifficultyTierFieldChange = (
    index: number,
    field: keyof DifficultyTier,
    value: number
  ) => {
    updateDifficultyTierDrafts((current) =>
      current.map((tier, tierIndex) => {
        if (tierIndex !== index) {
          return tier;
        }

        const nextTier = { ...tier };
        switch (field) {
          case 'scoreThreshold':
            nextTier.scoreThreshold = sanitizeTierValue(value, 0, 9999);
            break;
          case 'maxGridWidth':
            nextTier.maxGridWidth = sanitizeTierValue(value, GRID_SIZE_MIN, 9);
            break;
          case 'maxGridHeight':
            nextTier.maxGridHeight = sanitizeTierValue(value, GRID_SIZE_MIN, 9);
            break;
          case 'maxGroups':
            {
              const nextGroupCount = sanitizeTierValue(value, 1, 9);
              const currentCaps = normalizeTierGroupCaps(nextTier);
              if (currentCaps.length < nextGroupCount) {
                const fallback = currentCaps[currentCaps.length - 1] ?? nextTier.maxEndpointsPerGroup;
                while (currentCaps.length < nextGroupCount) {
                  currentCaps.push(sanitizeTierValue(fallback, 1, 9));
                }
              } else if (currentCaps.length > nextGroupCount) {
                currentCaps.splice(nextGroupCount);
              }
              nextTier.groupEndpointCaps = currentCaps;
              nextTier.maxGroups = currentCaps.length;
              nextTier.maxEndpointsPerGroup = currentCaps.reduce((max, cap) => Math.max(max, cap), 1);
            }
            break;
        }
        return normalizeDifficultyTierInput(nextTier);
      })
    );
  };

  const handleDifficultyTierGroupCapChange = (
    tierIndex: number,
    groupIndex: number,
    value: number
  ) => {
    updateDifficultyTierDrafts((current) =>
      current.map((tier, currentTierIndex) => {
        if (currentTierIndex !== tierIndex) {
          return tier;
        }

        const caps = normalizeTierGroupCaps(tier);
        if (groupIndex < 0 || groupIndex >= caps.length) {
          return normalizeDifficultyTierInput(tier);
        }

        caps[groupIndex] = sanitizeTierValue(value, 1, 9);
        return normalizeDifficultyTierInput({
          ...tier,
          groupEndpointCaps: caps
        });
      })
    );
  };

  const handleAddDifficultyTier = () => {
    updateDifficultyTierDrafts((current) => {
      const lastTier = normalizeDifficultyTierInput(current[current.length - 1] ?? fallbackDifficultyTier());
      return [
        ...current,
        normalizeDifficultyTierInput({
          scoreThreshold: lastTier.scoreThreshold + 10,
          maxGridWidth: lastTier.maxGridWidth,
          maxGridHeight: lastTier.maxGridHeight,
          maxGroups: lastTier.maxGroups,
          maxEndpointsPerGroup: lastTier.maxEndpointsPerGroup,
          groupEndpointCaps: normalizeTierGroupCaps(lastTier)
        })
      ];
    });
    setDifficultyTierScoreDrafts((current) => {
      const lastScore = Number(current[current.length - 1] ?? '0');
      const nextScore = Number.isFinite(lastScore) ? lastScore + 10 : 10;
      return [...current, String(nextScore)];
    });
  };

  const handleRemoveDifficultyTier = (index: number) => {
    updateDifficultyTierDrafts((current) => {
      if (current.length <= 1 || index === 0) {
        return current;
      }
      return current.filter((_, tierIndex) => tierIndex !== index);
    });
    setDifficultyTierScoreDrafts((current) => {
      if (current.length <= 1 || index === 0) {
        return current;
      }
      return current.filter((_, tierIndex) => tierIndex !== index);
    });
  };

  const handleSaveDifficultyTiers = () => {
    clearTransientInteraction();
    const nextTiers = difficultyTierDrafts.map((tier, tierIndex) => {
      const draft = difficultyTierScoreDrafts[tierIndex];
      const parsed = Number((draft ?? '').trim());
      const scoreThreshold = Number.isFinite(parsed)
        ? sanitizeTierValue(parsed, 0, 9999)
        : tier.scoreThreshold;
      return normalizeDifficultyTierInput({
        ...tier,
        scoreThreshold
      });
    });
    setGame((state) => setDifficultyTiers(state, nextTiers));
    setDifficultyTierDrafts(nextTiers);
    setDifficultyTierScoreDrafts(scoreDraftsFromTiers(nextTiers));
    persistDifficultyTiers(nextTiers);
    setDifficultyTierDraftDirty(false);
  };

  const handlePipeSpawnToggle = (kind: PipeKind, enabled: boolean) => {
    clearTransientInteraction();
    setGame((state) => setPipeSpawnEnabled(state, kind, enabled));
  };

  const handleGhostPreviewToggle = (enabled: boolean) => {
    setGame((state) => setShowGhostPipes(state, enabled));
  };

  const handleScoreReset = () => {
    setGame((state) => resetScore(state));
  };

  const handleResetBoard = () => {
    clearTransientInteraction();
    setGame((state) =>
      ({
        ...initGame({
          gridSize: state.gridSize,
          gridWidth: state.gridWidth,
          gridHeight: state.gridHeight,
          endpointScenario: state.endpointScenario,
          pipeSpawnEnabled: state.pipeSpawnEnabled,
          score: state.score,
          maxScoreReached: state.maxScoreReached,
          difficultyTiers: state.difficultyTiers,
          appliedDifficultyTierIndex: state.appliedDifficultyTierIndex,
          energy: DEFAULT_ENERGY,
          boosters: DEFAULT_BOOSTERS,
          offerSeed: state.offerSeed + 1
        }),
        showGhostPipes: state.showGhostPipes,
        score: state.score
      })
    );
  };

  const handleResetGame = () => {
    clearTransientInteraction();
    setGame((state) => {
      const baseTier = state.difficultyTiers[0] ?? fallbackDifficultyTier();
      const baseScenario = baseScenarioForTier(baseTier);
      setGroupSizesInput(scenarioToGroupSizes(baseScenario));

      return initGame({
        difficultyTiers: state.difficultyTiers,
        gridWidth: baseTier.maxGridWidth,
        gridHeight: baseTier.maxGridHeight,
        endpointScenario: baseScenario,
        pipeSpawnEnabled: state.pipeSpawnEnabled,
        score: 0,
        maxScoreReached: 0,
        appliedDifficultyTierIndex: 0,
        energy: DEFAULT_ENERGY,
        boosters: DEFAULT_BOOSTERS,
        offerSeed: 0
      });
    });
  };

  const handleToggleSettings = () => {
    setSettingsOpen((current) => !current);
  };

  const handleCloseSettings = () => {
    setSettingsOpen(false);
  };

  const normalizedGroupSizes = clampGroupSizesToCaps(groupSizesInput, unlockedTierGroupCaps);
  const groupInputWasClamped =
    normalizedGroupSizes.length !== groupSizesInput.length ||
    normalizedGroupSizes.some((size, index) => size !== groupSizesInput[index]);
  const gridCapacity = game.gridWidth * game.gridHeight;
  const requestedEndpoints = normalizedGroupSizes.reduce((sum, size) => sum + size, 0);
  const setupOverGridCapacity = requestedEndpoints > gridCapacity;

  return (
    <div className="preview-root">
      <div className="workspace-layout">
        <div className="mobile-preview">
          <div className="app-shell">
            <main className="canvas-wrap" ref={canvasWrapRef}>
              <canvas ref={canvasRef} className="game-canvas" />
              <div className="completion-layer" aria-hidden="true">
                {pipeExitPieces.map((piece) => (
                  <span
                    key={piece.id}
                    className="completion-pipe completion-exit"
                    style={
                      {
                        left: piece.x,
                        top: piece.y,
                        width: piece.size,
                        height: piece.size
                      } as React.CSSProperties
                    }
                    onAnimationEnd={() => {
                      setPipeExitPieces((current) =>
                        current.filter((currentPiece) => currentPiece.id !== piece.id)
                      );
                    }}
                  >
                    <PipeGlyph
                      kind={piece.kind}
                      orientation={piece.orientation}
                      color={piece.color}
                      className="completion-pipe-glyph"
                    />
                  </span>
                ))}
                {endpointTransitionPieces.map((piece) => (
                  <span
                    key={piece.id}
                    className={[
                      'completion-endpoint',
                      piece.mode === 'enter' ? 'completion-enter' : 'completion-exit'
                    ].join(' ')}
                    style={
                      {
                        left: piece.x,
                        top: piece.y,
                        width: piece.size,
                        height: piece.size,
                        backgroundColor: piece.color
                      } as React.CSSProperties
                    }
                    onAnimationEnd={() => {
                      setEndpointTransitionPieces((current) =>
                        current.filter((currentPiece) => currentPiece.id !== piece.id)
                      );
                      if (piece.mode === 'enter') {
                        setHiddenEndpointIds((current) => {
                          if (!current.has(piece.endpointId)) {
                            return current;
                          }
                          const next = new Set(current);
                          next.delete(piece.endpointId);
                          return next;
                        });
                      }
                    }}
                  />
                ))}
              </div>
              <div className="confetti-layer" aria-hidden="true">
                {confettiPieces.map((piece) => (
                  <span
                    key={piece.id}
                    className="confetti-piece"
                    style={
                      {
                        left: piece.x,
                        top: piece.y,
                        width: piece.size,
                        height: Math.max(2, piece.size * 0.56),
                        backgroundColor: piece.color,
                        '--confetti-dx': `${piece.dx}px`,
                        '--confetti-dy': `${piece.dy}px`,
                        '--confetti-rotate': `${piece.rotate}deg`,
                        '--confetti-duration': `${piece.durationMs}ms`
                      } as React.CSSProperties
                    }
                    onAnimationEnd={() => {
                      setConfettiPieces((current) =>
                        current.filter((currentPiece) => currentPiece.id !== piece.id)
                      );
                    }}
                  />
                ))}
              </div>
            </main>

            <footer className="offers-panel">
              <div className="offer-actions-row">
                <span className="energy-pill">Energy {game.energy}</span>
                <div className="offer-actions">
                  <button
                    type="button"
                    className="action-btn rotate-btn-global"
                    onClick={handleRotateAll}
                    disabled={game.offers.length === 0 || game.boosters <= 0}
                  >
                    <RotateIcon />
                    <span>Rotate {game.boosters}</span>
                  </button>
                  <button
                    type="button"
                    className="action-btn discard-btn-global"
                    onClick={handleDiscardAll}
                    disabled={game.offers.length === 0 || game.energy <= 0}
                  >
                    <DiscardIcon />
                    <span>Discard</span>
                  </button>
                </div>
              </div>

              <div className={game.offers.length === 1 ? 'offers-grid offers-grid-single' : 'offers-grid'}>
                {game.offers.map((offer, index) => {
                  return (
                    <div
                      key={offer.id}
                      className={[
                        'offer-card',
                        drag.offerIndex === index ? 'offer-active' : ''
                      ].join(' ')}
                    >
                      <div className="offer-head">
                        <span>{offer.kind}</span>
                      </div>

                      <div
                        className="offer-preview-wrap"
                        onPointerDown={(event) => startDragFromOffer(index, event)}
                      >
                        <PipeShapePreview
                          kind={offer.kind}
                          orientation={offer.orientation}
                          color="#ffffff"
                          className="pipe-preview"
                        />
                        <span className="offer-drag-label">Drag to board</span>
                      </div>

                    </div>
                  );
                })}
              </div>
            </footer>
          </div>
        </div>

      </div>

      <button
        type="button"
        className={`settings-toggle ${settingsOpen ? 'settings-toggle-open' : ''}`}
        onClick={handleToggleSettings}
        aria-expanded={settingsOpen}
        aria-controls="settings-panel"
        aria-label={settingsOpen ? 'Close settings' : 'Open settings'}
      >
        <GearIcon />
        <span className="settings-toggle-label">Settings</span>
      </button>

      <button
        type="button"
        className={`settings-backdrop ${settingsOpen ? 'settings-backdrop-open' : ''}`}
        onClick={handleCloseSettings}
        aria-label="Close settings panel"
      />

      <aside
        id="settings-panel"
        className={`side-panel settings-dropdown ${settingsOpen ? 'settings-dropdown-open' : ''}`}
        aria-hidden={!settingsOpen}
      >
        <div className="settings-panel-head">
          <h2>Settings</h2>
          <button
            type="button"
            className="settings-close"
            onClick={handleCloseSettings}
            aria-label="Close settings"
          >
            x
          </button>
        </div>
          <div className="score-panel">
            <div className="score-readout">
              <span>Score</span>
              <strong>{game.score}</strong>
              <small>Max {game.maxScoreReached}</small>
            </div>
            <button type="button" className="score-reset" onClick={handleScoreReset}>
              Reset Score
            </button>
          </div>

          <div className="admin-reset-row">
            <button type="button" className="admin-reset" onClick={handleResetBoard}>
              Reset Board
            </button>
            <button type="button" className="admin-reset admin-reset-danger" onClick={handleResetGame}>
              Reset Game
            </button>
          </div>

          <div className="control-group">
            <label>Manual Grid Override</label>
            <span>
              Current {game.gridWidth} x {game.gridHeight}
            </span>
            <div className="manual-grid-buttons">
              <button
                type="button"
                onClick={handleManualRemoveWidth}
                disabled={game.gridWidth <= GRID_SIZE_MIN}
              >
                - Width
              </button>
              <button
                type="button"
                onClick={handleManualAddWidth}
                disabled={game.gridWidth >= 9}
              >
                + Width
              </button>
              <button
                type="button"
                onClick={handleManualRemoveHeight}
                disabled={game.gridHeight <= GRID_SIZE_MIN}
              >
                - Height
              </button>
              <button
                type="button"
                onClick={handleManualAddHeight}
                disabled={game.gridHeight >= 9}
              >
                + Height
              </button>
            </div>
            <span>
              Manual override ignores progression caps and resets the board.
            </span>
          </div>

          <div className="control-group">
            <label htmlFor="scenario-groups">Endpoint Setup</label>
            <div className="group-editor">
              {groupSizesInput.map((size, index) => (
                <div className="group-editor-row" key={`group-size-${index}`}>
                  <span className="group-editor-label">Group {index + 1}</span>
                  <input
                    id={index === 0 ? 'scenario-groups' : undefined}
                    type="number"
                    min={1}
                    max={unlockedTierGroupCaps[index] ?? unlockedTierGroupCaps[unlockedTierGroupCaps.length - 1] ?? 9}
                    step={1}
                    value={size}
                    onChange={(event) => handleGroupSizeInput(index, Number(event.target.value))}
                  />
                  <span className="group-editor-unit">endpoints</span>
                  <button
                    type="button"
                    className="group-editor-remove"
                    onClick={() => handleRemoveGroup(index)}
                    disabled={groupSizesInput.length <= 1}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="group-editor-add"
                onClick={handleAddGroup}
                disabled={groupSizesInput.length >= unlockedTierGroupCaps.length}
              >
                Add Group
              </button>
            </div>
            <span>
              Unlocked setup: {unlockedTierGroupCaps.map((cap, index) => `G${index + 1}:${cap}`).join(', ')}.
            </span>
            {groupInputWasClamped && (
              <span>
                Input was clamped to current unlocked setup limits.
              </span>
            )}
            <span>
              Total Endpoints {requestedEndpoints}
            </span>
            {setupOverGridCapacity && (
              <span>
                Requested endpoints exceed grid capacity.
              </span>
            )}
            <button
              type="button"
              onClick={handleScenarioApply}
              disabled={setupOverGridCapacity}
            >
              Apply Scenario
            </button>
          </div>

          <div className="control-group">
            <label>Difficulty Ramp</label>
            <div className="tier-editor">
              {difficultyTierDrafts.map((tier, index) => {
                const groupCaps = normalizeTierGroupCaps(tier);
                return (
                  <div
                    className={[
                      'tier-editor-row',
                      index <= unlockedTierIndex ? 'tier-editor-row-unlocked' : '',
                      index === unlockedTierIndex ? 'tier-editor-row-active' : ''
                    ].join(' ').trim()}
                    key={`difficulty-tier-${index}`}
                  >
                    <div className="tier-editor-main">
                      <span className="tier-editor-label">
                        Tier {index + 1}
                      </span>
                      <label>
                        Score
                        <input
                          type="text"
                          inputMode="numeric"
                          value={difficultyTierScoreDrafts[index] ?? String(tier.scoreThreshold)}
                          onChange={(event) =>
                            handleDifficultyTierScoreChange(index, event.target.value)
                          }
                        />
                      </label>
                      <label>
                        W
                        <input
                          type="number"
                          min={GRID_SIZE_MIN}
                          max={9}
                          step={1}
                          value={tier.maxGridWidth}
                          onChange={(event) =>
                            handleDifficultyTierFieldChange(index, 'maxGridWidth', Number(event.target.value))
                          }
                        />
                      </label>
                      <label>
                        H
                        <input
                          type="number"
                          min={GRID_SIZE_MIN}
                          max={9}
                          step={1}
                          value={tier.maxGridHeight}
                          onChange={(event) =>
                            handleDifficultyTierFieldChange(index, 'maxGridHeight', Number(event.target.value))
                          }
                        />
                      </label>
                      <label>
                        Groups
                        <input
                          type="number"
                          min={1}
                          max={9}
                          step={1}
                          value={groupCaps.length}
                          onChange={(event) =>
                            handleDifficultyTierFieldChange(index, 'maxGroups', Number(event.target.value))
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="tier-editor-remove"
                        onClick={() => handleRemoveDifficultyTier(index)}
                        disabled={index === 0 || difficultyTierDrafts.length <= 1}
                      >
                        Remove
                      </button>
                    </div>

                    <div className="tier-group-caps">
                      {groupCaps.map((cap, groupIndex) => {
                        const color = ENDPOINT_COLOR_PALETTE[groupIndex % ENDPOINT_COLOR_PALETTE.length] ?? '#8ab8d8';
                        return (
                          <label
                            key={`tier-${index}-group-${groupIndex}`}
                            className="tier-group-cap"
                            style={
                              {
                                borderColor: `${color}AA`,
                                backgroundColor: `${color}1E`
                              } as React.CSSProperties
                            }
                          >
                            <span style={{ color }}>G{groupIndex + 1}</span>
                            <input
                              type="number"
                              min={1}
                              max={9}
                              step={1}
                              value={cap}
                              onChange={(event) =>
                                handleDifficultyTierGroupCapChange(index, groupIndex, Number(event.target.value))
                              }
                            />
                            <small>endpoints</small>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <div className="tier-editor-actions">
                <button type="button" onClick={handleAddDifficultyTier}>
                  Add Tier
                </button>
                <button
                  type="button"
                  onClick={handleSaveDifficultyTiers}
                  disabled={!difficultyTierDraftDirty}
                >
                  Save Progression
                </button>
                <span className="tier-editor-autosave">
                  {difficultyTierDraftDirty ? 'Unsaved changes' : 'Saved'}
                </span>
              </div>
            </div>
            <span>
              Active tier {unlockedTierIndex + 1} of {game.difficultyTiers.length}
              {' '}
              ({unlockedTier.maxGridWidth}x{unlockedTier.maxGridHeight},
              {' '}
              groups: {unlockedTierGroupCaps.map((cap, index) => `G${index + 1}:${cap}`).join(', ')}
              ).
            </span>
          </div>

          <div className="spawn-toggle-group">
            <strong>Pipe Types</strong>
            {PIPE_KIND_ORDER.map((kind) => (
              <label className="toggle-control" htmlFor={`spawn-${kind}`} key={`spawn-${kind}`}>
                <input
                  id={`spawn-${kind}`}
                  type="checkbox"
                  checked={game.pipeSpawnEnabled[kind]}
                  onChange={(event) => handlePipeSpawnToggle(kind, event.target.checked)}
                />
                <span>{PIPE_KIND_LABEL[kind]}</span>
              </label>
            ))}
            <label className="toggle-control" htmlFor="show-ghost-pipes">
              <input
                id="show-ghost-pipes"
                type="checkbox"
                checked={game.showGhostPipes}
                onChange={(event) => handleGhostPreviewToggle(event.target.checked)}
              />
              <span>Show Ghost Solution</span>
            </label>
          </div>

          <div className="game-log-panel">
            <div className="game-log-head">
              <strong>Event Log</strong>
              <span>{game.logs.length}</span>
            </div>
            <div className="game-log-list">
              {game.logs
                .slice(Math.max(0, game.logs.length - 120))
                .slice()
                .reverse()
                .map((entry) => (
                  <div key={entry.id} className="game-log-row">
                    <div className="game-log-meta">
                      <span>#{entry.id}</span>
                      <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                      <span>{entry.event}</span>
                    </div>
                    <div className="game-log-message">{entry.message}</div>
                  </div>
                ))}
            </div>
          </div>
        </aside>

      {drag.active && activeOffer && drag.pointerClient && (
        <div
          className="drag-ghost"
          style={{
            left: drag.pointerClient.x,
            top: drag.pointerClient.y
          }}
        >
          <PipeShapePreview
            kind={activeOffer.kind}
            orientation={activeOffer.orientation}
            color="#ffffff"
            className="drag-ghost-pipe"
          />
        </div>
      )}
    </div>
  );
}
