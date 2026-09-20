export type ToolName = "costing" | "load" | "buyer";
export type ToolSubview = "calculator" | "saved" | "archived";

export type WorkspaceRoute = {
  tool: ToolName;
  subview: ToolSubview;
};

export const defaultWorkspaceRoute: WorkspaceRoute = {
  tool: "costing",
  subview: "calculator",
};

const routePaths: Record<ToolName, Record<ToolSubview, string>> = {
  costing: {
    calculator: "costing/calculator",
    saved: "costing/saved",
    archived: "costing/archived",
  },
  load: {
    calculator: "load/calculator",
    saved: "load/saved",
    archived: "load/archived",
  },
  buyer: {
    calculator: "buyer/search",
    saved: "buyer/history",
    archived: "buyer/saved-buyers",
  },
};

const routesByPath = new Map<string, WorkspaceRoute>();

for (const tool of Object.keys(routePaths) as ToolName[]) {
  for (const subview of Object.keys(routePaths[tool]) as ToolSubview[]) {
    routesByPath.set(routePaths[tool][subview], { tool, subview });
  }
}

export function formatWorkspaceHash(route: WorkspaceRoute): string {
  return `#/${routePaths[route.tool][route.subview]}`;
}

export function parseWorkspaceHash(hash: string): WorkspaceRoute | undefined {
  const path = hash.replace(/^#/, "").replace(/^\/+|\/+$/g, "");
  const route = routesByPath.get(path);
  return route ? { ...route } : undefined;
}
