import { NextResponse } from "next/server";
import { supabaseService } from "../../../../lib/supabaseServer";

const isUUID = (v: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(v);

export async function POST(req: Request) {
  if (!supabaseService) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const client = supabaseService;
  try {
    const body = await req.json().catch(() => ({}));
    const id = body.id as string;
    const name = (body.name as string) || "";
    const taskId = body.taskId as string | undefined;

    const deleteById = async (toolId: string) => {
      // 删除引用的 system_scenarios -> 需要先查场景 id
      const scenQuery = client.from("tool_scenarios").select("id").eq("tool_id", toolId);
      const { data: scenList } = taskId ? await scenQuery.eq("task_id", taskId) : await scenQuery;
      const scenIds = (scenList || []).map((s) => s.id);
      if (scenIds.length) {
        const delSysScen = client.from("system_scenarios").delete().in("scenario_id", scenIds);
        if (taskId) await delSysScen.eq("task_id", taskId);
        else await delSysScen;
      }
      const delSysTool = client.from("system_tools").delete().eq("tool_id", toolId);
      if (taskId) await delSysTool.eq("task_id", taskId);
      else await delSysTool;
      const delScen = client.from("tool_scenarios").delete().eq("tool_id", toolId);
      if (taskId) await delScen.eq("task_id", taskId);
      else await delScen;
      const delTool = client.from("tools").delete().eq("id", toolId);
      if (taskId) await delTool.eq("task_id", taskId);
      else await delTool;
    };

    if (id && isUUID(id)) {
      await deleteById(id);
      return NextResponse.json({ ok: true });
    }

    if (name) {
      const query = client.from("tools").select("id").eq("name", name);
      const { data: rows, error } = taskId ? await query.eq("task_id", taskId) : await query;
      if (error) throw error;
      for (const row of rows || []) {
        await deleteById(row.id);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("delete-tool error", e);
    return NextResponse.json({ error: e.message || "delete failed" }, { status: 500 });
  }
}
