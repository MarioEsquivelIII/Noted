import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { runCanvasSync } from "@/lib/canvas/sync";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const courseIds: string[] | undefined = body.courseIds;

  try {
    const result = await runCanvasSync(user.id, courseIds);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Canvas sync failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 },
    );
  }
}
