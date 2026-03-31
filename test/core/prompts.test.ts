import test from "node:test";
import assert from "node:assert/strict";
import { buildPlannerPrompt, type ChatMessage } from "../../src/core/prompts";

test("build-planner-prompt enforces convergence and scope-freeze contract", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "We should skip export and keep this browser-only." },
    { role: "assistant", content: "Locked. One scope lock: desktop-only for V1?" },
    { role: "user", content: "yes absolutely" }
  ];

  const prompt = buildPlannerPrompt(messages, "G:\\code\\demo");

  assert.match(prompt, /Operating mode: decision sprint, not endless discovery\./);
  assert.match(prompt, /Run a lightweight internal sufficiency check before asking a question/);
  assert.match(prompt, /If 4 out of 5 sufficiency signals are present, move forward with assumptions/);
  assert.match(prompt, /Blocker-question budget across this conversation: 3/);
  assert.match(prompt, /Estimated blocker questions already asked by planner: 1/);
  assert.match(prompt, /User readiness signal detected: yes/);
  assert.match(prompt, /Mode B - Scope freeze/);
  assert.match(prompt, /- run \/write/);
});

test("build-planner-prompt blocks further questioning when budget is exhausted", () => {
  const messages: ChatMessage[] = [
    { role: "assistant", content: "Question one?" },
    { role: "assistant", content: "Question two?" },
    { role: "assistant", content: "Question three?" }
  ];

  const prompt = buildPlannerPrompt(messages, "G:\\code\\demo");

  assert.match(prompt, /Estimated blocker questions already asked by planner: 3/);
  assert.match(prompt, /Remaining blocker questions: 0/);
  assert.match(prompt, /you must not ask another question; produce closure/i);
});
