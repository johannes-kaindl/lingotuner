import type { Dimension } from "../dials";

export type ExampleLevel = -2 | -1 | 1 | 2;

export interface ExamplePair {
  dimension: Dimension;
  level: ExampleLevel;
  before: string;
  after: string;
}

export type ExampleKey = `${Dimension}:${ExampleLevel}`;

export function exampleKey(dim: Dimension, level: ExampleLevel): ExampleKey {
  return `${dim}:${level}`;
}
