-- Phase C: Explicit workflow topology
--
-- Adds topology column to files metadata for workflow-type files and
-- backfills existing workflows.

-- 1. Add topology as a metadata field (no column needed — all harness
--    metadata is stored in the JSONB metadata column). We add a top-level
--    metadata.topology for workflows. No schema change to the files table.

-- 2. Backfill: detect workflows with 0 edges and >1 nodes → topology='sequential'
--    and auto-generate edges as a one-time migration.
do $$
declare
  wf record;
  node_arr jsonb;
  edges_arr jsonb;
  prev_id text;
  n jsonb;
  edge_id text;
begin
  for wf in
    select id, metadata
    from files
    where file_type in ('harness_workflow', 'harness_workstream')
      and (metadata ->> 'topology' is null)
  loop
    -- If topology already set, skip
    if wf.metadata ? 'topology' then
      continue;
    end if;

    node_arr := coalesce(wf.metadata -> 'nodes', '[]'::jsonb);
    edges_arr := coalesce(wf.metadata -> 'edges', '[]'::jsonb);

    if jsonb_array_length(edges_arr) = 0 and jsonb_array_length(node_arr) > 1 then
      -- Implicitly sequential: set topology = 'sequential' and generate edges
      prev_id := null;
      edges_arr := '[]'::jsonb;
      for n in select value from jsonb_array_elements(node_arr) loop
        if prev_id is not null then
          edge_id := 'edge-' || prev_id || '-' || (n ->> 'id');
          edges_arr := edges_arr || jsonb_build_object('id', edge_id, 'source', prev_id, 'target', n ->> 'id');
        end if;
        prev_id := n ->> 'id';
      end loop;

      update files
      set metadata = metadata || jsonb_build_object(
        'topology', 'sequential',
        'edges', edges_arr
      )
      where id = wf.id;

    elsif jsonb_array_length(edges_arr) > 0 then
      -- Has edges → DAG topology
      update files
      set metadata = metadata || jsonb_build_object('topology', 'dag')
      where id = wf.id;
    else
      -- Single node or empty: set to DAG
      update files
      set metadata = metadata || jsonb_build_object('topology', 'dag')
      where id = wf.id;
    end if;
  end loop;
end;
$$;
