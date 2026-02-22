import type { Orientation, PipeKind } from './Pipe';

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
}

export type TileGrid = (PlacedPipe | null)[][];

export type PipeSpawnEnabled = Record<PipeKind, boolean>;

export function parseEndpointScenario(input: string): EndpointScenario {
  const trimmed = input.trim();
  if (!trimmed) {
    return [{ size: 2, groups: 1 }];
  }

  const terms: EndpointScenario = [];
  const parts = trimmed
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    const match = part.match(/^(\d+)\s*x\s*(\d+)$/i);
    if (!match) {
      continue;
    }

    let size = Number(match[1]);
    let groups = Number(match[2]);

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
