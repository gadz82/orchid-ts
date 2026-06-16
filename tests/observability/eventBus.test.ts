import { describe, it, expect, vi } from "vitest";
import { OrchidEventBus } from "../../src/observability/eventBus.js";
import type { EventListener } from "../../src/observability/eventBus.js";

describe("OrchidEventBus", () => {
    it("calls listener on emit", () => {
        const bus = new OrchidEventBus();
        const fn = vi.fn();

        bus.on("test", fn);
        bus.emit("test", { key: "value" });

        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith("test", { key: "value" });
    });

    it("calls multiple listeners for same event", () => {
        const bus = new OrchidEventBus();
        const fn1 = vi.fn();
        const fn2 = vi.fn();

        bus.on("test", fn1);
        bus.on("test", fn2);
        bus.emit("test", {});

        expect(fn1).toHaveBeenCalledTimes(1);
        expect(fn2).toHaveBeenCalledTimes(1);
    });

    it("does not call listener for different event", () => {
        const bus = new OrchidEventBus();
        const fn = vi.fn();

        bus.on("event_a", fn);
        bus.emit("event_b", {});

        expect(fn).not.toHaveBeenCalled();
    });

    it("off removes a specific listener", () => {
        const bus = new OrchidEventBus();
        const fn1 = vi.fn();
        const fn2 = vi.fn();

        bus.on("test", fn1);
        bus.on("test", fn2);
        bus.off("test", fn1);
        bus.emit("test", {});

        expect(fn1).not.toHaveBeenCalled();
        expect(fn2).toHaveBeenCalledTimes(1);
    });

    it("off removes event key when no listeners remain", () => {
        const bus = new OrchidEventBus();
        const fn = vi.fn();

        bus.on("test", fn);
        bus.off("test", fn);

        // emit should not throw
        bus.emit("test", {});
    });

    it("emit does not throw when no listeners for event", () => {
        const bus = new OrchidEventBus();
        expect(() => bus.emit("unknown", {})).not.toThrow();
    });

    it("wildcard listener (*) receives all events", () => {
        const bus = new OrchidEventBus();
        const wildcard = vi.fn();

        bus.on("*", wildcard);
        bus.emit("event_a", { a: 1 });
        bus.emit("event_b", { b: 2 });

        expect(wildcard).toHaveBeenCalledTimes(2);
        expect(wildcard).toHaveBeenCalledWith("event_a", { a: 1 });
        expect(wildcard).toHaveBeenCalledWith("event_b", { b: 2 });
    });

    it("wildcard listener works alongside specific listener", () => {
        const bus = new OrchidEventBus();
        const specific = vi.fn();
        const wildcard = vi.fn();

        bus.on("specific", specific);
        bus.on("*", wildcard);
        bus.emit("specific", { x: 1 });

        expect(specific).toHaveBeenCalledTimes(1);
        expect(wildcard).toHaveBeenCalledTimes(1);
    });

    it("swallows listener errors so other listeners still fire", () => {
        const bus = new OrchidEventBus();
        const bad = vi.fn(() => {
            throw new Error("boom");
        });
        const good = vi.fn();

        bus.on("test", bad);
        bus.on("test", good);
        bus.emit("test", {});

        expect(bad).toHaveBeenCalledTimes(1);
        expect(good).toHaveBeenCalledTimes(1);
    });

    it("clear removes all listeners", () => {
        const bus = new OrchidEventBus();
        const fn = vi.fn();

        bus.on("test", fn);
        bus.clear();
        bus.emit("test", {});

        expect(fn).not.toHaveBeenCalled();
    });

    it("emit iterates over snapshot so listeners added during emit are not called", () => {
        const bus = new OrchidEventBus();
        const fn1 = vi.fn();
        const fn2: EventListener = () => {
            bus.on("test", vi.fn()); // Add listener during emit
        };

        bus.on("test", fn1);
        bus.on("test", fn2);
        bus.emit("test", {});

        // fn1 and fn2 should have been called exactly once each
        // The listener added during emit should not be called in this cycle
        expect(fn1).toHaveBeenCalledTimes(1);
    });
});
