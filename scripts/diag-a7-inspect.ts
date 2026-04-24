import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

async function main() {
  const c = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await c
    .from("task_queue")
    .select("*")
    .eq("project_id", "diag-a7-zero-fal");
  console.log("error=", error);
  console.log("data=", JSON.stringify(data, null, 2));
}
main();
