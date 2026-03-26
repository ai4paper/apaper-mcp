import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "apaper-mcp",
  version: "0.1.0",
});

server.registerTool(
  "ping",
  {
    title: "Ping",
    description: "Return a pong response for smoke testing the MCP server.",
    inputSchema: z.object({
      message: z.string().optional(),
    }),
  },
  async ({ message }) => ({
    content: [
      {
        type: "text",
        text: message ? `pong: ${message}` : "pong",
      },
    ],
  }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("apaper-mcp running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
