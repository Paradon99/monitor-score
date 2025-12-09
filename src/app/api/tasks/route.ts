import { NextResponse } from "next/server";
import { supabaseService } from "../../../../lib/supabaseServer";

const isUUID = (v: string) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(v);
const genId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `task_${Date.now()}`);

export async function GET() {
  if (!supabaseService) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  const { data, error } = await supabaseService.from("tasks").select("id,name,description,created_at").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

export async function POST(req: Request) {
  if (!supabaseService) return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  try {
    const body = await req.json();
    const name: string = body.name;
    const cloneFrom: string | undefined = body.cloneFrom;
    if (!name) return NextResponse.json({ error: "缺少任务名称" }, { status: 400 });

    const newTaskId = genId();
    const { error: insertErr } = await supabaseService.from("tasks").insert({ id: newTaskId, name, description: body.description || "" });
    if (insertErr) throw insertErr;

    if (cloneFrom) {
      // 仅复制覆盖关系与评分（系统/工具/指标为全局，不再克隆系统）
      const { data: sysTools } = await supabaseService
        .from("system_tools")
        .select("system_id,tool_id,caps_selected")
        .eq("task_id", cloneFrom);
      if (sysTools && sysTools.length) {
        const rows = sysTools
          .map((st) => ({
            system_id: st.system_id,
            tool_id: st.tool_id,
            caps_selected: st.caps_selected || [],
            task_id: newTaskId,
          }))
          .filter((r) => r.system_id && r.tool_id);
        if (rows.length) {
          const { error } = await supabaseService.from("system_tools").insert(rows);
          if (error) throw error;
        }
      }

      const { data: sysScen } = await supabaseService
        .from("system_scenarios")
        .select("system_id,scenario_id,checked")
        .eq("task_id", cloneFrom);
      if (sysScen && sysScen.length) {
        const rows = sysScen
          .map((sc) => ({
            system_id: sc.system_id,
            scenario_id: sc.scenario_id && isUUID(sc.scenario_id) ? sc.scenario_id : undefined,
            checked: sc.checked,
            task_id: newTaskId,
          }))
          .filter((r) => r.system_id && r.scenario_id);
        if (rows.length) {
          const { error } = await supabaseService.from("system_scenarios").insert(rows);
          if (error) throw error;
        }
      }

      const { data: scores } = await supabaseService
        .from("scores")
        .select("system_id,rule_version,total,part1,part2,part3,part4,details")
        .eq("task_id", cloneFrom);
      if (scores && scores.length) {
        const rows = scores
          .map((sc) => ({
            system_id: sc.system_id,
            rule_version: sc.rule_version,
            total: sc.total,
            part1: sc.part1,
            part2: sc.part2,
            part3: sc.part3,
            part4: sc.part4,
            details: sc.details,
            task_id: newTaskId,
          }))
          .filter((r) => r.system_id);
        if (rows.length) {
          const { error } = await supabaseService.from("scores").insert(rows);
          if (error) throw error;
        }
      }
    }

    return NextResponse.json({ ok: true, id: newTaskId });
  } catch (e: any) {
    console.error("create-task error", e);
    return NextResponse.json({ error: e.message || "create failed" }, { status: 500 });
  }
}
