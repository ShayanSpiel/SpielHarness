import type { Sql } from "./index.ts";

export type FileRelationRow = {
  id: string;
  org_id: string;
  source_file_id: string;
  target_file_id: string;
  relation_type: string;
  ordering: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

/**
 * List all skill IDs bound to a role via file_relations (`role_skill`).
 */
export async function listRoleSkills(sql: Sql, orgId: string, roleId: string): Promise<string[]> {
  const rows = await sql<Array<{ target_file_id: string }>>`
    select target_file_id
    from file_relations
    where org_id = ${orgId}
      and source_file_id = ${roleId}
      and relation_type = 'role_skill'
    order by ordering nulls last, created_at
  `;
  return rows.map((r) => r.target_file_id);
}

/**
 * Map workflow node IDs to their assigned role ID.
 * Returns a Map of node position index → role file ID.
 */
export async function listWorkflowNodeRoles(
  sql: Sql,
  orgId: string,
  workflowId: string
): Promise<Map<number, string>> {
  const rows = await sql<Array<{ ordering: number | null; target_file_id: string }>>`
    select ordering, target_file_id
    from file_relations
    where org_id = ${orgId}
      and source_file_id = ${workflowId}
      and relation_type = 'workflow_node_role'
    order by ordering nulls last, created_at
  `;
  const result = new Map<number, string>();
  for (const row of rows) {
    if (row.ordering != null) {
      result.set(row.ordering, row.target_file_id);
    }
  }
  return result;
}

/**
 * Map workflow node positions to their assigned skill IDs.
 * Returns a Map of node position index → skill file IDs.
 */
export async function listWorkflowNodeSkills(
  sql: Sql,
  orgId: string,
  workflowId: string
): Promise<Map<number, string[]>> {
  const rows = await sql<Array<{ ordering: number | null; target_file_id: string }>>`
    select ordering, target_file_id
    from file_relations
    where org_id = ${orgId}
      and source_file_id = ${workflowId}
      and relation_type = 'workflow_node_skill'
    order by ordering nulls last, created_at
  `;
  const result = new Map<number, string[]>();
  for (const row of rows) {
    if (row.ordering != null) {
      const existing = result.get(row.ordering) ?? [];
      existing.push(row.target_file_id);
      result.set(row.ordering, existing);
    }
  }
  return result;
}

/**
 * Map workflow node positions to their assigned file IDs.
 * Returns a Map of node position index → file IDs.
 */
export async function listWorkflowNodeFiles(
  sql: Sql,
  orgId: string,
  workflowId: string
): Promise<Map<number, string[]>> {
  const rows = await sql<Array<{ ordering: number | null; target_file_id: string }>>`
    select ordering, target_file_id
    from file_relations
    where org_id = ${orgId}
      and source_file_id = ${workflowId}
      and relation_type = 'workflow_node_file'
    order by ordering nulls last, created_at
  `;
  const result = new Map<number, string[]>();
  for (const row of rows) {
    if (row.ordering != null) {
      const existing = result.get(row.ordering) ?? [];
      existing.push(row.target_file_id);
      result.set(row.ordering, existing);
    }
  }
  return result;
}

export type SkillConnectionOp = {
  connectionId: string;
  operation: string;
};

/**
 * List connection operations bound to a skill.
 */
export async function listSkillConnectionOps(
  sql: Sql,
  orgId: string,
  skillId: string
): Promise<SkillConnectionOp[]> {
  const rows = await sql<Array<{ target_file_id: string; metadata: Record<string, unknown> }>>`
    select target_file_id, metadata
    from file_relations
    where org_id = ${orgId}
      and source_file_id = ${skillId}
      and relation_type = 'skill_connection_operation'
    order by ordering nulls last, created_at
  `;
  return rows.map((r) => ({
    connectionId: r.target_file_id,
    operation: String(r.metadata?.operation ?? ""),
  }));
}
