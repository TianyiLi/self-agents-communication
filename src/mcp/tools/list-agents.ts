import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentRegistry } from "../../services/agent-registry";

export function registerListAgentsTool(server: McpServer, registry: AgentRegistry) {
  server.tool(
    "list_agents",
    "List all registered agents in the team with their roles, capabilities, and online status. " +
      "Use this to discover who is available for collaboration, find the right agent to ask " +
      "questions or delegate tasks to, or understand the current team composition. " +
      "Each agent entry includes: agent_id (for send_direct), name, role, description, " +
      "capabilities list, project path, and whether they are currently online.",
    {
      only_online: z.boolean().default(false).describe(
        "When true, only return agents that are currently online and reachable. " +
          "Default false returns all registered agents including offline ones."
      ),
    },
    async ({ only_online }) => {
      const agents = await registry.listAgents(only_online);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ agents }) }],
      };
    }
  );
}
