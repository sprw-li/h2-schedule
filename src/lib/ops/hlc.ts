import type { Hlc } from './types'

export function compareHlc(a: Hlc | null | undefined, b: Hlc | null | undefined): number {
  if (!a && !b) return 0
  if (!a) return -1
  if (!b) return 1
  if (a.wall !== b.wall) return a.wall < b.wall ? -1 : 1
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1
  const da = String(a.device ?? '')
  const db = String(b.device ?? '')
  if (da === db) return 0
  return da < db ? -1 : 1
}

/** Mutable per-device HLC clock (persisted via queue / in-memory). */
export class HlcClock {
  wall: number
  counter: number
  device: string

  constructor(device: string, wall = 0, counter = 0) {
    this.device = device
    this.wall = wall
    this.counter = counter
  }

  /** Tick for a new local op. */
  tick(now = Date.now()): Hlc {
    const phys = now
    if (phys > this.wall) {
      this.wall = phys
      this.counter = 0
    } else {
      this.counter += 1
    }
    return { wall: this.wall, counter: this.counter, device: this.device }
  }

  /** Observe a remote HLC (causal lift). */
  observe(remote: Hlc, now = Date.now()) {
    const phys = now
    const maxWall = Math.max(phys, remote.wall, this.wall)
    if (maxWall === this.wall && maxWall === remote.wall) {
      this.counter = Math.max(this.counter, remote.counter) + 1
    } else if (maxWall === this.wall) {
      this.counter += 1
    } else {
      this.wall = maxWall
      this.counter = maxWall === remote.wall ? remote.counter + 1 : 0
    }
  }

  snapshot(): Hlc {
    return { wall: this.wall, counter: this.counter, device: this.device }
  }
}
