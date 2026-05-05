import { describe, expect, it } from "vitest";
import { parseLLMOverridesFromArgv } from "../utils.js";

describe("parseLLMOverridesFromArgv", () => {
  it("parses service/model/base-url and transport overrides from CLI argv", () => {
    expect(parseLLMOverridesFromArgv([
      "write",
      "next",
      "--service",
      "google",
      "--model=gemini-2.5-flash",
      "--base-url",
      "https://custom.example.com/v1",
      "--api-format",
      "chat",
      "--no-stream",
    ])).toEqual({
      service: "google",
      model: "gemini-2.5-flash",
      baseUrl: "https://custom.example.com/v1",
      apiFormat: "chat",
      stream: false,
    });
  });
});
