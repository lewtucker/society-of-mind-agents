import { reset } from "../../../lib/demoState";

export const dynamic = "force-dynamic";

export async function POST() {
  reset();
  return new Response("ok");
}
