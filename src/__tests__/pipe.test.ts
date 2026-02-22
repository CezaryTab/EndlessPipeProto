import { describe, expect, it } from 'vitest';
import {
  ALL_DIRECTIONS,
  Direction,
  areEdgesConnected,
  isDirectionOpen,
  rotateMask,
  type Orientation,
  type PipeKind
} from '../Pipe';

const ORIENTATIONS: Orientation[] = [0, 90, 180, 270];
const PIPE_KINDS: PipeKind[] = ['straight', 'elbow', 'tee', 'cross', 'doubleElbow'];

describe('Pipe helpers', () => {
  it('rotates mask clockwise by orientation', () => {
    const vertical = Direction.N | Direction.S;
    const horizontal = rotateMask(vertical, 90);

    expect((horizontal & Direction.E) !== 0).toBe(true);
    expect((horizontal & Direction.W) !== 0).toBe(true);
    expect((horizontal & Direction.N) !== 0).toBe(false);
  });

  it('supports custom pair connectivity for double elbow', () => {
    expect(areEdgesConnected('doubleElbow', 0, Direction.N, Direction.E)).toBe(true);
    expect(areEdgesConnected('doubleElbow', 0, Direction.S, Direction.W)).toBe(true);
    expect(areEdgesConnected('doubleElbow', 0, Direction.N, Direction.S)).toBe(false);
    expect(areEdgesConnected('doubleElbow', 0, Direction.E, Direction.W)).toBe(false);
  });

  it('keeps connectivity symmetric and never connects through closed sides', () => {
    let caseCount = 0;

    for (const kind of PIPE_KINDS) {
      for (const orientation of ORIENTATIONS) {
        for (const from of ALL_DIRECTIONS) {
          for (const to of ALL_DIRECTIONS) {
            caseCount += 1;
            const forward = areEdgesConnected(kind, orientation, from, to);
            const backward = areEdgesConnected(kind, orientation, to, from);

            expect(forward, `${kind}@${orientation} symmetry ${from}->${to}`).toBe(backward);

            if (!isDirectionOpen(kind, orientation, from) || !isDirectionOpen(kind, orientation, to)) {
              expect(forward, `${kind}@${orientation} closed side ${from}->${to}`).toBe(false);
            }

            if (from === to) {
              expect(forward, `${kind}@${orientation} self-edge ${from}`).toBe(false);
            }
          }
        }
      }
    }

    expect(caseCount).toBe(320);
  });

  it('cross keeps channels separated from orthogonal turns', () => {
    for (const orientation of ORIENTATIONS) {
      expect(areEdgesConnected('cross', orientation, Direction.N, Direction.S)).toBe(true);
      expect(areEdgesConnected('cross', orientation, Direction.E, Direction.W)).toBe(true);
      expect(areEdgesConnected('cross', orientation, Direction.N, Direction.E)).toBe(false);
      expect(areEdgesConnected('cross', orientation, Direction.N, Direction.W)).toBe(false);
      expect(areEdgesConnected('cross', orientation, Direction.S, Direction.E)).toBe(false);
      expect(areEdgesConnected('cross', orientation, Direction.S, Direction.W)).toBe(false);
    }
  });

  it('tee connects every pair of open directions in all orientations', () => {
    for (const orientation of ORIENTATIONS) {
      const openDirections = ALL_DIRECTIONS.filter((direction) =>
        isDirectionOpen('tee', orientation, direction)
      );
      expect(openDirections.length).toBe(3);

      for (const from of openDirections) {
        for (const to of openDirections) {
          if (from === to) {
            continue;
          }
          expect(areEdgesConnected('tee', orientation, from, to)).toBe(true);
        }
      }
    }
  });
});
