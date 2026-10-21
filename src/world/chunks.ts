import { CHUNK_SIZE } from '../config';

export const chunkIndex = (v: number): number => Math.floor(v / CHUNK_SIZE);
export const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`;
export const chunkCenter = (c: number): number => (c + 0.5) * CHUNK_SIZE;
export const chunkOrigin = (c: number): number => c * CHUNK_SIZE;
