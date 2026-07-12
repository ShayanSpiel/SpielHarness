"use client";

import { useState } from "react";
import { Icon } from "@spielos/design-system/components";
import type { RoleContractDefinition } from "../../lib/workspace-data";

export function ContractFlow({
  input,
  output,
  inputContracts,
  outputContracts,
  tone,
  roleId,
}: {
  input: string;
  output: string;
  inputContracts: RoleContractDefinition[];
  outputContracts: RoleContractDefinition[];
  tone: "Role" | "QA";
  roleId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMultiple = inputContracts.length > 1 || outputContracts.length > 1;
  const showFirst = !expanded;
  const displayInputs = showFirst ? inputContracts.slice(0, 1) : inputContracts;
  const displayOutputs = showFirst ? outputContracts.slice(0, 1) : outputContracts;

  return (
    <div className="rounded-md border border-border bg-panel p-2">
      <div className="mb-2 flex items-center gap-2">
        <Icon name="workflow-alt" className="text-muted-foreground" size={13} />
        <span className="text-[11px] font-medium text-muted-foreground">{tone} flow</span>
        {roleId && roleId !== "runtime.eval" && (
          <a
            className="ml-auto text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            href="/roles"
            onClick={(e) => e.stopPropagation()}
          >
            Edit in role
          </a>
        )}
      </div>
      <div className="grid gap-1.5">
        {displayInputs.length > 0
          ? displayInputs.map((contract, i) => (
              <div className="rounded-md bg-panel-raised px-2 py-1.5" key={`in-${i}`}>
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Input{inputContracts.length > 1 ? ` ${i + 1}` : ""}
                </div>
                <div className="mt-0.5 truncate text-xs text-foreground">
                  {contract.name || input}
                </div>
                {expanded && contract.body && (
                  <div className="mt-1 text-[10px] text-muted-foreground line-clamp-2">
                    {contract.body}
                  </div>
                )}
              </div>
            ))
          : (
            <div className="rounded-md bg-panel-raised px-2 py-1.5">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Input
              </div>
              <div className="mt-0.5 truncate text-xs text-foreground">{input}</div>
            </div>
          )}
        <div className="flex justify-center text-muted-foreground">
          <Icon name="arrow-down" size={13} />
        </div>
        {displayOutputs.length > 0
          ? displayOutputs.map((contract, i) => (
              <div className="rounded-md bg-panel-raised px-2 py-1.5" key={`out-${i}`}>
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Output{outputContracts.length > 1 ? ` ${i + 1}` : ""}
                </div>
                <div className="mt-0.5 truncate text-xs text-foreground">
                  {contract.name || output}
                </div>
                {expanded && contract.body && (
                  <div className="mt-1 text-[10px] text-muted-foreground line-clamp-2">
                    {contract.body}
                  </div>
                )}
              </div>
            ))
          : (
            <div className="rounded-md bg-panel-raised px-2 py-1.5">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Output
              </div>
              <div className="mt-0.5 truncate text-xs text-foreground">{output}</div>
            </div>
          )}
        {hasMultiple && (
          <button
            className="mt-1 text-center text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setExpanded(!expanded)}
            type="button"
          >
            {expanded
              ? "Show less"
              : `Show all (${inputContracts.length} inputs, ${outputContracts.length} outputs)`}
          </button>
        )}
      </div>
    </div>
  );
}
