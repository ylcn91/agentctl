
import type { Component } from "solid-js";
import type { ToolRendererProps } from "./shared.js";
import { BashTool } from "./bash.js";
import { WriteTool } from "./write.js";
import { EditTool } from "./edit.js";
import { ReadTool } from "./read.js";
import { GlobTool } from "./glob.js";
import { GrepTool } from "./grep.js";
import { FetchTool } from "./fetch.js";
import { TaskTool } from "./task.js";
import { DefaultTool } from "./default.js";

export type { ToolRendererProps } from "./shared.js";

export const ToolComponents: Record<string, Component<ToolRendererProps>> = {
  Bash: BashTool,
  Write: WriteTool,
  Edit: EditTool,
  Read: ReadTool,
  Glob: GlobTool,
  Grep: GrepTool,
  WebFetch: FetchTool,
  Task: TaskTool,

  bash: BashTool,
  write: WriteTool,
  edit: EditTool,
  read: ReadTool,
  glob: GlobTool,
  grep: GrepTool,
  webfetch: FetchTool,
  task: TaskTool,

  WebSearch: FetchTool,
  NotebookEdit: EditTool,
};

export { DefaultTool } from "./default.js";
export { StatusIcon, InlineTool, BlockTool, parseInput, shortenPath, truncate } from "./shared.js";
