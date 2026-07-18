"use client";

import type { Role } from "@spielos/core";
import { Field, Input, Inspector, InspectorBody, InspectorEmptyState, InspectorHeader, InspectorSection, NativeSelect } from "@spielos/design-system";
import { ENTITY_ICONS } from "@spielos/design-system/components";
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
      <Inspector>
        <InspectorHeader icon="workflow-alt" title="Step settings" />
        <InspectorBody>
          <InspectorEmptyState description="Select a step on the canvas to edit its role, contracts, files, and skills." icon="workflow-alt" title="No step selected" />
        </InspectorBody>
      </Inspector>
    );
  }

  const roleOptions = roles
    .filter((role) => role.status === "active" || role.id === node.roleId)
    .map((role) => ({
      label: role.status === "active" ? role.name : `${role.name} (disabled)`,
      value: role.id,
    }));
  const isEvalNode = !!node.evalInput;
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
        label: `${entry.title} output${entry.outputContract ? ` (${entry.outputContract})` : ""}`,
        value: `node:${entry.id}`,
      })),
  ];

  return (
    <Inspector>
      <InspectorHeader icon="workflow-alt" title="Step settings" />
      <InspectorBody>
      <InspectorSection>
        <Field label="Step title">
          <Input
            className="w-full"
            onChange={(event) => updateNode(node.id, { title: event.target.value })}
            value={node.title}
          />
        </Field>
      </InspectorSection>
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
                    outputContract: "Eval report",
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
              <div className="rounded-md border border-border bg-panel-raised px-2 py-2 text-2xs text-muted-foreground">
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
                    updateNode(node.id, { inputContract: "workflow_request", evalInput: { type: "workflow_input" } });
                    return;
                  }
                  if (value.startsWith("node:")) {
                    const nodeId = value.slice("node:".length);
                    const sourceNode = nodes.find((entry) => entry.id === nodeId);
                    updateNode(node.id, {
                      inputContract: sourceNode?.outputContract ?? "selected_output",
                      evalInput: { type: "node_output", nodeId },
                    });
                    return;
                  }
                  updateNode(node.id, { inputContract: "previous_output", evalInput: { type: "previous_output" } });
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
                  inputContract: nextRole ? roleContractName(nextRole, "inputs", "Role input") : node.inputContract,
                  outputContract: nextRole ? roleContractName(nextRole, "outputs", "Role output") : node.outputContract,
                });
              }}
              options={roleOptions}
              value={node.roleId}
            />
          </Field>
        )}
        <ContractFlow
          inputLabel={node.inputContract}
          outputLabel={node.outputContract}
          inputDetail={
            isEvalNode || !selectedRole ? "" : (roleContracts(selectedRole, "inputs")[0]?.body?.trim() ?? "")
          }
          outputDetail={
            isEvalNode || !selectedRole ? "" : (roleContracts(selectedRole, "outputs")[0]?.body?.trim() ?? "")
          }
          roleId={isEvalNode ? undefined : node.roleId}
        />
        {!isEvalNode ? (
          <Field label="Prompt override">
            <div className="overflow-hidden rounded-md border border-border bg-input transition-colors focus-within:border-[var(--focus-border)] focus-within:ring-2 focus-within:ring-[var(--focus-ring)]">
              <div className="flex h-8 items-center gap-2 border-b border-border bg-panel-raised px-2">
                <span className="text-2xs text-muted-foreground">Optional role prompt override</span>
                <span className="ms-auto text-3xs text-muted-foreground select-none">@ to mention</span>
              </div>
              <MentionTextarea
                className="min-h-36"
                density="field"
                mono
                onChange={(event) => updateNode(node.id, { promptOverride: event })}
                placeholder="Optional. Leave blank to use the role's current prompt."
                value={node.promptOverride ?? ""}
              />
            </div>
          </Field>
        ) : null}
        <PickList
          activeIds={node.fileIds}
          items={files.map((file) => ({
            id: file.id,
            title: file.title,
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
              }))}
            iconName={ENTITY_ICONS.skill}
            label="Skills"
            searchPlaceholder="Search skills"
            onToggle={(id) => toggleNodeList(node.id, "skillIds", id)}
          />
        ) : null}
      </div>
      </InspectorBody>
    </Inspector>
  );
}
