/**
 * Verify configured Transformers.js model files exist on Hugging Face
 * (prevents defaulting to 404 ONNX paths like Xenova/gpt2 + q8 model_quantized).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MODELS } from "../public/runtimes.js";

async function headOk(url) {
  const res = await fetch(url, { method: "HEAD", redirect: "follow" });
  return res.ok || res.status === 302 || res.status === 200;
}

describe("Transformers.js model asset mapping", () => {
  it("lists distilgpt2 first with q8 model_quantized path that exists", async () => {
    const list = MODELS.transformersjs;
    assert.equal(list[0].id, "Xenova/distilgpt2");
    assert.equal(list[0].loadOpts?.dtype, "q8");
    const url =
      "https://huggingface.co/Xenova/distilgpt2/resolve/main/onnx/model_quantized.onnx";
    const ok = await headOk(url);
    assert.equal(ok, true, `expected HEAD ok for ${url}`);
  });

  it("gpt2 entry does not rely on missing model_quantized.onnx", async () => {
    const gpt2 = MODELS.transformersjs.find((m) => m.id === "Xenova/gpt2");
    assert.ok(gpt2);
    assert.equal(gpt2.loadOpts?.model_file_name, "decoder_model_merged_quantized");
    const bad =
      "https://huggingface.co/Xenova/gpt2/resolve/main/onnx/model_quantized.onnx";
    const res = await fetch(bad, { method: "HEAD", redirect: "follow" });
    assert.equal(res.status, 404, "gpt2 model_quantized.onnx must stay 404 (documents the bug we avoid)");
    const good =
      "https://huggingface.co/Xenova/gpt2/resolve/main/onnx/decoder_model_merged_quantized.onnx";
    assert.equal(await headOk(good), true);
  });
});
