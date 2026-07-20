import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { inferWorkflowTopology, validateWorkflowDAG } from "@spielos/core";

function wf(nodes: unknown[], edges: unknown[], topology?: string) {
  return {
    id: "wf-1", name: "Test", nodes, edges, topology,
    status: "active", metadata: {}, inputContract: null, outputContract: null,
  };
}

function node(id: string) {
  return { id, title: id, roleId: "r1", skillIds: [] };
}

function edge(id: string, source: string, target: string) {
  return { id, source, target };
}

describe("inferWorkflowTopology", () => {
  it("returns topology from metadata when present", () => {
    assert.equal(inferWorkflowTopology(wf([node("n1")], [], "dag")), "dag");
  });

  it("returns 'dag' for explicit edges", () => {
    assert.equal(
      inferWorkflowTopology(wf([node("n1"), node("n2")], [edge("e1", "n1", "n2")])),
      "dag"
    );
  });

  it("returns 'sequential' for no edges and multiple nodes", () => {
    assert.equal(
      inferWorkflowTopology(wf([node("n1"), node("n2")], [])),
      "sequential"
    );
  });

  it("returns 'dag' for single node with no edges", () => {
    assert.equal(inferWorkflowTopology(wf([node("n1")], [])), "dag");
  });
});

describe("validateWorkflowDAG", () => {
  it("returns no issues for no edges", () => {
    const issues = validateWorkflowDAG(wf([node("n1")], []));
    assert.equal(issues.length, 0);
  });

  it("returns no issues for linear chain", () => {
    const issues = validateWorkflowDAG(
      wf([node("n1"), node("n2"), node("n3")], [edge("e1", "n1", "n2"), edge("e2", "n2", "n3")])
    );
    assert.equal(issues.length, 0);
  });

  it("detects a simple cycle", () => {
    const issues = validateWorkflowDAG(
      wf([node("n1"), node("n2")], [edge("e1", "n1", "n2"), edge("e2", "n2", "n1")])
    );
    assert.ok(issues.some((i) => i.type === "cycle"));
  });

  it("self-loop on single node is not checked (returns early)", () => {
    const issues = validateWorkflowDAG(
      wf([node("n1")], [edge("e1", "n1", "n1")])
    );
    assert.equal(issues.length, 0);
  });

  it("detects a longer cycle", () => {
    const issues = validateWorkflowDAG(
      wf(
        [node("n1"), node("n2"), node("n3")],
        [edge("e1", "n1", "n2"), edge("e2", "n2", "n3"), edge("e3", "n3", "n1")]
      )
    );
    assert.ok(issues.some((i) => i.type === "cycle"));
  });
});
