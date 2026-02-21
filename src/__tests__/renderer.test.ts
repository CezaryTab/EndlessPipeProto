import { describe, expect, it } from 'vitest';
import { ENDPOINT_COLOR_PALETTE } from '../GameState';
import { ROUTE_PREVIEW_STYLE_BY_ID } from '../Renderer';

describe('Route preview styles', () => {
  it('uses fixed difficulty colors and dash patterns', () => {
    expect(ROUTE_PREVIEW_STYLE_BY_ID.easy.color).toBe('#4fdf7f');
    expect(ROUTE_PREVIEW_STYLE_BY_ID.medium.color).toBe('#f4d24d');
    expect(ROUTE_PREVIEW_STYLE_BY_ID.hard.color).toBe('#ff6464');

    expect(ROUTE_PREVIEW_STYLE_BY_ID.easy.dash).toEqual([1, 12]);
    expect(ROUTE_PREVIEW_STYLE_BY_ID.medium.dash).toEqual([1, 8]);
    expect(ROUTE_PREVIEW_STYLE_BY_ID.hard.dash).toEqual([1, 5]);
  });

  it('keeps route preview colors independent from endpoint palette', () => {
    const endpointColors = new Set(ENDPOINT_COLOR_PALETTE.map((color) => color.toLowerCase()));
    const routeColors = [
      ROUTE_PREVIEW_STYLE_BY_ID.easy.color,
      ROUTE_PREVIEW_STYLE_BY_ID.medium.color,
      ROUTE_PREVIEW_STYLE_BY_ID.hard.color
    ];

    for (const color of routeColors) {
      expect(endpointColors.has(color.toLowerCase())).toBe(false);
    }
  });
});
