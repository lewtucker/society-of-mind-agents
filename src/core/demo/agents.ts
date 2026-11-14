import { Agent } from "../agent/Agent.ts";
import type { AgentContext, AgentOptions, AgentResponse } from "../agent/types.ts";

// ─── FindAgent / Orchestrator ─────────────────────────────────────────────────

/**
 * FindAgent manages the block sequence for a tower-build task.
 *
 * On `task.start`: emits `block.found` for the first block.
 * On `placement.confirmed`: emits `block.found` for the next block,
 *   or `task.succeeded` when all blocks have been placed.
 *
 * `task.succeeded` carries `description` so that capturePositiveKLine()
 * embeds a rich, retrievable situation description.
 */
export function createFindAgent(): Agent {
  // Mutable state per task (reset on each task.start)
  let pendingBlocks: string[] = [];
  let placedBlocks:  string[] = [];
  let taskId = "";

  return new Agent({
    id:           "find-agent",
    name:         "Find Agent",
    systemPrompt: "Scans the environment for blocks and advances the tower-building sequence.",
    signals:      ["task.start", "placement.confirmed"],
    capability:   "deterministic",

    handler: (ctx: AgentContext): AgentResponse => {
      const { signal, payload } = ctx.trigger;

      if (signal === "task.start") {
        const p = payload as { task_id: string; blocks: string[] };
        taskId       = p.task_id;
        pendingBlocks = [...p.blocks];
        placedBlocks  = [];

        const next = pendingBlocks.shift()!;
        return {
          emit: [{ signal: "block.found", type: "polyneme" as const, payload: { block_id: next, task_id: taskId } }],
        };
      }

      if (signal === "placement.confirmed") {
        const { block_id } = payload as { block_id: string };
        placedBlocks.push(block_id);

        if (pendingBlocks.length > 0) {
          const next = pendingBlocks.shift()!;
          return {
            emit: [{ signal: "block.found", type: "polyneme" as const, payload: { block_id: next, task_id: taskId } }],
          };
        }

        // All blocks placed — emit task.succeeded with an explicit description
        // so capturePositiveKLine() embeds predictable vocabulary for retrieval
        const blockList = placedBlocks.join(" ");
        return {
          emit: [{
            signal:  "task.succeeded",
            type:    "polyneme" as const,
            payload: {
              task_id:     taskId,
              placed:      placedBlocks.slice(),
              description: `block tower build grasp place stack ${blockList} succeeded`,
            },
          }],
        };
      }

      return { emit: [] };
    },
  } satisfies AgentOptions);
}

// ─── SeeAgent ─────────────────────────────────────────────────────────────────

export function createSeeAgent(): Agent {
  return new Agent({
    id:           "see-agent",
    name:         "See Agent",
    systemPrompt: "Identifies block properties from the environment.",
    signals:      ["block.found"],
    capability:   "deterministic",
    handler: (ctx: AgentContext): AgentResponse => {
      const { block_id, task_id } = ctx.trigger.payload as { block_id: string; task_id: string };
      return {
        emit: [{
          signal:  "block.described",
          type:    "polyneme" as const,
          payload: { block_id, task_id, size: "medium", color: "red", position: "table" },
        }],
      };
    },
  } satisfies AgentOptions);
}

// ─── GraspAgent ───────────────────────────────────────────────────────────────

export function createGraspAgent(): Agent {
  return new Agent({
    id:           "grasp-agent",
    name:         "Grasp Agent",
    systemPrompt: "Extends manipulator arm to grasp a described block.",
    signals:      ["block.described"],
    capability:   "deterministic",
    handler: (ctx: AgentContext): AgentResponse => {
      const { block_id, task_id } = ctx.trigger.payload as { block_id: string; task_id: string };
      return {
        emit: [{
          signal:  "grip.ready",
          type:    "polyneme" as const,
          payload: { block_id, task_id },
        }],
      };
    },
  } satisfies AgentOptions);
}

// ─── MoveAgent ────────────────────────────────────────────────────────────────

export function createMoveAgent(): Agent {
  return new Agent({
    id:           "move-agent",
    name:         "Move Agent",
    systemPrompt: "Moves a grasped block to the target tower position.",
    signals:      ["grip.ready"],
    capability:   "deterministic",
    handler: (ctx: AgentContext): AgentResponse => {
      const { block_id, task_id } = ctx.trigger.payload as { block_id: string; task_id: string };
      return {
        emit: [{
          signal:  "block.placed",
          type:    "polyneme" as const,
          payload: { block_id, task_id, target_position: "tower-top" },
        }],
      };
    },
  } satisfies AgentOptions);
}

// ─── PutAgent ─────────────────────────────────────────────────────────────────

export function createPutAgent(): Agent {
  return new Agent({
    id:           "put-agent",
    name:         "Put Agent",
    systemPrompt: "Places a moved block precisely at the target position.",
    signals:      ["block.placed"],
    capability:   "deterministic",
    handler: (ctx: AgentContext): AgentResponse => {
      const { block_id, task_id, target_position } = ctx.trigger.payload as {
        block_id:        string;
        task_id:         string;
        target_position: string;
      };
      return {
        emit: [{
          signal:  "placement.confirmed",
          type:    "polyneme" as const,
          payload: { block_id, task_id, position: target_position },
        }],
      };
    },
  } satisfies AgentOptions);
}
