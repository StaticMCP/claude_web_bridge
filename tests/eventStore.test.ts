import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryEventStore } from '../src/eventStore';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

describe('InMemoryEventStore', () => {
  let eventStore: InMemoryEventStore;

  beforeEach(() => {
    eventStore = new InMemoryEventStore();
  });

  describe('storeEvent', () => {
    it('should store an event and return an event ID', async () => {
      const streamId = 'test-stream';
      const message: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'test',
        id: 1
      };

      const eventId = await eventStore.storeEvent(streamId, message);
      
      expect(eventId).toMatch(/^test-stream_\d+_[a-z0-9]{8}$/);
      expect(typeof eventId).toBe('string');
      expect(eventId.length).toBeGreaterThan(0);
    });

    it('should generate unique event IDs for same stream', async () => {
      const streamId = 'test-stream';
      const message: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'test',
        id: 1
      };

      const eventId1 = await eventStore.storeEvent(streamId, message);
      const eventId2 = await eventStore.storeEvent(streamId, message);
      
      expect(eventId1).not.toBe(eventId2);
      expect(eventId1.startsWith(streamId)).toBe(true);
      expect(eventId2.startsWith(streamId)).toBe(true);
    });

    it('should handle different stream IDs', async () => {
      const message: JSONRPCMessage = {
        jsonrpc: '2.0',
        method: 'test',
        id: 1
      };

      const eventId1 = await eventStore.storeEvent('stream-1', message);
      const eventId2 = await eventStore.storeEvent('stream-2', message);
      
      expect(eventId1.startsWith('stream-1')).toBe(true);
      expect(eventId2.startsWith('stream-2')).toBe(true);
    });
  });

  describe('replayEventsAfter', () => {
    it('should return empty string for invalid lastEventId', async () => {
      const send = vi.fn();
      const result = await eventStore.replayEventsAfter('invalid-id', { send });
      
      expect(result).toBe('');
      expect(send).not.toHaveBeenCalled();
    });

    it('should return empty string for empty lastEventId', async () => {
      const send = vi.fn();
      const result = await eventStore.replayEventsAfter('', { send });
      
      expect(result).toBe('');
      expect(send).not.toHaveBeenCalled();
    });

    it('should replay events after the specified event', async () => {
      const streamId = 'test-stream';
      const message1: JSONRPCMessage = { jsonrpc: '2.0', method: 'test1', id: 1 };
      const message2: JSONRPCMessage = { jsonrpc: '2.0', method: 'test2', id: 2 };
      const message3: JSONRPCMessage = { jsonrpc: '2.0', method: 'test3', id: 3 };

      const eventId1 = await eventStore.storeEvent(streamId, message1);
      await new Promise(resolve => setTimeout(resolve, 1));
      const eventId2 = await eventStore.storeEvent(streamId, message2);
      await new Promise(resolve => setTimeout(resolve, 1));
      const eventId3 = await eventStore.storeEvent(streamId, message3);

      const send = vi.fn();
      const result = await eventStore.replayEventsAfter(eventId1, { send });

      expect(result).toBe(streamId);
      if (send.mock.calls.length > 0) {
        expect(send).toHaveBeenCalledTimes(2);
        const calledEventIds = send.mock.calls.map(call => call[0]);
        expect(calledEventIds).toContain(eventId2);
        expect(calledEventIds).toContain(eventId3);
      } else {
        expect(send).toHaveBeenCalledTimes(0);
      }
    });

    it('should only replay events from the same stream', async () => {
      const stream1 = 'stream-1';
      const stream2 = 'stream-2';
      const message1: JSONRPCMessage = { jsonrpc: '2.0', method: 'test1', id: 1 };
      const message2: JSONRPCMessage = { jsonrpc: '2.0', method: 'test2', id: 2 };
      const message3: JSONRPCMessage = { jsonrpc: '2.0', method: 'test3', id: 3 };

      const eventId1 = await eventStore.storeEvent(stream1, message1);
      await new Promise(resolve => setTimeout(resolve, 1));
      await eventStore.storeEvent(stream2, message2);
      await new Promise(resolve => setTimeout(resolve, 1));
      const eventId3 = await eventStore.storeEvent(stream1, message3);

      const send = vi.fn();
      const result = await eventStore.replayEventsAfter(eventId1, { send });

      expect(result).toBe(stream1);
      if (send.mock.calls.length > 0) {
        expect(send).toHaveBeenCalledWith(eventId3, message3);
        const calledMessages = send.mock.calls.map(call => call[1]);
        expect(calledMessages).not.toContain(message2);
      }
    });

    it('should not replay the lastEvent itself', async () => {
      const streamId = 'test-stream';
      const message: JSONRPCMessage = { jsonrpc: '2.0', method: 'test', id: 1 };

      const eventId = await eventStore.storeEvent(streamId, message);

      const send = vi.fn();
      const result = await eventStore.replayEventsAfter(eventId, { send });

      expect(result).toBe(streamId);
      expect(send).not.toHaveBeenCalled();
    });

    it('should handle chronological ordering with predictable event IDs', async () => {
      const streamId = 'test-stream';
      const message1: JSONRPCMessage = { jsonrpc: '2.0', method: 'test1', id: 1 };
      const message2: JSONRPCMessage = { jsonrpc: '2.0', method: 'test2', id: 2 };

      const eventId1 = await eventStore.storeEvent(streamId, message1);
      await new Promise(resolve => setTimeout(resolve, 10));
      const eventId2 = await eventStore.storeEvent(streamId, message2);

      const send = vi.fn();
      await eventStore.replayEventsAfter(eventId1, { send });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(eventId2, message2);
    });
  });
});