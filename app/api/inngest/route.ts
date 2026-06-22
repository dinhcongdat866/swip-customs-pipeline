import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

/**
 * The endpoint the Inngest dev server (and Inngest Cloud) calls to run our
 * durable functions. This is what makes `classifyShipment` actually execute —
 * the CLI demo ran the plain orchestrator; this runs the real durable one.
 *
 * Run the dev server alongside `next dev`:  npx inngest-cli@latest dev
 */
export const { GET, POST, PUT } = serve({ client: inngest, functions });
