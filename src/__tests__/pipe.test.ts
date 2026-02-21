import { describe, expect, it } from 'vitest';
import { Direction, areEdgesConnected, rotateMask } from '../Pipe';

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
});
