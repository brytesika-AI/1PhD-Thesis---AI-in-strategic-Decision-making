const QUEUE_KEYS = {
  steering: "steering",
  follow_up: "follow_up",
  debate: "debate"
};

function idempotencyKey(item = {}) {
  return item.idempotency_key || [
    item.type || "action",
    item.agent_id || "none",
    item.stage || "none",
    item.reason || "none",
    item.source_agent_id || "none"
  ].join(":");
}

export class DecisionQueues {
  constructor(snapshot = {}) {
    this.steering = [...(snapshot.steering || [])];
    this.follow_up = [...(snapshot.follow_up || snapshot.followUp || [])];
    this.debate = [...(snapshot.debate || [])];
  }

  enqueue(queueName, item) {
    const key = QUEUE_KEYS[queueName] || queueName;
    if (!this[key]) {
      throw new Error(`Unknown decision queue: ${queueName}`);
    }
    const actionKey = idempotencyKey(item);
    const existing = [...this.steering, ...this.follow_up, ...this.debate]
      .find((queued) => idempotencyKey(queued) === actionKey);
    if (existing) return existing;
    const queued = {
      id: item.id || crypto.randomUUID(),
      idempotency_key: actionKey,
      created_at: item.created_at || new Date().toISOString(),
      ...item
    };
    this[key].push(queued);
    return queued;
  }

  dequeueNext() {
    if (this.steering.length) return { queue: "steering", item: this.steering.shift() };
    if (this.debate.length) return { queue: "debate", item: this.debate.shift() };
    if (this.follow_up.length) return { queue: "follow_up", item: this.follow_up.shift() };
    return null;
  }

  isEmpty() {
    return this.steering.length === 0 && this.debate.length === 0 && this.follow_up.length === 0;
  }

  snapshot() {
    return {
      steering: [...this.steering],
      follow_up: [...this.follow_up],
      debate: [...this.debate]
    };
  }
}
