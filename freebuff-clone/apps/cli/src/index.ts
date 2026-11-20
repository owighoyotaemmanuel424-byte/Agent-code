#!/usr/bin/env bun
import { Command } from "commander";
import { registerCommands } from "./commands";

const program = new Command()
  .name("freebuff")
  .description("Ad-supported coding agent for the terminal")
  .version("0.0.0");

registerCommands(program);

await program.parseAsync(process.argv);
