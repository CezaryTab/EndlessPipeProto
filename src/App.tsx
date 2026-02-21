import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_BOOSTERS,
  DEFAULT_ENERGY,
  DEFAULT_ENDPOINT_SCENARIO_LABEL,
  DEFAULT_GRID_SIZE,
  applyRouteFallbackChoice,
  canPlaceOffer,
  clearConnectedPathAfterBurst,
  consumePendingFlow,
  discardAllOffers,
  deriveRouteDifficultyWindow,
  initGame,
  parseScenarioFromLabel,
  placeOffer,
  rotateAllOffers,
  setEndpointScenario,
  setGridSize,
  setHoveredCell,
  setOfferDifficulty,
  setPipeSpawnEnabled,
  setRoutePreviewEnabled,
  type GameState
} from './GameState';
import {
  createInputController,
  type GridMetrics as InputGridMetrics,
  type InputController,
  type PointerPoint
} from './Input';
import { renderFrame, type DragRenderState, type GridRenderMetrics } from './Renderer';
import { createIdleAnimationState, startFlowAnimation, tickAnimation } from './Animation';
import {
  ALL_DIRECTIONS,
  directionToDelta,
  getPipeTopology,
  type Orientation,
  type PipeKind
} from './Pipe';
import type { Cell, RouteId } from './RouteSolver';

interface DragState {
  active: boolean;
  offerIndex: number | null;
  pointerClient: PointerPoint | null;
  hoveredCell: Cell | null;
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

const ROUTE_IDS: RouteId[] = ['easy', 'medium', 'hard'];

const PIPE_KIND_ORDER: PipeKind[] = ['straight', 'elbow', 'doubleElbow', 'tee', 'cross'];
const PIPE_KIND_LABEL: Record<PipeKind, string> = {
  straight: 'Straight',
  elbow: 'Elbow',
  doubleElbow: 'Double Elbow (X)',
  tee: 'T',
  cross: 'Cross'
};

const SCENARIO_PRESETS = ['2x1', '3x1', '2x2', '2x3', '2x2 + 1x3'];

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
      {kind !== 'doubleElbow' &&
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
      {kind !== 'doubleElbow' && <circle cx={center} cy={center} r={7} fill={color} />}
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

export default function App(): JSX.Element {
  const [game, setGame] = useState<GameState>(() => initGame({ gridSize: DEFAULT_GRID_SIZE }));
  const [animation, setAnimation] = useState(createIdleAnimationState);
  const [drag, setDrag] = useState<DragState>(createInitialDragState);
  const [canvasSize, setCanvasSize] = useState({ width: 640, height: 640 });
  const [scenarioText, setScenarioText] = useState(DEFAULT_ENDPOINT_SCENARIO_LABEL);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const gridMetricsRef = useRef<GridRenderMetrics>({
    originX: 0,
    originY: 0,
    cellSize: 0,
    gridSize: game.gridSize
  });
  const inputControllerRef = useRef<InputController | null>(null);
  const dragOfferRef = useRef<number | null>(null);

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
  const routeDifficultyWindow = useMemo(
    () => deriveRouteDifficultyWindow(game.offerDifficulty),
    [game.offerDifficulty]
  );

  useEffect(() => {
    setScenarioText(game.endpointScenario.map((term) => `${term.size}x${term.groups}`).join(' + '));
  }, [game.endpointScenario]);

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
      animation,
      drag: dragRenderModel,
      width: canvasSize.width,
      height: canvasSize.height
    });

