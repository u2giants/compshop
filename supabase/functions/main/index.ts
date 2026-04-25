// Main service for self-hosted Supabase edge runtime.
// Dispatches /functions/v1/<name> requests to the matching sub-function worker.
// Sub-functions use Deno.serve() so each runs in its own EdgeRuntime worker.

const FUNCTIONS_PATH = "/home/deno/functions";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  // Kong strips /functions/v1/ prefix, so path arrives as /<name>[/...rest]
  // Handle both the full path (local testing) and stripped path (via Kong)
  const funcName = url.pathname
    .replace(/^\/functions\/v1\//, "")
    .replace(/^\/+/, "")
    .split("/")[0];

  if (!funcName) {
    return new Response(JSON.stringify({ error: "Missing function name" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const envVars = Object.entries(Deno.env.toObject());
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `${FUNCTIONS_PATH}/${funcName}`,
      memoryLimitMb: 150,
      workerTimeoutMs: 30_000,
      noModuleCache: false,
      importMapPath: null,
      envVars,
    });
    return await worker.fetch(req);
  } catch (e) {
    const isNotFound = e instanceof Error && e.message.includes("not found");
    return new Response(
      JSON.stringify({
        error: isNotFound ? `Function '${funcName}' not found` : "Internal server error",
      }),
      {
        status: isNotFound ? 404 : 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
