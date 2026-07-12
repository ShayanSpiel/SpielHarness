"use client";

import type { Role } from "@spielos/core";
import { Icon } from "@spielos/design-system/components";
import { Field, Input, NativeSelect } from "@spielos/design-system";
import { MentionTextarea } from "../../components/mention-textarea";
import { ContractFlow } from "./contract-flow";
import { PickList } from "./pick-list";
import type { EvalFile, RoleContractDefinition, SkillDefinition, WorkstreamNode } from "../../lib/workspace-data";

export function roleContractName(
  role: Role,
  direction: "inputs" | "outputs",
  fallback: string,
) {
  const saved = (role.metadata?.contracts as
    | { inputs?: RoleContractDefinition[]; outputs?: RoleContractDefinition[] }
    | undefined)?.[direction]?.[0];
  return saved?.name?.trim() || fallback;
}

export function roleContracts(
  role: Role,
  direction: "inputs" | "outputs",
): RoleContractDefinition[] {
  return (
    (role.metadata?.contracts as
      | { inputs?: RoleContractDefinition[]; outputs?: RoleContractDefinition[] }
      | undefined)?.[direction] ?? []
  );
}

function evalInputLabel(value: string, nodes: WorkstreamNode[]) {
  if (value === "workflow_input") return "Workflow request";
  if (value.startsWith("node:")) {
    const node = nodes.find((entry) => entry.id === value.slice("node:".length));
    return node ? `${node.title} output` : "Selected step output";
  }
  return "Previous step output";
}

