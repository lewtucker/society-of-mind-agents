import { step } from "../../../lib/demoState";

export const dynamic = "force-dynamic";

export async function POST() {
  step();
  return new Response("ok");
}
