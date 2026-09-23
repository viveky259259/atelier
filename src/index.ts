#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PaperClient } from "./paper/client.js";
import { createAtelierServer } from "./server.js";

const paper = new PaperClient();
const server = createAtelierServer({ paper });
await server.connect(new StdioServerTransport());
