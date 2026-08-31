import { currentUid } from "@/auth";

/** The browser needs its own pseudonymous id to key local identity storage. */
export async function GET() {
  const uid = await currentUid();
  return new Response(JSON.stringify({ uid }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