export function NodeInspector({
  evals,
  files,
  node,
  nodes,
  roles,
  skills,
  toggleNodeList,
  updateNode,
}: {
  evals: EvalFile[];
  files: Array<{ id: string; title: string; folder?: string; kind: string }>;
  node: WorkstreamNode | null;
  nodes: WorkstreamNode[];
  roles: Role[];
  skills: SkillDefinition[];
  toggleNodeList: (nodeId: string, key: "skillIds" | "fileIds", value: string) => void;
  updateNode: (nodeId: string, patch: Partial<WorkstreamNode>) => void;
}) {
  if (!node) {
    return (
      <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-[11px] text-muted-foreground">
        <Icon name="workflow-alt" size={16} />
        <div>No step selected.</div>
        <div>Click a step on the canvas to edit it.</div>
      </div>
    );
  }

  const roleOptions = roles
    .filter((role) => role.status === "active" || role.id === node.roleId)
    .map((role) => ({
      label: role.status === "active" ? role.name : `${role.name} (disabled)`,
      value: role.id,
    }));
  const isEvalNode = node.nodeType === "eval";
  const selectedRole = roles.find((role) => role.id === node.roleId) ?? null;
  const evalOptions = evals
    .filter((evalFile) => evalFile.status === "active" || node.skillIds.includes(evalFile.id))
    .map((evalFile) => ({
      label: evalFile.status === "active" ? evalFile.name : `${evalFile.name} (disabled)`,
      value: evalFile.id,
    }));
  const selectedEvalId = node.skillIds[0] ?? "";
  const evalInputValue = (() => {
    if (!node.evalInput || node.evalInput.type === "previous_output") return "previous_output";
    if (node.evalInput.type === "workflow_input") return "workflow_input";
    return `node:${node.evalInput.nodeId ?? ""}`;
  })();
  const evalInputOptions = [
    { label: "Previous step output", value: "previous_output" },
    { label: "Workflow request", value: "workflow_input" },
    ...nodes
      .filter((entry) => entry.id !== node.id)
      .map((entry) => ({
        label: `${entry.title} output${entry.output ? ` (${entry.output})` : ""}`,
        value: `node:${entry.id}`,
      })),
  ];

  return (
    <div>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <Icon name="workflow-alt" className="text-muted-foreground" size={14} />
        <span className="text-xs font-semibold text-foreground">Step Settings</span>
      </div>
      <div className="border-b border-border p-3">
        <Field label="Step title">
          <div className="flex items-center gap-2">
            <Input
              className="flex-1"
              onChange={(event) => updateNode(node.id, { title: event.target.value })}
              value={node.title}
            />
            {!isEvalNode && node.roleId && node.roleId !== "runtime.eval" && (
              <a className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground transition-colors" href="/roles">
                Edit in role
              </a>
            )}
          </div>
        </Field>
      </div>
      <div className="grid gap-3 p-3">
        {isEvalNode ? (
          <>
            <Field label="QA eval">
              <NativeSelect
                ariaLabel="Step QA eval"
                onChange={(value) => {
                  const evalFile = evals.find((entry) => entry.id === value);
                  updateNode(node.id, {
                    roleId: "runtime.eval",
                    skillIds: [value],
                    title: evalFile ? `QA: ${evalFile.name}` : node.title,
                    output: "Eval report",
                    loopConfig: evalFile
                      ? { ...evalFile.loopConfig, evalId: evalFile.id }
                      : node.loopConfig,
                  });
                }}
                options={evalOptions}
                value={selectedEvalId}
              />
            </Field>
            <Field label="Gate behavior">
              <div className="rounded-md border border-border bg-panel-raised px-2 py-2 text-[11px] text-muted-foreground">
                {(() => {
                  const evalFile = evals.find((entry) => entry.id === selectedEvalId);
                  const loopConfig = node.loopConfig ??
                    (evalFile ? { ...evalFile.loopConfig, evalId: evalFile.id } : null);
                  if (!loopConfig?.enabled) return "Pass continues. Fail stops the workflow.";
                  return `Pass continues. Fail retries the previous step up to ${loopConfig.maxAttempts} attempts.`;
                })()}
              </div>
            </Field>
            <Field label="Evaluate">
              <NativeSelect
                ariaLabel="Eval input source"
                onChange={(value) => {
                  if (value === "workflow_input") {
                    updateNode(node.id, { input: "workflow_request", evalInput: { type: "workflow_input" } });
                    return;
                  }
                  if (value.startsWith("node:")) {
                    const nodeId = value.slice("node:".length);
                    const sourceNode = nodes.find((entry) => entry.id === nodeId);
                    updateNode(node.id, {
                      input: sourceNode?.output ?? "selected_output",
                      evalInput: { type: "node_output", nodeId },
                    });
                    return;
                  }
                  updateNode(node.id, { input: "previous_output", evalInput: { type: "previous_output" } });
                }}
                options={evalInputOptions}
                value={evalInputValue}
              />
            </Field>
          </>
        ) : (
          <Field label="Role">
            <NativeSelect
              ariaLabel="Step role"
              onChange={(value) => {
                const nextRole = roles.find((role) => role.id === value);
                updateNode(node.id, {
                  roleId: value,
                  title: nextRole?.name ?? node.title,
                  input: nextRole ? roleContractName(nextRole, "inputs", "Role input") : node.input,
                  output: nextRole ? roleContractName(nextRole, "outputs", "Role output") : node.output,
                });
              }}
              options={roleOptions}
              value={node.roleId}
            />
          </Field>
        )}
        <ContractFlow
          input={
            isEvalNode
              ? evalInputLabel(evalInputValue, nodes)
              : selectedRole
                ? roleContractName(selectedRole, "inputs", node.input)
                : node.input
          }
          output={
            isEvalNode
              ? "Eval report"
              : selectedRole
                ? roleContractName(selectedRole, "outputs", node.output)
                : node.output
          }
          inputContracts={
            isEvalNode ? [] : selectedRole ? roleContracts(selectedRole, "inputs") : []
          }
          outputContracts={
            isEvalNode
              ? [
                  {
                    name: "Eval report",
                    format: "markdown" as const,
                    body: "",
                    required: true,
                    multiple: false,
                  },
                ]
              : selectedRole
                ? roleContracts(selectedRole, "outputs")
                : []
          }
          tone={isEvalNode ? "QA" : "Role"}
          roleId={isEvalNode ? undefined : node.roleId}
        />
        {!isEvalNode ? (
          <Field label="Prompt override">
            <div className="overflow-hidden rounded-md border border-border bg-background">
              <div className="flex h-8 items-center gap-2 border-b border-border bg-panel-raised px-2">
                <span className="text-[11px] text-muted-foreground">Optional role prompt override</span>
                <span className="ml-auto text-[10px] text-muted-foreground select-none">@ to mention</span>
              </div>
              <MentionTextarea
                className="min-h-36"
                mono
                onChange={(event) => updateNode(node.id, { prompt: event })}
                placeholder="Optional. Leave blank to use the role's current prompt."
                value={node.prompt}
              />
            </div>
          </Field>
        ) : null}
        <PickList
          activeIds={node.fileIds}
          items={files.map((file) => ({
            id: file.id,
            title: file.title,
            subtitle: file.folder ?? file.kind,
          }))}
          iconName="file-text"
          label="Files"
          searchPlaceholder="Search files"
          onToggle={(id) => toggleNodeList(node.id, "fileIds", id)}
        />
        {!isEvalNode ? (
          <PickList
            activeIds={node.skillIds}
            items={skills
              .filter((skill) => skill.status === "active" || node.skillIds.includes(skill.id))
              .map((skill) => ({
                id: skill.id,
                title: skill.name,
                subtitle:
                  skill.status === "active"
                    ? skill.category
                    : `${skill.category} - disabled`,
              }))}
            iconName="reading-glass"
            label="Skills"
            searchPlaceholder="Search skills"
            onToggle={(id) => toggleNodeList(node.id, "skillIds", id)}
          />
        ) : null}
      </div>
    </div>
  );
}
