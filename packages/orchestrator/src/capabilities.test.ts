import { describe, expect, it, vi } from "vitest";
import { CapabilityRegistry, defaultCapabilities, processorCapability } from "./capabilities.js";

describe("runtime capability registry", () => {
  it("distinguishes registration from operational capability and emits readiness changes", () => {
    const registry = new CapabilityRegistry(defaultCapabilities("autonomous")); const listener = vi.fn(); registry.onChange(listener);
    expect(processorCapability("activate-node", registry.snapshot())).toBe("not_configured");
    registry.set("operatorSigner", "ready");
    expect(processorCapability("activate-node", registry.snapshot())).toBe("ready"); expect(listener).toHaveBeenCalledWith("operatorSigner", "ready");
  });
});
