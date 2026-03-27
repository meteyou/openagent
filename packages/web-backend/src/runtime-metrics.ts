export class RuntimeMetrics {
  private activeRequests = 0
  private externalQueueDepths = new Map<string, number>()

  startRequest(): void {
    this.activeRequests++
  }

  endRequest(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1)
  }

  setQueueDepth(source: string, depth: number): void {
    if (!Number.isFinite(depth) || depth <= 0) {
      this.externalQueueDepths.delete(source)
      return
    }

    this.externalQueueDepths.set(source, Math.floor(depth))
  }

  getQueueDepth(): number {
    let total = this.activeRequests

    for (const depth of this.externalQueueDepths.values()) {
      total += depth
    }

    return total
  }
}
