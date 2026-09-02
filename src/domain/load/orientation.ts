import type { CartonOrientation, NormalizedCargo } from "./types.js";

export function generateCartonOrientations(dimensions: NormalizedCargo["dimensions"]): CartonOrientation[] {
  const candidates: CartonOrientation[] = [
    { lengthMm: dimensions.lengthMm, widthMm: dimensions.widthMm, heightMm: dimensions.heightMm },
    { lengthMm: dimensions.lengthMm, widthMm: dimensions.heightMm, heightMm: dimensions.widthMm },
    { lengthMm: dimensions.widthMm, widthMm: dimensions.lengthMm, heightMm: dimensions.heightMm },
    { lengthMm: dimensions.widthMm, widthMm: dimensions.heightMm, heightMm: dimensions.lengthMm },
    { lengthMm: dimensions.heightMm, widthMm: dimensions.lengthMm, heightMm: dimensions.widthMm },
    { lengthMm: dimensions.heightMm, widthMm: dimensions.widthMm, heightMm: dimensions.lengthMm },
  ];
  const seen = new Set<string>();
  const orientations: CartonOrientation[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.lengthMm}:${candidate.widthMm}:${candidate.heightMm}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    orientations.push(candidate);
  }

  return orientations;
}
