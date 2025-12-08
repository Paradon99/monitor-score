import { NextResponse } from "next/server";
import { supabaseService } from "../../../../lib/supabaseServer";

const isUUID = (v: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(v);

export async function POST(req: Request) {
  if (!supabaseService) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const id = body.id as string;
    const name = (body.name as string) || "";
    const taskId = body.taskId as string | undefined;

    // 如果是 UUID，直接按 id 删除
    if (id && isUUID(id)) {
      await supabaseService.from("system_tools").delete().eq("system_id", id);
      await supabaseService.from("system_scenarios").delete().eq("system_id", id);
      await supabaseService.from("scores").delete().eq("system_id", id);
      const { error } = await supabaseService.from("systems").delete().eq("id", id).eq("task_id", taskId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    // 非 UUID：按名称查找并删除匹配的系统
    if (name) {
      const query = supabaseService.from("systems").select("id").eq("name", name);
      const { data: rows, error: queryErr } = taskId ? await query.eq("task_id", taskId) : await query;
      if (queryErr) throw queryErr;
      const ids = (rows || []).map((r) => r.id);
      for (const sid of ids) {
        if (taskId) {
          await supabaseService.from("system_tools").delete().eq("system_id", sid).eq("task_id", taskId);
          await supabaseService.from("system_scenarios").delete().eq("system_id", sid).eq("task_id", taskId);
          await supabaseService.from("scores").delete().eq("system_id", sid).eq("task_id", taskId);
          await supabaseService.from("systems").delete().eq("id", sid).eq("task_id", taskId);
        } else {
          await supabaseService.from("system_tools").delete().eq("system_id", sid);
          await supabaseService.from("system_scenarios").delete().eq("system_id", sid);
          await supabaseService.from("scores").delete().eq("system_id", sid);
          await supabaseService.from("systems").delete().eq("id", sid);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("delete-system error", e);
    return NextResponse.json({ error: e.message || "delete failed" }, { status: 500 });
  }
}
