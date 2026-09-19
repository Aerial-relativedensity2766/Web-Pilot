import { describe, expect, it } from 'vitest';
import { EventBus, createEventBus } from '@webpilot/shared';

type Payload = { id: number; note: string };

describe('createEventBus', () => {
  it('returns a fresh EventBus instance', () => {
    const bus = createEventBus<Payload>();
    expect(bus).toBeInstanceOf(EventBus);
    expect(bus.size).toBe(0);
  });
});

describe('EventBus', () => {
  it('delivers the original payload to subscribers and tracks size', () => {
    const bus = createEventBus<Payload>();
    const payload: Payload = { id: 7, note: 'agent-update' };
    const received: Payload[] = [];

    expect(bus.size).toBe(0);

    bus.on((event) => {
      received.push(event);
    });

    expect(bus.size).toBe(1);
    bus.emit(payload);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe(payload);
  });

  it('stops delivery after off()', () => {
    const bus = createEventBus<string>();
    const received: string[] = [];
    const listener = (event: string) => {
      received.push(event);
    };

    bus.on(listener);
    bus.off(listener);
    expect(bus.size).toBe(0);

    bus.emit('after-off');
    expect(received).toEqual([]);
  });

  it('stops delivery after the unsubscribe function returned by on()', () => {
    const bus = createEventBus<string>();
    const received: string[] = [];

    const unsubscribe = bus.on((event) => {
      received.push(event);
    });

    unsubscribe();
    expect(bus.size).toBe(0);

    bus.emit('after-unsubscribe');
    expect(received).toEqual([]);
  });

  it('fires a once listener only once', () => {
    const bus = createEventBus<string>();
    const received: string[] = [];

    bus.once((event) => {
      received.push(event);
    });

    bus.emit('first');
    bus.emit('second');

    expect(received).toEqual(['first']);
    expect(bus.size).toBe(0);
  });

  it('does not re-fire once when that listener synchronously emits another event', () => {
    const bus = createEventBus<string>();
    const received: string[] = [];

    bus.once((event) => {
      received.push(event);
      bus.emit('nested');
    });

    bus.emit('first');

    expect(received).toEqual(['first']);
    expect(bus.size).toBe(0);
  });

  it('does not stop other listeners when one throws', () => {
    const bus = createEventBus<string>();
    const received: string[] = [];

    bus.on(() => {
      throw new Error('listener failed');
    });
    bus.on((event) => {
      received.push(event);
    });

    expect(() => bus.emit('keep-going')).not.toThrow();
    expect(received).toEqual(['keep-going']);
  });

  it('clear removes listeners so later emits are ignored', () => {
    const bus = createEventBus<string>();
    const received: string[] = [];

    bus.on((event) => {
      received.push(event);
    });
    bus.on((event) => {
      received.push(`${event}-2`);
    });

    bus.clear();
    expect(bus.size).toBe(0);

    bus.emit('after-clear');
    expect(received).toEqual([]);
  });

  it('treats repeated unsubscription as harmless', () => {
    const bus = createEventBus<string>();
    const listener = () => {
      throw new Error('should not run after unsubscribe');
    };

    const unsubscribe = bus.on(listener);

    expect(() => {
      unsubscribe();
      unsubscribe();
      bus.off(listener);
      bus.off(listener);
    }).not.toThrow();

    expect(bus.size).toBe(0);
    expect(() => bus.emit('ignored')).not.toThrow();
  });
});
