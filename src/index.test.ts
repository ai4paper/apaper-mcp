import { describe, expect, test } from "bun:test";
import { buildPingText } from "./index.js";

describe("buildPingText", () => {
  test("returns pong when no message is provided", () => {
    expect(buildPingText()).toBe("pong");
  });

  test("returns pong with the provided message", () => {
    expect(buildPingText("hello")).toBe("pong: hello");
  });
});
