import { NextResponse } from "next/server";
import { supabaseService } from "../../../../lib/supabaseServer";

export async function POST(req: Request) {
  if (!supabaseService) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  try {
    const body = await req.json();
    const { systemId, scores, ruleVersion, details, taskId } = body;
    if (!systemId || !scores || !taskId) return NextResponse.json({ error: "Missing payload" }, { status: 400 });

    const payload = {
      system_id: systemId,
      rule_version: ruleVersion || (process.env.NEXT_PUBLIC_RULE_VERSION || (scores.rule_version ?? "v1")),
      total: scores.total,
      part1: scores.part1,
      part2: scores.part2,
      part3: scores.part3,
      part4: scores.part4,
      details: details || scores,
      created_at: new Date().toISOString(),
      task_id: taskId,
    };

    const { error } = await supabaseService
      .from("scores")
      .upsert(payload, { onConflict: "task_id,system_id" });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("save-score error", e);
    return NextResponse.json({ error: e.message || "save failed" }, { status: 500 });
  }
}
