import { describe, it, expect, beforeEach } from "vitest";
import {
    registerEventType,
    getEventType,
    listEventTypes,
    unregisterEventType,
    clearEventRegistry,
} from "../../src/events/registry.js";

describe("Event Type Registry", () => {
    beforeEach(() => {
        clearEventRegistry();
    });

    describe("registerEventType", () => {
        it("adds an event type to the registry", () => {
            const handler = () => "ok";
            registerEventType("test.event", { type: "object" }, handler);
            const entry = getEventType("test.event");
            expect(entry).not.toBeNull();
            expect(entry!.schema).toEqual({ type: "object" });
            expect(entry!.handler).toBe(handler);
        });

        it("throws when registering a duplicate event type", () => {
            registerEventType("test.event", {}, () => {});
            expect(() => registerEventType("test.event", {}, () => {})).toThrow(
                "Event type 'test.event' is already registered",
            );
        });
    });

    describe("getEventType", () => {
        it("returns the event type entry if registered", () => {
            const handler = () => "hello";
            registerEventType("my.event", { foo: "bar" }, handler);
            const entry = getEventType("my.event");
            expect(entry).toEqual({ schema: { foo: "bar" }, handler });
        });

        it("returns null for unregistered event type", () => {
            const entry = getEventType("nonexistent");
            expect(entry).toBeNull();
        });
    });

    describe("listEventTypes", () => {
        it("lists all registered event type names", () => {
            registerEventType("a", {}, () => {});
            registerEventType("b", {}, () => {});
            registerEventType("c", {}, () => {});
            const list = listEventTypes();
            expect(list).toHaveLength(3);
            expect(list).toContain("a");
            expect(list).toContain("b");
            expect(list).toContain("c");
        });

        it("returns empty array when nothing is registered", () => {
            expect(listEventTypes()).toEqual([]);
        });
    });

    describe("unregisterEventType", () => {
        it("removes a registered event type and returns true", () => {
            registerEventType("to-remove", {}, () => {});
            expect(getEventType("to-remove")).not.toBeNull();
            const removed = unregisterEventType("to-remove");
            expect(removed).toBe(true);
            expect(getEventType("to-remove")).toBeNull();
        });

        it("returns false when unregistering an unknown type", () => {
            expect(unregisterEventType("missing")).toBe(false);
        });
    });
});
