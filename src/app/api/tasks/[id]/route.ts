import { NextResponse, NextRequest } from "next/server";
import { supabaseService } from "../../../../../lib/supabaseServer";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!supabaseService) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const name = body.name as string;
    const description = body.description as string | undefined;
    if (!name) return NextResponse.json({ error: "缺少任务名称" }, { status: 400 });
    const { error } = await supabaseService.from("tasks").update({ name, description }).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("task rename error", e);
    return NextResponse.json({ error: e.message || "update failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!supabaseService) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { id } = await params;
  try {
    // 删除该任务下的关联数据
    await supabaseService.from("system_tools").delete().eq("task_id", id);
    await supabaseService.from("system_scenarios").delete().eq("task_id", id);
    await supabaseService.from("scores").delete().eq("task_id", id);
    const { error } = await supabaseService.from("tasks").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("task delete error", e);
    return NextResponse.json({ error: e.message || "delete failed" }, { status: 500 });
  }
}
