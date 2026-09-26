export function createDebugModelClient({ client, print = defaultPrint }) {
  return {
    async generateStructured(request) {
      const result = await client.generateStructured(request);
      print(`Structured output [${request.schemaName}]`, {
        model: result.metadata.actualModel,
        provider: result.metadata.provider,
        latencyMs: result.metadata.latencyMs,
        usage: result.metadata.usage,
        data: result.data,
      });
      return result;
    },

    async research(request) {
      const result = await client.research({
        ...request,
        onSearchComplete: async (search) => {
          print(`Research raw output [${request.schemaName}]`, {
            model: search.metadata.actualModel,
            provider: search.metadata.provider,
            latencyMs: search.metadata.latencyMs,
            usage: search.metadata.usage,
            sources: search.sources.map((source) => ({ url: source.url, title: source.title })),
            researchText: search.researchText,
          });
          await request.onSearchComplete?.(search);
        },
      });
      print(`Research formatted output [${request.schemaName}]`, {
        model: result.formattingMetadata.actualModel,
        candidateCount: result.data.candidates.length,
        candidates: result.data.candidates,
      });
      return result;
    },
  };
}

function defaultPrint(label, payload) {
  console.error(`\n=== BUYER DEBUG: ${label} ===\n${JSON.stringify(payload, null, 2)}`);
}
