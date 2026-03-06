import { describe, test, expect } from "bun:test";
import { llm } from "../../server/services/ai/ai.js";

describe("services/ai", () => {
  test("llm export has largeModel, mediumModel, and smallModel", () => {
    expect(llm).toBeDefined();
    expect(llm.largeModel).toBeDefined();
    expect(llm.mediumModel).toBeDefined();
    expect(llm.smallModel).toBeDefined();
  });

  test("each model has a modelId string", () => {
    expect(typeof llm.largeModel.modelId).toBe("string");
    expect(typeof llm.mediumModel.modelId).toBe("string");
    expect(typeof llm.smallModel.modelId).toBe("string");
  });

  test("each model conforms to LanguageModelV2 (has specificationVersion)", () => {
    expect(llm.largeModel.specificationVersion).toBe("v2");
    expect(llm.mediumModel.specificationVersion).toBe("v2");
    expect(llm.smallModel.specificationVersion).toBe("v2");
  });

  test("models are distinct objects", () => {
    expect(llm.largeModel).not.toBe(llm.mediumModel);
    expect(llm.mediumModel).not.toBe(llm.smallModel);
    expect(llm.largeModel).not.toBe(llm.smallModel);
  });
});