    gridMetricsRef.current = metrics;
  }, [game, animation, drag, hoverValidity, activeOffer, canvasSize]);

  useEffect(() => {
    let frameId = 0;
    let lastTime = performance.now();

    const loop = (time: number) => {
      const delta = time - lastTime;
      lastTime = time;

      setAnimation((current) => {
        const result = tickAnimation(current, delta);
        if (result.event === 'cleanup' && result.completedPath.length > 0) {
          setGame((state) => clearConnectedPathAfterBurst(state, result.completedPath));
        }
        return result.state;
      });

      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frameId);
    };
  }, []);

  useEffect(() => {
    if (game.pendingFlowPath && game.pendingFlowPath.length > 0 && animation.phase === 'idle') {
      setAnimation(startFlowAnimation(game.pendingFlowPath, game.pendingFlowColor ?? '#4ed4a8'));
      setGame((state) => consumePendingFlow(state));
    }
  }, [game.pendingFlowPath, game.pendingFlowColor, animation.phase]);

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
          gridSize: metrics.gridSize
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

  const startDragFromOffer = (offerIndex: number, event: React.PointerEvent<HTMLDivElement>) => {
    if (animation.phase !== 'idle') {
      return;
    }

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
    setAnimation(createIdleAnimationState());
    setDrag(createInitialDragState());
    dragOfferRef.current = null;
  };

  const handleRotateAll = () => {
    setGame((state) => rotateAllOffers(state));
  };

  const handleDiscardAll = () => {
    setGame((state) => discardAllOffers(state));
  };

  const handleGridSizeChange = (value: number) => {
    clearTransientInteraction();
    setGame((state) => setGridSize(state, clamp(value, 3, 9)));
  };

  const handleScenarioPreset = (value: string) => {
    setScenarioText(value);
    clearTransientInteraction();
    setGame((state) => setEndpointScenario(state, parseScenarioFromLabel(value)));
  };

  const handleScenarioApply = () => {
    clearTransientInteraction();
    setGame((state) => setEndpointScenario(state, parseScenarioFromLabel(scenarioText)));
  };

  const handleRoutePreviewToggle = (enabled: boolean) => {
    setGame((state) => setRoutePreviewEnabled(state, enabled));
  };

  const handlePipeSpawnToggle = (kind: PipeKind, enabled: boolean) => {
    clearTransientInteraction();
    setGame((state) => setPipeSpawnEnabled(state, kind, enabled));
  };

  const handleOfferDifficultyChange = (value: number) => {
    clearTransientInteraction();
    setGame((state) => setOfferDifficulty(state, clamp(value, 0, 100)));
  };

  const handleReset = () => {
    clearTransientInteraction();
    setGame((state) =>
      initGame({
        gridSize: state.gridSize,
        endpointScenario: state.endpointScenario,
        pipeSpawnEnabled: state.pipeSpawnEnabled,
        offerDifficulty: state.offerDifficulty,
        showRoutePreviews: state.showRoutePreviews,
        energy: DEFAULT_ENERGY,
        boosters: DEFAULT_BOOSTERS,
        offerSeed: state.offerSeed + 1
      })
    );
  };

  return (
    <div className="preview-root">
      <div className="workspace-layout">
        <div className="mobile-preview">
          <div className="app-shell">
            <main className="canvas-wrap" ref={canvasWrapRef}>
              <canvas ref={canvasRef} className="game-canvas" />
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

          {game.modal && (
            <div className="modal-backdrop" role="dialog" aria-modal="true">
              <div className="modal-card">
                <h2>{game.modal.type === 'blockedBoard' ? 'No Moves Possible' : 'Route Recovery Required'}</h2>
                <p>{game.modal.message}</p>
                <div className="modal-actions">
                  {game.modal.type !== 'blockedBoard' && (
                    <button
                      type="button"
                      onClick={() => setGame((state) => applyRouteFallbackChoice(state, 'respawnEndpoints'))}
                    >
                      Respawn Endpoints
                    </button>
                  )}
                  <button
                    type="button"
                    className="danger"
                    onClick={() => setGame((state) => applyRouteFallbackChoice(state, 'resetBoard'))}
                  >
                    {game.modal.type === 'blockedBoard' ? 'Clear Board' : 'Reset Board'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="side-panel settings-side">
          <h2>Settings</h2>

          <div className="control-group">
            <label htmlFor="grid-size">Grid Size</label>
            <input
              id="grid-size"
              type="range"
              min={3}
              max={9}
              value={game.gridSize}
              onChange={(event) => handleGridSizeChange(Number(event.target.value))}
            />
            <span>{game.gridSize} x {game.gridSize}</span>
          </div>

          <div className="control-group">
            <label htmlFor="scenario-select">Endpoint Scenario</label>
            <select
              id="scenario-select"
              value={SCENARIO_PRESETS.includes(scenarioText) ? scenarioText : ''}
              onChange={(event) => handleScenarioPreset(event.target.value)}
            >
              <option value="">Custom</option>
              {SCENARIO_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={scenarioText}
              onChange={(event) => setScenarioText(event.target.value)}
              placeholder="2x2 + 1x3"
            />
            <button type="button" onClick={handleScenarioApply}>
              Apply Scenario
            </button>
          </div>

          <label className="toggle-control" htmlFor="route-preview-toggle">
            <input
              id="route-preview-toggle"
              type="checkbox"
              checked={game.showRoutePreviews}
              onChange={(event) => handleRoutePreviewToggle(event.target.checked)}
            />
            <span>Show Dotted Route Previews</span>
          </label>

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
          </div>

          <button type="button" className="admin-reset" onClick={handleReset}>
            Reset Board
          </button>

          <div className="route-tuning">
            <div className="control-group">
              <label htmlFor="offer-difficulty">Offer Difficulty (0-100)</label>
              <input
                id="offer-difficulty"
                type="range"
                min={0}
                max={100}
                value={game.offerDifficulty}
                onChange={(event) => handleOfferDifficultyChange(Number(event.target.value))}
              />
              <span>{game.offerDifficulty}</span>
            </div>
          </div>

          <div className="route-lane-fixed">
            <strong>Preview Lanes (Current)</strong>
            <span>Easy {routeDifficultyWindow.easy}</span>
            <span>Medium {routeDifficultyWindow.medium}</span>
            <span>Hard {routeDifficultyWindow.hard}</span>
          </div>

          <div className="route-stats route-stats-external">
            {ROUTE_IDS.map((routeId) => {
              const route = game.routes.find((item) => item.id === routeId);
              return (
                <div key={routeId} className={`route-chip route-${routeId}`}>
                  <strong>{routeId}</strong>
                  <span>Length {route?.length ?? '-'}</span>
                  <span>Turns {route?.turns ?? '-'}</span>
                  <span>Complexity {route?.complexity ?? '-'}</span>
                </div>
              );
            })}
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
      </div>

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
