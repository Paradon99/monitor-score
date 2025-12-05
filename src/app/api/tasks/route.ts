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
      // 复制工具及指标
      const { data: tools } = await supabaseService
        .from("tools")
        .select("id,name,default_caps,tool_scenarios(id,category,metric,threshold,level)")
        .eq("task_id", cloneFrom);
      const toolMap: Record<string, string> = {};
      if (tools && tools.length) {
        const newToolRows = tools.map((t) => {
          const newId = genId();
          toolMap[t.id] = newId;
          return { id: newId, name: t.name, default_caps: t.default_caps || [], task_id: newTaskId };
        });
        const { error: toolErr } = await supabaseService.from("tools").insert(newToolRows);
        if (toolErr) throw toolErr;
        const scenRows: any[] = [];
        tools.forEach((t) => {
          t.tool_scenarios?.forEach((s: any) => {
            scenRows.push({
              id: genId(),
              tool_id: toolMap[t.id],
              category: s.category,
              metric: s.metric,
              threshold: s.threshold || "",
              level: s.level || "gray",
              task_id: newTaskId,
            });
          });
        });
        if (scenRows.length) {
          const { error: scenErr } = await supabaseService.from("tool_scenarios").insert(scenRows);
          if (scenErr) throw scenErr;
        }
      }

      // 复制系统及关联
      const { data: systems } = await supabaseService
        .from("systems")
        .select("id,name,class,is_self_built,server_coverage,app_coverage,server_total,server_covered,app_total,app_covered,documented_items")
        .eq("task_id", cloneFrom);
      const sysMap: Record<string, string> = {};
      if (systems && systems.length) {
        const sysRows = systems.map((s) => {
          const newId = genId();
          sysMap[s.id] = newId;
          return {
            id: newId,
            name: s.name,
            class: s.class,
            is_self_built: s.is_self_built,
            server_coverage: s.server_coverage,
            app_coverage: s.app_coverage,
            server_total: s.server_total,
            server_covered: s.server_covered,
            app_total: s.app_total,
            app_covered: s.app_covered,
            documented_items: s.documented_items,
            task_id: newTaskId,
          };
        });
        const { error: sysErr } = await supabaseService.from("systems").insert(sysRows);
        if (sysErr) throw sysErr;

        const { data: sysTools } = await supabaseService.from("system_tools").select("system_id,tool_id,caps_selected").eq("task_id", cloneFrom);
        if (sysTools && sysTools.length) {
          const rows = sysTools
            .map((st) => ({
              system_id: sysMap[st.system_id],
              tool_id: toolMap[st.tool_id],
              caps_selected: st.caps_selected || [],
              task_id: newTaskId,
            }))
            .filter((r) => r.system_id && r.tool_id);
          if (rows.length) {
            const { error } = await supabaseService.from("system_tools").insert(rows);
            if (error) throw error;
          }
        }

        const { data: sysScen } = await supabaseService.from("system_scenarios").select("system_id,scenario_id,checked").eq("task_id", cloneFrom);
        if (sysScen && sysScen.length) {
          const rows = sysScen
            .map((sc) => ({
              system_id: sysMap[sc.system_id],
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
              system_id: sysMap[sc.system_id],
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
    }

    return NextResponse.json({ ok: true, id: newTaskId });
  } catch (e: any) {
    console.error("create-task error", e);
    return NextResponse.json({ error: e.message || "create failed" }, { status: 500 });
  }
}
