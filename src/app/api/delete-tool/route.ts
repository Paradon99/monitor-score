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

    const deleteById = async (toolId: string) => {
      // 删除引用的 system_scenarios -> 需要先查场景 id
      const { data: scenList } = await client.from("tool_scenarios").select("id").eq("tool_id", toolId);
      const scenIds = (scenList || []).map((s) => s.id);
      if (scenIds.length) {
        await client.from("system_scenarios").delete().in("scenario_id", scenIds);
      }
      await client.from("system_tools").delete().eq("tool_id", toolId);
      await client.from("tool_scenarios").delete().eq("tool_id", toolId);
      await client.from("tools").delete().eq("id", toolId);
    };

    if (id && isUUID(id)) {
      await deleteById(id);
      return NextResponse.json({ ok: true });
    }

    if (name) {
      const { data: rows, error } = await client.from("tools").select("id").eq("name", name);
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
